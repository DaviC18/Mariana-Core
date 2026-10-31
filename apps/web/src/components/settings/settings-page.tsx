"use client";

import {
  Bot,
  Building2,
  CheckCircle2,
  FileQuestion,
  HelpCircle,
  Lock,
  Package,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  UserCog,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Consultant = {
  active: boolean;
  calendarId: string;
  connectedGoogleAccount: string | null;
  email: string;
  id: string;
  name: string;
};

type CompanySettings = {
  description: string;
  name: string;
  phone: string;
};

type ProductItem = {
  desc: string;
  id: string;
  title: string;
};

type FaqItem = {
  a: string;
  id: string;
  q: string;
};

type AgentSettings = {
  instructions: string;
  maxWaitMinutes: number;
  tone: string;
};

type SystemSettings = {
  agent: AgentSettings;
  company: CompanySettings;
  faq: FaqItem[];
  products: ProductItem[];
};

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

export function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const validTabs = ["empresa", "produtos", "faq", "agente", "consultores"];
  const tabParam = searchParams.get("tab");
  const activeTab = validTabs.includes(tabParam ?? "") ? (tabParam as string) : "empresa";

  // Auth state
  const [authorized, setAuthorized] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authCode, setAuthCode] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const lastActivityAt = useRef(0);

  // Settings data state
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<{ error?: string; success?: string }>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Form states for settings
  const [companyForm, setCompanyForm] = useState<CompanySettings>({ description: "", name: "", phone: "" });
  const [productsForm, setProductsForm] = useState<ProductItem[]>([]);
  const [faqForm, setFaqForm] = useState<FaqItem[]>([]);
  const [agentForm, setAgentForm] = useState<AgentSettings>({ instructions: "", maxWaitMinutes: 15, tone: "" });

  // Consultants state
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [consultantForm, setConsultantForm] = useState({ calendarId: "", email: "", name: "" });
  const [editingConsultantId, setEditingConsultantId] = useState<string | null>(null);
  const [consultantToDelete, setConsultantToDelete] = useState<Consultant | null>(null);
  const [deleteCode, setDeleteCode] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [consultantMsg, setConsultantMsg] = useState("");

  const handleTabChange = (val: string | number | null) => {
    if (!val) return;
    const nextTab = String(val);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", nextTab);
    router.replace(`/configuracoes?${params.toString()}`, { scroll: false });
  };

  // Load initial settings (read-only for all)
  const loadSettings = async () => {
    try {
      const res = await fetch("/api/admin/settings", { cache: "no-store" });
      if (res.ok) {
        const body = (await res.json()) as { settings: SystemSettings };
        setSettings(body.settings);
        setCompanyForm(body.settings.company);
        setProductsForm(body.settings.products);
        setFaqForm(body.settings.faq);
        setAgentForm(body.settings.agent);
      }
    } catch {
      // Ignora erro de rede inicial
    } finally {
      setSettingsLoading(false);
    }
  };

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/admin/auth", { cache: "no-store" });
      if (res.ok) {
        const body = (await res.json()) as { authenticated: boolean };
        setAuthorized(body.authenticated);
      }
    } catch {
      // Ignora erro
    }
  };

  // Load consultants (reads list for all visitors)
  const loadConsultants = async () => {
    try {
      const res = await fetch("/api/admin/consultants", { cache: "no-store" });
      if (res.ok) {
        const body = (await res.json()) as { consultants: Consultant[] };
        setConsultants(body.consultants);
      }
    } catch {
      // Erro silencioso
    }
  };

  useEffect(() => {
    void checkAuth();
    void loadSettings();
    void loadConsultants();
  }, []);

  // Idle timeout & activity listener
  useEffect(() => {
    if (!authorized) return;
    let timeout = window.setTimeout(expire, IDLE_TIMEOUT_MS);
    function expire() {
      void fetch("/api/admin/auth", { method: "DELETE" });
      setAuthorized(false);
      setSaveStatus({ error: "Sessão administrativa expirada após 5 minutos de inatividade." });
    }
    function recordActivity() {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(expire, IDLE_TIMEOUT_MS);
      const now = Date.now();
      if (now - lastActivityAt.current >= 30_000) {
        lastActivityAt.current = now;
        void fetch("/api/admin/activity", { method: "POST" });
      }
    }
    for (const event of ["keydown", "pointerdown", "touchstart", "scroll"] as const) {
      window.addEventListener(event, recordActivity, { passive: true });
    }
    return () => {
      window.clearTimeout(timeout);
      for (const event of ["keydown", "pointerdown", "touchstart", "scroll"] as const) {
        window.removeEventListener(event, recordActivity);
      }
    };
  }, [authorized]);

  // Auth handler
  const handleAuthSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      const res = await fetch("/api/admin/auth", {
        body: JSON.stringify({ code: authCode }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setAuthError(body?.error ?? "Código de autenticação inválido.");
        return;
      }
      setAuthorized(true);
      setShowAuthModal(false);
      setAuthCode("");
      void loadConsultants();
    } catch {
      setAuthError("Erro de comunicação ao validar código.");
    } finally {
      setAuthLoading(false);
    }
  };

  const lockAdmin = async () => {
    await fetch("/api/admin/auth", { method: "DELETE" });
    setAuthorized(false);
    setSaveStatus({});
  };

  // Save specific settings key
  const saveSettingKey = async (key: "company" | "products" | "faq" | "agent", payload: unknown) => {
    setSavingKey(key);
    setSaveStatus({});
    try {
      const res = await fetch(`/api/admin/settings/${key}`, {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      if (res.status === 401) {
        setAuthorized(false);
        setShowAuthModal(true);
        setSaveStatus({ error: "Sua sessão expirou. Autentique-se para salvar." });
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setSaveStatus({ error: body?.error ?? "Não foi possível salvar as alterações." });
        return;
      }
      setSaveStatus({ success: "Configurações salvas com sucesso!" });
      void loadSettings();
    } catch {
      setSaveStatus({ error: "Erro de comunicação ao salvar configurações." });
    } finally {
      setSavingKey(null);
    }
  };

  // Consultant actions
  const saveConsultant = async (e: FormEvent) => {
    e.preventDefault();
    setConsultantMsg("");
    const res = await fetch(editingConsultantId ? `/api/admin/consultants/${editingConsultantId}` : "/api/admin/consultants", {
      body: JSON.stringify(consultantForm),
      headers: { "Content-Type": "application/json" },
      method: editingConsultantId ? "PATCH" : "POST",
    });
    const body = await res.json();
    if (!res.ok) {
      setConsultantMsg(body.error ?? "Não foi possível salvar o consultor.");
      return;
    }
    setConsultantForm({ calendarId: "", email: "", name: "" });
    setEditingConsultantId(null);
    setConsultants((curr) =>
      editingConsultantId
        ? curr.map((c) => (c.id === editingConsultantId ? { ...c, ...body.consultant } : c))
        : [...curr, body.consultant].sort((a, b) => a.name.localeCompare(b.name))
    );
  };

  const toggleConsultant = async (consultant: Consultant) => {
    const res = await fetch(`/api/admin/consultants/${consultant.id}`, {
      body: JSON.stringify({ active: !consultant.active }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    });
    const body = await res.json();
    if (!res.ok) {
      setConsultantMsg(body.error ?? "Não foi possível alterar status.");
      return;
    }
    setConsultants((curr) => curr.map((c) => (c.id === consultant.id ? body.consultant : c)));
  };

  const connectGoogle = async (consultant: Consultant) => {
    const res = await fetch("/api/admin/google-calendar/connect-link", {
      body: JSON.stringify({ consultantId: consultant.id }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const body = await res.json();
    if (!res.ok) {
      setConsultantMsg(body.error ?? "Não foi possível iniciar a conexão com o Google.");
      return;
    }
    window.location.assign(body.url);
  };

  const confirmRemoveConsultant = async (e: FormEvent) => {
    e.preventDefault();
    if (!consultantToDelete || deleteCode.length !== 6) return;
    setIsDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch(`/api/admin/consultants/${consultantToDelete.id}`, {
        headers: { "x-admin-totp": deleteCode },
        method: "DELETE",
      });
      if (res.status === 204) {
        setConsultants((curr) => curr.filter((c) => c.id !== consultantToDelete.id));
        setConsultantToDelete(null);
        setDeleteCode("");
        return;
      }
      const body = await res.json().catch(() => null);
      if (body?.error === "consultant_has_history") {
        setDeleteError("Este consultor possui histórico de agendas e só pode ser desativado.");
      } else {
        setDeleteError(body?.error ?? "Não foi possível excluir o consultor.");
      }
    } catch {
      setDeleteError("Erro de comunicação ao excluir consultor.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Configurações</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Parâmetros institucionais, regras de produtos e diretrizes operacionais da Mariana.
          </p>
        </div>
        <div>
          {authorized ? (
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <ShieldCheck size={14} />
                Edição liberada
              </span>
              <Button variant="outline" size="sm" onClick={lockAdmin}>
                <Lock size={14} className="mr-1.5" />
                Bloquear
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowAuthModal(true)}>
              <Lock size={14} className="mr-1.5" />
              Habilitar edição
            </Button>
          )}
        </div>
      </div>

      {/* Global save feedback message */}
      {saveStatus.success && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3 text-xs text-primary">
          <CheckCircle2 size={16} />
          <span>{saveStatus.success}</span>
        </div>
      )}
      {saveStatus.error && (
        <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {saveStatus.error}
        </div>
      )}

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
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

        {/* Tab 1: Empresa */}
        <TabsContent value="empresa" className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Building2 className="size-5 text-primary" />
                <h2 className="text-base font-semibold text-foreground">Identificação Institucional</h2>
              </div>
              {authorized && (
                <Button
                  size="sm"
                  disabled={savingKey === "company"}
                  onClick={() => saveSettingKey("company", companyForm)}
                >
                  {savingKey === "company" ? "Salvando..." : "Salvar empresa"}
                </Button>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Dados da organização utilizados pela Mariana durante as conversas no WhatsApp.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Nome da Empresa</label>
                {authorized ? (
                  <input
                    value={companyForm.name}
                    onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })}
                    className="h-10 w-full rounded-lg border border-border bg-muted/30 px-3.5 text-sm text-foreground outline-none focus:border-primary"
                  />
                ) : (
                  <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-sm text-foreground">
                    {companyForm.name || "Não informado"}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Telefone Oficial WhatsApp</label>
                {authorized ? (
                  <input
                    value={companyForm.phone}
                    onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })}
                    className="h-10 w-full rounded-lg border border-border bg-muted/30 px-3.5 text-sm font-mono text-foreground outline-none focus:border-primary"
                  />
                ) : (
                  <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-sm font-mono text-foreground">
                    {companyForm.phone || "Não informado"}
                  </div>
                )}
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Descrição Institucional</label>
                {authorized ? (
                  <textarea
                    rows={3}
                    value={companyForm.description}
                    onChange={(e) => setCompanyForm({ ...companyForm, description: e.target.value })}
                    className="w-full rounded-lg border border-border bg-muted/30 p-3.5 text-sm text-foreground outline-none focus:border-primary"
                  />
                ) : (
                  <div className="rounded-lg border border-border bg-muted/40 p-3.5 text-sm text-foreground leading-relaxed">
                    {companyForm.description || "Não informado"}
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Tab 2: Produtos */}
        <TabsContent value="produtos" className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Package className="size-5 text-primary" />
                <h2 className="text-base font-semibold text-foreground">Catálogo de Consórcios</h2>
              </div>
              {authorized && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setProductsForm([
                        ...productsForm,
                        { desc: "Nova descrição do produto...", id: `prod-${Date.now()}`, title: "Novo Consórcio" },
                      ])
                    }
                  >
                    <Plus size={14} className="mr-1" />
                    Adicionar
                  </Button>
                  <Button
                    size="sm"
                    disabled={savingKey === "products"}
                    onClick={() => saveSettingKey("products", productsForm)}
                  >
                    {savingKey === "products" ? "Salvando..." : "Salvar produtos"}
                  </Button>
                </div>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Segmentos e modalidades que a Mariana apresenta durante a qualificação.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {productsForm.map((prod, index) => (
                <div key={prod.id} className="rounded-lg border border-border bg-muted/30 p-4">
                  {authorized ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <input
                          value={prod.title}
                          onChange={(e) => {
                            const updated = [...productsForm];
                            updated[index] = { ...prod, title: e.target.value };
                            setProductsForm(updated);
                          }}
                          placeholder="Título do consórcio"
                          className="h-8 font-medium text-sm text-foreground bg-card border border-border rounded px-2 w-full outline-none focus:border-primary"
                        />
                        <Button
                          variant="destructive"
                          size="sm"
                          type="button"
                          onClick={() => setProductsForm(productsForm.filter((_, i) => i !== index))}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                      <textarea
                        rows={2}
                        value={prod.desc}
                        onChange={(e) => {
                          const updated = [...productsForm];
                          updated[index] = { ...prod, desc: e.target.value };
                          setProductsForm(updated);
                        }}
                        placeholder="Descrição do consórcio"
                        className="text-xs text-muted-foreground bg-card border border-border rounded p-2 w-full outline-none focus:border-primary"
                      />
                    </div>
                  ) : (
                    <>
                      <p className="font-medium text-sm text-foreground">{prod.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{prod.desc}</p>
                    </>
                  )}
                </div>
              ))}
              {productsForm.length === 0 && (
                <p className="text-xs text-muted-foreground p-4">Nenhum produto cadastrado.</p>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Tab 3: FAQ */}
        <TabsContent value="faq" className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <FileQuestion className="size-5 text-primary" />
                <h2 className="text-base font-semibold text-foreground">Base de Conhecimento e FAQ</h2>
              </div>
              {authorized && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setFaqForm([
                        ...faqForm,
                        { a: "Resposta detalhada...", id: `faq-${Date.now()}`, q: "Nova pergunta frequente?" },
                      ])
                    }
                  >
                    <Plus size={14} className="mr-1" />
                    Adicionar
                  </Button>
                  <Button
                    size="sm"
                    disabled={savingKey === "faq"}
                    onClick={() => saveSettingKey("faq", faqForm)}
                  >
                    {savingKey === "faq" ? "Salvando..." : "Salvar FAQ"}
                  </Button>
                </div>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Respostas pré-definidas e regras que orientam as explicações sobre consórcio.
            </p>

            <div className="mt-5 space-y-3">
              {faqForm.map((faq, index) => (
                <div key={faq.id} className="rounded-lg border border-border bg-muted/30 p-4">
                  {authorized ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <input
                          value={faq.q}
                          onChange={(e) => {
                            const updated = [...faqForm];
                            updated[index] = { ...faq, q: e.target.value };
                            setFaqForm(updated);
                          }}
                          placeholder="Pergunta"
                          className="h-8 font-medium text-sm text-foreground bg-card border border-border rounded px-2 w-full outline-none focus:border-primary"
                        />
                        <Button
                          variant="destructive"
                          size="sm"
                          type="button"
                          onClick={() => setFaqForm(faqForm.filter((_, i) => i !== index))}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                      <textarea
                        rows={2}
                        value={faq.a}
                        onChange={(e) => {
                          const updated = [...faqForm];
                          updated[index] = { ...faq, a: e.target.value };
                          setFaqForm(updated);
                        }}
                        placeholder="Resposta"
                        className="text-xs text-muted-foreground bg-card border border-border rounded p-2 w-full outline-none focus:border-primary"
                      />
                    </div>
                  ) : (
                    <>
                      <p className="font-medium text-sm text-foreground">{faq.q}</p>
                      <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{faq.a}</p>
                    </>
                  )}
                </div>
              ))}
              {faqForm.length === 0 && (
                <p className="text-xs text-muted-foreground p-4">Nenhuma pergunta cadastrada.</p>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Tab 4: Agente IA */}
        <TabsContent value="agente" className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Bot className="size-5 text-primary" />
                <h2 className="text-base font-semibold text-foreground">Diretrizes da Mariana (IA)</h2>
              </div>
              {authorized && (
                <Button
                  size="sm"
                  disabled={savingKey === "agent"}
                  onClick={() => saveSettingKey("agent", agentForm)}
                >
                  {savingKey === "agent" ? "Salvando..." : "Salvar diretrizes"}
                </Button>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Comportamento, tom de voz e regras de qualificação executadas no atendimento do WhatsApp.
            </p>

            <div className="mt-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Tom de Voz</label>
                  {authorized ? (
                    <input
                      value={agentForm.tone}
                      onChange={(e) => setAgentForm({ ...agentForm, tone: e.target.value })}
                      className="h-10 w-full rounded-lg border border-border bg-muted/30 px-3.5 text-sm text-foreground outline-none focus:border-primary"
                    />
                  ) : (
                    <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-sm text-foreground">
                      {agentForm.tone}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Janela de Inatividade (minutos)</label>
                  {authorized ? (
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={agentForm.maxWaitMinutes}
                      onChange={(e) => setAgentForm({ ...agentForm, maxWaitMinutes: Number(e.target.value) || 15 })}
                      className="h-10 w-full rounded-lg border border-border bg-muted/30 px-3.5 text-sm font-mono text-foreground outline-none focus:border-primary"
                    />
                  ) : (
                    <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-sm font-mono text-foreground">
                      {agentForm.maxWaitMinutes} minutos
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Instruções Operacionais e Limitações</label>
                {authorized ? (
                  <textarea
                    rows={4}
                    value={agentForm.instructions}
                    onChange={(e) => setAgentForm({ ...agentForm, instructions: e.target.value })}
                    className="w-full rounded-lg border border-border bg-muted/30 p-3.5 text-sm text-foreground outline-none focus:border-primary leading-relaxed"
                  />
                ) : (
                  <div className="rounded-lg border border-border bg-muted/40 p-3.5 text-sm text-foreground leading-relaxed">
                    {agentForm.instructions}
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Tab 5: Consultores */}
        <TabsContent value="consultores" className="space-y-5">
          {authorized && (
            <div className="rounded-xl border border-border bg-card p-6">
              <h2 className="text-base font-semibold">Equipe de consultores</h2>
              <p className="mt-1 text-sm text-muted-foreground">Consultores inativos não recebem novas agendas. O histórico é preservado.</p>
              <form onSubmit={saveConsultant} className="mt-5 grid gap-3 sm:grid-cols-3">
                <input
                  required
                  value={consultantForm.name}
                  onChange={(e) => setConsultantForm({ ...consultantForm, name: e.target.value })}
                  placeholder="Nome completo"
                  className="h-9 rounded-lg border border-border bg-muted/30 px-3 text-sm"
                />
                <input
                  required
                  type="email"
                  value={consultantForm.email}
                  onChange={(e) => setConsultantForm({ ...consultantForm, email: e.target.value })}
                  placeholder="E-mail"
                  className="h-9 rounded-lg border border-border bg-muted/30 px-3 text-sm"
                />
                <div className="flex gap-2">
                  <input
                    required
                    value={consultantForm.calendarId}
                    onChange={(e) => setConsultantForm({ ...consultantForm, calendarId: e.target.value })}
                    placeholder="ID do Google Calendar"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-muted/30 px-3 text-sm"
                  />
                  <Button type="submit">{editingConsultantId ? "Salvar" : "Adicionar"}</Button>
                  {editingConsultantId && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEditingConsultantId(null);
                        setConsultantForm({ calendarId: "", email: "", name: "" });
                      }}
                    >
                      Cancelar
                    </Button>
                  )}
                </div>
              </form>
              {consultantMsg && <p className="mt-3 text-sm text-destructive">{consultantMsg}</p>}
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="divide-y divide-border">
              {consultants.map((consultant) => (
                <div key={consultant.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium text-sm">{consultant.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {consultant.email} · {consultant.calendarId}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <StatusBadge status={consultant.connectedGoogleAccount ? "connected" : "disconnected"} />
                      <span className="text-xs text-muted-foreground">
                        {consultant.connectedGoogleAccount ?? "Google Calendar não conectado"}
                      </span>
                    </div>
                  </div>
                  {authorized ? (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" size="sm" onClick={() => connectGoogle(consultant)}>
                        Conectar Google
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingConsultantId(consultant.id);
                          setConsultantForm({
                            calendarId: consultant.calendarId,
                            email: consultant.email,
                            name: consultant.name,
                          });
                        }}
                      >
                        <Pencil />
                        Editar
                      </Button>
                      <Button
                        variant={consultant.active ? "outline" : "default"}
                        size="sm"
                        onClick={() => toggleConsultant(consultant)}
                      >
                        {consultant.active ? "Desativar" : "Ativar"}
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => setConsultantToDelete(consultant)}>
                        <Trash2 />
                        Excluir
                      </Button>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <StatusBadge status={consultant.active ? "scheduled" : "cancelled"} />
                      <span>{consultant.active ? "Ativo" : "Inativo"}</span>
                    </div>
                  )}
                </div>
              ))}
              {consultants.length === 0 && (
                <p className="p-6 text-sm text-muted-foreground">Nenhum consultor cadastrado.</p>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Auth Modal (Habilitar edição) */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-foreground">Acesso administrativo</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Informe o código de seis dígitos do seu aplicativo autenticador para liberar a edição das configurações e consultores.
            </p>
            <form onSubmit={handleAuthSubmit} className="mt-5 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Código de seis dígitos</label>
                <input
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={authCode}
                  onChange={(e) => setAuthCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  className="h-10 w-full rounded-lg border border-border bg-muted/30 px-3 text-center font-mono text-lg tracking-[0.3em] outline-none focus:border-primary"
                />
              </div>
              {authError && <p className="text-sm text-destructive">{authError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowAuthModal(false);
                    setAuthCode("");
                    setAuthError("");
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={authCode.length !== 6 || authLoading}>
                  {authLoading ? "Validando..." : "Entrar"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Consultant Modal */}
      {consultantToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-foreground">Confirmar exclusão de consultor</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Para excluir <strong className="text-foreground">{consultantToDelete.name}</strong>, informe o código de 6 dígitos do seu autenticador.
            </p>
            <form onSubmit={confirmRemoveConsultant} className="mt-5 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">Código de seis dígitos</label>
                <input
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={deleteCode}
                  onChange={(e) => setDeleteCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  className="h-10 w-full rounded-lg border border-border bg-muted/30 px-3 text-center font-mono text-lg tracking-[0.3em] outline-none focus:border-primary"
                />
              </div>
              {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isDeleting}
                  onClick={() => {
                    setConsultantToDelete(null);
                    setDeleteCode("");
                    setDeleteError("");
                  }}
                >
                  Cancelar
                </Button>
                <Button type="submit" variant="destructive" disabled={deleteCode.length !== 6 || isDeleting}>
                  {isDeleting ? "Excluindo..." : "Confirmar exclusão"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
