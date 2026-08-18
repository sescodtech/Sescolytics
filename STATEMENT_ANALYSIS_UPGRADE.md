# Upgrade: Bank Statement Analysis + Credit Analysis

Added as a new module inside the existing ILRMS / Charis-Mfb-Tracker app —
nothing in the original app was rebuilt or removed.

## 1. Run the migration

In the Supabase SQL editor, run `schema_statement_analysis.sql` **after**
the base `schema.sql`. It's additive: two new tables
(`statement_uploads`, `statement_transactions`), a private
`statement-files` storage bucket for the original uploaded file, and RLS
policies matching the rest of the app (any authenticated staff member can
read/write).

## 2. Install the two new dependencies

```
npm install
```

`pdfjs-dist` (PDF text extraction) and `tesseract.js` (OCR for scanned
statements) were added to `package.json`.

## 3. What was built

- **`/statement-analysis`** — upload a statement (PDF, scanned/image PDF,
  CSV, or Excel), watch it move through the pipeline
  (Detect → Extract → Normalise → Analyse → Save), and see analysis history.
- **`/statement-analysis/[id]`** — the results dashboard: top-line
  inflow/outflow/net figures, the **Monthly Summary table** (the main
  output, per spec), a chart, an optional/collapsed category breakdown,
  the **Credit Analysis** panel with supporting figures and a Low /
  Moderate / Strong assessment, and a searchable transaction table with
  review flags. "Export Report" produces a PDF via jsPDF.
- **`src/lib/statement-analysis/`** — the actual pipeline, kept separate
  from UI so it can be reused (e.g. from a future bulk/API flow):
  - `fileReaders.ts` — CSV/XLSX parsing, PDF text extraction via
    `pdfjs-dist`, and an OCR fallback via `tesseract.js` when a PDF has no
    text layer (scanned/image statements) or the file is a plain image.
  - `tableDetector.ts` — bank-agnostic column alias matching for
    CSV/XLSX, and a line-pattern scanner (date + trailing amounts) for
    PDFs/OCR text that has no columns at all.
  - `normalizer.ts` — turns raw rows/lines into normalised transactions:
    flexible date parsing, debit/credit resolution, confidence scoring,
    review flags, and duplicate detection via a content hash.
  - `categorizer.ts` — keyword-based inflow/outflow sub-categories
    (salary, transfers, cash deposits/withdrawals, loan repayment, bank
    charges, etc.) — intentionally secondary to the monthly totals.
  - `analyzer.ts` — builds the monthly summary and the credit analysis
    (averages, obligations, income consistency, cash-flow stability, and
    an explainable Low/Moderate/Strong assessment with the reasoning
    spelled out, not just a score).
  - `pipeline.ts` — orchestrates the above end to end for one file.
  - `data.ts` — Supabase reads/writes for the two new tables.
  - `reportExport.ts` — the downloadable PDF report.

## 4. Design notes / what's intentionally not built yet

- **No fixed bank format.** Column names and PDF layouts are matched by
  alias/heuristic, not hard-coded — this is what lets the same pipeline
  handle different banks. Anything the extractor isn't confident about is
  flagged `needs_review` rather than silently included in the totals.
- **OCR runs in the browser** (Tesseract.js WASM), not on a server. This
  keeps the free-tier product cheap to run with no OCR API bill, at the
  cost of being slower on large scanned statements — acceptable for a v1.
- **Duplicates** are detected via a hash of (date, narration, debit,
  credit, balance) and excluded from totals, both client-side and via a
  DB unique index as a second line of defence.
- **Monetisation/usage limits/API access were intentionally not
  implemented** per the brief — `uploaded_by` and `customer_id` on
  `statement_uploads` are enough to bolt a per-account quota on top later
  without another migration.
- The two new tables aren't in the generated `src/lib/supabase/types.ts`
  (that file is codegen output for the original schema). `data.ts` owns
  typed access to the new tables directly rather than hand-editing
  generated code — regenerate `types.ts` from Supabase later and this can
  be simplified to use the typed client throughout.
