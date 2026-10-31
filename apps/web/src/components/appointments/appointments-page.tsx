"use client";

import { Info, User } from "lucide-react";
import { useMemo, useState } from "react";
import { FilterDropdown, type FilterOption } from "@/components/ui/filter-dropdown";
import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { DateDisplay } from "@/components/ui/date-display";
import { useApi } from "@/lib/client-api";
import { formatPhone, shortId } from "@/lib/format";
import type { Appointment, Lead } from "@/lib/types";

const statusOptions: FilterOption<string>[] = [
  { value: "all", label: "Todos os status" },
  { value: "pending_confirmation", label: "Aguardando confirmação" },
  { value: "confirmed", label: "Confirmados" },
  { value: "scheduled", label: "Agendados" },
  { value: "completed", label: "Concluídos" },
  { value: "cancelled", label: "Cancelados" },
  { value: "expired", label: "Expirados" },
];

export function AppointmentsPage() {
  const appointments = useApi<{ appointments: Appointment[] }>("appointments");
  const leads = useApi<{ leads: Lead[] }>("leads");

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const allAppointments = useMemo(
    () => appointments.data?.appointments ?? [],
    [appointments.data?.appointments]
  );
  const allLeads = useMemo(
    () => leads.data?.leads ?? [],
    [leads.data?.leads]
  );

  const leadMap = useMemo(() => new Map(allLeads.map((l) => [l.id, l])), [allLeads]);

  const filteredAppointments = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allAppointments.filter((app) => {
      const matchStatus = statusFilter === "all" || app.status === statusFilter;
      const lead = leadMap.get(app.leadId);
      const leadName = lead?.name?.toLowerCase() ?? "";
      const matchQuery = !q || leadName.includes(q) || app.externalEventId.toLowerCase().includes(q);
      return matchStatus && matchQuery;
    });
  }, [allAppointments, statusFilter, query, leadMap]);

  return (
    <>
      <PageHeader
        title="Agendamentos"
        description="Reuniões agendadas pela Mariana entre leads qualificados e consultores."
      />

      {/* Alerta de transparência sobre Meet / Calendar */}
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-foreground/90">
        <Info className="size-4 shrink-0 text-primary mt-0.5" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Sincronização com Google Calendar</p>
          <p className="text-muted-foreground leading-relaxed">
            As reuniões são criadas no Google Calendar com o link do Google Meet gerado automaticamente e enviado ao lead via WhatsApp. O consultor gerencia e acessa a videoconferência diretamente pelo seu Google Agenda.
          </p>
        </div>
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput
            value={query}
            onChangeValue={setQuery}
            placeholder="Buscar por lead ou ID do evento..."
            className="w-full sm:max-w-md"
          />
          <FilterDropdown
            value={statusFilter}
            options={statusOptions}
            onChangeValue={setStatusFilter}
            ariaLabel="Filtrar agendamentos por status"
          />
        </div>

        {!appointments.loading && !appointments.error && allAppointments.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Exibindo <span className="font-medium text-foreground">{filteredAppointments.length}</span> de{" "}
            <span className="font-medium text-foreground">{allAppointments.length}</span> agendamentos
          </div>
        )}
      </div>

      {appointments.error || leads.error ? (
        <ErrorState message={appointments.error ?? leads.error ?? "Erro ao carregar agendamentos."} />
      ) : appointments.loading || leads.loading ? (
        <LoadingState rows={6} />
      ) : !allAppointments.length ? (
        <EmptyState
          title="Nenhum agendamento realizado"
          detail="Assim que a Mariana qualificar e fechar um horário de reunião com um lead, ele aparecerá aqui."
        />
      ) : !filteredAppointments.length ? (
        <EmptyState
          title="Nenhum agendamento encontrado"
          detail="Tente alterar os termos de busca ou o filtro de status."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-5 py-3.5">Lead</th>
                  <th className="px-5 py-3.5">Data e Horário</th>
                  <th className="px-5 py-3.5">Consultor</th>
                  <th className="px-5 py-3.5">Evento Google Calendar</th>
                  <th className="px-5 py-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredAppointments.map((app) => {
                  const lead = leadMap.get(app.leadId);
                  return (
                    <tr key={app.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-5 py-4">
                        <p className="font-medium text-foreground">
                          {lead?.name ?? `Lead #${shortId(app.leadId)}`}
                        </p>
                        {lead?.phone && (
                          <p className="text-xs font-mono text-muted-foreground">
                            {formatPhone(lead.phone)}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-4 text-xs">
                        <p className="font-medium text-foreground">
                          <DateDisplay date={app.startAt} variant="date" />
                        </p>
                        <p className="text-muted-foreground">
                          <DateDisplay date={app.startAt} variant="time" /> às{" "}
                          <DateDisplay date={app.endAt} variant="time" />
                        </p>
                      </td>
                      <td className="px-5 py-4 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1 font-mono">
                          <User size={12} className="text-primary" />
                          Consultor #{shortId(app.consultantId)}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs font-mono text-muted-foreground">
                        <span className="truncate max-w-[180px] inline-block" title={app.externalEventId}>
                          {app.externalEventId}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={app.status} />
                      </td>
                    </tr>
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
