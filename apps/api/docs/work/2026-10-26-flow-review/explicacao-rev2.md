# Explicação — Revisão 2 + 2.1 do plano (2026-10-27)

## 1. O que eu entendi do problema
- **Rotação de 4h (V1-b).** São três buracos do plano:
  - F-V1b-1: um reenvio atrasado fica sem resposta;
  - F-V1b-3: o agendamento e a rotação travam um ao outro (deadlock);
  - R-V1b-1: um turno velho da IA grava no lead que acabou de ser zerado.
- **V1-c.**
  - F-V1c-1: um toque antigo em `sessao:*` com menos de 4h fica em silêncio.
  - F-V1c-2: o teste estático de lock é fraco.
- **Escolha de consultor.** Você disse: "tire a escolha de consultor, deixe somente o horario e depois do horario o botão para confirmar" e "deixe random a escolha de consultor". Conferi no código e você tem razão. Hoje o fluxo é este:
  1. A Mariana manda os botões de horário.
  2. Logo depois, manda "Você tem preferência por algum consultor?" (`autonomous-task-handlers.ts:485-588`).
  3. Se o cliente responder "Tenho preferência", recebe uma lista de consultores. Se responder "Sem preferência", recebe os horários de novo.
  4. Depois vem o Confirmar.
- **A spec já proibia essa pergunta** desde a v1.1 (R-SCH-01: "Não há pergunta de preferência de consultor"). O código nunca foi ajustado. Essa ordem também causa três bugs:
  - B-1: o cliente toca num horário da primeira mensagem e nada acontece. O backend espera a resposta da preferência.
  - B-2: quando só existe 1 horário, o botão Confirmar é recusado e o cliente não recebe resposta.
  - B-3: se o horário foi ocupado antes do Confirmar, o cliente também não recebe resposta.
- **Isso não está no prompt nem no conhecimento (C1/C2).** É código fixo do backend. Hoje quem escolhe o consultor de cada horário é o sistema, pela menor carga, na hora da oferta. A escolha fica gravada no slot, e o Google Agenda cria o evento no calendário desse consultor.

## 2. O que eu vou fazer
- **26. O reenvio fica na conversa original.** No WhatsApp: a mensagem atrasada é respondida uma vez, nunca fica em silêncio.
- **27. O agendamento trava o lead primeiro.** O teste estático sai. Entra um teste real de deadlock no banco, e o `todo` do tester (`session-rotation.test.ts:1581`) passa a verde. No WhatsApp: some o caso raro de mensagem perdida.
- **28. Um turno de uma conversa fechada não grava nada.** No WhatsApp: a resposta velha não chega, e a mensagem nova é respondida na conversa nova.
- **29. Toque antigo `sessao:*` com menos de 4h.** A Mariana manda um aviso curto mais os botões da etapa atual, como na S-07. No WhatsApp: acaba o silêncio.
- **30. Consultor sorteado.**
  - Na hora da oferta, para cada horário, o backend sorteia um consultor entre os que estão livres naquele horário no Google Agenda. O sorteio acontece uma vez só e fica gravado no slot, antes de existir qualquer botão Confirmar.
  - A IA nunca escolhe. Nos testes, o sorteio usa uma fonte aleatória injetada, então o resultado é sempre o mesmo.
  - No WhatsApp: "Você escolheu 28/10 às 10:00 com <consultor>. Posso confirmar?". O Confirmar agenda exatamente esse consultor e esse horário, porque a regra do `selectedSlotId` continua.
- **31. Sem pergunta de preferência.** O fluxo fica: horários, toque no horário, Confirmar, confirmação. O caso de 1 horário passa a funcionar (corrige B-1 e B-2). No WhatsApp: some uma mensagem e um passo.
- **32. Clientes no meio do fluxo quando isso entrar no ar** (vale por uma versão):
  - a pergunta de preferência que ainda está na fila não é enviada;
  - o toque num horário funciona em qualquer etapa antiga;
  - um toque antigo em "Tenho/Sem preferência" ou num consultor recebe um aviso curto mais os botões de horário.
- **33. Horário ocupado antes do Confirmar.** Nada é agendado e o consultor nunca é trocado escondido. A Mariana avisa e oferece horários novos, com um sorteio novo. Se não houver horário, ela usa o texto que já existe. Corrige B-3.
- **24. Docs.**
  - Spec v1.4: R-SES-02, R-SES-03, R-SCH-03, S-07 e S-08; R-SCH-01 com o sorteio; R-SCH-07 novo; S-22 a S-25 novos.
  - CLAUDE.md: a regra do E8 e, se você aprovar, "travar o lead primeiro".
  - CODEMAP e ROADMAP (D-10: "sorteado entre os livres").
- **25. Verificação final.**
- **Ordem dos lotes:** 26–27, depois 28–29, depois 30–31, depois 32–33, e por fim 24–25.

## 3. O que NÃO vou mexer
- Os passos 19–23.
- O prompt e o conhecimento.
- O `drizzle/`: os valores antigos de etapa e a coluna `preferredConsultantId` ficam no banco, sem uso, porque não pode haver migration.
- A revalidação antes de agendar, a criação e a compensação do evento no Google, o outbox, o Neon e o `.env`.
- A rota de disponibilidade do admin, que mantém a ordem de hoje.
- Outros toques em etapa errada (pacote B).

## 4. Riscos
- **Sorteio puro:** ignora a carga, então um consultor pode receber mais reuniões que outro por acaso (ver D-R2-7).
- **Testes antigos:** os que esperam a pergunta de preferência precisam ser reescritos no passo 31. Se algum caso válido não for portado, o tester vai acusar.
- **Clientes no meio do fluxo:** o passo 32 cobre os casos que encontrei. Um caminho esquecido aparece como toque sem resposta, e o teste do passo 32 deve pegar.
- **Reoferta:** cria uma sessão nova. Um toque depois disso num botão da oferta anterior cai no caso S-07.
- **Passo 26:** a resposta pode chegar horas depois, no contexto antigo.
- **Passo 28:** tarefas que sobraram numa conversa fechada aparecem como "puladas" nas métricas.

## 5. Decisões que preciso de você
- **Confirmar D-R2-1 a D-R2-4 (Rev2)**, todas na opção (a). O seu "aprovo as mudanças" não citou essas decisões.
- **D-R2-5 (você decidiu: "deixe random a escolha de consultor").**
  - Recomendo (a): o sorteio acontece na oferta, entre os consultores livres, e fica gravado no horário. Se o horário for ocupado antes do Confirmar, o cliente recebe uma oferta nova e o consultor nunca é trocado.
  - A opção (b) é sortear só no toque do horário. Isso custa uma chamada a mais ao Google, e o consultor pode mudar.
- **D-R2-6 (textos novos).** Recomendo (a):
  - Aviso de toque antigo: "Esse botão é de uma mensagem antiga." Depois vêm os botões atuais, com "Estes são os horários que tenho para você:". Se não houver agendamento em andamento, vem "Me conta o que você precisa agora?".
  - Reoferta: "Esse horário acabou de ficar indisponível. Tenho estes outros horários:".
  - A opção (b) é você escrever os textos.
- **D-R2-7 (carga).** Recomendo (a): sorteio puro, como você pediu. A opção (b) é sortear só entre os livres com a menor carga.
- **Ainda aberto (não bloqueia código):** você roda os 2 SELECTs só de leitura no Neon antes do deploy (E3-a).

## 6. Pedido de permissão
Posso seguir com este plano? Responda: aprovo / aprovo com mudanças (diga quais) / não aprovo.
Um "aprovo" simples aceita a opção (a) de D-R2-1 a D-R2-7 e todo o texto da spec v1.4.
