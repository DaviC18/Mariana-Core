import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  note?: string;
  badge?: ReactNode;
  loading?: boolean;
}

export function MetricCard({
  label,
  value,
  icon: Icon,
  note,
  badge,
  loading = false,
}: MetricCardProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="size-8 rounded-lg bg-muted" />
          <div className="h-5 w-16 rounded bg-muted" />
        </div>
        <div className="mt-4 h-4 w-24 rounded bg-muted" />
        <div className="mt-2 h-8 w-16 rounded bg-muted" />
        <div className="mt-3 h-3 w-32 rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 transition-colors hover:border-border/80">
      <div className="flex items-center justify-between">
        {Icon && (
          <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon size={18} />
          </div>
        )}
        {badge && <div>{badge}</div>}
      </div>
      <p className="mt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
        {value}
      </p>
      {note && (
        <p className="mt-2 text-xs text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  );
}
