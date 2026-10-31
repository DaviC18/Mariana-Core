"use client";

import {
  AlertTriangle,
  Bot,
  Building2,
  FileQuestion,
  HelpCircle,
  Package,
  UserCog,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Consultant = { id: string; name: string; email: string; calendarId: string; active: boolean };

function ConsultantsAdmin() {
  const [code, setCode] = useState(""); const [authorized, setAuthorized] = useState(false);
  const [consultants, setConsultants] = useState<Consultant[]>([]); const [message, setMessage] = useState("");
  const [form, setForm] = useState({ name: "", email: "", calendarId: "" });
  const load = async () => {
    const response = await fetch("/api/admin/consultants", { cache: "no-store" });
    if (response.status === 401) { setAuthorized(false); return; }
    const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Não foi possível carregar os consultores.");
    setConsultants(body.consultants); setAuthorized(true);
  };
  useEffect(() => {
    const timer = setTimeout(() => { load().catch((error: Error) => setMessage(error.message)); }, 0);
    return () => clearTimeout(timer);
  }, []);
  const authenticate = async (event: FormEvent) => {
    event.preventDefault(); setMessage("");
    const response = await fetch("/api/admin/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    if (!response.ok) { setMessage((await response.json()).error ?? "Código inválido."); return; }
    setCode(""); await load();
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setMessage("");
    const response = await fetch("/api/admin/consultants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const body = await response.json(); if (!response.ok) { setMessage(body.error ?? "Não foi possível cadastrar o consultor."); return; }
    setForm({ name: "", email: "", calendarId: "" }); setConsultants((current) => [...current, body.consultant].sort((a, b) => a.name.localeCompare(b.name)));
  };
  const toggle = async (consultant: Consultant) => {
    const response = await fetch(`/api/admin/consultants/${consultant.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !consultant.active }) });
    const body = await response.json(); if (!response.ok) { setMessage(body.error ?? "Não foi possível atualizar o consultor."); return; }
    setConsultants((current) => current.map((item) => item.id === consultant.id ? body.consultant : item));
  };
  if (!authorized) return <div className="rounded-xl border border-border bg-card p-6"><h2 className="text-base font-semibold">Acesso administrativo</h2><p className="mt-1 text-sm text-muted-foreground">Informe o código de seis dígitos do seu aplicativo autenticador para gerenciar a equipe.</p><form onSubmit={authenticate} className="mt-5 flex max-w-sm gap-2"><input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" className="h-9 w-full rounded-lg border border-border bg-muted/30 px-3 font-mono tracking-[0.3em] outline-none focus:border-primary" /><Button type="submit">Entrar</Button></form>{message && <p className="mt-3 text-sm text-destructive">{message}</p>}</div>;
  return <div className="space-y-5"><div className="rounded-xl border border-border bg-card p-6"><h2 className="text-base font-semibold">Equipe de consultores</h2><p className="mt-1 text-sm text-muted-foreground">Consultores inativos não recebem novas agendas. O histórico é preservado.</p><form onSubmit={save} className="mt-5 grid gap-3 sm:grid-cols-3"><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nome completo" className="h-9 rounded-lg border border-border bg-muted/30 px-3 text-sm"/><input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="E-mail" className="h-9 rounded-lg border border-border bg-muted/30 px-3 text-sm"/><div className="flex gap-2"><input required value={form.calendarId} onChange={(event) => setForm({ ...form, calendarId: event.target.value })} placeholder="ID do Google Calendar" className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-muted/30 px-3 text-sm"/><Button type="submit">Adicionar</Button></div></form>{message && <p className="mt-3 text-sm text-destructive">{message}</p>}</div><div className="overflow-hidden rounded-xl border border-border bg-card"><div className="divide-y divide-border">{consultants.map((consultant) => <div key={consultant.id} className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium text-sm">{consultant.name}</p><p className="text-xs text-muted-foreground">{consultant.email} · {consultant.calendarId}</p></div><Button variant={consultant.active ? "outline" : "default"} size="sm" onClick={() => toggle(consultant)}>{consultant.active ? "Desativar" : "Ativar"}</Button></div>)}{consultants.length === 0 && <p className="p-6 text-sm text-muted-foreground">Nenhum consultor cadastrado.</p>}</div></div></div>;
}

function PendingNotice({
  title,
  endpoint,
}: {
  title: string;
  endpoint: string;
}) {
  return (
    <div className="mt-5 rounded-lg border border-amber-400/25 bg-amber-400/10 p-4 text-xs text-amber-100">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle size={14} className="text-amber-400 shrink-0" />
        <span>Pendência de Integração: {title}</span>
      </div>
      <p className="mt-1 text-amber-200/80 leading-relaxed">
        O backend atual ainda não possui o endpoint administrativo (ex:{" "}
        <code className="font-mono text-foreground bg-muted/60 px-1 py-0.5 rounded">{endpoint}</code>) para persistência destas configurações via painel.
      </p>
    </div>
  );
}

export function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Configurações"
        description="Parâmetros institucionais, regras de produtos e diretrizes operacionais da Mariana."
      />

      <Tabs defaultValue="empresa" className="w-full">
        <TabsList className="mb-6 h-10 bg-muted/60 p-1">
          <TabsTrigger value="empresa" className="px-4 text-xs">
            <Building2 size={14} className="mr-1.5" />
            Empresa
          </TabsTrigger>
          <TabsTrigger value="produtos" className="px-4 text-xs">
            <Package size={14} className="mr-1.5" />
            Produtos & Serviços
          </TabsTrigger>
          <TabsTrigger value="faq" className="px-4 text-xs">
            <HelpCircle size={14} className="mr-1.5" />
            Perguntas Frequentes
          </TabsTrigger>
          <TabsTrigger value="agente" className="px-4 text-xs">
            <Bot size={14} className="mr-1.5" />
            Agente de IA
          </TabsTrigger>
          <TabsTrigger value="consultores" className="px-4 text-xs">
            <UserCog size={14} className="mr-1.5" />
            Consultores
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Dados da Empresa */}
        <TabsContent value="empresa" className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-2">
              <Building2 className="size-5 text-primary" />
              <h2 className="text-base font-semibold text-foreground">Identificação Institucional</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Dados da organização utilizados pela Mariana durante as conversas no WhatsApp.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Nome da Empresa</label>
                <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-sm text-foreground">
                  Mariana Consórcios
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Telefone Oficial WhatsApp</label>
                <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-sm font-mono text-foreground">
                  Conforme número conectado à Z-API / WhatsApp Cloud API
                </div>
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Descrição Institucional</label>
                <div className="rounded-lg border border-border bg-muted/40 p-3.5 text-sm text-foreground leading-relaxed">
                  Especialistas em cartas de crédito para imóveis, veículos leves, frotas comerciais e planejamento financeiro com poder de compra à vista.
                </div>
              </div>
            </div>

            <PendingNotice
              title="Edição de Dados da Empresa"
              endpoint="PATCH /admin/company-profile"
            />
          </div>
        </TabsContent>

        {/* Tab 2: Produtos e Serviços */}
        <TabsContent value="produtos" className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-2">
              <Package className="size-5 text-primary" />
              <h2 className="text-base font-semibold text-foreground">Catálogo de Consórcios</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Segmentos e modalidades que a Mariana apresenta durante a qualificação.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                { title: "Consórcio Imobiliário", desc: "Aquisição de imóveis residenciais, comerciais, reformas e construção com taxas administrativas reduzidas." },
                { title: "Consórcio de Veículos", desc: "Planos para compra de automóveis novos e seminovos sem cobrança de juros de financiamento." },
                { title: "Frotas e Veículos Pesados", desc: "Caminhões, implementos rodoviários e maquinário agrícola com foco em renovação de ativos." },
                { title: "Planejamento e Disciplina", desc: "Alavancagem patrimonial e formação de carteira imobiliária por meio de lances programados." },
              ].map((prod) => (
                <div key={prod.title} className="rounded-lg border border-border bg-muted/30 p-4">
                  <p className="font-medium text-sm text-foreground">{prod.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{prod.desc}</p>
                </div>
              ))}
            </div>

            <PendingNotice
              title="Gerenciamento de Produtos"
              endpoint="GET/POST /admin/products"
            />
          </div>
        </TabsContent>

        {/* Tab 3: Perguntas Frequentes (FAQ) */}
        <TabsContent value="faq" className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-2">
              <FileQuestion className="size-5 text-primary" />
              <h2 className="text-base font-semibold text-foreground">Base de Conhecimento e FAQ</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Respostas pré-definidas e regras que orientam as explicações sobre regras de consórcio.
            </p>

            <div className="mt-5 space-y-3">
              {[
                { q: "Qual a diferença entre sorteio e lance?", a: "O sorteio ocorre mensalmente via Loteria Federal; o lance permite antecipar parcelas com recursos próprios ou FGTS para acelerar a contemplação." },
                { q: "Como funciona a reunião com o consultor?", a: "É um encontro online de 30 minutos via Google Meet para simular parcelas, prazos e estratégias de lance personalizadas para o perfil do cliente." },
                { q: "Quais são as taxas aplicadas?", a: "O consórcio não cobra juros compensatórios, apenas a taxa de administração e fundo de reserva diluídos ao longo das parcelas." },
              ].map((faq) => (
                <div key={faq.q} className="rounded-lg border border-border bg-muted/30 p-4">
                  <p className="font-medium text-sm text-foreground">{faq.q}</p>
                  <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{faq.a}</p>
                </div>
              ))}
            </div>

            <PendingNotice
              title="Cadastro de FAQ da Mariana"
              endpoint="GET/POST /admin/knowledge-base"
            />
          </div>
        </TabsContent>

        {/* Tab 4: Agente de IA */}
        <TabsContent value="agente" className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center gap-2">
              <Bot className="size-5 text-primary" />
              <h2 className="text-base font-semibold text-foreground">Diretrizes da Mariana (IA)</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Configurações de tom de voz, escopo de atendimento e limites de atuação do modelo de linguagem.
            </p>

            <div className="mt-5 space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tom de Voz e Personalidade
                </p>
                <p className="mt-1 text-sm text-foreground leading-relaxed">
                  Consultiva, cordial, objetiva e transparente. Nunca promete contemplação imediata ou garantida. Foco na condução para o agendamento com especialista.
                </p>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Regras de Compliance WhatsApp
                </p>
                <p className="mt-1 text-sm text-foreground leading-relaxed">
                  Respeito imediato a pedidos de opt-out (&quot;PARAR&quot;, &quot;SAIR&quot;). Não realiza spam. Limitação de mensagens automáticas dentro da janela regulamentar de 24h da Meta.
                </p>
              </div>
            </div>

            <PendingNotice
              title="Versionamento de Prompts e Instruções"
              endpoint="GET/PUT /admin/ai-agent-config"
            />
          </div>
        </TabsContent>

        <TabsContent value="consultores"><ConsultantsAdmin /></TabsContent>
      </Tabs>
    </>
  );
}
