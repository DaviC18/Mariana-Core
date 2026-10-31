# Explicação — Revisão 3 do plano (2026-10-27)

## 1. O que eu entendi do problema
Os passos 26 a 33 estão prontos. O tester achou uma falha que é culpa do plano (F-T32-1): depois de uma reoferta, a mensagem antiga continua na tela. Se o cliente toca num horário antigo, no Confirmar antigo ou no Não antigo, ele não recebe resposta, e isso quebra a regra "nenhum toque fica sem resposta" (R-SCH-03, S-07). Sobraram também pontas menores: dois caminhos que ainda podem dar deadlock, uma janela curta em que uma resposta da conversa velha ainda sai, um toque reenviado que mexe na conversa nova, o rótulo errado no rastro e dois textos/números da spec.

## 2. O que eu vou fazer
1. **Passo 34 — toque recusado sempre recebe resposta.**
   - O que muda: quando o backend recusa um toque (horário de oferta antiga, Confirmar ou Não antigo, ou sessão vencida), ele manda o aviso já aprovado: "Esse botão é de uma mensagem antiga." mais os botões da etapa atual. Sem agendamento em curso, ele manda "Me conta o que você precisa agora?". Isso também resolve o segundo toque antigo depois de 4h (F-V1c-3).
   - Por quê: hoje esses caminhos terminam em silêncio. O teste do implementador que exige silêncio (`sent = []`) vai passar a exigir uma resposta.
   - No WhatsApp: o cliente toca no botão velho e recebe uma resposta curta com os botões que valem agora. Nunca é agendado nada por um botão velho.
2. **Passo 35 — texto da reoferta com um só horário** (depende da sua decisão D-R3-3).
   - Hoje sai: "Esse horário acabou de ficar indisponível. Tenho estes outros horários:" e, na linha de baixo, "Tenho um horário disponível: … Posso confirmar?".
   - Proposta: "Esse horário acabou de ficar indisponível. Tenho outro horário: <data hora> com <consultor>. Posso confirmar?" [Confirmar | Não].
3. **Passo 36 — lead primeiro nos dois últimos lugares (F-T27-1).**
   - O que muda: o pedido de confirmação depois do toque no horário e a gravação da oferta passam a travar o lead antes de mexer na sessão.
   - Por quê: hoje a ordem é a inversa da rotação. Isso pode dar deadlock raro, e a mensagem do cliente pode se perder.
   - No WhatsApp: nada visível. O que some é uma falha rara.
4. **Passo 37 — a conversa velha não responde depois que a nova abriu.**
   - O que muda: depois do turno da IA, a gravação da oferta e o envio da resposta conferem de novo, com o lead travado, se a conversa ainda está ativa. Se não estiver, nada é gravado nem enviado.
   - Por quê: o passo 28 protegeu o turno, mas não a parte final (a busca de horários e o envio).
   - No WhatsApp: o cliente nunca recebe uma resposta atrasada da conversa velha junto com a resposta da nova.
5. **Passo 38 — rastro `superseded`.** Um turno cancelado pela rotação deixa de aparecer como `turn_error`, e as métricas de erro param de inflar. No mesmo passo, os comentários do código passam a citar R-SCH-08 em vez de R-SCH-07. Não muda nada no WhatsApp.
6. **Passo 39 — toque reenviado não mexe na conversa nova (F-T26-2).** Se o WhatsApp reenvia um toque antigo depois que a conversa nova abriu, o backend reconhece o toque e não atualiza o relógio de 4h da conversa nova. Não muda nada no WhatsApp: o cliente já não recebia resposta duplicada.
7. **Passo 24 (docs), revisado:**
   - a regra nova da reoferta vira **R-SCH-08**, porque R-SCH-07 já existe na spec (linha 63);
   - o texto de S-22 e R-SES-02 muda conforme D-R3-1;
   - o texto da reoferta com um só horário entra conforme D-R3-3;
   - S-08 ganha uma nota conforme D-R3-4.
8. **Passo 25:** a verificação final passa a incluir os passos 34 a 39.

## 3. O que NÃO vou mexer
- A regra de 4h e a rotação.
- A deduplicação de eventos e o outbox.
- Os textos já aprovados (só muda o da reoferta com um só horário, se você aprovar).
- O sorteio do consultor e a revalidação antes de agendar.
- Prompts e conhecimento, `drizzle/`, Neon, `.env` e `.claude/`.
- Também fica de fora: a falha técnica de agendamento (`appointment_failed`), que continua sem resposta (pacote B), e gravar o toque como mensagem do cliente.

## 4. Riscos
- **Passo 34:** o cliente pode receber o aviso em casos que antes ficavam calados, por exemplo dois toques antigos seguidos. Cada toque recebe no máximo uma resposta (a chave `stale-tap:`), e os testes de repetição do Meta conferem isso.
- **Passo 36:** os testes de lock dependem de tempo. Por isso o `test:db` roda duas vezes, como no passo 27.
- **Passo 37:** fica na conversa velha uma linha do assistente que nunca foi enviada. Ela fica só no histórico.
- **Passo 39:** se a busca do toque achar a conversa errada, um toque novo pode ser ignorado. O teste de regressão do E1 e o teste de toque repetido vão mostrar isso.

## 5. Decisões que preciso de você
- **D-R3-1 — reenvio atrasado quando a conversa A já fechou (F-T26-1).**
  - (a, recomendado) Manter o que você aprovou no passo 26: o reenvio não recebe uma resposta separada, porque a mensagem mais nova já foi respondida na conversa B. Eu só corrijo o texto de S-22, hoje "nunca silêncio", para "se ela ainda está ativa". Por quê: responder X em B levaria o assunto da conversa velha para a nova, e isso quebra a regra "começa do zero". Além disso, X tem mais de 4h.
  - (b) Responder X em B. Isso exige mover a mensagem e a tarefa para B, e precisa de uma nova revisão.
- **D-R3-2 — rota HTTP `POST /conversations/:id/messages` sem a proteção.**
  - (a, recomendado) Só registrar o problema e tratar junto com a Q1/F2-05 (proteger ou remover a rota). Ela não é o caminho do WhatsApp e não rotaciona.
  - (b) Proteger agora e responder 409.
- **D-R3-3 — texto da reoferta com um só horário (bloqueia o passo 35).**
  - (a, recomendado) "Esse horário acabou de ficar indisponível. Tenho outro horário: <data hora> com <consultor>. Posso confirmar?".
  - (b) Manter o texto de hoje.
  - (c) Você escreve o texto.
- **D-R3-4 — toque numa sessão vencida (S-08).**
  - (a, recomendado) Por enquanto, mandar o aviso e "Me conta o que você precisa agora?". A nova oferta automática fica para o pacote B.
  - (b) Fazer a nova oferta agora. Isso exige um texto novo e mais um passo.

## 6. Pedido de permissão
Posso seguir com este plano? Responda: aprovo / aprovo com mudanças (diga quais) / não aprovo.
Um "aprovo" simples aceita a opção (a) de D-R3-1 a D-R3-4 e os textos do passo 24 revisado.

---

# Revisão 3.1 (2026-10-27) — depois da falha do tester no lote V3-b

## O que falhou
O passo 37 protegeu só a resposta normal da IA. Quando o Gemini falha, o backend manda a mensagem curta de falha (S-17) por outro caminho, que não confere se a conversa ainda está ativa. Se a conversa nova (B) abriu enquanto o Gemini pensava, o cliente recebe o aviso de falha da conversa velha e, junto, a resposta de B. A culpa é do plano (F-V3b-1).

## O que eu vou fazer
1. **Passo 40 — aviso de falha só sai de conversa ativa.**
   - O que muda: o aviso passa a ser gravado e enfileirado numa única transação. Essa transação trava o lead primeiro e confere se a conversa ainda está ativa.
   - Rastro: quando a conversa já fechou, o rastro passa a dizer `superseded`. O mesmo vale para o caso "sem horários", que hoje diz `replied` sem enviar nada (D-R3-5).
   - O que continua igual: numa conversa ativa, a falha do modelo continua gerando exatamente um aviso (S-17). Há teste para isso.
   - No mesmo lote, três ajustes de limpeza que o tester pediu:
     - o teste de lock não pode mais travar para sempre;
     - o import vira direto, sem o reexport e sem o `biome-ignore`;
     - o JSDoc volta para a função certa.
2. **Passo 41 — a mesma conferência nos botões.** Procurei todos os envios do fluxo. Ainda sem essa conferência estão:
   - a reoferta;
   - as respostas do "Não";
   - a resposta de escolha em `process_button_reply`;
   - o toque legado de consultor, que confere o status fora da transação.

   Todos passam a conferir a conversa com o lead travado. Todos dependem de uma tarefa atrasada 4h ou mais, então são raros, mas assim esse tipo de buraco acaba.

## No WhatsApp
Depois que a conversa nova começa, o cliente nunca recebe uma mensagem atrasada da conversa velha. A exceção é "Agendamento confirmado …": se a reunião foi mesmo criada, o aviso sai (D-R3-6).

## O que NÃO vou mexer
- Os textos.
- As chaves de idempotência.
- O outbox.
- A regra de 4h.
- O sorteio do consultor.
- Os passos 34–38, que já estão prontos.

## Riscos
- Uma resposta que deveria sair pode ser bloqueada se a leitura do status estiver errada. Para perceber isso, os testes de sucesso de botões e de S-17 precisam continuar verdes.
- Fica uma linha do assistente na conversa velha que nunca é enviada. Ela fica só no histórico, como já aceito.

## Decisões que preciso de você
- **D-R3-5 — rastro.**
  - (a, recomendado) `superseded` quando a conversa fechou durante o turno, incluindo "sem horários" e falha do modelo depois da rotação. Entra no passo 40.
  - (b) Manter `replied` / `model_error`.
- **D-R3-6 — reunião confirmada logo antes da rotação.**
  - (a, recomendado) Enviar mesmo assim "Agendamento confirmado …", porque a reunião existe de verdade.
  - (b) Bloquear como os outros envios.

## Pedido de permissão
Posso seguir com este plano? Responda: aprovo / aprovo com mudanças (diga quais) / não aprovo.
Um "aprovo" simples aceita a opção (a) de D-R3-5 e D-R3-6.
