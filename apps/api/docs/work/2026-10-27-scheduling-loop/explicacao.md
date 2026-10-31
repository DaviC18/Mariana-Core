# Loop no agendamento (invalid_grant) — explicação

## 1. O que eu entendi do problema
O token do Google de um consultor expirou. Quando o cliente respondeu "sim por favor", a Mariana chamou o Gemini e depois tentou ler a agenda. O Google respondeu `invalid_grant`, o turno quebrou e a task tentou de novo 5 vezes. Foram 5 chamadas ao Gemini, nenhuma resposta ao cliente e nenhum log com o erro de verdade.

Reproduzi o caso no banco local (`localhost/mariana_test`), com tudo mockado, e o resultado foi idêntico ao do incidente. Também achei mais dois problemas:
- o serviço do Calendar usa o token da primeira conexão que encontra, para todos os consultores (`google-calendar-service.ts:41-47`, `.limit(1)` sem `where`);
- basta um consultor falhar para derrubar a oferta inteira (`consultant-availability.ts:57-75`).

Não foi o passo 30 do flow-review que causou isso. Esse comportamento já existia antes. O `accepted_pending_offer` disparou porque o marcador de oferta pendente é o texto exato da oferta, não uma coluna. Ele está ativo em produção, e o `CLAUDE.md` está desatualizado nesse ponto.

## 2. O que eu vou fazer
1. **Logar o erro real.**
   - O que muda: o rastro do turno e o executor de tasks passam a registrar o nome, o código e a mensagem do erro, com os números mascarados.
   - Por que muda: hoje o erro fica só no banco.
   - O que o cliente percebe: nada. Você passa a ver `invalid_grant` no log.
2. **Resposta fixa quando nenhuma agenda responde.**
   - O que muda: a Mariana responde na hora com um texto fixo, sem tentar de novo.
   - Por que muda: tentar de novo não conserta um token revogado e gasta Gemini.
   - O que o cliente percebe: em vez de silêncio, recebe na hora "Desculpe, tive um problema para consultar a agenda dos consultores agora. Me mande uma mensagem daqui a pouco que eu tento de novo." (texto a confirmar).
3. **Limitar as tentativas e avisar na última.**
   - O que muda: para outros erros (banco etc.), o máximo de tentativas cai de 5 para 3, e na última o cliente recebe um aviso fixo.
   - Por que muda: menos custo com o Gemini e nunca silêncio.
   - O que o cliente percebe: no pior caso, um aviso de falha técnica.
4. **Cada consultor usa o próprio token.**
   - O que muda: o Calendar passa a buscar a conexão daquele consultor.
   - Por que muda: hoje um token ruim pode derrubar todos os consultores.
   - O que o cliente percebe: nada.
5. **Consultor com token quebrado sai do sorteio.**
   - O que muda: ao receber `invalid_grant`, aquele consultor fica marcado como quebrado em memória e sai do sorteio, e o log diz qual consultor precisa reautorizar.
   - Por que muda: a oferta continua com os outros consultores. Quando você reautoriza, o `updatedAt` muda e o consultor volta sozinho, sem reiniciar.
   - O que o cliente percebe: recebe horários normalmente, só dos consultores que estão funcionando.

## 3. O que NÃO vou mexer
Tokens, `auth-google.ts`, migrations e schema, `consultants.active`, prompts, o fluxo de confirmar e agendar, o `MODEL_FAILURE_NOTICE` e o `CLAUDE.md`. Uma tela de admin para conectar o Google fica como follow-up, porque depende do F2-05.

## 4. Riscos
- A marca de "quebrado" fica em memória e se perde ao reiniciar o servidor. Depois de um restart, cada consultor quebrado custa uma chamada ao Calendar que falha, e aí é marcado de novo. Um flag persistente precisa de uma coluna nova, ou seja, de uma migration, e isso espera a baseline.
- Se hoje vocês usam uma única conta Google compartilhada, o passo 4 pode excluir consultores que não têm linha de conexão. Por isso esse passo depende da Q3.
- Mensagens assistentes que nunca foram enviadas, gravadas nas tentativas que falharam, continuam existindo para erros que não são do Calendar (follow-up F-2).
- Como vamos perceber: testes de regressão vermelhos antes e verdes depois, e o script `repro/scheduling-loop-v2.repro.ts` tem que mostrar 1 chamada ao Gemini e 1 mensagem na outbox.

## 5. Decisões que preciso de você
- **Q1 (bloqueia o passo 2): o texto.** Recomendo o A: "Desculpe, tive um problema para consultar a agenda dos consultores agora. Me mande uma mensagem daqui a pouco que eu tento de novo." O B promete que um consultor vai entrar em contato. Só faz sentido se alguém for realmente avisado, e hoje ninguém é.
- **Q2: máximo de tentativas da task de entrada.** Recomendo 3 (hoje são 5). A alternativa é 2.
- **Q3 (bloqueia o passo 4): cada consultor tem a própria conexão Google, ou é uma conta só que enxerga todas as agendas?** Recomendo uma conexão por consultor. Para conferir, compare a quantidade de linhas em `google_calendar_connections` com a quantidade de consultores ativos.
- **Q4: depois do aviso do passo 3, a task fica `failed` ou `completed`?** Recomendo `failed`, porque ela continua aparecendo no seu SELECT.
- **Q5: você corrige a linha do `CLAUDE.md` sobre a oferta pendente?** Hoje ela diz que esse caminho não está ativo em produção, mas está.

## 6. Pedido de permissão
Posso seguir com este plano? Responda: aprovo / aprovo com mudanças (diga quais) / não aprovo.
