# Mariana — Plano de Implementação do Frontend

## 1. Objetivo

Construir um painel administrativo moderno, responsivo e funcional para o sistema Mariana.

O painel permitirá que o cliente acompanhe a operação do sistema, visualize leads, consulte conversas, acompanhe reuniões e configure os dados da empresa e do agente de IA.

**Diretriz principal:** aproveitar o backend existente. Não duplicar funcionalidades que já funcionam na API nem criar regras de negócio desnecessárias no frontend.

## 2. Stack tecnológica

- Next.js 16 — App Router.
- React 19.
- TypeScript.
- Tailwind CSS 4.
- shadcn/ui.
- Lucide React.
- Recharts — gráficos, caso necessário.
- React Hook Form + Zod — formulários e validação, se já compatíveis com o projeto.

Antes de instalar dependências, verificar o que já está disponível no projeto. Evitar duplicações.

## 3. Identidade visual e Design System

Criar uma identidade visual consistente para todas as páginas.

**Direção visual:**

- Interface SaaS profissional.
- Tema escuro como padrão, com possibilidade de tema claro futuramente.
- Fundo em tons de grafite e preto.
- Superfícies com contraste sutil.
- Cor de destaque em verde ou esmeralda, associada à identidade da Mariana.
- Bordas discretas, sombras moderadas e cantos arredondados.
- Tipografia legível e hierarquia visual clara.

**Componentes compartilhados:**

- Sidebar.
- Header.
- PageHeader.
- MetricCard.
- DataTable.
- SearchInput.
- FilterDropdown.
- StatusBadge.
- EmptyState.
- LoadingState.
- ErrorState.
- ConfirmDialog.
- FormField.
- DateDisplay.

Utilizar componentes shadcn/ui sempre que possível.

Criar tokens e estilos reutilizáveis. Não repetir estilos e estruturas em cada página.

## 4. Estrutura de navegação

A navegação principal terá cinco áreas:

1. Dashboard
2. Leads
3. Conversas
4. Agendamentos
5. Configurações

A sidebar deve permanecer consistente entre as páginas, com indicação visual da seção ativa.

O header deverá apresentar o nome da empresa, título da página e informações úteis da interface.

## 5. Páginas e funcionalidades

### 5.1 Dashboard

Objetivo: apresentar uma visão geral da operação da Mariana.

**Elementos:**

- Total de leads.
- Conversas recebidas.
- Agendamentos realizados.
- Atividade recente.
- Evolução das conversas, se houver dados históricos suficientes.
- Resumo dos atendimentos.

**Regras:**

- Todos os indicadores devem vir da API.
- Não criar métricas fictícias.
- Não apresentar números demonstrativos como se fossem reais.
- Caso algum indicador não tenha endpoint ou dado disponível, mostrar estado indisponível ou omitir o componente.

### 5.2 Leads

Objetivo: permitir a consulta dos clientes que entraram em contato.

**Elementos:**

- Tabela de leads.
- Nome.
- Telefone.
- Data de entrada.
- Status, se disponibilizado pela API.
- Campo de pesquisa.
- Filtros compatíveis com os dados existentes.
- Visualização dos detalhes do lead.

**Restrições:**

- Não permitir editar leads.
- Não permitir excluir leads.
- Não criar ações administrativas desnecessárias.

A seção será exclusivamente de consulta.

### 5.3 Conversas

Objetivo: permitir acompanhar o atendimento realizado pela IA.

**Layout:**

- Coluna lateral com a lista de conversas.
- Área principal com o histórico da conversa selecionada.

**Elementos:**

- Identificação do lead.
- Histórico de mensagens.
- Mensagens enviadas pelo cliente.
- Respostas enviadas pela IA.
- Datas e horários.
- Indicadores de status, quando disponíveis.

**Restrições:**

- Não disponibilizar envio manual de mensagens.
- Não criar funcionalidade de takeover de atendimento pelo painel.
- Não inventar transferência de conversa para humano.

O atendimento com consultor ocorre por meio da reunião agendada no Google Meet.

### 5.4 Agendamentos

Objetivo: acompanhar as reuniões realizadas por meio da Mariana.

**Elementos:**

- Nome do lead.
- Consultor responsável.
- Data e horário.
- Status do agendamento.
- Link do Google Meet.
- Ação para abrir a reunião.

**Fluxo já existente:**

1. Cliente conversa com a IA pelo WhatsApp.
2. A IA conduz o agendamento.
3. O sistema cria o compromisso e gera o link do Google Meet.
4. O cliente recebe automaticamente o link pelo WhatsApp.
5. O consultor visualiza o compromisso no Google Calendar e acessa a reunião por lá.

**Restrições:**

- Não gerar outro link do Meet.
- Não duplicar a integração com o Google Calendar.
- Não criar um segundo sistema de agendamento.
- Exibir somente informações efetivamente disponibilizadas pelo backend.

### 5.5 Configurações

Objetivo: permitir que o cliente personalize o funcionamento da Mariana.

Organizar a página em seções ou abas.

**Empresa**

- Nome da empresa.
- Descrição.
- Informações de contato.
- Outras informações já suportadas pelo backend.

**Produtos e serviços**

- Lista de produtos e serviços.
- Descrições e informações disponíveis.
- Edição somente se houver suporte na API.

**Perguntas frequentes**

- Visualização das perguntas e respostas cadastradas.
- Edição e gerenciamento somente se houver endpoints correspondentes.

**Agente de IA**

- Instruções do agente.
- Contexto da empresa.
- Configurações de comportamento que já existam no backend.

Não criar controles visuais que não tenham integração real. Se alguma configuração ainda não tiver suporte na API, identificar a pendência em vez de simular seu funcionamento.

## 6. Organização técnica sugerida

Respeitar a estrutura atual do projeto e adaptar a organização abaixo ao que já existe.

```text
apps/web/src/
├── app/
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── leads/
│   │   ├── conversas/
│   │   ├── agendamentos/
│   │   └── configuracoes/
│   ├── api/
│   │   └── ... (Route Handlers / BFF)
│   └── globals.css
│
├── components/
│   ├── layout/
│   ├── dashboard/
│   ├── leads/
│   ├── conversations/
│   ├── appointments/
│   ├── settings/
│   └── ui/
│
├── lib/
│   ├── utils.ts
│   ├── types/
│   └── ...
│
└── ...
```

Não reorganizar arquivos existentes sem necessidade. A estrutura é uma referência, não uma ordem para refatorar todo o projeto.

## 7. Integração com o backend

A integração deve respeitar o contrato real da API Fastify.

**Arquitetura recomendada:**

```text
Browser
   |
   v
Next.js Route Handlers (BFF)
   |
   v
Fastify API
   |
   v
PostgreSQL / Neon
```

Regras obrigatórias:

- O navegador nunca recebe a ADMIN_API_KEY.
- A chave fica exclusivamente no ambiente server-side.
- Não utilizar variáveis NEXT_PUBLIC para segredos.
- Centralizar chamadas à API.
- Padronizar tratamento de erros.
- Implementar loading, empty e error states.
- Evitar chamadas duplicadas e requisições desnecessárias.
- Não acessar o banco diretamente pelo frontend.

O BFF deverá ser implementado e validado separadamente, em coordenação com o Codex.

**Importante:** como não haverá login próprio, o painel não poderá ficar publicamente acessível sem uma camada externa de proteção, como Cloudflare Access ou outra solução equivalente.

## 8. Responsividade e experiência

O painel deverá funcionar em:

- Desktop.
- Notebook.
- Tablet.
- Celular.

Priorizar desktop, mas não deixar tabelas, conversas e formulários inutilizáveis em telas menores.

Também implementar:

- Feedback visual para ações.
- Skeletons durante carregamento.
- Estados vazios informativos.
- Mensagens de erro claras.
- Confirmação para ações que alterem configurações.
- Navegação consistente.

## 9. Ordem de implementação

### Fase 1 — Fundação

- Inspecionar o frontend atual.
- Preservar configurações existentes.
- Definir Design System.
- Configurar layout principal.
- Criar sidebar e header.
- Preparar componentes compartilhados.

### Fase 2 — Páginas principais

1. Dashboard.
2. Leads.
3. Conversas.
4. Agendamentos.
5. Configurações.

Construir todas utilizando o mesmo Design System.

### Fase 3 — Integração

- Consumir dados reais.
- Integrar cada página com os endpoints disponíveis.
- Implementar estados de carregamento e erro.
- Validar contratos e tipos.

### Fase 4 — Validação

- Testar navegação.
- Testar responsividade.
- Verificar ausência de dados fictícios.
- Validar links e informações dos agendamentos.
- Verificar proteção das rotas administrativas.
- Executar lint, typecheck e build.

## 10. Organização da implementação

A implementação deverá respeitar a separação entre frontend, backend e integração.

- O frontend deve consumir exclusivamente os contratos disponibilizados pela API.
- A integração deve preservar a arquitetura existente.
- Alterações no backend devem ocorrer somente quando forem necessárias e justificadas.
- Evitar alterações simultâneas nos mesmos arquivos.
- Antes de modificar componentes ou serviços existentes, verificar suas dependências e possíveis impactos.
- Toda alteração deve preservar a compatibilidade entre frontend e backend.

O desenvolvimento deve seguir uma única especificação, sem atribuir responsabilidades a ferramentas ou agentes externos.

## 11. Critérios de conclusão

O frontend estará pronto para demonstração quando:

- [x] As cinco áreas estiverem implementadas (Dashboard, Leads, Conversas, Agendamentos, Configurações).
- [x] A navegação estiver funcionando com AppShell responsivo e links ativos.
- [x] Os dados forem carregados da API real via BFF e hook `useApi`.
- [x] Leads forem exclusivamente de consulta (somente leitura com busca, filtros e detalhes expansíveis).
- [x] Conversas exibirem o histórico de mensagens corretamente (chat estilizado com auto-scroll e filtros).
- [x] Agendamentos integrados aos registros do banco (exibição de lead, data/horário, consultor e ID do evento no Google Calendar, com aviso transparente sobre a ausência de coluna direta de Meet URL no backend).
- [x] Configurações conectadas aos parâmetros disponíveis com identificação explícita de pendências administrativas da API.
- [x] Métricas calculadas estritamente a partir dos dados reais da API, sem dados fictícios.
- [x] Interface totalmente responsiva em desktop, tablet e mobile.
- [x] Estados de carregamento (`LoadingState`), erro (`ErrorState`) e vazio (`EmptyState`) padronizados.
- [x] A `ADMIN_API_KEY` isolada no servidor via Route Handler BFF (`/api/admin/[...path]`).
- [x] Build e verificações de código passarem (`tsc`, `eslint` e `next build` com 0 erros).

## 12. Regras de execução

1. Não reescrever o backend.
2. Não migrar de Next.js para outra tecnologia.
3. Não adicionar funcionalidades fora do escopo.
4. Não criar dados fictícios para preencher telas.
5. Não duplicar integrações já existentes.
6. Reutilizar componentes e estilos.
7. Preservar o código existente sempre que possível.
8. Não fazer commits ou push sem autorização explícita.
9. Se uma funcionalidade depender de endpoint inexistente, registrar a pendência em vez de simular seu funcionamento.
10. Priorizar uma entrega funcional e consistente, não complexidade visual desnecessária.

**Resultado esperado:** um painel administrativo profissional, conectado à Mariana, que permita ao cliente acompanhar a operação e configurar o sistema sem duplicar as funcionalidades do backend.

## 13. Skills e padrões de qualidade

Durante a implementação do frontend, utilizar as seguintes skills como referências técnicas e visuais:

1. UI/UX Pro Max: orientar a criação do Design System, identidade visual, hierarquia visual e experiência do usuário.

2. Impeccable: aprimorar o acabamento visual, tipografia, espaçamentos, consistência e qualidade estética.

3. Vercel React Best Practices: orientar arquitetura React, Next.js, performance, renderização e boas práticas de desenvolvimento.

4 .Web Design Guidelines: validar acessibilidade, responsividade, semântica HTML, usabilidade e boas práticas de interfaces web.

Regras de utilização

Consultar as instruções das skills antes de iniciar a implementação.

Aplicar as recomendações compatíveis com a stack existente.

Evitar recomendações redundantes ou conflitantes.

Priorizar consistência visual e qualidade técnica.

Não instalar dependências desnecessárias.

Não alterar a arquitetura ou a stack sem justificativa.

Não permitir que as skills modifiquem o escopo funcional definido neste documento.

Prioridade: o FRONTEND-PLAN.md permanece como especificação principal. As skills são referências complementares para elevar a qualidade da implementação.
