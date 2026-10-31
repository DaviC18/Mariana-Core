"use client";
import { CalendarDays, MessageSquareText, Users } from "lucide-react";
import { useApi } from "@/lib/client-api";
import { dateTime } from "@/lib/format";
import type { Appointment, Conversation, Lead } from "@/lib/types";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";

type Data = { leads: Lead[] }; type Conversations = { conversations: Conversation[] }; type Appointments = { appointments: Appointment[] };
export function DashboardPage() {
  const leads = useApi<Data>("leads"), conversations = useApi<Conversations>("conversations"), appointments = useApi<Appointments>("appointments");
  const loading = leads.loading || conversations.loading || appointments.loading; const error = leads.error || conversations.error || appointments.error;
  const leadNames = new Map(leads.data?.leads.map((lead) => [lead.id, lead.name]));
  const recent = [...(conversations.data?.conversations ?? [])].sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt)).slice(0, 5);
  return <><PageHeader title="Visão geral" description="Acompanhe o que está acontecendo na operação agora."/>
    {error && <ErrorState message={error}/>} {loading ? <LoadingState rows={4}/> : <>
      <div className="grid gap-4 sm:grid-cols-3">{[{ label: "Leads", value: leads.data?.leads.length ?? 0, icon: Users, note: "cadastros na base" }, { label: "Conversas", value: conversations.data?.conversations.length ?? 0, icon: MessageSquareText, note: `${conversations.data?.conversations.filter((item) => item.status === "active").length ?? 0} ativas` }, { label: "Agendamentos", value: appointments.data?.appointments.length ?? 0, icon: CalendarDays, note: "registros disponíveis" }].map(({ label, value, icon: Icon, note }) => <section key={label} className="rounded-xl border bg-card p-5"><Icon className="mb-7 size-5 text-primary"/><p className="text-sm text-muted-foreground">{label}</p><p className="mt-1 text-3xl font-semibold tracking-tight">{value}</p><p className="mt-2 text-xs text-muted-foreground">{note}</p></section>)}</div>
      <section className="mt-7 rounded-xl border bg-card"><div className="border-b px-5 py-4"><h2 className="font-medium">Atividade recente</h2><p className="mt-1 text-sm text-muted-foreground">Conversas ordenadas pela última atualização.</p></div>{recent.length ? <div className="divide-y">{recent.map((conversation) => <div key={conversation.id} className="flex items-center justify-between gap-4 px-5 py-4"><div><p className="font-medium">{leadNames.get(conversation.leadId) ?? `Lead ${conversation.leadId.slice(0, 8)}`}</p><p className="mt-1 text-xs text-muted-foreground">Atualizada em {dateTime(conversation.updatedAt)}</p></div><StatusBadge status={conversation.status}/></div>)}</div> : <EmptyState title="Nenhuma atividade ainda" detail="As conversas aparecerão aqui assim que forem registradas pela API."/>}</section>
    </>}</>;
}
