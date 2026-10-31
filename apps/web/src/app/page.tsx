import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  Bot,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Layers,
  MessageSquare,
  ShieldAlert,
  Users,
} from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur sticky top-0 z-20 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold shadow-sm">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-lg leading-tight">Mariana Core</h1>
              <Badge variant="outline" className="text-xs font-mono font-medium text-emerald-600 border-emerald-300 dark:border-emerald-800">
                v1.0.0 Monorepo
              </Badge>
            </div>
            <p className="text-xs text-zinc-500">Agente IA de Consórcio & Automação WhatsApp</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Badge className="bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1.5 py-1 px-2.5">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Backend API Online
          </Badge>
          <Button variant="outline" size="sm" asChild>
            <a href="/api/health" target="_blank" rel="noreferrer">
              Healthcheck (Fastify :3252)
            </a>
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Total de Leads
              </CardTitle>
              <Users className="h-4 w-4 text-zinc-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">1.248</div>
              <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
                <span className="text-emerald-600 font-medium">+18%</span> vs mês anterior
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Conversas Ativas
              </CardTitle>
              <MessageSquare className="h-4 w-4 text-zinc-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">84</div>
              <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
                <Clock className="h-3 w-3 text-zinc-400" /> Janela de inatividade: 4h
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Reuniões Agendadas
              </CardTitle>
              <CalendarCheck className="h-4 w-4 text-zinc-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">42</div>
              <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Google Meet sincronizado
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
                Workers em Execução
              </CardTitle>
              <Activity className="h-4 w-4 text-emerald-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">2 Ativos</div>
              <p className="text-xs text-zinc-500 mt-1">
                Autonomous Tasks & Outbox
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs Section */}
        <Tabs defaultValue="architecture" className="space-y-4">
          <TabsList className="bg-zinc-100 dark:bg-zinc-800 p-1">
            <TabsTrigger value="architecture" className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Arquitetura Monorepo
            </TabsTrigger>
            <TabsTrigger value="routes" className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Inventário de Endpoints (22)
            </TabsTrigger>
            <TabsTrigger value="audit" className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              Auditoria & Status Técnico
            </TabsTrigger>
          </TabsList>

          {/* Tab: Architecture */}
          <TabsContent value="architecture" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Estrutura Integrada Monorepo</CardTitle>
                <CardDescription>
                  Separação estrita entre o motor headless de backend e a interface web do operador.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                    <h3 className="font-semibold text-emerald-600 flex items-center gap-2 mb-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                      apps/api (Backend Fastify)
                    </h3>
                    <ul className="space-y-1.5 text-zinc-600 dark:text-zinc-400">
                      <li>• Fastify 5.12 + Drizzle ORM + PostgreSQL (Neon)</li>
                      <li>• Orquestrador Gemini (Google GenAI)</li>
                      <li>• Integração Meta Cloud API & Google Calendar</li>
                      <li>• Fila durável com leases (`autonomous_tasks`)</li>
                      <li>• Fila outbox transacional (`outbound_messages`)</li>
                    </ul>
                  </div>

                  <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/50">
                    <h3 className="font-semibold text-blue-600 flex items-center gap-2 mb-2">
                      <span className="h-2 w-2 rounded-full bg-blue-500" />
                      apps/web (Frontend Next.js)
                    </h3>
                    <ul className="space-y-1.5 text-zinc-600 dark:text-zinc-400">
                      <li>• Next.js (App Router) + React 19 + TypeScript</li>
                      <li>• Tailwind CSS + shadcn/ui</li>
                      <li>• Painel de atendimento e gestão de leads</li>
                      <li>• Gestão de conexões Google Calendar</li>
                      <li>• npm workspaces integrado no repositório raiz</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab: Routes */}
          <TabsContent value="routes">
            <Card>
              <CardHeader>
                <CardTitle>Catálogo de Endpoints da API</CardTitle>
                <CardDescription>
                  Contrato real consolidado em docs/api-contract.md.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[100px]">Método</TableHead>
                      <TableHead>Rota</TableHead>
                      <TableHead>Escopo / Autenticação</TableHead>
                      <TableHead>Descrição</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell><Badge variant="outline" className="font-mono text-emerald-600">GET</Badge></TableCell>
                      <TableCell className="font-mono text-xs">/</TableCell>
                      <TableCell><Badge variant="secondary">Público</Badge></TableCell>
                      <TableCell>Healthcheck simples (retorna &apos;ok&apos;)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell><Badge variant="outline" className="font-mono text-emerald-600">GET</Badge></TableCell>
                      <TableCell className="font-mono text-xs">/webhooks/whatsapp</TableCell>
                      <TableCell><Badge variant="secondary">Meta Token</Badge></TableCell>
                      <TableCell>Verificação de webhook Meta Cloud API</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell><Badge variant="outline" className="font-mono text-blue-600">POST</Badge></TableCell>
                      <TableCell className="font-mono text-xs">/webhooks/whatsapp</TableCell>
                      <TableCell><Badge variant="secondary">HMAC SHA-256</Badge></TableCell>
                      <TableCell>Entrada de mensagens e toques de botões WhatsApp</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell><Badge variant="outline" className="font-mono text-blue-600">POST</Badge></TableCell>
                      <TableCell className="font-mono text-xs">/leads</TableCell>
                      <TableCell><Badge className="bg-amber-100 text-amber-800 border-amber-300">Admin Bearer</Badge></TableCell>
                      <TableCell>Criação manual de lead (validação &gt;= 18 anos)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell><Badge variant="outline" className="font-mono text-emerald-600">GET</Badge></TableCell>
                      <TableCell className="font-mono text-xs">/leads</TableCell>
                      <TableCell><Badge className="bg-amber-100 text-amber-800 border-amber-300">Admin Bearer</Badge></TableCell>
                      <TableCell>Listagem de leads</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell><Badge variant="outline" className="font-mono text-blue-600">POST</Badge></TableCell>
                      <TableCell className="font-mono text-xs">/conversations</TableCell>
                      <TableCell><Badge className="bg-amber-100 text-amber-800 border-amber-300">Admin Bearer</Badge></TableCell>
                      <TableCell>Cria ou recupera conversa ativa (idempotente)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell><Badge variant="outline" className="font-mono text-emerald-600">GET</Badge></TableCell>
                      <TableCell className="font-mono text-xs">/appointments/availability</TableCell>
                      <TableCell><Badge className="bg-amber-100 text-amber-800 border-amber-300">Admin Bearer</Badge></TableCell>
                      <TableCell>Consulta de horários livres de consultores</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell><Badge variant="outline" className="font-mono text-blue-600">POST</Badge></TableCell>
                      <TableCell className="font-mono text-xs">/appointments</TableCell>
                      <TableCell><Badge className="bg-amber-100 text-amber-800 border-amber-300">Admin Bearer</Badge></TableCell>
                      <TableCell>Cria agendamento com Google Meet e compensação atômica</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab: Audit */}
          <TabsContent value="audit">
            <Card>
              <CardHeader>
                <CardTitle>Auditoria de Contrato e Segurança</CardTitle>
                <CardDescription>
                  Políticas ativas no Fastify e anomalias mapeadas para refatoração futura.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <h4 className="font-semibold text-sm mb-2 text-zinc-900 dark:text-zinc-100">
                      Políticas Globais de Segurança
                    </h4>
                    <ul className="text-xs space-y-1 text-zinc-600 dark:text-zinc-400">
                      <li>• CSP estrito: <code className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">default-src &apos;none&apos;; frame-ancestors &apos;none&apos;</code></li>
                      <li>• Header anti-clickjacking: <code className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">X-Frame-Options: DENY</code></li>
                      <li>• Rate limiter contra força bruta: 10 falhas / 15 min por IP no admin</li>
                      <li>• Cache-Control: <code className="bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">no-store</code> em rotas administrativas</li>
                    </ul>
                  </div>

                  <div className="p-4 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/20">
                    <h4 className="font-semibold text-sm mb-2 text-amber-800 dark:text-amber-400">
                      Anomalias Contratuais a Ajustar
                    </h4>
                    <ul className="text-xs space-y-1 text-amber-700 dark:text-amber-300">
                      <li>• GET com retorno 201: <code className="bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded">/conversations/:id</code>, <code className="bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded">/messages</code></li>
                      <li>• Recurso inexistente retornando 401 em vez de 404: <code className="bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded">/leads/:id</code></li>
                      <li>• Exceção 500 por ausência de return pós-404: <code className="bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded">/messages/:id</code></li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800 py-4 px-6 text-center text-xs text-zinc-500">
        Mariana Core Monorepo &bull; Fastify Backend em <code className="font-mono">apps/api</code> &bull; Next.js Frontend em <code className="font-mono">apps/web</code>
      </footer>
    </div>
  );
}
