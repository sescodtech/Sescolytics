import { cn, formatStatus } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  colorClass: string;
  className?: string;
}

export function StatusBadge({ status, colorClass, className }: StatusBadgeProps) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", colorClass, className)}>
      {formatStatus(status)}
    </span>
  );
}
