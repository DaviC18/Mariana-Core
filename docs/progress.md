# Progresso do Projeto Mariana Core

**Última Atualização:** 31 de Outubro de 2026  
**Status Atual:** Monorepo Estruturado & Base Frontend Inicializada (Comitado e Sincronizado em `origin/master` - commit `83e03df`)

---

## 1. Etapas Concluídas

### 1.1 Auditoria Técnica Integral do Backend
- [x] **Mapeamento de Rotas:** 22 endpoints auditados (8 públicos e 14 administrativos com Bearer token e rate limit).
- [x] **Auditoria de Banco:** 11 tabelas modeladas em Drizzle ORM (PostgreSQL/Neon) com índices, enums e integridade referencial.
- [x] **Auditoria de Serviços e Assincronismo:**
  - Máquina de estados conversacionais (fluxos v1 e v2).
  - Integração Gemini (`@google/genai`) com guardrails e políticas comerciais.
  - Integração Google Calendar com criação atômica de reuniões Google Meet e rollback de compensação.
  - Fila durável `autonomous_tasks` com leases e recuperação de tarefas órfãs.
  - Fila outbox `outbound_messages` com conformidade à janela de 24h e opt-out.
  - Rotação automática de sessão após 4h de inatividade do cliente.
- [x] **Documento de Contrato Real:** Gerado em [`docs/api-contract.md`](file:///home/davi-curty/Documentos/Programing/Projects/mariana-core/docs/api-contract.md), catalogando rotas, esquemas Zod, cabeçalhos, rate limits e as 4 anomalias contratuais identificadas para futura refatoração.

---

### 1.2 Resolução de Conflito Git na Raiz
- [x] **Diagnóstico:** A pasta `Mariana/` continha seu próprio `.git` e estava registrada no repositório raiz como gitlink/submódulo órfão (`160000`), gerando aviso permanente de `modified: Mariana (conteúdo não monitorado)`.
- [x] **Backup:** Cópia de segurança do histórico do repositório interno preservada em `/tmp/mariana_dot_git_backup`.
- [x] **Correção:** Executado `git rm --cached Mariana`, removido o `.git` aninhado e movido o backend para `apps/api/`, unificando o controle de versão sob a raiz `mariana-core`.

---

### 1.3 Estruturação do Monorepo (`npm workspaces`)
- [x] **Configuração Raiz:** Criado [`package.json`](file:///home/davi-curty/Documentos/Programing/Projects/mariana-core/package.json) com `workspaces: ["apps/*", "packages/*"]`.
- [x] **Scripts Raiz Unificados:**
  - `npm run dev:api` / `npm run dev:web`
  - `npm run build:api` / `npm run build:web`
  - `npm run test:api`
- [x] **Regras de Ignore:** Configurado [`.gitignore`](file:///home/davi-curty/Documentos/Programing/Projects/mariana-core/.gitignore) cobrindo `.next`, `node_modules`, `dist`, `.env*` e logs.

---

### 1.4 Fundação do Frontend (`apps/web`)
- [x] **Stack:** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4.
- [x] **Componentes shadcn/ui:** Instalados e configurados:
  - `Button`, `Card`, `Badge`, `Tabs`, `Table` e ícones `lucide-react`.
- [x] **Dashboard Base:** Implementado em [`apps/web/src/app/page.tsx`](file:///home/davi-curty/Documentos/Programing/Projects/mariana-core/apps/web/src/app/page.tsx) com:
  - Header de status do sistema e healthcheck.
  - Cards de métricas operacionais (leads, conversas, reuniões, workers).
  - Aba de arquitetura técnica do monorepo.
  - Aba do catálogo dos 22 endpoints auditados da API.
  - Aba de segurança e anomalias mapeadas.

---

## 2. Validações e Testes Realizados

| Comando | Escopo | Resultado |
|---|---|---|
| `npm run test:api` | Backend Unit Suite (`apps/api`) | **100% Sucesso** (Exit Code 0) |
| `npm run build:web` | Frontend Build (`apps/web`) | **100% Sucesso** (Static Prerender limpo) |
| `git status` | Repositório Raiz | Limpo, sem erros de submódulo |

---

## 3. Estado do Repositório Git

- **Commit Base:** `83e03df` (`chore: setup npm workspaces monorepo with apps/api and apps/web`) enviado para `origin/master`.
- **Arquivos Locais Atualizados:**
  - `docs/progress.md`: Este relatório de progresso contínuo.
  - `docs/api-contract.md`: Contrato integral da API.

---

## 4. Próximos Passos Recomendados

1. **Aprovação do Commit Base:** Submeter commit das alterações estruturais do monorepo (`chore: setup npm workspaces monorepo with apps/api and apps/web`).
2. **Integração Frontend <-> Backend:** Criar cliente HTTP tipado no frontend para consumir as rotas administrativas de leads e agendamentos.
3. **Autenticação de Operador no Frontend:** Desenhar camada de sessão segura para o operador interagir com a API sem expor a `ADMIN_API_KEY` no client-side.
4. **Refatoração das Anomalias de Contrato:** Ajustar os retornos 201 em GETs e a correção do bug de retorno em `GET /messages/:id` quando aprovado.
