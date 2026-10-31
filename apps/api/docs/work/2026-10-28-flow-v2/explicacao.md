# Flow v2 — explicação do plano (DRAFT)

## 1. O que eu entendi do problema
A v1 deixa a IA escrever tudo e depois corrige o texto em 11 camadas. Isso gera respostas cortadas e "encaminhe ao consultor" sem motivo. Na v2, cada turno tem um único responsável: a automação manda textos fixos e botões, e a IA só entende o texto livre e responde dúvidas com a base aprovada. O texto da IA vai inteiro ou é trocado inteiro por um texto fixo. A v1 fica atrás de `MARIANA_FLOW=v1` até você aprovar a v2 no WhatsApp.

## 2. O que eu vou fazer
Uso um único implementador do começo ao fim (lote A ao D). O tester revisa o diff de cada lote e roda todas as suítes.

- **Lote A (V0+V1): flag, roteador e rotas automáticas.**
  - O que muda: a flag `MARIANA_FLOW` (padrão `v1`), os textos fixos, um roteador puro, a leitura do estado do turno e o início do agendamento (R8). Também o botão "Falar com consultor" e o tratamento do toque nele. As funções de modelo saem de `agent.ts` (v1) para `ai/model-config.ts`, para a v2 não depender da v1.
  - Por quê: é a base, e a v1 não muda.
  - No WhatsApp (com v2): "oi" recebe a boas-vindas fixa. "não" a uma oferta recebe uma recusa educada. "sim" ou o toque no botão mostra os horários. Se o Calendar cair, chega o aviso A uma vez, sem repetição.
- **Lote B (V2): IA "entender" + filtro da resposta.**
  - O que muda: um prompt curto com toda a base liberada ao cliente, mais duração (30 min) e Google Meet. A IA devolve um JSON validado. Um filtro rejeita a resposta inteira se ela tiver valor, %, parcelas, prazo, promessa de contemplação, conteúdo interno, "agendado" ou mais de 3 frases. Os dados do cliente vão para o lead.
  - Por quê: "como funciona?" passa a ser respondido de verdade, e nenhuma frase sai cortada.
  - No WhatsApp: resposta curta da base + botão "Falar com consultor". Pergunta de parcela recebe o texto fixo de assunto sensível.
- **Lote C (V3): IA durante o agendamento.** Com horários na tela, a dúvida é respondida e os mesmos botões voltam. "Está confirmada?" recebe o estado fixo e os botões. Com reunião futura, a Mariana informa data, hora e consultor. "Remarcar" recebe T-RESCHEDULE e o pedido é registrado em log. O tamanho deste lote depende da Q8.
- **Lote D (V4): testes ponta a ponta, rastro e docs.** Duas mensagens seguidas geram uma única resposta. Cada turno gera uma linha `mariana_turn` com rota e responsável. O simulador ganha `--flow v2` (Gemini real só com sua permissão). Atualizo CODEMAP e spec v1.5. Paro antes do V5.

## 3. O que NÃO vou mexer
O cérebro da v1 (exceto o re-export em `agent.ts`), os serviços de agenda, o webhook, a rotação de 4h, o outbox, as migrations e o schema. Nada no Neon e nenhum Gemini real.

## 4. Riscos
- **O filtro pode rejeitar resposta boa** (falso positivo). Um teste garante que toda frase da base passa no filtro. Na rota, `guardRejected` mostra a taxa.
- **A IA pode classificar mal** (por exemplo, `wants_consultant` à toa). O pior caso é mostrar horários: nada é agendado sem toque. `accept_offer` só vale com a marca de oferta do backend.
- **Erro na troca da flag.** O teste V-16 prova que a v1 continua igual com `v1`.
- **A v2 importar a v1 por engano.** Um teste de importação falha.

## 5. Mapa S-01…S-25 na v2
| S | Na v2 | Teste |
|---|---|---|
| S-01 | Igual, mas o "sim" à oferta vira toque em "Falar com consultor" (ou "quero marcar") | V-04 + testes de agenda atuais |
| S-02 | **Muda**: a explicação vem com o botão (sem horários) | V-02 |
| S-03 | Pergunta do objetivo (T-ASK-OBJECTIVE, uma vez), depois os horários | V-04/V-05 |
| S-04 | T-SENSITIVE + botão, sem número | V-06 |
| S-05 | IA registra na conversa, sem simular e sem repetir o valor (não existe coluna, nem na v1) | V-07 (filtro) |
| S-06 | T-DECLINE | V-10 |
| S-07, S-08, S-24, S-25 | Sem mudança (fluxo de botões atual) | testes atuais |
| S-09 | Estado fixo + botões (lote C) | V-09 |
| S-10 | Data, hora e consultor fixos (lote C) | S-10-v2 |
| S-11, S-18–S-22 | Sem mudança (rotação no webhook) | testes atuais + `state.test` |
| S-12, S-21 | Uma resposta por lote do debounce | V-15 |
| S-13 | IA com histórico; só verificável no simulador e no WhatsApp | V5 |
| S-14 | Recusa da IA ou T-AI-FALLBACK | V-13 |
| S-15 | T-UNDER-18 no agendamento; dúvidas continuam | V-11 |
| S-16 | IA com 30 min / Meet no prompt | V-08 / V-03 |
| S-17 | Aviso de falha do modelo | V-14 |
| S-23 | Resposta da conversa fechada não sai | S-23-v2 |

## 6. Decisões que preciso de você
- **Q1 — Textos fixos:** aprovar os textos da seção 4 da spec, mais três novos.
  - T-APPOINTMENT-INFO: "Sua reunião está marcada para {data} às {hora} com {consultor}."
  - T-STATUS-SLOT: "Falta escolher um dos horários abaixo."
  - T-STATUS-CONFIRM: "Falta confirmar o horário abaixo."
  - Atenção: T-RESCHEDULE promete "Vou avisar o consultor", e nada avisa o consultor hoje (só log). **Recomendo** "Anotei seu pedido de remarcação. O consultor entra em contato com você." **somente se alguém ler esse log**. Caso contrário, diga o texto.
- **Q2 — Nome:** **Recomendo** usar o nome do perfil do WhatsApp e nunca perguntar. Sem nome válido, o texto sai sem nome. O telefone nunca é usado como nome.
- **Q3 — Mínimo para mostrar horários:** **Recomendo** só o objetivo.
- **Q4 — Botão em toda resposta da IA:** **Recomendo sim.** As exceções são durante o agendamento (voltam os botões da etapa) e com reunião futura (sem botão).
- **Q5 — Filtro rejeita a resposta inteira:** **Recomendo confirmar** (substitui a R-FLOW-12).
- **Q6 — Modelo:** **Recomendo** `GEMINI_MODEL` do env, e a comparação A2 roda na v2.
- **Q7 — Oferta pendente sem migration:** só vale quando a última mensagem da Mariana na conversa atual é exatamente T-SENSITIVE ou T-AI-FALLBACK (sim/não), ou T-ASK-OBJECTIVE (resposta com objetivo). Ela some no turno seguinte. **Recomendo** isso, com a inclusão do T-AI-FALLBACK, que também pergunta "Quer que eu veja os horários?". Depois atualizo a invariante no `CLAUDE.md`.
- **Q8 — V3 completo ou simples:**
  - Simples: 1 passo, cerca de 80–120 mil tokens, cerca de 45 min. Durante o agendamento, a IA responde e os botões voltam. Ainda bloqueia horários novos se já há reunião futura. "Está confirmada?", "quando é a reunião?" e "remarcar" ficam para depois: na versão simples, a IA não sabe o estado, e o filtro troca "confirmada" pelo texto genérico.
  - Completo: 2 passos, cerca de 180–250 mil tokens, cerca de 1h30.
  - **Recomendo o completo.** Custa cerca de +110 mil tokens e +45 min, porque os botões da etapa já existem. Sem ele, S-09, S-10 e V-12 pioram em relação à spec já aprovada.
- **Q9 — Idade < 18 (nova):** sem coluna nova, **recomendo** gravar a data de nascimento estimada em `leads.birthDate`, direto, sem `updateLeadFromAgent` (essa função lança erro com menor). Assim o bloqueio vale nos turnos seguintes.
- **Q10 — Padrão da flag (nova):** **recomendo** `v1` no código até o V5. Você liga `MARIANA_FLOW=v2` no ambiente de teste do WhatsApp. O plano de limpeza remove a flag depois.

## 7. Pedido de permissão
Posso seguir com este plano? Responda: aprovo / aprovo com mudanças (diga quais) / não aprovo.
