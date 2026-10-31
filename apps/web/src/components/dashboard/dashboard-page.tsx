"use client";

import { CalendarDays, CheckCircle2, MessageSquareText, Users } from "lucide-react";
import Link from "next/link";
import { MetricCard } from "@/components/ui/metric-card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { DateDisplay } from "@/components/ui/date-display";
import { useApi } from "@/lib/client-api";
import { shortId } from "@/lib/format";
import type { Appointment, Conversation, Lead } from "@/lib/types";

export function DashboardPage() {
  const leads = useApi<{ leads: Lead[] }>("leads");
  const conversations = useApi<{ conversations: Conversation[] }>("conversations");
  const appointments = useApi<{ appointments: Appointment[] }>("appointments");

  const isLoading = leads.loading || conversations.loading || appointments.loading;
  const error = leads.error || conversations.error || appointments.error;

  const allLeads = leads.data?.leads ?? [];
  const allConversations = conversations.data?.conversations ?? [];
  const allAppointments = appointments.data?.appointments ?? [];

  const leadMap = new Map(allLeads.map((l) => [l.id, l]));

  const activeConversations = allConversations.filter((c) => c.status === "active").length;
  const qualifiedLeads = allLeads.filter(
    (l) => l.status === "qualified" || l.status === "scheduled"
  ).length;

  const recentConversations = [...allConversations]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  return (
    <>
      <PageHeader
        title="Visão Geral"
        description="Acompanhamento em tempo real da operação do agente e fluxo de atendimento."
      />

      {error && <div className="mb-6"><ErrorState message={error} /></div>}

      {isLoading ? (
        <LoadingState rows={5} />
      ) : (
        <div className="space-y-7">
          {/* Métricas Principais */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Total de Leads"
              value={allLeads.length}
              icon={Users}
              note="Contatos registrados na base"
            />
            <MetricCard
              label="Conversas em Andamento"
              value={activeConversations}
              icon={MessageSquareText}
              note={`${allConversations.length} conversas no total`}
            />
            <MetricCard
              label="Leads Qualificados"
              value={qualifiedLeads}
              icon={CheckCircle2}
              note={
                allLeads.length > 0
                  ? `${Math.round((qualifiedLeads / allLeads.length) * 100)}% de taxa de qualificação`
                  : "Aguardando primeiros leads"
              }
            />
            <MetricCard
              label="Reuniões Agendadas"
              value={allAppointments.length}
              icon={CalendarDays}
              note="Sincronizadas com o Calendar"
            />
          </div>

          {/* Atividade Recente */}
          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="font-semibold text-foreground">Atividade Recente</h2>
                <p className="text-xs text-muted-foreground">
                  Últimas interações conduzidas pela IA
                </p>
              </div>
              <Link
                href="/conversas"
                className="text-xs font-medium text-primary hover:underline"
              >
                Ver todas as conversas →
              </Link>
            </div>

            {recentConversations.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="Nenhuma atividade ainda"
                  detail="As conversas recentes aparecerão aqui assim que forem registradas pela API."
                />
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recentConversations.map((conv) => {
                  const lead = leadMap.get(conv.leadId);
                  return (
                    <div
                      key={conv.id}
                      className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between transition-colors hover:bg-muted/30"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">
                          {lead?.name ?? `Lead #${shortId(conv.leadId)}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Última interação: <DateDisplay date={conv.updatedAt} />
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={conv.status} />
                        <Link
                          href={`/conversas?id=${conv.id}`}
                          className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                          Abrir conversa
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
