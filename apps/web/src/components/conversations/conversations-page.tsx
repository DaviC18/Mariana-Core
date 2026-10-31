"use client";

import { Bot, Phone, User } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useRef, useState, useEffect } from "react";
import { FilterDropdown, type FilterOption } from "@/components/ui/filter-dropdown";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { DateDisplay } from "@/components/ui/date-display";
import { useApi } from "@/lib/client-api";
import { formatPhone, shortId } from "@/lib/format";
import type { Conversation, Lead, Message } from "@/lib/types";

const statusOptions: FilterOption<"all" | "active" | "closed">[] = [
  { value: "all", label: "Todas as conversas" },
  { value: "active", label: "Ativas" },
  { value: "closed", label: "Encerradas" },
];

export function ConversationsPage() {
  const searchParams = useSearchParams();
  const urlId = searchParams.get("id");

  const conversations = useApi<{ conversations: Conversation[] }>("conversations");
  const leads = useApi<{ leads: Lead[] }>("leads");

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "closed">("all");

  const allConversations = useMemo(
    () => conversations.data?.conversations ?? [],
    [conversations.data?.conversations]
  );
  const allLeads = useMemo(
    () => leads.data?.leads ?? [],
    [leads.data?.leads]
  );
  const leadMap = useMemo(
    () => new Map(allLeads.map((l) => [l.id, l])),
    [allLeads]
  );

  const filteredConversations = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...allConversations]
      .filter((c) => {
        const matchesStatus = statusFilter === "all" || c.status === statusFilter;
        const lead = leadMap.get(c.leadId);
        const name = lead?.name?.toLowerCase() ?? "";
        const phone = lead?.phone ?? "";
        const matchesQuery = !q || name.includes(q) || phone.includes(q) || c.id.includes(q);
        return matchesStatus && matchesQuery;
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [allConversations, statusFilter, query, leadMap]);

  const activeId = selectedId ?? urlId ?? filteredConversations[0]?.id;
  const activeConversation = allConversations.find((c) => c.id === activeId);
  const activeLead = activeConversation ? leadMap.get(activeConversation.leadId) : undefined;

  return (
    <>
      <PageHeader
        title="Conversas"
        description="Acompanhe em tempo real os diálogos conduzidos pela IA. O atendimento é 100% automatizado pela Mariana."
      />

      {conversations.error || leads.error ? (
        <ErrorState message={conversations.error ?? leads.error ?? "Erro ao carregar dados."} />
      ) : conversations.loading || leads.loading ? (
        <LoadingState rows={6} />
      ) : !allConversations.length ? (
        <EmptyState
          title="Nenhuma conversa registrada"
          detail="Assim que um cliente enviar mensagem via WhatsApp, o atendimento será iniciado automaticamente."
        />
      ) : (
        <div className="grid min-h-[620px] overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[340px_1fr]">
          {/* Coluna Lateral: Lista de conversas */}
          <aside className="flex flex-col border-b border-border lg:border-b-0 lg:border-r">
            <div className="space-y-2.5 border-b border-border p-3.5 bg-muted/20">
              <SearchInput
                value={query}
                onChangeValue={setQuery}
                placeholder="Buscar por lead ou telefone..."
                className="w-full text-xs"
              />
              <FilterDropdown
                value={statusFilter}
                options={statusOptions}
                onChangeValue={setStatusFilter}
                className="w-full text-xs h-9"
              />
            </div>

            <div className="max-h-[300px] flex-1 overflow-y-auto divide-y divide-border/60 lg:max-h-[580px]">
              {filteredConversations.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  Nenhuma conversa encontrada com os filtros atuais.
                </div>
              ) : (
                filteredConversations.map((conv) => {
                  const lead = leadMap.get(conv.leadId);
                  const isSelected = activeId === conv.id;
                  return (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => setSelectedId(conv.id)}
                      className={`block w-full p-4 text-left transition-colors ${
                        isSelected
                          ? "bg-primary/10 border-l-2 border-primary"
                          : "hover:bg-muted/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {lead?.name ?? `Lead #${shortId(conv.leadId)}`}
                        </p>
                        <StatusBadge status={conv.status} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {lead?.phone ? formatPhone(lead.phone) : "Sem telefone"}
                      </p>
                      <p className="mt-2 text-[11px] text-muted-foreground/80">
                        Atualizado em <DateDisplay date={conv.updatedAt} />
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </aside>

          {/* Área Principal: Histórico de mensagens */}
          <section className="flex flex-col min-w-0 bg-background/50">
            {activeConversation ? (
              <>
                {/* Header da conversa selecionada */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/80 px-6 py-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-foreground">
                        {activeLead?.name ?? `Lead #${shortId(activeConversation.leadId)}`}
                      </h2>
                      <StatusBadge status={activeConversation.status} />
                    </div>
                    <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                      {activeLead?.phone && (
                        <span className="flex items-center gap-1 font-mono">
                          <Phone size={12} /> {formatPhone(activeLead.phone)}
                        </span>
                      )}
                      <span>
                        Iniciada em <DateDisplay date={activeConversation.startedAt} />
                      </span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-border/80 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
                    Atendimento IA automatizado
                  </div>
                </div>

                {/* Thread de mensagens */}
                <div className="flex-1 overflow-y-auto p-5">
                  <MessageThread conversationId={activeConversation.id} />
                </div>
              </>
            ) : (
              <div className="grid flex-1 place-items-center p-8">
                <EmptyState
                  title="Nenhuma conversa selecionada"
                  detail="Selecione uma conversa ao lado para visualizar o histórico de mensagens trocadas com a Mariana."
                />
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function MessageThread({ conversationId }: { conversationId: string }) {
  const { data, error, loading } = useApi<{ messages: Message[] }>(
    `conversations/${conversationId}/messages`
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = useMemo(() => data?.messages ?? [], [data?.messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (error) {
    return <ErrorState message={error} />;
  }

  if (loading) {
    return <LoadingState rows={4} />;
  }

  if (messages.length === 0) {
    return (
      <EmptyState
        title="Histórico vazio"
        detail="Nenhuma mensagem registrada nesta conversa até o momento."
      />
    );
  }

  return (
    <div className="space-y-4">
      {messages.map((msg) => {
        const isUser = msg.role === "user";
        const isAssistant = msg.role === "assistant";

        if (!isUser && !isAssistant) {
          // Mensagem de sistema
          return (
            <div key={msg.id} className="my-2 flex justify-center">
              <span className="rounded-full border border-border bg-muted/60 px-3 py-1 text-xs text-muted-foreground">
                {msg.content} · <DateDisplay date={msg.createdAt} variant="time" />
              </span>
            </div>
          );
        }

        return (
          <div
            key={msg.id}
            className={`flex flex-col ${isUser ? "items-start" : "items-end"}`}
          >
            <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              {isUser ? (
                <>
                  <User size={12} />
                  <span>Cliente</span>
                </>
              ) : (
                <>
                  <Bot size={12} className="text-primary" />
                  <span className="font-medium text-primary">Mariana (IA)</span>
                </>
              )}
              <span>·</span>
              <DateDisplay date={msg.createdAt} variant="time" />
            </div>

            <div
              className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                isUser
                  ? "rounded-tl-none border border-border bg-muted/80 text-foreground"
                  : "rounded-tr-none border border-primary/30 bg-primary/15 text-foreground shadow-sm"
              }`}
            >
              {msg.content}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
