"use client";
import { useState } from "react";
import { useApi } from "@/lib/client-api";
import { dateTime } from "@/lib/format";
import type { Conversation, Lead, Message } from "@/lib/types";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
export function ConversationsPage() {
  const conversations = useApi<{ conversations: Conversation[] }>("conversations"), leads = useApi<{ leads: Lead[] }>("leads");
  const [selected, setSelected] = useState<string>();
  const leadNames = new Map(leads.data?.leads.map((lead) => [lead.id, lead.name])); const items = [...(conversations.data?.conversations ?? [])].sort((a,b) => +new Date(b.updatedAt) - +new Date(a.updatedAt));
  return <><PageHeader title="Conversas" description="Acompanhe o histórico atendido pela IA. O envio manual não está disponível."/>{conversations.error || leads.error ? <ErrorState message={conversations.error ?? leads.error ?? "Erro ao carregar."}/> : conversations.loading || leads.loading ? <LoadingState rows={6}/> : !items.length ? <EmptyState title="Nenhuma conversa encontrada" detail="Quando os clientes iniciarem contato, o histórico aparecerá aqui."/> : <div className="grid min-h-[540px] overflow-hidden rounded-xl border bg-card lg:grid-cols-[320px_1fr]"><aside className="border-b lg:border-r lg:border-b-0"><div className="border-b px-4 py-3 text-sm font-medium">Conversas ({items.length})</div><div className="max-h-64 overflow-auto lg:max-h-[490px]">{items.map((conversation) => <button key={conversation.id} onClick={() => setSelected(conversation.id)} className={`block w-full border-b px-4 py-4 text-left ${selected === conversation.id ? "bg-primary/10" : "hover:bg-muted/60"}`}><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{leadNames.get(conversation.leadId) ?? `Lead ${conversation.leadId.slice(0, 8)}`}</p><StatusBadge status={conversation.status}/></div><p className="mt-1 text-xs text-muted-foreground">{dateTime(conversation.updatedAt)}</p></button>)}</div></aside><section className="flex min-w-0 flex-col"><div className="border-b px-5 py-4"><p className="font-medium">{selected ? leadNames.get(items.find((item) => item.id === selected)?.leadId ?? "") ?? "Conversa" : "Selecione uma conversa"}</p><p className="mt-1 text-xs text-muted-foreground">Histórico somente para consulta</p></div>{selected ? <MessageThread key={selected} conversationId={selected}/> : <EmptyState title="Escolha uma conversa" detail="Selecione um item na lista para visualizar as mensagens."/>}</section></div>}</>;
}

function MessageThread({ conversationId }: { conversationId: string }) {
  const messages = useApi<{ messages: Message[] }>(`conversations/${conversationId}/messages`);
  if (messages.error) return <div className="p-5"><ErrorState message={messages.error}/></div>;
  if (messages.loading) return <div className="p-5"><LoadingState rows={4}/></div>;
  return <div className="space-y-4 p-5">{messages.data?.messages.length ? messages.data.messages.map((message) => <div key={message.id} className={`max-w-[86%] rounded-xl px-4 py-3 text-sm ${message.role === "user" ? "mr-auto bg-muted" : message.role === "assistant" ? "ml-auto bg-primary text-primary-foreground" : "mx-auto bg-muted/60 text-muted-foreground"}`}><p>{message.content}</p><p className={`mt-2 text-xs ${message.role === "assistant" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{message.role === "user" ? "Cliente" : message.role === "assistant" ? "Mariana" : "Sistema"} · {dateTime(message.createdAt)}</p></div>) : <EmptyState title="Sem mensagens" detail="A conversa não possui mensagens registradas."/>}</div>;
}
