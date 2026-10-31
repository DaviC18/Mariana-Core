import { dateTime, dateOnly, timeOnly } from "@/lib/format";

interface DateDisplayProps {
  date: string | Date | null | undefined;
  variant?: "datetime" | "date" | "time";
  fallback?: string;
  className?: string;
}

export function DateDisplay({
  date,
  variant = "datetime",
  fallback = "—",
  className = "",
}: DateDisplayProps) {
  if (!date) return <span className={`text-muted-foreground ${className}`}>{fallback}</span>;

  let formatted = fallback;
  if (variant === "datetime") formatted = dateTime(date);
  else if (variant === "date") formatted = dateOnly(date);
  else if (variant === "time") formatted = timeOnly(date);

  const iso = typeof date === "string" ? date : date.toISOString();

  return (
    <time dateTime={iso} className={className}>
      {formatted}
    </time>
  );
}
