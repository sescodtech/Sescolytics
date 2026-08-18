import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function daysFromNow(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function getLoanStatusColor(status: string): string {
  switch (status) {
    case "active": return "bg-blue-100 text-blue-800";
    case "due_today": return "bg-amber-100 text-amber-800";
    case "due_tomorrow": return "bg-yellow-100 text-yellow-800";
    case "overdue": return "bg-red-100 text-red-800";
    case "completed": return "bg-green-100 text-green-800";
    default: return "bg-gray-100 text-gray-700";
  }
}

export function getCollectionStatusColor(status: string): string {
  switch (status) {
    case "current": return "bg-green-100 text-green-800";
    case "reminder_sent": return "bg-blue-100 text-blue-800";
    case "follow_up_required": return "bg-orange-100 text-orange-800";
    case "promise_to_pay": return "bg-purple-100 text-purple-800";
    case "partially_paid": return "bg-yellow-100 text-yellow-800";
    case "fully_paid": return "bg-emerald-100 text-emerald-800";
    default: return "bg-gray-100 text-gray-700";
  }
}

export function getInvestmentStatusColor(status: string): string {
  switch (status) {
    case "active": return "bg-green-100 text-green-800";
    case "maturing_soon": return "bg-amber-100 text-amber-800";
    case "matured": return "bg-blue-100 text-blue-800";
    case "renewed": return "bg-purple-100 text-purple-800";
    case "closed": return "bg-gray-100 text-gray-700";
    default: return "bg-gray-100 text-gray-700";
  }
}

export function formatStatus(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
