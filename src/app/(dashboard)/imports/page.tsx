"use client";

import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/utils";
import {
  Upload, FileText, CheckCircle, XCircle, Loader2,
  Download, CreditCard, TrendingUp, FileSpreadsheet, AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { resolveOrCreateCustomer } from "@/lib/imports/customerResolver";
import {
  LOAN_FIELD_ALIASES, LOAN_FIELD_LABELS, LOAN_REQUIRED_FIELDS,
  INVESTMENT_FIELD_ALIASES, INVESTMENT_FIELD_LABELS, INVESTMENT_REQUIRED_FIELDS,
  detectFieldMapping, type FieldMappingEntry,
} from "@/lib/imports/fieldMapping";

// ── Types ────────────────────────────────────────────────────
type CSVRow = Record<string, string>;
type ImportType = "loans" | "investments";

const getImportStatusColor = (s: string) => ({
  processing: "bg-blue-100 text-blue-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
}[s] ?? "bg-gray-100 text-gray-700");

// ── Column helpers ───────────────────────────────────────────
// Accepts any variant of a column name (case-insensitive, trimmed)
const col = (row: CSVRow, ...keys: string[]): string => {
  const rowLower: Record<string, string> = {};
  Object.keys(row).forEach(k => { rowLower[k.toLowerCase().trim()] = row[k]; });
  for (const key of keys) {
    const val = rowLower[key.toLowerCase().trim()];
    if (val !== undefined && String(val).trim() !== "") return String(val).trim();
  }
  return "";
};

const num = (row: CSVRow, ...keys: string[]): number => {
  const raw = col(row, ...keys).replace(/[₦,\s]/g, "");
  return parseFloat(raw) || 0;
};

const dateStr = (row: CSVRow, ...keys: string[]): string => {
  const raw = col(row, ...keys);
  if (!raw) return new Date().toISOString().slice(0, 10);
  // Excel serial number
  if (/^\d{4,5}$/.test(raw)) {
    const date = XLSX.SSF.parse_date_code(parseInt(raw));
    return `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`;
  }
  // DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    const [d, m, y] = raw.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // MM/DD/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    const [m, d, y] = raw.split("/");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // DD-MM-YYYY
  if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(raw)) {
    const [d, m, y] = raw.split("-");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
};

// ── Read file → array of row objects ────────────────────────
function readFile(file: File): Promise<CSVRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, {
          type: "array",
          cellDates: false, // keep as serial so we can detect them
          raw: true,
        });
        // Use first sheet
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<CSVRow>(sheet, {
          defval: "",
          raw: false, // convert to string
        });
        resolve(rows as CSVRow[]);
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ── Template downloads ───────────────────────────────────────
function downloadTemplate(type: ImportType) {
  const loanData = [
    ["loan_number", "customer_name", "customer_phone", "customer_email", "principal_amount", "interest_amount",
      "total_amount", "amount_paid", "outstanding_balance", "start_date", "due_date", "repayment_frequency"],
    ["LN-001", "John Adeyemi", "08012345678", "john@email.com", "500000", "50000", "550000", "0", "550000", "2024-01-01", "2024-12-31", "monthly"],
    ["LN-002", "Ngozi Okafor", "08098765432", "", "200000", "20000", "220000", "50000", "170000", "2024-02-01", "2024-08-01", "weekly"],
  ];
  const invData = [
    ["investment_number", "customer_name", "customer_phone", "customer_email", "amount", "interest_rate", "duration_days", "start_date", "maturity_date", "notes"],
    ["INV-001", "Mary Okonkwo", "08011112222", "mary@email.com", "1000000", "12.5", "365", "2024-01-01", "2024-12-31", "Fixed deposit"],
    ["INV-002", "Emeka Chukwu", "08033334444", "", "500000", "10", "180", "2024-03-01", "2024-08-28", ""],
  ];
  const ws = XLSX.utils.aoa_to_sheet(type === "loans" ? loanData : invData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, type === "loans" ? "Loans" : "Investments");
  XLSX.writeFile(wb, `${type}_import_template.xlsx`);
}

// ── Import Loans ─────────────────────────────────────────────
async function importLoans(rows: CSVRow[], fileName: string) {
  const batchId = crypto.randomUUID();
  let created = 0, updated = 0, failed = 0, needsReview = 0;
  const errors: { row: number; error: string }[] = [];

  await supabase.from("loan_import_batches").insert({
    id: batchId,
    filename: `[LOANS] ${fileName}`,
    total_records: rows.length,
    status: "processing",
    successful_records: 0,
    failed_records: 0,
  });

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const loanNumber = col(row, ...LOAN_FIELD_ALIASES.loan_number);
      if (!loanNumber) throw new Error("Missing loan number — check column name");

      const customerName = col(row, ...LOAN_FIELD_ALIASES.customer_name);
      const customerPhone = col(row, ...LOAN_FIELD_ALIASES.customer_phone);
      const customerEmail = col(row, ...LOAN_FIELD_ALIASES.customer_email);

      const principal = num(row, ...LOAN_FIELD_ALIASES.principal_amount);
      const interest = num(row, ...LOAN_FIELD_ALIASES.interest_amount);
      const total = num(row, ...LOAN_FIELD_ALIASES.total_amount) || (principal + interest);
      const paid = num(row, ...LOAN_FIELD_ALIASES.amount_paid);
      const outstanding = num(row, ...LOAN_FIELD_ALIASES.outstanding_balance) || (total - paid);

      const startDate = dateStr(row, ...LOAN_FIELD_ALIASES.start_date);
      const dueDateRaw = col(row, ...LOAN_FIELD_ALIASES.due_date);
      const dueDate = dateStr(row, ...LOAN_FIELD_ALIASES.due_date);

      const rawFreq = col(row, ...LOAN_FIELD_ALIASES.repayment_frequency).toLowerCase();
      const freqMap: Record<string, string> = {
        daily: "daily", weekly: "weekly", biweekly: "biweekly", "bi-weekly": "biweekly",
        "bi weekly": "biweekly", monthly: "monthly", quarterly: "quarterly",
        bullet: "bullet", lump: "bullet", "lump sum": "bullet", annual: "quarterly",
      };
      const repaymentFreq = freqMap[rawFreq] ?? "monthly";

      // Resolve/create the customer from whatever contact info this row has —
      // never require the user to have pre-created the customer record.
      const resolution = customerName || customerPhone || customerEmail
        ? await resolveOrCreateCustomer({ name: customerName, phone: customerPhone, email: customerEmail }, `${Date.now()}-${i}`)
        : null;

      if (!dueDateRaw) needsReview++;

      const loanPayload = {
        loan_number: loanNumber,
        customer_id: resolution?.customerId ?? null,
        customer_name: customerName || "Unknown",
        customer_phone: customerPhone || null,
        principal_amount: principal,
        interest_amount: interest,
        total_amount: total,
        amount_paid: paid,
        outstanding_balance: outstanding,
        start_date: startDate,
        due_date: dueDate,
        status: (outstanding <= 0 ? "completed" : "active") as "active" | "completed",
        collection_status: (paid > 0 && outstanding > 0 ? "partially_paid" : "current") as "current" | "partially_paid",
        repayment_frequency: repaymentFreq as Tables_repayment_freq,
        import_batch_id: batchId,
      };

      // Never blindly duplicate: if this loan number already exists, update
      // it in place instead of erroring out or creating a second row.
      const { data: existingLoan } = await supabase.from("loans").select("id").eq("loan_number", loanNumber).maybeSingle();

      if (existingLoan) {
        const { error } = await supabase.from("loans").update(loanPayload).eq("id", existingLoan.id);
        if (error) throw new Error(error.message);
        updated++;
      } else {
        const { error } = await supabase.from("loans").insert(loanPayload);
        if (error) throw new Error(error.message);
        created++;
      }
    } catch (e) {
      failed++;
      errors.push({ row: i + 2, error: String(e instanceof Error ? e.message : e) });
    }
  }

  await supabase.from("loan_import_batches").update({
    status: failed === rows.length ? "failed" : "completed",
    successful_records: created + updated,
    failed_records: failed,
    new_records: created,
    updated_records: updated,
    review_records: needsReview,
    errors_json: errors.length ? errors : null,
  }).eq("id", batchId);

  return { created, updated, failed, needsReview, errors };
}

// We need this type inline since we can't import it easily
type Tables_repayment_freq = "daily" | "weekly" | "biweekly" | "monthly" | "quarterly" | "bullet";
type Tables_investment_status = "active" | "maturing_soon" | "matured" | "renewed" | "closed";

// ── Import Investments ───────────────────────────────────────
async function importInvestments(rows: CSVRow[], fileName: string) {
  const batchId = crypto.randomUUID();
  let created = 0, updated = 0, failed = 0, needsReview = 0;
  const errors: { row: number; error: string }[] = [];

  await supabase.from("loan_import_batches").insert({
    id: batchId,
    filename: `[INVESTMENTS] ${fileName}`,
    total_records: rows.length,
    status: "processing",
    successful_records: 0,
    failed_records: 0,
  });

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const invNumber = col(row, ...INVESTMENT_FIELD_ALIASES.investment_number);
      if (!invNumber) throw new Error("Missing investment number — check column name");

      const customerName = col(row, ...INVESTMENT_FIELD_ALIASES.customer_name);
      const customerPhone = col(row, ...INVESTMENT_FIELD_ALIASES.customer_phone);
      const customerEmail = col(row, ...INVESTMENT_FIELD_ALIASES.customer_email);

      const resolution = customerName || customerPhone || customerEmail
        ? await resolveOrCreateCustomer({ name: customerName, phone: customerPhone, email: customerEmail }, `${Date.now()}-${i}`)
        : null;
      if (!resolution) throw new Error("Could not resolve customer — no name, phone, or email found on this row");

      const amount = num(row, ...INVESTMENT_FIELD_ALIASES.amount);
      const rate = num(row, ...INVESTMENT_FIELD_ALIASES.interest_rate);
      const startDate = dateStr(row, ...INVESTMENT_FIELD_ALIASES.start_date);
      const maturityRaw = col(row, ...INVESTMENT_FIELD_ALIASES.maturity_date);
      const maturityDate = dateStr(row, ...INVESTMENT_FIELD_ALIASES.maturity_date);
      const durationRaw = num(row, ...INVESTMENT_FIELD_ALIASES.duration_days);
      const duration = durationRaw || Math.ceil(
        (new Date(maturityDate).getTime() - new Date(startDate).getTime()) / 86400000
      );
      const notes = col(row, ...INVESTMENT_FIELD_ALIASES.notes);

      if (!maturityRaw) needsReview++;

      const today = new Date().toISOString().slice(0, 10);
      const daysToMaturity = Math.ceil(
        (new Date(maturityDate).getTime() - new Date(today).getTime()) / 86400000
      );
      const status: Tables_investment_status =
        daysToMaturity < 0 ? "matured" :
        daysToMaturity <= 7 ? "maturing_soon" : "active";

      const invPayload = {
        investment_number: invNumber,
        customer_id: resolution.customerId,
        amount: amount || 0,
        interest_rate: rate || 0,
        duration_days: duration || 365,
        start_date: startDate,
        maturity_date: maturityDate,
        status,
        notes: notes || null,
      };

      const { data: existingInv } = await supabase.from("investments").select("id").eq("investment_number", invNumber).maybeSingle();

      if (existingInv) {
        const { error } = await supabase.from("investments").update(invPayload).eq("id", existingInv.id);
        if (error) throw new Error(error.message);
        updated++;
      } else {
        const { error } = await supabase.from("investments").insert(invPayload);
        if (error) throw new Error(error.message);
        created++;
      }
    } catch (e) {
      failed++;
      errors.push({ row: i + 2, error: String(e instanceof Error ? e.message : e) });
    }
  }

  await supabase.from("loan_import_batches").update({
    status: failed === rows.length ? "failed" : "completed",
    successful_records: created + updated,
    failed_records: failed,
    new_records: created,
    updated_records: updated,
    review_records: needsReview,
    errors_json: errors.length ? errors : null,
  }).eq("id", batchId);

  return { created, updated, failed, needsReview, errors };
}

// ── Main Page ────────────────────────────────────────────────
export default function ImportsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ImportType>("loans");
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<CSVRow[]>([]);
  const [allRows, setAllRows] = useState<CSVRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [fileType, setFileType] = useState("");
  const [columnNames, setColumnNames] = useState<string[]>([]);
  const [fieldMapping, setFieldMapping] = useState<FieldMappingEntry[]>([]);
  const [errors, setErrors] = useState<{ row: number; error: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: batches = [], isLoading, refetch } = useQuery({
    queryKey: ["import-batches"],
    queryFn: async () => {
      const { data } = await supabase
        .from("loan_import_batches")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30);
      return data ?? [];
    },
  });

  const resetFile = () => {
    setPreview([]);
    setAllRows([]);
    setFileName("");
    setFileType("");
    setColumnNames([]);
    setFieldMapping([]);
    setErrors([]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const computeMapping = (columns: string[]) => {
    return activeTab === "loans"
      ? detectFieldMapping(columns, LOAN_FIELD_ALIASES, LOAN_FIELD_LABELS, LOAN_REQUIRED_FIELDS)
      : detectFieldMapping(columns, INVESTMENT_FIELD_ALIASES, INVESTMENT_FIELD_LABELS, INVESTMENT_REQUIRED_FIELDS);
  };

  const handleFile = async (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const allowed = ["xlsx", "xls", "csv"];
    if (!allowed.includes(ext)) {
      toast.error("Please upload an Excel (.xlsx, .xls) or CSV file");
      return;
    }
    setFileName(file.name);
    setFileType(ext);
    setErrors([]);
    try {
      const rows = await readFile(file);
      if (rows.length === 0) {
        toast.error("File is empty or has no data rows");
        return;
      }
      setAllRows(rows);
      setPreview(rows.slice(0, 5));
      const columns = Object.keys(rows[0]);
      setColumnNames(columns);
      setFieldMapping(computeMapping(columns));
      toast.success(`Read ${rows.length} rows from ${file.name}`);
    } catch (e) {
      toast.error("Could not read file: " + String(e instanceof Error ? e.message : e));
    }
  };

  const handleImport = async () => {
    if (!allRows.length) return;
    setImporting(true);
    setErrors([]);
    try {
      const result = activeTab === "loans"
        ? await importLoans(allRows, fileName)
        : await importInvestments(allRows, fileName);

      // A file often brings due-dates/maturity-dates that just changed the
      // picture — refresh computed statuses immediately so reminders and
      // dashboards reflect it right away instead of waiting on the next
      // page load's throttled refresh.
      await Promise.all([
        supabase.rpc("refresh_loan_statuses"),
        supabase.rpc("refresh_investment_statuses"),
      ]).catch(() => {});

      const summary = `${result.created} new, ${result.updated} updated${result.failed ? `, ${result.failed} failed` : ""}${result.needsReview ? `, ${result.needsReview} need review (missing date)` : ""}`;

      if (result.errors.length > 0) {
        setErrors(result.errors);
        toast.warning(summary);
      } else {
        toast.success(`✅ ${summary}`);
        resetFile();
      }
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      queryClient.invalidateQueries({ queryKey: ["investments"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-loan-stats"] });
      queryClient.invalidateQueries({ queryKey: ["collections"] });
      queryClient.invalidateQueries({ queryKey: ["overdue-for-reminder"] });
      refetch();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setImporting(false);
    }
  };

  const loanBatches = batches.filter(b => b.filename.startsWith("[LOANS]") || !b.filename.startsWith("["));
  const invBatches = batches.filter(b => b.filename.startsWith("[INVESTMENTS]"));
  const activeBatches = activeTab === "loans" ? loanBatches : invBatches;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Data Imports" description="Import loan and investment records from your CBS — supports Excel and CSV" />

      {/* Info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 text-sm text-blue-800">
        <p className="font-semibold mb-1">📊 Supported formats</p>
        <p>Excel (.xlsx, .xls) and CSV (.csv) files are both supported. Export directly from your core banking software and upload here. Column names are matched intelligently — they don't need to match exactly.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {(["loans", "investments"] as ImportType[]).map(tab => (
          <button key={tab} onClick={() => { setActiveTab(tab); resetFile(); }}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all border ${activeTab === tab ? "brand-gradient text-white border-transparent" : "border-border bg-card hover:bg-muted/40"}`}>
            {tab === "loans" ? <CreditCard className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
            {tab === "loans" ? "Loan Records" : "Investment Records"}
          </button>
        ))}
      </div>

      {/* Template download */}
      <div className="flex items-center justify-between px-5 py-4 bg-card border border-border rounded-xl">
        <div>
          <p className="text-sm font-semibold text-foreground">Download Excel Template</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {activeTab === "loans"
              ? "Columns: loan_number, customer_name, phone, principal_amount, interest_amount, total_amount, amount_paid, outstanding_balance, start_date, due_date, repayment_frequency"
              : "Columns: investment_number, customer_name, phone, amount, interest_rate, duration_days, start_date, maturity_date, notes"}
          </p>
        </div>
        <button onClick={() => downloadTemplate(activeTab)}
          className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-medium hover:bg-muted/40 transition-colors flex-shrink-0 ml-4">
          <Download className="w-4 h-4" /> Template (.xlsx)
        </button>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault(); setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${dragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/40 hover:bg-muted/20"}`}
      >
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        <div className="flex items-center justify-center gap-3 mb-3">
          <FileSpreadsheet className="w-8 h-8 text-green-600" />
          <Upload className="w-6 h-6 text-muted-foreground" />
        </div>
        <p className="font-semibold text-foreground">
          Drop your {activeTab === "loans" ? "loan" : "investment"} file here or click to browse
        </p>
        <p className="text-sm text-muted-foreground mt-1">Supports Excel (.xlsx, .xls) and CSV (.csv)</p>
      </div>

      {/* Preview */}
      {preview.length > 0 && (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-green-600" />
                <span className="text-sm font-semibold text-foreground">{fileName}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${fileType === "csv" ? "bg-gray-100 text-gray-700" : "bg-green-100 text-green-800"}`}>
                  {fileType.toUpperCase()}
                </span>
                <span className="text-xs text-muted-foreground">{allRows.length} rows · {columnNames.length} columns</span>
              </div>
              <div className="flex gap-2">
                <button onClick={resetFile}
                  className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-muted/40">
                  Cancel
                </button>
                <button onClick={handleImport} disabled={importing}
                  className="flex items-center gap-2 px-4 py-2 brand-gradient text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60">
                  {importing
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Importing {allRows.length} rows...</>
                    : <><Upload className="w-4 h-4" /> Import {allRows.length} Records</>}
                </button>
              </div>
            </div>

            {/* Column mapping preview */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="text-xs text-muted-foreground font-medium mr-1">Detected columns:</span>
              {columnNames.map(c => (
                <span key={c} className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full font-mono">{c}</span>
              ))}
            </div>
          </div>

          {/* Field mapping checklist */}
          {fieldMapping.length > 0 && (
            <div className="px-5 py-4 border-b border-border bg-muted/20">
              <p className="text-xs font-semibold text-foreground mb-2.5">
                {allRows.length} records detected — {fieldMapping.filter(f => f.matchedColumn).length} of {fieldMapping.length} fields recognised
                {fieldMapping.some(f => !f.matchedColumn) && (
                  <span className="text-amber-600"> · {fieldMapping.filter(f => !f.matchedColumn).length} field(s) could not be identified</span>
                )}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                {fieldMapping.map(f => (
                  <div key={f.field} className="flex items-center gap-1.5 text-xs">
                    {f.matchedColumn ? (
                      <CheckCircle className="w-3.5 h-3.5 text-success flex-shrink-0" />
                    ) : (
                      <AlertCircle className={`w-3.5 h-3.5 flex-shrink-0 ${f.required ? "text-destructive" : "text-muted-foreground/50"}`} />
                    )}
                    <span className={f.matchedColumn ? "text-foreground" : "text-muted-foreground"}>
                      {f.label}{f.required && !f.matchedColumn && <span className="text-destructive"> *</span>}
                    </span>
                    {f.matchedColumn && <span className="text-muted-foreground font-mono truncate">({f.matchedColumn})</span>}
                  </div>
                ))}
              </div>
              {fieldMapping.filter(f => f.required && !f.matchedColumn).length > 0 && (
                <p className="text-xs text-destructive mt-2.5">
                  ⚠ A required field is missing — rows without it will fail to import. Check your file's column names.
                </p>
              )}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2.5 text-muted-foreground font-medium">#</th>
                  {columnNames.map(k => (
                    <th key={k} className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.map((row, i) => (
                  <tr key={i} className="hover:bg-muted/20">
                    <td className="px-4 py-2.5 text-muted-foreground">{i + 2}</td>
                    {columnNames.map(k => (
                      <td key={k} className="px-4 py-2.5 text-foreground max-w-[160px] truncate">{row[k]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {allRows.length > 5 && (
            <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground">
              Showing first 5 of {allRows.length} rows
            </div>
          )}
        </div>
      )}

      {/* Error report */}
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-5 py-3 border-b border-red-200">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <p className="text-sm font-semibold text-red-800">{errors.length} rows failed to import</p>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {errors.map((e, i) => (
              <div key={i} className="px-5 py-2.5 border-b border-red-100 last:border-0 text-xs">
                <span className="font-semibold text-red-700">Row {e.row}:</span>{" "}
                <span className="text-red-600">{e.error}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-4">
          {activeTab === "loans" ? "Loan" : "Investment"} Import History
        </h2>
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Filename</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Total</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">New</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Updated</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Failed</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-muted-foreground">Review</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-5 py-3"><div className="h-4 bg-muted animate-pulse rounded" /></td>
                    ))}</tr>
                  ))
                ) : activeBatches.map(b => (
                  <tr key={b.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="w-4 h-4 text-green-600 flex-shrink-0" />
                        <span className="font-medium text-foreground text-sm">
                          {b.filename.replace(/^\[(LOANS|INVESTMENTS)\] /, "")}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right text-foreground">{b.total_records}</td>
                    <td className="px-5 py-3 text-right">
                      <span className="flex items-center justify-end gap-1 text-success font-medium">
                        <CheckCircle className="w-3.5 h-3.5" /> {b.new_records ?? 0}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right text-primary font-medium">{b.updated_records ?? 0}</td>
                    <td className="px-5 py-3 text-right">
                      <span className={`flex items-center justify-end gap-1 font-medium ${b.failed_records > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        <XCircle className="w-3.5 h-3.5" /> {b.failed_records}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className={`font-medium ${(b.review_records ?? 0) > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
                        {b.review_records ?? 0}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground text-xs">{formatDateTime(b.created_at)}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={b.status} colorClass={getImportStatusColor(b.status)} />
                    </td>
                  </tr>
                ))}
                {!isLoading && activeBatches.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                      No imports yet — upload a file above to get started
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
