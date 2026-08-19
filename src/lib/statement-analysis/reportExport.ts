// ── Exportable reports ───────────────────────────────────────────────────
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import type { StatementReport, StatementTransactionRow, StatementUploadRow } from "./types";
import { formatDate } from "@/lib/utils";

// jsPDF's built-in fonts (Helvetica etc.) don't include the ₦ glyph (U+20A6) —
// it renders as a broken box/pipe character. Rather than embed a custom
// Unicode font just for one symbol, PDF output uses the "NGN" prefix, which
// is standard on printed financial statements anyway. The in-app UI keeps
// the ₦ symbol (formatCurrency in utils.ts) since browsers render it fine.
function pdfCurrency(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  return `${sign}NGN ${Math.abs(amount).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

const NAVY: [number, number, number] = [10, 37, 64]; // #0A2540 — matches the app's brand navy
const GOLD: [number, number, number] = [201, 162, 39];

function safeFileBase(upload: StatementUploadRow): string {
  const base = upload.applicant_name || upload.account_name || upload.filename.replace(/\.[^.]+$/, "");
  return base.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

export function exportStatementReportPdf(upload: StatementUploadRow, report: StatementReport) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 0;

  // ── Letterhead ───────────────────────────────────────────────────────
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageWidth, 30, "F");
  doc.setFillColor(...GOLD);
  doc.rect(0, 30, pageWidth, 1.2, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("ILRMS — Charis Microfinance Bank", 14, 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text("Bank Statement & Credit Analysis Report", 14, 20);
  doc.setFontSize(8);
  doc.text(new Date(report.generatedAt).toLocaleString("en-NG"), pageWidth - 14, 13, { align: "right" });

  y = 40;

  // ── Applicant / statement meta ──────────────────────────────────────
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(upload.applicant_name || upload.account_name || "Applicant not specified", 14, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 100, 115);
  const meta = [
    `Bank: ${upload.bank_name || "Not detected"}   Account: ${upload.account_number || "—"}${upload.account_name ? ` (${upload.account_name})` : ""}`,
    `Statement period: ${upload.statement_start ? formatDate(upload.statement_start) : "—"} – ${upload.statement_end ? formatDate(upload.statement_end) : "—"}`,
  ];
  meta.forEach((line) => {
    doc.text(line, 14, y);
    y += 5;
  });
  y += 4;

  // ── Monthly summary (primary output) ──────────────────────────────────
  sectionTitle(doc, "Monthly Summary", 14, y);
  y += 5;

  autoTable(doc, {
    startY: y,
    head: [["Month", "Inflow", "Outflow", "Net"]],
    body: report.months.map((m) => [m.monthLabel, pdfCurrency(m.inflow), pdfCurrency(m.outflow), pdfCurrency(m.net)]),
    foot: [["Total", pdfCurrency(report.totals.inflow), pdfCurrency(report.totals.outflow), pdfCurrency(report.totals.net)]],
    theme: "grid",
    headStyles: { fillColor: NAVY, textColor: 255 },
    footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    styles: { fontSize: 9 },
  });

  // @ts-expect-error jspdf-autotable augments doc at runtime
  y = doc.lastAutoTable.finalY + 10;

  // ── Credit analysis ────────────────────────────────────────────────────
  if (y > 245) {
    doc.addPage();
    y = 18;
  }
  sectionTitle(doc, "Credit Analysis", 14, y);
  y += 5;

  const c = report.credit;
  autoTable(doc, {
    startY: y,
    body: [
      ["Months Analysed", String(c.monthsAnalyzed)],
      ["Average Monthly Inflow", pdfCurrency(c.avgMonthlyInflow)],
      ["Average Monthly Outflow", pdfCurrency(c.avgMonthlyOutflow)],
      ["Average Monthly Net Cash Flow", pdfCurrency(c.avgMonthlyNet)],
      ["Average Balance", pdfCurrency(c.avgBalance)],
      ["Lowest Balance", c.lowestBalance !== null ? pdfCurrency(c.lowestBalance) : "—"],
      ["Existing Obligations (avg/mo)", pdfCurrency(c.existingObligations)],
      ["Income Consistency", `${c.incomeConsistencyPct}%`],
      ["Cash-flow Stability", `${c.cashflowStabilityPct}% of months positive`],
      [
        "Primary Income Source",
        c.primaryIncome
          ? `${pdfCurrency(c.primaryIncome.avgAmount)}/mo (${c.primaryIncome.confidencePct}% confidence, ~day ${c.primaryIncome.avgDayOfMonth})`
          : "Not clearly identified",
      ],
    ],
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 1.5 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 70 }, 1: { halign: "right" } },
  });

  // @ts-expect-error jspdf-autotable augments doc at runtime
  y = doc.lastAutoTable.finalY + 5;

  // Assessment badge
  const badgeColor: Record<string, [number, number, number]> = {
    Strong: [22, 163, 74],
    Moderate: [217, 119, 6],
    Low: [220, 38, 38],
  };
  const [br, bg, bb] = badgeColor[c.assessment] || [100, 100, 100];
  doc.setFillColor(br, bg, bb);
  doc.roundedRect(14, y, 46, 8, 2, 2, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`${c.assessment} Capacity`, 14 + 23, y + 5.5, { align: "center" });
  y += 14;

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("Supporting notes", 14, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  c.assessmentNotes.forEach((note) => {
    if (y > 275) {
      doc.addPage();
      y = 18;
    }
    const split = doc.splitTextToSize(`•  ${note}`, pageWidth - 28);
    doc.text(split, 14, y);
    y += split.length * 4.2;
  });

  if (c.recurringObligations.length) {
    y += 4;
    if (y > 265) {
      doc.addPage();
      y = 18;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Recurring Payments", 14, y);
    y += 4;
    autoTable(doc, {
      startY: y,
      head: [["Description", "Avg Amount", "Times Seen"]],
      body: c.recurringObligations.map((p) => [p.sampleNarration, pdfCurrency(p.avgAmount), `${p.occurrences}/${c.monthsAnalyzed} months`]),
      theme: "striped",
      headStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42] },
      styles: { fontSize: 8 },
      columnStyles: { 1: { halign: "right" } },
    });
    // @ts-expect-error jspdf-autotable augments doc at runtime
    y = doc.lastAutoTable.finalY + 6;
  }

  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(130, 138, 150);
  const disclaimer = doc.splitTextToSize(
    "This report is generated automatically from the extracted statement data and is intended as a supporting reference only. Figures should be reconciled against the original statement, and rows flagged for review should be checked manually before use in a credit decision.",
    pageWidth - 28
  );
  if (y > 280) {
    doc.addPage();
    y = 18;
  }
  doc.text(disclaimer, 14, y);

  // Footer on every page
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(150, 158, 170);
    doc.text(`ILRMS — Charis Microfinance Bank  ·  Page ${i} of ${pageCount}`, pageWidth / 2, 291, { align: "center" });
  }

  doc.save(`statement-analysis-${safeFileBase(upload)}.pdf`);
}

function sectionTitle(doc: jsPDF, title: string, x: number, y: number) {
  doc.setFillColor(...GOLD);
  doc.rect(x, y - 3.5, 2.2, 5, "F");
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11.5);
  doc.text(title, x + 5, y);
}

// ── Excel export ─────────────────────────────────────────────────────────
// Three sheets: Monthly Summary, Credit Analysis, and the full transaction
// list — so the underlying data can be reconciled/re-worked outside the app.
export function exportStatementReportExcel(
  upload: StatementUploadRow,
  report: StatementReport,
  transactions: StatementTransactionRow[]
) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Monthly Summary
  const monthlyRows = [
    ["Bank Statement & Credit Analysis Report"],
    [`Applicant: ${upload.applicant_name || upload.account_name || "—"}`],
    [`Bank: ${upload.bank_name || "—"}   Account: ${upload.account_number || "—"} (${upload.account_name || "—"})`],
    [`Statement period: ${upload.statement_start ? formatDate(upload.statement_start) : "—"} – ${upload.statement_end ? formatDate(upload.statement_end) : "—"}`],
    [],
    ["Month", "Inflow", "Outflow", "Net"],
    ...report.months.map((m) => [m.monthLabel, m.inflow, m.outflow, m.net]),
    ["Total", report.totals.inflow, report.totals.outflow, report.totals.net],
  ];
  const wsMonthly = XLSX.utils.aoa_to_sheet(monthlyRows);
  wsMonthly["!cols"] = [{ wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsMonthly, "Monthly Summary");

  // Sheet 2: Credit Analysis
  const c = report.credit;
  const creditRows = [
    ["Credit Analysis"],
    [],
    ["Months Analysed", c.monthsAnalyzed],
    ["Average Monthly Inflow", c.avgMonthlyInflow],
    ["Average Monthly Outflow", c.avgMonthlyOutflow],
    ["Average Monthly Net Cash Flow", c.avgMonthlyNet],
    ["Average Balance", c.avgBalance],
    ["Lowest Balance", c.lowestBalance ?? "—"],
    ["Highest Balance", c.highestBalance ?? "—"],
    ["Existing Obligations (avg/mo)", c.existingObligations],
    ["Income Consistency (%)", c.incomeConsistencyPct],
    ["Cash-flow Stability (%)", c.cashflowStabilityPct],
    ["Positive Months", c.positiveMonths],
    ["Negative Months", c.negativeMonths],
    [
      "Primary Income Source",
      c.primaryIncome ? `${c.primaryIncome.avgAmount} / mo (${c.primaryIncome.confidencePct}% confidence, ~day ${c.primaryIncome.avgDayOfMonth})` : "Not clearly identified",
    ],
    ["Credit Assessment", c.assessment],
    [],
    ["Supporting Notes"],
    ...c.assessmentNotes.map((n) => [n]),
    [],
    ["Recurring Payments", "Avg Amount", "Times Seen"],
    ...c.recurringObligations.map((p) => [p.sampleNarration, p.avgAmount, `${p.occurrences}/${c.monthsAnalyzed} months`]),
  ];
  const wsCredit = XLSX.utils.aoa_to_sheet(creditRows);
  wsCredit["!cols"] = [{ wch: 40 }, { wch: 20 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, wsCredit, "Credit Analysis");

  // Sheet 3: Transactions
  const txnRows = [
    ["Date", "Narration", "Category", "Debit", "Credit", "Balance", "Needs Review", "Duplicate"],
    ...transactions.map((t) => [
      t.txn_date || "",
      t.narration,
      t.category,
      t.debit || "",
      t.credit || "",
      t.balance ?? "",
      t.needs_review ? "Yes" : "No",
      t.is_duplicate ? "Yes" : "No",
    ]),
  ];
  const wsTxn = XLSX.utils.aoa_to_sheet(txnRows);
  wsTxn["!cols"] = [{ wch: 12 }, { wch: 45 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, wsTxn, "Transactions");

  XLSX.writeFile(wb, `statement-analysis-${safeFileBase(upload)}.xlsx`);
}
