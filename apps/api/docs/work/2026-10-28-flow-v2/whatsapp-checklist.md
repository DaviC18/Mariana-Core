# Checklist manual de WhatsApp — V5 (`MARIANA_FLOW=v2`)

Dono: Davi. Staging, número de teste da Meta, workers ligados. Nada aqui roda no
simulador: é a conferência no WhatsApp de verdade, depois que o código da v2
passar nos testes. Não ativar em produção antes de fechar esta lista.

## Antes de começar

- [ ] `MARIANA_FLOW=v2` no ambiente de staging; reiniciar app e workers (relia).
- [ ] `GEMINI_MODEL`, `GEMINI_API_KEY`, Google Agenda e WhatsApp configurados no staging.
- [ ] Um consultor de teste com Google Agenda conectado e horário livre nos próximos dias.
- [ ] Logs acessíveis para conferir `mariana_turn` (sem texto de cliente, telefone ou token).

## Roteiro

| # | Ação no WhatsApp | Esperado |
|---|---|---|
| 1 | Enviar "oi" | T-WELCOME, sem botão de consultor. |
| 2 | Enviar "como funciona o consórcio de carro?" | Resposta da IA em 2–3 frases + botão **Falar com consultor**; sem repetir a saudação. |
| 3 | Enviar "quanto fica a parcela?" | T-SENSITIVE + botão; nenhum valor, taxa ou prazo na mensagem. |
| 4 | Tocar **Falar com consultor** com objetivo conhecido | Até 3 horários reais em botões; um único conjunto de botões. |
| 5 | Tocar em um horário e depois em **Confirmar** | Evento criado, confirmação com data, hora, consultor e **link do Google Meet**; abrir o link e conferir a sala. |
| 6 | Durante o agendamento, enviar "é online?" | Resposta da IA + os mesmos botões da etapa; nenhum botão novo de consultor. |
| 7 | Durante o agendamento, enviar "está confirmada?" | Texto fixo do estado atual + botões da etapa. |
| 8 | Enviar duas mensagens seguidas ("oi" e "tudo bem?") | Uma única resposta para o par; nenhuma mensagem duplicada. |
| 9 | Sem agendamento, enviar "quero falar com um consultor" sem objetivo | T-ASK-OBJECTIVE; responder o objetivo → horários. |
| 10 | Com reunião futura, enviar "quero remarcar" | T-RESCHEDULE, sem horários novos e sem botão; pedido registrado no log e linha datada na descrição do evento. |
| 11 | Com reunião futura, enviar "qual é o link da reunião?" | T-APPOINTMENT-INFO com data, hora, consultor e link do Meet. |
| 12 | Reenviar uma mensagem antiga (ou tocar um botão antigo) | Nenhuma resposta duplicada; toque antigo recebe aviso curto + botões da etapa atual. |
| 13 | (Se possível) derrubar a conexão de um consultor e pedir horários | Oferta só com os consultores saudáveis; nenhum erro para o cliente. |
| 14 | Conferir os logs do turno | Cada turno tem um `mariana_turn` com `flow: "v2"`, `route` e `responder`; reentrega não gera rastro novo. |

## Critérios de aceite

- [ ] Nenhuma mensagem duplicada, nenhum beco sem saída, nenhum valor sensível inventado.
- [ ] Todo horário oferecido existe na agenda real; link do Meet abre.
- [ ] Remarcação/cancelamento não cria horário novo nem evento novo.
- [ ] Nenhum log contém texto do cliente, telefone completo, token ou segredo.

## Rollback

- [ ] Voltar `MARIANA_FLOW=v1` e reiniciar app e workers; a v1 continua intacta.
- [ ] Nenhuma migration foi aplicada na v2 (a flag é o único interruptor).
