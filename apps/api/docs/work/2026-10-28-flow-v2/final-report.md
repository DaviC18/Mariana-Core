# Relatório final — 2026-10-28-flow-v2 (D-12)

Data: 2026-10-28. Escopo entregue: lotes V0–V4 (batches A, A4, B, C, C-MEET e D), rodada C, rodada final (CM-3 + docs) e este relatório. **V5 não iniciado** (teste manual do Davi no WhatsApp).

Depois do Batch D vieram a rodada C (teste independente), a rodada final (CM-3 + docs) e este relatório. A rodada final mexeu em `google-calendar-service.ts` e no simulador; `run-turn.ts` e `texts.ts` **não** foram tocados nela.

## Veredito por rodada

Todas as rodadas fecharam com **0 achados bloqueantes**. Só a primeira rodada B reprovou (B-1..B-4 em `reply-guard.ts`); depois da correção, as suítes finais não têm falha nem `todo` extra além dos 6 conhecidos (E-12c/E-15).

| Rodada | Quando | Escopo | Veredito | Bloqueantes | `test:unit` | `test:db` |
|---|---|---|---|---|---|---|
| A (A1–A3) | antes de `41096ee` | flag, núcleo puro, rotas de automação, R8, tap | PASS | 0 | 464 / 458 / 0 / 6 | 868 / 862 / 0 / 6 (2 execuções) |
| A4 | depois de A | listas fechadas, T-APPOINTMENT-INFO, N1–N3 | PASS | 0 | 477 / 471 / 0 / 6 | 886 / 880 / 0 / 6 (2 execuções) |
| B (B1–B3) | depois de A4 | reply guard, `understand`, wiring + campos do lead | PASS após correção (1ª rodada: FAIL, 4 falhas) | 0 após B-1..B-4 | 507 / 497 / 0 / 10 `todo` → 515 / 509 / 0 / 6 após o fix | 928 / 918 / 0 / 10 → 937 / 931 / 0 / 6 |
| D (V4) | depois de `7368c59` | V-15, V-17, simulador `--flow v2`, docs | PASS | 0 | 522 / 516 / 0 / 6 | 957 / 951 / 0 / 6 (2 execuções) |
| C (C1 + C2 + C-MEET) | depois de D, HEAD `7368c59` | V-08, V-09, V-12, S-09, S-10-v2, S-16, Meet | PASS | 0 | 522 / 516 / 0 / 6 | 962 / 956 / 0 / 6 (2 execuções) |
| Rodada final (CM-3 + docs) | último, HEAD `d82ab54` | CM-3, D3-1, D3-2, D2-1, D2-2, changelog CM-2 | PASS | 0 | 528 / 522 / 0 / 6 | 970 / 964 / 0 / 6 (2 execuções) |

Ordem cronológica: A → A4 → B → D → C → rodada final. A rodada C rodou depois de D e acrescentou 4 testes; a rodada final acrescentou 6 testes de unidade e 8 de DB.

## Resultado

- Fluxo v2 atrás de `MARIANA_FLOW=v2`; `v1` continua o padrão. As mudanças da v1 pelo C-MEET são intencionais e estão no changelog da spec v1.5 (CM-2).
- Um responsável por turno: roteador puro decide (`automation` ou `ai`); a IA nunca é autoridade sobre ID, disponibilidade ou autorização.
- Uma transação por turno (estado + linha da assistente + oferta + outbox + mensagens processadas), uma trilha `mariana_turn` com `flow`, `route` e `responder`; reentrega deduplicada não gera trilha.
- Remarcação com reunião futura usa `T-RESCHEDULE`, registra `mariana_reschedule_request` e anota a descrição do evento; Meet no texto de confirmação/`T-APPOINTMENT-INFO` quando existir.
- Sala do Meet é **best-effort**: se o Google recusar `conferenceData`, o evento é criado sem sala, o cliente recebe a confirmação sem link e o log `calendar_meet_link_missing` leva só ids técnicos (CM-3 fechado).

## Cenários V-01…V-18 → teste

Todos os testes de fluxo v2 usam Gemini, WhatsApp e Google Calendar falsos, banco local de teste.

| Cenário | Teste | Resultado |
|---|---|---|
| V-01 "oi" → T-WELCOME, sem IA | `run-turn.test.ts` "V-01" | PASS |
| V-02 saudação + pergunta → resposta da IA + botão | `run-turn.test.ts` "V-02" | PASS |
| V-03 "como funciona?" após boas-vindas → resposta inteira com conhecimento | `run-turn.test.ts` "V-03" | PASS |
| V-04 toque com objetivo → horários; sem objetivo → T-ASK-OBJECTIVE → horários | `run-turn.test.ts` "V-04" | PASS |
| V-05 pedido de consultor em texto ou lista → horários | `run-turn.test.ts` "V-05" | PASS |
| V-06 pergunta de parcela → T-SENSITIVE + botão, sem número | `run-turn.test.ts` "V-06" | PASS |
| V-07 R$/contemplação → resposta trocada inteira por T-AI-FALLBACK; `guardRejected` | `run-turn.test.ts` e `reply-guard.test.ts` "V-07" | PASS |
| V-08 "é online?" durante agendamento → resposta + mesmos botões, sem consultor | `run-turn.test.ts` "V-08" | PASS |
| V-09 status durante agendamento/confirmação → texto fixo + botões da etapa | `run-turn.test.ts` "V-09" (dois) | PASS |
| V-10 oferta pendente + "não" → T-DECLINE; "sim" → horários | `run-turn.test.ts` "V-10" | PASS |
| V-11 cliente diz 16 → `birthDate`; T-UNDER-18; perguntas continuam | `run-turn.test.ts` "V-11" | PASS |
| V-12 reunião futura + "quero remarcar" → T-RESCHEDULE uma vez, pedido registrado | `run-turn.test.ts` "V-12" | PASS |
| V-13 injeção de prompt → recusa da IA ou T-AI-FALLBACK | `run-turn.test.ts` "V-13" | PASS |
| V-14 erro/JSON inválido do Gemini → aviso de falha uma vez, tarefa completa | `run-turn.test.ts` "V-14" | PASS |
| V-15 duas mensagens na janela do debounce → um turno, um outbox, uma trilha | `run-turn.test.ts` "V-15" | PASS |
| V-16 `MARIANA_FLOW=v1` → caminho v1, sem trilha v2 | `run-turn.test.ts` "V-16" | PASS |
| V-17 cada turno v2 → uma trilha com `flow`, `route`, `responder` | `run-turn.test.ts` "V-17" | PASS |
| V-18 Calendar todo fora → texto A uma vez, tarefa completa na 1ª tentativa | `run-turn.test.ts` "V-18" | PASS |

Cobertura adicional: roteador puro (`router.test.ts`), textos fixos (`texts.test.ts`), estado/oferta pendente/reunião futura (`state.test.ts`), guarda (`reply-guard.test.ts`), `understand` (`understand.test.ts`), campos do lead (`lead-fields.test.ts`), Meet (`google-calendar-meet.test.ts`), descrição do evento (`appointment-service.test.ts`), confirmação no webhook (`webhook-whatsapp.test.ts`), simulador (`conversation-simulator.test.ts`).

## Suítes finais

Números da última execução independente registrada (rodada final, HEAD `d82ab54`, `test-report.md`).

| Comando | Resultado |
|---|---|
| `npm run test:unit` | 528 testes, 522 pass, 0 fail, 6 todo |
| `npm run test:db` (localhost:5432/mariana_test, workers off) | 970 testes, 964 pass, 0 fail, 6 todo — duas execuções sequenciais |
| `npx tsc --noEmit` | limpo |
| `npm run build` | sucesso |
| biome (6 arquivos alterados de código/teste/script) | limpo |
| `git diff --check` | limpo |
| `npm run sim:conversation -- --flow v2` | 2 cenários PASS (v2-1, v2-2); relatório com `Flow: v2. Mocked Gemini, local test database, WhatsApp stubbed, Calendar mocked.` |
| `npx tsx --test src/tests/integrations/google-calendar-meet.test.ts` | 10/10 pass |
| `npm run sim:conversation -- --flow v1` sem `--real-gemini` | recusa, exit 2 (esperado; medido na rodada D) |
| `npx tsx --test src/tests/services/flow-v2/run-turn.test.ts` | 48/48 pass (medido na rodada C) |

Divergência de registro: `progress.md` e as rodadas anteriores citam `test:db` 957/951, 955/949 e 962/956; vale o 970/964 da rodada final, que é a execução independente mais recente. Os 6 `todo` são os buracos E-12c/E-15 já conhecidos, não falhas destes lotes.

A rodada final rodou o simulador uma vez, mockado, e o rótulo do relatório agora vem do flag real (`Mocked Gemini`). A rodada C não repetiu o simulador.

Não rodados: Gemini real (sem permissão do Davi), WhatsApp e Google Calendar reais (proibido), Neon (proibido).

## O que mudou

45 arquivos, +8552/−56 desde o início do lote v2 (`41096ee~1..d82ab54`). A rodada final, ainda não commitada, soma 11 arquivos, +580/−55.

- Motor v2 (novo, `src/services/flow-v2/`): `run-turn.ts`, `router.ts`, `state.ts`, `texts.ts`, `intent-lists.ts`, `reply-guard.ts`, `understand.ts`, `lead-fields.ts`, `start-scheduling.ts`.
- Flag: `MARIANA_FLOW` (`v1|v2`, padrão `v1`) e `MARIANA_HISTORY_MESSAGES` (1–30, padrão 10) em `src/env.ts` e `.env.example`. Timeout do `understand` em `MARIANA_UNDERSTAND_TIMEOUT_MS` (padrão 20000, faixa 1000–45000).
- Integração: `src/ai/model-config.ts` (novo), `src/lib/turn-trace.ts`, `src/services/conversations/autonomous-task-handlers.ts`, `src/services/conversations/stale-tap-reply.ts`, `src/integrations/google-calendar/google-calendar-service.ts`, `src/services/calendar/appointment-service.ts`.
- Simulador: `scripts/simulate-conversation.ts` aceita `--flow v1|v2` e `--real-gemini`; v2 usa Gemini falso por padrão. Suporte em `src/tests/support/{conversation-simulator,simulation-args,simulation-checks}.ts`.
- Testes: `src/tests/services/flow-v2/*` (novos), `google-calendar-meet.test.ts` (novo), `conversation-simulator.test.ts`, `webhook-whatsapp.test.ts`, `appointment-service.test.ts`, `agent-model-config.test.ts`, `env.test.ts`, harness.
- Docs: `docs/CODEMAP.md`, `docs/specs/MARIANA_BEHAVIOR_SPEC.md` (v1.5), `docs/specs/2026-10-28-mariana-flow-v2.md`, `CLAUDE.md`, `docs/work/2026-10-28-flow-v2/{plan,progress,test-report,whatsapp-checklist}.md`.
- `package.json`, `.env.example`.

Rodada final (não commitada):

- `src/integrations/google-calendar/google-calendar-service.ts`: sala do Meet best-effort. `createEvent` repete o insert sem `conferenceData` quando o Google recusa só a sala (`:335-400`), detecta a recusa em `:180-198`, um único `calendar_meet_link_missing` sem PII (`:200-212`) e lê link de `hangoutLink` ou `conferenceData.entryPoints` (`:145-156`).
- `scripts/simulate-conversation.ts` e `src/tests/support/conversation-simulator.ts`: rótulo do relatório derivado de `--real-gemini` (`Real Gemini`/`Mocked Gemini`), nunca fixo.
- Quatro docs alinhados: `MARIANA_BEHAVIOR_SPEC.md` v1.5 (R-FLOW-03, R-INF-02, changelog CM-2/D3-1), `2026-10-28-mariana-flow-v2.md` (R7c/R7d/R7e, T-RESCHEDULE), `plan.md` (T-RESCHEDULE decidido, R7d), `progress.md` (D2-2: uma linha por turno, aponta V-15).
- `run-turn.ts` e `texts.ts` **não** foram tocados nesta rodada.

Comportamento da v1: roteamento, textos e fluxo da v1 não foram alterados, e `V-16` prova o caminho v1. Exceção confirmada em **CM-2**: o C-MEET mexeu em três pontos do caminho de agendamento que a v1 também usa (link do Meet na confirmação, descrição do evento com nome/WhatsApp/objetivo em vez do uuid, `conferenceData` em todo `createEvent`). Davi confirmou que é intencional, inclusive o alcance na v1, e o changelog registra em `MARIANA_BEHAVIOR_SPEC.md:166`.

## Movimento de achados (rodada final)

### Resolvidos nesta rodada

| ID | Estado | O que mudou |
|---|---|---|
| CM-3 | RESOLVED | Sala do Meet é best-effort: fallback sem `conferenceData`/`conferenceDataVersion` quando o Google recusa só a sala (`google-calendar-service.ts:335-400`), detecção restrita a 400/403 com "conference"/"hangout" (`:180-198`), um log sem PII (`:200-212`). Testes `google-calendar-meet.test.ts:248,300,322,337,396,420`. |
| D3-1 | RESOLVED | `MARIANA_BEHAVIOR_SPEC.md:42` (R-FLOW-03) e `:30` (R-INF-02) agora declaram as exceções: sessão ativa → botões da etapa; agendamento futuro → texto puro, sem botão. Changelog "Correção de texto (2026-10-28)" registra o D3-1. |
| D3-2 | RESOLVED | T-RESCHEDULE opção A em `2026-10-28-mariana-flow-v2.md:52` e `texts.ts:25-27`, byte-idênticos; `plan.md:5` diz que o texto foi decidido e não bloqueia etapa. |
| D2-1 | RESOLVED | `formatSimulationReport` deriva o rótulo do flag (`conversation-simulator.ts:305-316`), `simulate-conversation.ts:95` passa `realGemini`; testes `conversation-simulator.test.ts:44,82,89`. |
| D2-2 | RESOLVED | `progress.md:152` descreve "one user row per turn" (`user.join("\n")`) e aponta V-15 para o debounce. |

### Confirmado intencional

| ID | Estado | Registro |
|---|---|---|
| CM-2 | CONFIRMED INTENTIONAL por Davi | Changelog v1.5 em `MARIANA_BEHAVIOR_SPEC.md:166`: link do Meet na confirmação, descrição com nome/WhatsApp/objetivo em vez do uuid, `conferenceData` em todo `createEvent`; o impacto na v1 está declarado. |

## Achados e riscos (não bloqueantes)

Nenhum destes impede o V5. Agrupados por natureza, com o efeito prático para o Davi.

### Documentação e plano

| ID | Severidade | Descrição | Consequência prática |
|---|---|---|---|
| FF-4 | baixa | `plan.md:119` ainda diz que T-RESCHEDULE bloqueia textos do lote A e `:121` ainda diz "Q4 button on every AI answer (rec.)". São listas históricas de perguntas; `plan.md:3` e `:5` são autoritativos. | Quem lê só a lista acha que o texto está aberto e que o botão vale em toda resposta; não contradiz a spec. |
| D-gap V4 | baixa | Spec §8 V4 pede cenários do simulador V-01…V-17; existem só `v2-1` e `v2-2`. | Cobertura pelo simulador é menor que a spec; o resto é coberto por testes de DB. |

### Código e comportamento

| ID | Severidade | Descrição | Consequência prática |
|---|---|---|---|
| FF-1 | média | Detecção de recusa da sala é heurística de string: 400/403 cujo corpo/mensagem contenha "conference" ou "hangout" (`google-calendar-service.ts:180-198`). O caso 403 com recusa de sala não tem teste (só 400). | Um 403 de outra causa que cite "conference" cai no fallback; uma mudança de texto do Google faz o erro subir e derruba o agendamento. |
| FF-2 | média | O fallback pressupõe que 400/403 vêm **antes** de o evento existir (`google-calendar-service.ts:175-178`). | Se o Google criar o evento e ainda assim responder 400/403, o segundo insert duplica o compromisso; a premissa só foi exercitada com mock. |
| FF-5 | baixa | O edge C1-1 continua: sessão ativa **e** reunião futura ao mesmo tempo → `run-turn.ts:649-663` devolve os botões da etapa antes de checar `futureAppointment`. | A R-FLOW-03 (b) não vale nesse edge; o cliente com reunião vê botões da etapa. Sem teste e sem impacto no caminho comum. |
| FF-6 | baixa (v1) | `extractMeetLink` também lê `conferenceData.entryPoints` (`google-calendar-service.ts:145-156,403-418`). | Se o Google devolver entry point sem `hangoutLink`, a confirmação da v1 passa a mostrar um link que antes não mostrava. |
| FF-7 | cosmética | Dois formatos do mesmo log `calendar_meet_link_missing`: `createEvent` grava `source` + `reason` (`google-calendar-service.ts:200-212`); o caminho de info grava `flow` + `appointmentId` (`run-turn.ts:812-819`). | Nenhum consumidor conhecido; unificar quando houver. |
| FF-8 | baixa | O fallback adiciona uma segunda chamada ao Google no caminho crítico, sem timeout no cliente (CM-5). | Um insert pendurado dobra a exposição antes do lease expirar; o cliente não recebe nada até o fim e a reentrega é idempotente. Pré-existente, ampliado nesta rodada. |
| B-N2 | média | Idade de menor dita sobrescreve data adulta ("mais restritivo vence"); a extração vem da IA. | Um número errado extraído (ex.: "2" de "tenho 2 filhos") bloqueia o lead no R8 para sempre. |
| A4-N2 | baixa | Status na etapa de confirmação diz "Tenho um horário disponível" mesmo com o slot já auto-selecionado. | Texto levemente contraditório para o cliente. |
| C2-1 | baixa | R7d sem reunião futura grava `mariana_reschedule_request` com `appointmentId: null`. | Ruído de semântica no log; sem dado do cliente. |
| CM-1 | baixa | O caminho `R8-appointment-info` do `planStartScheduling` monta T-APPOINTMENT-INFO sem consultar o Meet e sem logar `calendar_meet_link_missing`. | Mesmo texto com comportamento diferente conforme a entrada (toque "Falar com consultor" com reunião futura); sem teste. |
| CM-4 | baixa | `appendEventDescription` faz `events.get` + `events.patch`; dois patches concorrentes perdem linha. | A anotação de remarcação pode sumir se dois turnos mexerem no mesmo evento. |
| CM-5 | baixa | Chamadas ao Google sem timeout; lease pode expirar depois da gravação. | A reentrega deduplicada pula o patch e a anotação de remarcação não é registrada; cliente não é afetado. |
| CM-7 | baixa (pré-existente) | `buildBookingConfirmationText` usa `formatSlotDate` no fuso do sistema; T-APPOINTMENT-INFO usa `America/Sao_Paulo`. | Em servidor UTC, confirmação e info podem mostrar horas diferentes. |
| B-N1 | baixa | Cliente Gemini compartilhado sem timeout de requisição. Mitigado na v2 por `MARIANA_UNDERSTAND_TIMEOUT_MS`; a v1 segue sem limite. | Chamada pendurada na v1 segura o turno até o lease expirar. |
| N6 | aceita | Lead `scheduled` sem reunião futura não recebe horários (`lead_not_qualified`). | Mesmo comportamento da v1; cliente recebe aviso final depois das retentativas. |
| Nota técnica | baixa | Dedup dentro da tx ainda faz um `UPDATE` em `messages.processedAt` antes de olhar o outbox (`run-turn.ts:409-432`). | Sem resposta, sem linha de assistente, sem outbox: escrita inofensiva no caminho de dedup. |
| Nota técnica | baixa | O caminho silencioso do R1 (`run-turn.ts:496-508`) grava e traça fora da tx e não checa `runKey`. | Dois turnos concorrentes do mesmo lote de opt-out podem gerar duas linhas `mariana_turn`; sem impacto no cliente, e o V-17 não pega. |
| Risco | baixa | Corrida de rotação entre o commit de `markLeadReadyForScheduling` e a tx de escrita deixa o lead qualificado sem oferta. | Benigno; o próximo toque resolve. |
| Risco | baixa | Toque de conversa já fechada devolve `conversation_not_active` em silêncio. | Igual à v1 nos fluxos de botão. |

### Fragilidade de teste

| ID | Severidade | Descrição | Consequência prática |
|---|---|---|---|
| FF-3 | baixa | `appointment-service.test.ts:714-721` compara a confirmação de forma tautológica (`buildBookingConfirmationText` com `hangoutLink` `undefined` vs. sem o parâmetro). A prova real de "confirmação enviada sem link" é `session-rotation-adversarial.test.ts:1593` (regex ancorada) com `createEvent` sem link (`:1310`). | O teste não falha se o link aparecer; trocar por uma string literal esperada. |
| CM-6 | baixa | `session-rotation-adversarial.test.ts:1155` ancora `BOOKING_CONFIRMED_TEXT` com `$`; se o mock passar a devolver `hangoutLink`, o regex falha. | Vermelho falso no futuro; não é falha de produto. |

### Achados já resolvidos (registro)

N1, N2, N3, A4-N1, A4-N3, N4, N5 e B-1..B-4 estão fechados: listas fechadas no A4, exceção de botão no C1, T-RESCHEDULE no C2, dedup sem trilha no D1, guarda com `number`/`too_long`/`MAX_REPLY_CHARS = 600` e timeout do `understand` no fix do B. B-N3 (histórico com lote mais novo) foi fechado com `messageCutoff`. CM-3, D3-1, D3-2, D2-1 e D2-2 fecharam na rodada final (tabela acima); CM-2 foi confirmado intencional.

### Riscos sem teste

- `--real-gemini` na v2 (understand real, saída do modelo passando pelo guard) — exige permissão do Davi.
- Recusa real de `conferenceData`, criação real de sala Meet, leitura do link e patch da descrição no Google (só mock; FF-1/FF-2).
- Caminho CM-1 e edge C1-1/FF-5.

## Decisões registradas

- C1: exceção de botão do R7e também vale para `R7c-fallback` e R7b/`list-sensitive` durante sessão ativa.
- C2: reunião futura vence a sessão em `schedule_status`; respostas automáticas com reunião futura são só texto; R7d sempre usa `T_RESCHEDULE`, descarta a resposta da IA e registra o pedido só após escrita real. Texto aprovado: "Tudo bem! Anotei seu pedido e o consultor entra em contato com você. Precisa de mais alguma coisa?"
- C-MEET: link do Meet é best-effort depois da escrita; ausência/falha não derruba a resposta e os logs não levam dado do cliente.
- CM-2: Davi confirmou intencional, inclusive o alcance na v1; registrado no changelog da spec v1.5 (`MARIANA_BEHAVIOR_SPEC.md:166`).
- D1: turno deduplicado não é turno; sem `mariana_turn` (fecha N4).
- D2: `--flow v2` usa Gemini falso por padrão; real só com `--real-gemini` e permissão do Davi.

## Como validar (V5, manual)

V5 ainda **não começou**. Roteiro completo: `docs/work/2026-10-28-flow-v2/whatsapp-checklist.md` — 14 passos no número de teste, critérios de aceite e rollback.

1. Staging: `MARIANA_FLOW=v2`, depois reiniciar app e workers. Rollback é `MARIANA_FLOW=v1` e reiniciar de novo.
2. Configurar `GEMINI_MODEL`, `GEMINI_API_KEY`, Google Agenda e WhatsApp no staging, com um consultor de teste e horário livre.
3. Gemini real só com permissão explícita do Davi. WhatsApp e Google Calendar reais valem no V5; Neon não.
4. Seguir os 14 passos do checklist com os logs abertos: cada turno deve ter um `mariana_turn` com `flow: "v2"`, `route` e `responder`, sem texto do cliente, telefone ou token.
5. A sala do Meet é best-effort: se a sala faltar, o agendamento acontece igual e o cliente recebe o texto sem link; um `calendar_meet_link_missing` é esperado, não é falha do V5.
6. Falha no V5 volta como achado com cenário e trilha. Não ativar em produção antes de fechar a lista.

## Estado do git

`git status --short` (real, antes desta edição; `final-report.md` entra como 12º arquivo depois dela):

```
 M docs/specs/2026-10-28-mariana-flow-v2.md
 M docs/specs/MARIANA_BEHAVIOR_SPEC.md
 M docs/work/2026-10-28-flow-v2/plan.md
 M docs/work/2026-10-28-flow-v2/progress.md
 M docs/work/2026-10-28-flow-v2/test-report.md
 M scripts/simulate-conversation.ts
 M src/integrations/google-calendar/google-calendar-service.ts
 M src/tests/integrations/google-calendar-meet.test.ts
 M src/tests/services/appointment-service.test.ts
 M src/tests/services/conversation-simulator.test.ts
 M src/tests/support/conversation-simulator.ts
```

`git diff --stat` (não commitado):

```
 docs/specs/2026-10-28-mariana-flow-v2.md           |  10 +-
 docs/specs/MARIANA_BEHAVIOR_SPEC.md                |   8 +-
 docs/work/2026-10-28-flow-v2/plan.md               |   6 +-
 docs/work/2026-10-28-flow-v2/progress.md           |   2 +-
 docs/work/2026-10-28-flow-v2/test-report.md        |  62 +++++
 scripts/simulate-conversation.ts                   |   2 +-
 .../google-calendar/google-calendar-service.ts     | 171 ++++++++++---
 .../integrations/google-calendar-meet.test.ts      | 273 ++++++++++++++++++++-
 src/tests/services/appointment-service.test.ts     |  67 +++++
 src/tests/services/conversation-simulator.test.ts  |  27 +-
 src/tests/support/conversation-simulator.ts        |   7 +-
 11 files changed, 580 insertions(+), 55 deletions(-)
```

Commits já aplicados pelo Davi (6, todos em `HEAD`):

| Commit | Conteúdo |
|---|---|
| `41096ee` | esqueleto v2 + testes dos lotes A/A4/B |
| `94bfe4a` | C1 — R7e + `schedule_status` |
| `7adf5dc` | C2 — reunião futura + T-RESCHEDULE |
| `81bf7be` | C-MEET — Meet, descrição do evento, nota de remarcação |
| `7368c59` | Batch D — V-15/V-17, simulador `--flow v2`, docs/spec v1.5 |
| `d82ab54` | testes do testador (rodada C), `test-report.md` e este relatório |

`git diff --shortstat 41096ee~1..d82ab54`: 45 arquivos, +8552/−56.

Tudo o que está fora desses 6 commits é a rodada final, ainda **não commitada**. Quem commita é o Davi. Nenhum agente commita, faz stage ou reescreve histórico.

## Sugestão de commit (só o que falta)

Não reescrever os 6 commits acima. Proposta em 3 commits, pronta para colar; nenhuma foi executada.

```bash
git add src/integrations/google-calendar/google-calendar-service.ts \
        src/tests/integrations/google-calendar-meet.test.ts \
        src/tests/services/appointment-service.test.ts
git commit -m "fix(calendar): keep booking when Google rejects the Meet room"

git add scripts/simulate-conversation.ts \
        src/tests/support/conversation-simulator.ts \
        src/tests/services/conversation-simulator.test.ts
git commit -m "fix(simulator): derive Gemini label from the real-gemini flag"

git add docs/specs/MARIANA_BEHAVIOR_SPEC.md \
        docs/specs/2026-10-28-mariana-flow-v2.md \
        docs/work/2026-10-28-flow-v2/plan.md \
        docs/work/2026-10-28-flow-v2/progress.md \
        docs/work/2026-10-28-flow-v2/test-report.md \
        docs/work/2026-10-28-flow-v2/final-report.md
git commit -m "docs(flow-v2): record CM-3 fallback and the final round"
```

## Próximo passo

Parar antes do V5. Davi testa no WhatsApp de teste com `MARIANA_FLOW=v2` usando o checklist; qualquer falha volta como achado com cenário e trilha. CM-2, CM-3, D3-1, D3-2, D2-1 e D2-2 estão fechados; ficam abertos os FF-1..FF-8 e os riscos já listados. Mudanças fora do escopo (lembretes de reunião com template Meta, remoção da v1) ficam para planos separados.
