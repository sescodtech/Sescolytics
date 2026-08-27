# PDF Extraction Upgrade — Bank Statement Analysis

This upgrade replaces the PDF/OCR extraction layer inside
`src/lib/statement-analysis/` with a **column-aware** pipeline. It does not
touch the analysis, categorisation, scoring, dashboard, database, or UI —
only how transactions are read out of a PDF/scanned/image statement before
they reach the existing (unchanged) normalisation and analysis stages.

**CSV and Excel (.xlsx/.xls) extraction is untouched.** `parseCsv` and
`parseXlsx` in `fileReaders.ts`, and `detectColumnMapping` /
`extractRowsFromMatrix` in `tableDetector.ts`, are exactly as they were. The
new PDF/OCR path was built to *feed into* that same tested code rather than
duplicate or replace it (see "How it works" below).

## The problem this fixes

The previous PDF pipeline flattened every page into plain text lines, then
guessed which trailing number on a line was the debit, credit, or balance
purely by counting how many numbers appeared (`amounts.length === 1 / 2 /
>=3`). That breaks the moment a statement doesn't match the assumed order,
and it ignores the one thing a rendered/scanned page actually gives us for
free: where each word sits on the page — which *is* how the statement's own
columns are laid out.

## How it works now

**PDF → detect text vs scanned → extract with column awareness:**

1. **Text-layer PDFs** (`fileReaders.ts::extractPdf`) — every word from
   `pdfjs-dist`'s text content is kept with its `(x, y)` position, not just
   flattened into a line string.
2. **Scanned/image PDFs** — pages are rendered at 2.5x scale, run through a
   new grayscale + Otsu-threshold binarisation pass
   (`preprocessCanvasForOcr`) to improve contrast on photocopied/low-quality
   scans, then OCR'd with Tesseract.js in **word-bounding-box mode**, so we
   get the same `(x, y, width, confidence)` per word that a text-layer PDF
   gives us — just with a confidence score attached.
3. **Plain image uploads** (`extractImage`) go through the same
   preprocessing + word-bbox OCR.

All three now produce the same shape: `PositionedToken[]` per page
(`types.ts`).

**Column reconstruction** (`pdfTable.ts`, new file):
- Tokens are grouped into visual rows by Y-position (adaptive tolerance
  based on the page's own font size).
- Words on a row are merged into cells based on horizontal gap (a gap wider
  than ~2 characters starts a new cell — this is what turns "Transaction
  Date" back into one header label instead of two).
- The pipeline scans for whichever row scores highest against the existing
  alias list (`Date`, `Narration`, `Debit`, `Credit`, `Balance`, `DR/CR`,
  `Withdrawal`, `Deposit`, etc. — same aliases already used for CSV/XLSX) to
  find the **real header row**, wherever it is in the document.
- That header row's cell X-positions become column boundaries (midpoint
  between adjacent header cells). Every other row — including on later
  pages — has its words bucketed into those same columns by position.
- The result is a `string[][]` matrix identical in shape to what
  `parseXlsx` already produces, which is then fed into the **same**
  `matrixToRows` / `detectColumnMapping` / `normalizeMappedRows` functions
  used for spreadsheets. Column mapping logic isn't duplicated for PDFs —
  it's reused.

**If no row scores confidently as a header** (very messy/garbled layout),
the pipeline falls back to the previous line-based "date + trailing
numbers" scan rather than forcing a column mapping onto a layout it can't
actually read, and adds a warning telling the user to review the results.

## Additional accuracy/validation work (`tableDetector.ts`, `normalizer.ts`)

- **Multi-page & transactions split across pages**: rows are built across
  all pages in document order before column mapping runs, so a transaction
  whose description wraps onto the next page is handled the same as one
  that wraps within a page.
- **Continuation-row merging** (`mergeContinuationRows`): a row with
  narration text but no date and no amount (a wrapped description line) is
  folded into the previous transaction instead of becoming a bogus row.
- **Header/footer/page-number/duplicate-row removal** (`stripNoiseRows`):
  repeated column headers on later pages and boilerplate like "Page 2 of
  12" or "Continued on next page" are detected and dropped before they can
  pollute a narration or be miscounted as a transaction. (Exact-duplicate
  transaction rows were already deduplicated via content hash — unchanged.)
- **Opening/closing balance detection** (`detectOpeningClosingBalance`):
  scans the top/bottom of the document for "Opening Balance" / "Balance
  B/F" and "Closing Balance" / "Balance C/F" lines.
- **Mathematical running-balance validation**
  (`normalizer.ts::applyRunningBalanceValidation`): every row with a
  balance is checked against `previous balance + credit − debit`. This
  both (a) auto-corrects the common case of a swapped debit/credit column,
  since the arithmetic proves which way it goes, and (b) flags a genuine
  mismatch for manual review rather than silently trusting a misread digit.
  The statement's closing balance is also cross-checked against the last
  extracted row.
- **Embedded DR/CR handling**: some layouts print `5,000.00 DR` in a single
  amount cell with no separate indicator column — this is now checked in
  addition to a standalone Dr/Cr column.
- **Low-confidence OCR flagging**: each OCR'd row carries its average word
  confidence through to `normalizeMappedRows`; rows below ~70% confidence
  are flagged with a review reason instead of being silently trusted.
- **Date/amount format handling** — unchanged and reused as-is
  (`parseDateFlexible` / `parseAmount` already handled DD/MM/YYYY, ISO,
  Excel serials, "12 Jan 2026", `₦`-prefixed and comma-formatted amounts,
  parenthesised negatives).

## What was intentionally left alone

- `analyzer.ts`, `categorizer.ts`, `recurrence.ts`, `reportExport.ts`,
  `data.ts` — no changes.
- The `/statement-analysis` and `/statement-analysis/[id]` pages, database
  schema, and `ExtractionResult` shape used by the UI — no changes (a few
  new *optional* fields were added to `ExtractionResult`, e.g.
  `openingBalanceGuess`, for internal use; nothing existing was removed or
  renamed).
- CSV/XLSX extraction — no changes.

## Testing notes

This was validated with a synthetic multi-page token fixture covering: a
header on page 1 only, a wrapped narration line, a repeated header on page
2, a page-number footer line, and a deliberately swapped debit/credit row —
confirming the column reconstruction, continuation-merge, noise-strip, and
balance-validation/auto-correct steps all behave correctly together, and
that the fallback line-scan engages when no header can be confidently
found. A full `npm run build` (strict TypeScript, Next.js 15) passes clean.
Because this repo has no bundled sample Nigerian bank statement PDFs, real
scanned/text statements from GTBank/Access/Zenith/UBA/etc. layouts should
still be run through `/statement-analysis` before this goes live, per the
brief — the `columnLayoutDetected` field now returned by the pipeline (and
the warnings array) make it easy to see, per upload, whether the column
path or the fallback path was used.
