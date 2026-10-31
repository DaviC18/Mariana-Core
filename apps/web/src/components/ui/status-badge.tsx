interface StatusBadgeProps {
  status: string;
  className?: string;
}

const statusConfig: Record<string, { label: string; tone: string; dot: string }> = {
  // Leads
  new: { label: "Novo", tone: "bg-blue-500/10 text-blue-400 border-blue-500/20", dot: "bg-blue-400" },
  qualifying: { label: "Em qualificação", tone: "bg-amber-500/10 text-amber-400 border-amber-500/20", dot: "bg-amber-400" },
  qualified: { label: "Qualificado", tone: "bg-primary/10 text-primary border-primary/20", dot: "bg-primary" },
  scheduled: { label: "Agendado", tone: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400" },
  // Conversas
  active: { label: "Ativa", tone: "bg-primary/10 text-primary border-primary/20", dot: "bg-primary" },
  closed: { label: "Encerrada", tone: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground" },
  // Agendamentos
  pending_confirmation: { label: "Aguardando confirmação", tone: "bg-amber-500/10 text-amber-400 border-amber-500/20", dot: "bg-amber-400" },
  confirmed: { label: "Confirmado", tone: "bg-primary/10 text-primary border-primary/20", dot: "bg-primary" },
  expired: { label: "Expirado", tone: "bg-destructive/10 text-destructive border-destructive/20", dot: "bg-destructive" },
  cancelled: { label: "Cancelado", tone: "bg-destructive/10 text-destructive border-destructive/20", dot: "bg-destructive" },
  completed: { label: "Concluído", tone: "bg-primary/10 text-primary border-primary/20", dot: "bg-primary" },
};

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const config = statusConfig[status] ?? {
    label: status,
    tone: "bg-muted text-muted-foreground border-border",
    dot: "bg-muted-foreground",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${config.tone} ${className}`}
    >
      <span className={`size-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  );
}
