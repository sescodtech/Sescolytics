// ── Exportable report ────────────────────────────────────────────────────
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { StatementReport, StatementUploadRow } from "./types";
import { formatCurrency, formatDate } from "@/lib/utils";

export function exportStatementReportPdf(upload: StatementUploadRow, report: StatementReport) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 18;

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Bank Statement & Credit Analysis Report", 14, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const meta = [
    `Applicant: ${upload.applicant_name || "—"}`,
    `Bank: ${upload.bank_name || "—"}    Account: ${upload.account_number || "—"} (${upload.account_name || "—"})`,
    `Statement period: ${upload.statement_start ? formatDate(upload.statement_start) : "—"} – ${upload.statement_end ? formatDate(upload.statement_end) : "—"}`,
    `Generated: ${new Date(report.generatedAt).toLocaleString("en-NG")}`,
  ];
  meta.forEach((line) => {
    doc.text(line, 14, y);
    y += 5;
  });
  y += 3;

  // ── Monthly summary (primary output) ──────────────────────────────────
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Monthly Summary", 14, y);
  y += 4;

  autoTable(doc, {
    startY: y,
    head: [["Month", "Inflow", "Outflow", "Net"]],
    body: report.months.map((m) => [
      m.monthLabel,
      formatCurrency(m.inflow),
      formatCurrency(m.outflow),
      formatCurrency(m.net),
    ]),
    foot: [[
      "Total",
      formatCurrency(report.totals.inflow),
      formatCurrency(report.totals.outflow),
      formatCurrency(report.totals.net),
    ]],
    theme: "grid",
    headStyles: { fillColor: [30, 41, 59] },
    footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
    styles: { fontSize: 9 },
  });

  // @ts-expect-error jspdf-autotable augments doc at runtime
  y = doc.lastAutoTable.finalY + 10;

  // ── Credit analysis ────────────────────────────────────────────────────
  if (y > 250) {
    doc.addPage();
    y = 18;
  }
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Credit Analysis", 14, y);
  y += 4;

  const c = report.credit;
  autoTable(doc, {
    startY: y,
    body: [
      ["Months Analysed", String(c.monthsAnalyzed)],
      ["Average Monthly Inflow", formatCurrency(c.avgMonthlyInflow)],
      ["Average Monthly Outflow", formatCurrency(c.avgMonthlyOutflow)],
      ["Average Monthly Net Cash Flow", formatCurrency(c.avgMonthlyNet)],
      ["Average Balance", formatCurrency(c.avgBalance)],
      ["Lowest Balance", c.lowestBalance !== null ? formatCurrency(c.lowestBalance) : "—"],
      ["Existing Obligations (avg/mo)", formatCurrency(c.existingObligations)],
      ["Income Consistency", `${c.incomeConsistencyPct}%`],
      ["Cash-flow Stability", `${c.cashflowStabilityPct}% of months positive`],
      ["Credit Assessment", c.assessment],
    ],
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 1.5 },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 70 } },
  });

  // @ts-expect-error jspdf-autotable augments doc at runtime
  y = doc.lastAutoTable.finalY + 6;

  doc.setFontSize(9);
  doc.setFont("helvetica", "italic");
  c.assessmentNotes.forEach((note) => {
    const split = doc.splitTextToSize(`• ${note}`, pageWidth - 28);
    doc.text(split, 14, y);
    y += split.length * 4.2;
  });

  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(120);
  const disclaimer = doc.splitTextToSize(
    "This report is generated automatically from the extracted statement data and is intended as a supporting reference only. Figures should be reconciled against the original statement, and rows flagged for review should be checked manually before use in a credit decision.",
    pageWidth - 28
  );
  if (y > 270) {
    doc.addPage();
    y = 18;
  }
  doc.text(disclaimer, 14, y);

  doc.save(`statement-analysis-${(upload.applicant_name || upload.filename).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`);
}
