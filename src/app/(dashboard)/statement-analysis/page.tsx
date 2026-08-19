"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime, formatCurrency, cn } from "@/lib/utils";
import {
  Upload, FileText, FileSpreadsheet, Loader2, ScanSearch,
  CheckCircle2, AlertTriangle, XCircle, Trash2, ArrowRight, Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { runExtractionPipeline } from "@/lib/statement-analysis/pipeline";
import { buildReport } from "@/lib/statement-analysis/analyzer";
import {
  createUploadRecord, finalizeUpload, insertTransactions, listUploads,
  deleteUpload, uploadStatementFile,
} from "@/lib/statement-analysis/data";
import type { ProgressStep, StatementUploadRow, UploadStatus } from "@/lib/statement-analysis/types";

const STATUS_COLORS: Record<UploadStatus, string> = {
  uploaded: "bg-gray-100 text-gray-700",
  processing: "bg-blue-100 text-blue-800",
  needs_review: "bg-amber-100 text-amber-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
};

const PIPELINE_STEPS: { key: string; label: string }[] = [
  { key: "detect", label: "Detecting format" },
  { key: "extract", label: "Extracting transactions" },
  { key: "normalise", label: "Normalising data" },
  { key: "analyse", label: "Analysing & building summary" },
  { key: "save", label: "Saving results" },
];

function fileIcon(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return FileText;
  if (n.endsWith(".csv")) return FileSpreadsheet;
  if (n.endsWith(".xlsx") || n.endsWith(".xls")) return FileSpreadsheet;
  return ImageIcon;
}

export default function StatementAnalysisPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [steps, setSteps] = useState<ProgressStep[]>(
    PIPELINE_STEPS.map((s) => ({ ...s, status: "pending" }))
  );
  const [applicantName, setApplicantName] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const { data: history = [], isLoading } = useQuery({
    queryKey: ["statement-uploads"],
    queryFn: listUploads,
  });

  const markStep = (key: string, status: ProgressStep["status"]) => {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, status } : s)));
  };

  const resetPipelineUi = () => {
    setSteps(PIPELINE_STEPS.map((s) => ({ ...s, status: "pending" })));
    setProgressPct(0);
    setProgressLabel("");
  };

  const handleFile = useCallback((file: File) => {
    setPendingFile(file);
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const startAnalysis = async () => {
    if (!pendingFile) return;
    const file = pendingFile;
    setProcessing(true);
    resetPipelineUi();
    markStep("detect", "active");

    try {
      // Stage: Extract + normalise (pipeline.ts covers detect→extract→normalise)
      const extraction = await runExtractionPipeline(file, (message, pct) => {
        setProgressLabel(message);
        if (pct !== undefined) setProgressPct(pct);
        if (pct !== undefined && pct < 10) markStep("detect", "done");
        markStep("extract", "active");
      });
      markStep("detect", "done");
      markStep("extract", "done");
      markStep("normalise", "done");

      if (extraction.warnings.length) {
        extraction.warnings.forEach((w) => toast.warning(w));
      }

      // Stage: Analyse & generate summary
      markStep("analyse", "active");
      const report = buildReport(extraction.transactions);
      markStep("analyse", "done");

      // Stage: Save
      markStep("save", "active");
      const record = await createUploadRecord({
        filename: file.name,
        fileKind: extraction.method,
        applicantName: applicantName.trim() || undefined,
        fileSizeBytes: file.size,
      });

      const storagePath = await uploadStatementFile(file, record.id);
      if (storagePath) {
        await import("@/lib/statement-analysis/data").then((m) => m.updateUploadRecord(record.id, { storage_path: storagePath }));
      }

      await insertTransactions(record.id, extraction.transactions);

      const dates = extraction.transactions.map((t) => t.date).filter(Boolean) as string[];
      const start = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
      const end = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;

      const flaggedCount = extraction.transactions.filter((t) => t.needsReview).length;
      const status: UploadStatus = extraction.transactions.length === 0
        ? "failed"
        : flaggedCount > 0
        ? "needs_review"
        : "completed";

      await finalizeUpload({
        id: record.id,
        bankName: extraction.bankNameGuess,
        accountName: extraction.accountNameGuess,
        accountNumber: extraction.accountNumberGuess,
        statementStart: start,
        statementEnd: end,
        status,
        extractionMethod: extraction.method,
        totalTransactions: extraction.transactions.length,
        flaggedTransactions: flaggedCount,
        duplicateTransactions: extraction.transactions.filter((t) => t.isDuplicate).length,
        report,
        errorMessage: extraction.transactions.length === 0 ? "No transactions could be extracted from this file." : null,
      });

      markStep("save", "done");
      queryClient.invalidateQueries({ queryKey: ["statement-uploads"] });
      toast.success("Statement analysed successfully");
      router.push(`/statement-analysis/${record.id}`);
    } catch (err) {
      console.error(err);
      markStep("save", "error");
      toast.error(err instanceof Error ? err.message : "Failed to analyse statement");
    } finally {
      setProcessing(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this analysis? This cannot be undone.")) return;
    try {
      await deleteUpload(id);
      queryClient.invalidateQueries({ queryKey: ["statement-uploads"] });
      toast.success("Deleted");
    } catch {
      toast.error("Failed to delete");
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Bank Statement Analysis"
        description="Upload a bank statement to get a monthly inflow/outflow summary and credit analysis"
      />

      {/* Upload card */}
      <div className="bg-card rounded-xl border border-border shadow-sm p-6 mb-8">
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Applicant / customer name (optional)
            </label>
            <input
              value={applicantName}
              onChange={(e) => setApplicantName(e.target.value)}
              placeholder="e.g. John Adeyemi"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background"
              disabled={processing}
            />
          </div>
        </div>

        {!pendingFile ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={cn(
              "border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all",
              dragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/40 hover:bg-muted/20"
            )}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.csv,.xlsx,.xls,.png,.jpg,.jpeg,.webp"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            <div className="flex items-center justify-center gap-3 mb-3">
              <FileText className="w-8 h-8 text-blue-600" />
              <FileSpreadsheet className="w-8 h-8 text-green-600" />
              <ScanSearch className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="font-semibold text-foreground">Drop a bank statement here or click to browse</p>
            <p className="text-sm text-muted-foreground mt-1">
              Supports PDF (including scanned/image statements via OCR), CSV, and Excel — any bank, any layout
            </p>
          </div>
        ) : (
          <div className="border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                {(() => { const Icon = fileIcon(pendingFile.name); return <Icon className="w-5 h-5 text-primary flex-shrink-0" />; })()}
                <span className="font-medium text-foreground text-sm truncate">{pendingFile.name}</span>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {(pendingFile.size / 1024).toFixed(0)} KB
                </span>
              </div>
              {!processing && (
                <button
                  onClick={() => setPendingFile(null)}
                  className="text-xs text-muted-foreground hover:text-destructive flex-shrink-0"
                >
                  Remove
                </button>
              )}
            </div>

            {!processing ? (
              <button
                onClick={startAnalysis}
                className="mt-2 flex items-center gap-2 px-4 py-2 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90"
              >
                <ScanSearch className="w-4 h-4" /> Analyse Statement
              </button>
            ) : (
              <div className="mt-3">
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden mb-3">
                  <div
                    className="h-full brand-gradient transition-all duration-300"
                    style={{ width: `${Math.max(4, progressPct)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mb-3">{progressLabel || "Working…"}</p>
                <div className="flex flex-wrap gap-2">
                  {steps.map((s) => (
                    <span
                      key={s.key}
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                        s.status === "done" && "bg-green-100 text-green-800",
                        s.status === "active" && "bg-blue-100 text-blue-800",
                        s.status === "error" && "bg-red-100 text-red-800",
                        s.status === "pending" && "bg-gray-100 text-gray-500"
                      )}
                    >
                      {s.status === "done" && <CheckCircle2 className="w-3 h-3" />}
                      {s.status === "active" && <Loader2 className="w-3 h-3 animate-spin" />}
                      {s.status === "error" && <XCircle className="w-3 h-3" />}
                      {s.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* History */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-4">Analysis History</h2>
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Applicant / File</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Bank</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Net Cash Flow</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Assessment</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-5 py-3"><div className="h-4 bg-muted animate-pulse rounded" /></td>
                      ))}
                    </tr>
                  ))
                ) : (history as StatementUploadRow[]).map((u) => (
                  <tr
                    key={u.id}
                    className="hover:bg-muted/20 transition-colors cursor-pointer"
                    onClick={() => router.push(`/statement-analysis/${u.id}`)}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {(() => { const Icon = fileIcon(u.filename); return <Icon className="w-4 h-4 text-primary flex-shrink-0" />; })()}
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{u.applicant_name || u.account_name || u.filename}</p>
                          {(u.applicant_name || u.account_name) && <p className="text-xs text-muted-foreground truncate">{u.filename}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{u.bank_name || "—"}</td>
                    <td className="px-5 py-3 text-right">
                      {u.report ? (
                        <span className={cn("font-medium", u.report.totals.net >= 0 ? "text-success" : "text-destructive")}>
                          {formatCurrency(u.report.totals.net)}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-5 py-3">
                      {u.report?.credit?.assessment ? (
                        <span className={cn(
                          "text-xs font-semibold px-2 py-0.5 rounded-full",
                          u.report.credit.assessment === "Strong" && "bg-green-100 text-green-800",
                          u.report.credit.assessment === "Moderate" && "bg-amber-100 text-amber-800",
                          u.report.credit.assessment === "Low" && "bg-red-100 text-red-800",
                        )}>
                          {u.report.credit.assessment}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground text-xs">{formatDateTime(u.created_at)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={u.status} colorClass={STATUS_COLORS[u.status]} />
                        {u.flagged_transactions > 0 && (
                          <span title={`${u.flagged_transactions} rows need review`}>
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(u.id); }}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <ArrowRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </td>
                  </tr>
                ))}
                {!isLoading && history.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">
                      No statements analysed yet — upload one above to get started
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
