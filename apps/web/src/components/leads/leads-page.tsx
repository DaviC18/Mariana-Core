"use client";

import { ChevronDown, Info, UserCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { FilterDropdown, type FilterOption } from "@/components/ui/filter-dropdown";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { DateDisplay } from "@/components/ui/date-display";
import { useApi } from "@/lib/client-api";
import { formatPhone } from "@/lib/format";
import type { Lead, LeadStatus } from "@/lib/types";

const statusOptions: FilterOption<LeadStatus | "all">[] = [
  { value: "all", label: "Todos os status" },
  { value: "new", label: "Novos" },
  { value: "qualifying", label: "Em qualificação" },
  { value: "qualified", label: "Qualificados" },
  { value: "scheduled", label: "Agendados" },
];

const urgencyLabels: Record<string, string> = {
  immediate: "Imediata (até 30 dias)",
  short_term: "Curto prazo (1 a 3 meses)",
  medium_term: "Médio prazo (3 a 6 meses)",
  long_term: "Longo prazo (mais de 6 meses)",
};

const approachLabels: Record<string, string> = {
  vehicle_renewal: "Renovação de frota / veículo",
  operational_cost: "Custo operacional",
  cash_purchase_power: "Poder de compra à vista",
  investment_discipline: "Disciplina de investimento",
  quota_bank: "Banco de cotas",
  fleet: "Frota comercial",
  general: "Abordagem geral",
};

const sourceLabels: Record<string, string> = {
  whatsapp: "WhatsApp direto",
  google_ads: "Google Ads",
  meta_ads: "Meta Ads (Instagram / Facebook)",
};

function DetailItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/60 p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{value || "Não informado"}</dd>
    </div>
  );
}

export function LeadsPage() {
  const { data, error, loading } = useApi<{ leads: Lead[] }>("leads");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LeadStatus | "all">("all");
  const [selectedId, setSelectedId] = useState<string>();

  const allLeads = useMemo(() => data?.leads ?? [], [data?.leads]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allLeads.filter((lead) => {
      const matchStatus = status === "all" || lead.status === status;
      const matchQuery =
        !q ||
        lead.name.toLowerCase().includes(q) ||
        lead.phone.toLowerCase().includes(q) ||
        (lead.email && lead.email.toLowerCase().includes(q));
      return matchStatus && matchQuery;
    });
  }, [allLeads, status, query]);

  return (
    <>
      <PageHeader
        title="Leads"
        description="Consulte os contatos recebidos pela Mariana. A visualização é exclusivamente para leitura operacional."
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput
            value={query}
            onChangeValue={setQuery}
            placeholder="Buscar por nome, telefone ou e-mail..."
            className="w-full sm:max-w-md"
          />
          <FilterDropdown
            value={status}
            options={statusOptions}
            onChangeValue={setStatus}
            ariaLabel="Filtrar leads por status"
          />
        </div>

        {!loading && !error && allLeads.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Exibindo <span className="font-medium text-foreground">{filtered.length}</span> de{" "}
            <span className="font-medium text-foreground">{allLeads.length}</span> contatos
          </div>
        )}
      </div>

      {error ? (
        <ErrorState message={error} />
      ) : loading ? (
        <LoadingState rows={6} />
      ) : !allLeads.length ? (
        <EmptyState
          title="Nenhum lead registrado"
          detail="Quando clientes iniciarem contato via WhatsApp ou anúncios, eles aparecerão aqui."
        />
      ) : !filtered.length ? (
        <EmptyState
          title="Nenhum resultado para a busca"
          detail="Tente alterar os termos de pesquisa ou remover o filtro de status."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-5 py-3.5">Contato</th>
                  <th className="px-5 py-3.5">Telefone</th>
                  <th className="px-5 py-3.5">Origem</th>
                  <th className="px-5 py-3.5">Entrada</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((lead) => {
                  const isExpanded = selectedId === lead.id;
                  return (
                    <LeadRow
                      key={lead.id}
                      lead={lead}
                      isExpanded={isExpanded}
                      onToggle={() => setSelectedId(isExpanded ? undefined : lead.id)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

function LeadRow({
  lead,
  isExpanded,
  onToggle,
}: {
  lead: Lead;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className={`transition-colors hover:bg-muted/30 ${isExpanded ? "bg-muted/20" : ""}`}>
        <td className="px-5 py-4">
          <p className="font-medium text-foreground">{lead.name}</p>
          {lead.email && <p className="text-xs text-muted-foreground">{lead.email}</p>}
        </td>
        <td className="px-5 py-4 font-mono text-xs text-muted-foreground">
          {formatPhone(lead.phone)}
        </td>
        <td className="px-5 py-4 text-xs text-muted-foreground">
          {sourceLabels[lead.source] ?? lead.source}
        </td>
        <td className="px-5 py-4 text-xs text-muted-foreground">
          <DateDisplay date={lead.createdAt} />
        </td>
        <td className="px-5 py-4">
          <StatusBadge status={lead.status} />
        </td>
        <td className="px-5 py-4 text-right">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isExpanded}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            {isExpanded ? "Recolher" : "Detalhes"}
            <ChevronDown
              className={`size-3.5 transition-transform duration-200 ${
                isExpanded ? "rotate-180" : ""
              }`}
            />
          </button>
        </td>
      </tr>

      {isExpanded && (
        <tr className="bg-muted/10">
          <td colSpan={6} className="px-5 py-5 border-t border-border/40">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Info size={14} className="text-primary" />
                Dados de qualificação coletados pela IA
              </div>
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <DetailItem
                  label="Tipo de consórcio"
                  value={lead.consortiumType}
                />
                <DetailItem
                  label="Objetivo de compra"
                  value={lead.objective}
                />
                <DetailItem
                  label="Urgência declarada"
                  value={lead.urgency ? (urgencyLabels[lead.urgency] ?? lead.urgency) : null}
                />
                <DetailItem
                  label="Situação atual"
                  value={lead.currentSituation}
                />
                <DetailItem
                  label="Abordagem comercial"
                  value={
                    lead.commercialApproach
                      ? (approachLabels[lead.commercialApproach] ?? lead.commercialApproach)
                      : null
                  }
                />
                <DetailItem
                  label="Interesse em consultor"
                  value={
                    lead.interestedInConsultant ? (
                      <span className="inline-flex items-center gap-1 font-medium text-primary">
                        <UserCheck size={14} /> Sim
                      </span>
                    ) : (
                      "Não informado / Não"
                    )
                  }
                />
                <DetailItem
                  label="Data de qualificação"
                  value={lead.qualifiedAt ? <DateDisplay date={lead.qualifiedAt} /> : null}
                />
                <DetailItem
                  label="Última atualização"
                  value={<DateDisplay date={lead.updatedAt} />}
                />
              </dl>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
