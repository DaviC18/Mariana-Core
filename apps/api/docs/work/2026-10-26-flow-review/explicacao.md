# Revisão do fluxo — explicação do plano (2026-10-26)

## 1. O que eu entendi do problema
A pergunta "Continuar / Nova conversa" depois de 4h funciona na primeira vez, mas tem três buracos graves que deixam o cliente sem resposta:
- **Segundo intervalo de 4h na mesma conversa.** Se o cliente escolheu "Continuar" e some de novo por mais de 4h, a primeira mensagem dele é engolida. Ele não recebe a pergunta nem resposta nenhuma. O motivo é que o estado da escolha só pode existir uma vez por conversa.
- **"Continuar" depois de um toque guardado.** Se a pergunta foi disparada por um toque em botão (um horário, por exemplo), o toque é descartado. Depois do "Continuar", nada é enviado.
- **Falha no meio da escolha.** Se der erro de banco logo depois de a escolha ser gravada, a nova tentativa responde "Sua escolha já foi registrada" e para ali.

Além disso, o trabalho de 22/10 ficou sem verificação final, e as proteções de teste do pacote A (Batch E) não foram feitas.

## 2. O que eu vou fazer
- **R0 — Batch E do pacote A (já aprovado).** Fecha os caminhos pelos quais um teste poderia chegar ao Neon ou ao Gemini real. No WhatsApp: nada muda.
- **R1 — fechar a sessão de 4h.**
  - Verificar o Batch D e os passos 8 a 14.
  - Corrigir o teste do gate que falha.
  - Trocar o teste "24h" por um teste de 4h e colocá-lo no `test:unit`.
  - Atualizar ROADMAP, spec D6, CODEMAP e as 2 invariantes do `CLAUDE.md` que você já aprovou.
  - Rodar as suítes completas.

  No WhatsApp: nada muda. Uma correção: o passo 9 (status pela data da reunião) já estava feito.
- **R2 — os críticos e os altos.**
  - Passo 8: a pergunta pode ser reaberta numa conversa já usada, e nenhuma mensagem fica sem destino. O cliente que volta pela segunda vez recebe a pergunta, em vez de silêncio.
  - Passo 9: gravar a escolha e aplicar os efeitos numa única transação. Uma falha nunca termina em "já registrada" seguido de silêncio.
  - Passo 10: depois do "Continuar", o toque guardado é reprocessado. Se não houver nada guardado, vai uma frase curta (texto: Q2). Com isso, "Continuar" sempre recebe resposta.
  - Passo 11: um toque antigo em "Continuar" recebe "Sua escolha já foi registrada", em vez de silêncio.
  - Passo 12: duas mensagens seguidas depois de 4h recebem só a pergunta, sem um lembrete logo atrás (Q3).
- **R3 — médios.**
  - Não reenviar mensagens antigas que falharam.
  - Lembrete que chega depois da escolha vira resposta normal.
  - A trava de agendamento passa a valer também no worker de produção.
  - As respostas da escolha passam a ser gravadas no histórico. Assim a Mariana não cumprimenta duas vezes depois de "Nova conversa".
  - Rastro `mariana_turn` também para as respostas automáticas.
  - Corrida entre texto e "Nova conversa".
  - Opt-out sem pergunta.

Cada passo começa com um teste que falha. Uso só o banco local, nunca o Neon, e nenhum commit.

## 3. O que NÃO vou mexer
- Prompt e base de conhecimento.
- Modelo.
- Migrations e o Neon.
- Os textos atuais da escolha e o valor de 4h.
- `.claude/` e `.env`.
- A reescrita do agendamento (pacote B), o status por data no fluxo normal (pacote D) e as falhas terminais de webhook e de task (pacote E). Esses itens ficam mapeados, não planejados.

## 4. Riscos
- **Reabrir o estado (passo 8)** mexe na única garantia de "uma escolha pendente por conversa". A chave única continua, e testes de concorrência cobrem isso.
- **Reprocessar o toque (passo 10)** usa o mesmo roteamento do webhook. Se o toque estiver velho, a resposta será a de hoje (o F-03 do pacote B), não uma resposta nova.
- **Achado de segurança (F2-05).** As rotas HTTP não têm autenticação: `GET /leads` devolve todos os leads com telefone. Não corrijo isso sem você decidir.
- **Falhas do baseline.** O tester está rodando o baseline em paralelo. Falhas novas podem acrescentar passos. Nesse caso, eu reviso o plano e peço de novo.

## 5. Decisões que preciso de você
1. **Q1:** o servidor é acessível pela internet? Recomendo tratar como público e abrir uma spec de segurança separada.
2. **Q2:** texto quando "Continuar" não tem nada guardado. Recomendo: "Combinado, seguimos de onde paramos. Como posso te ajudar?", com os botões da etapa atual.
3. **Q3:** sem lembrete dentro de 8 s da pergunta? Recomendo: sim.
4. **Q4:** áudio, imagem ou documento hoje ficam sem resposta. Recomendo responder "Por enquanto só consigo ler mensagens de texto. Pode me escrever?".
5. **Q5:** em "Nova conversa" com mensagem guardada, o cliente recebe 2 mensagens. Recomendo manter por enquanto.

## 6. Pedido de permissão
Posso seguir com este plano? Responda: aprovo / aprovo com mudanças (diga quais) / não aprovo.
