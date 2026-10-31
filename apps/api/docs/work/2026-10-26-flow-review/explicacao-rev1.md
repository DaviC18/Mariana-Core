# Revisão 1 — sessão nova automática depois de 4h

## 1. O que eu entendi do problema
Você decidiu que a pergunta "Continuar / Nova conversa" sai. Se o cliente fica 4h ou mais sem escrever, a próxima mensagem dele já começa uma conversa nova, sem perguntar nada. O valor de 4h continua. Hoje o código faz a pergunta, guarda a mensagem e espera o toque. Tudo isso vira código morto.

## 2. O que eu vou fazer
1. **Spec v1.3 (passo 19, só documento).** Reescrevo R-SES-02, S-18, S-19 e S-20 e crio a S-21 ("duas mensagens juntas depois de 4h"). O texto proposto está no `plan.md`, seção "Spec v1.3 wording". Só edito o arquivo da spec depois que você aprovar.
   - No WhatsApp: nada muda ainda.
2. **Rotação automática no webhook (passo 20).** Quando a mensagem chega, o backend trava o lead e confere o horário da última mensagem do cliente. Se passou de 4h, ele fecha a conversa antiga e abre a nova. Tudo isso acontece na mesma transação que grava a mensagem. Na conversa nova, o estado comercial é zerado e a sessão de agendamento antiga expira. O opt-out é copiado. O status do lead segue a data da reunião: reunião futura mantém "agendado", senão volta a `new` (a decisão D-1 continua valendo).
   - Por quê: hoje a conversa é escolhida numa transação separada. Com duas mensagens juntas, isso criaria duas conversas novas, ou gravaria uma mensagem na conversa já fechada.
   - No WhatsApp: o cliente manda "oi" depois de 4h e recebe **uma** resposta normal, de começo de conversa. Não recebe pergunta nenhuma.
3. **Status `qualified`/`qualifying` também volta a `new` (passo 21, depende da E7).** Achei um bug: hoje o "Nova conversa" só zera o status `scheduled`. Um lead `qualified` leva esse status para a conversa nova.
   - No WhatsApp: a conversa nova não pula etapas.
4. **Toque num botão antigo depois de 4h (passo 22, depende da E1).** O backend abre a conversa nova, não agenda e manda uma resposta curta e fixa.
   - No WhatsApp: o cliente toca num horário antigo e recebe a resposta curta (texto da E1). Nenhum agendamento é criado.
5. **Apagar o código morto (passo 23).** Saem os handlers de pergunta, lembrete e escolha, a trava nos handlers de agendamento, o filtro do executor, o roteamento `sessao:*`, o `session-choice-store.ts`, os textos da pergunta e 6 arquivos de teste. Os casos que ainda valem vão para o novo `session-rotation.test.ts`. Os três tipos de tarefa antigos ficam por uma versão num handler que não faz nada, para não falhar se algum ainda estiver na fila. Não há migration: as linhas antigas ficam na tabela, sem uso.
6. **Docs (passo 24) e verificação final (passo 25).** Tiro do `CLAUDE.md` o invariante "At most one pending session choice per conversation". Também atualizo o CODEMAP, o D6/AC11/AC12 e o WP-4 do roadmap.

Cada passo começa com um teste que falha antes da mudança e passa depois. A seção "Verdicts" do plano dá o veredito de cada item antigo. Ficam obsoletos: F2-01, 02, 03, 07, 13, 14, 15, 17 e 22, e também Q2, Q3 e Q5. Mudaram: F2-06, 20 e 21. Continuam valendo: F2-19, Q1 e Q4. A F2-29 está **sem veredito**: o texto dela não está no repositório.

## 3. O que NÃO vou mexer
O valor de 4h e a regra `>=`, a janela de 24h do WhatsApp, a deduplicação, o debounce de 8 s, a máquina de estados do outbox, os prompts e o conhecimento, as migrations, o Neon, o `.claude/` e o `.env`. Também ficam de fora os toques silenciosos do pacote B e as mensagens de áudio e imagem (Q4).

## 4. Riscos
- **Duas mensagens criarem duas conversas.** O teste com `Promise.all` do passo 20 pega isso.
- **Tarefa antiga da conversa A rodando depois que ela fecha.** As tarefas pendentes de A são encerradas na rotação. Uma tarefa que já estiver rodando pode ainda terminar em A. O risco é baixo, e o passo 25 verifica isso.
- **Escolhas pendentes em produção na hora do deploy.** O SQL de leitura da E3 mostra se existem.
- **O teste S-20 que o tester ainda não comitou é apagado no passo 23.**

## 5. Decisões que preciso de você
- **E1. Toque em horário antigo depois de 4h.** Recomendo: conversa nova, o toque não vale, e a Mariana responde "Oi! Já faz um tempo desde a nossa última conversa, então aqueles horários não valem mais. Me conta o que você procura agora?".
- **E2. Cliente com reunião futura.** Recomendo: abrir a conversa nova mesmo assim, com o status continuando "agendado" (S-10).
- **E3. Escolhas pendentes no Neon.** Antes do deploy, rode você mesmo os 2 SELECTs do plano. Eles só leem. Recomendo fazer o deploy só se os dois derem 0. Ou o gate de 4h já está em produção?
- **E4. A primeira resposta da conversa nova cumprimenta?** Recomendo: sim, como o começo normal de uma conversa, sem texto extra. O "que bom te ver de novo" fica para o C2.
- **E5. O que acontece com a conversa antiga.** Recomendo: fica `closed`, nunca é apagada, e o estado comercial vai para uma linha de auditoria (sem migration).
- **E6. Opt-out depois de 4h.** Recomendo: abre a conversa nova como qualquer mensagem, com o opt-out gravado na conversa nova.
- **E7. Lead `qualified` sem reunião futura.** Recomendo: volta a `new`.
- **E8. CLAUDE.md.** Recomendo: tirar o invariante antigo e colocar "A new conversation is opened only by the backend, under the lead lock, in the transaction that stores the inbound."
- **Spec v1.3.** Você aprova o texto de R-SES-02, S-18, S-19, S-20 e S-21 que está no `plan.md`?

## 6. Pedido de permissão
Posso seguir com este plano? Responda: aprovo / aprovo com mudanças (diga quais) / não aprovo.
