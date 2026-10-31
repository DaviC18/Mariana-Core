# Explicação — 2026-10-27-api-auth

## 1. O que eu entendi do problema
Nenhuma rota HTTP da Mariana pede senha. Qualquer pessoa que souber a URL do ngrok pode listar todos os leads com telefone, ler todas as conversas, criar agendamentos reais no Google Calendar e injetar mensagens "system" na conversa da IA. Pior: qualquer um pode abrir `/auth/google?consultantId=...` e ligar a conta Google DELE a um consultor, e aí os agendamentos passam a cair na agenda do invasor. O `state` do OAuth é assinado, mas não expira, pode ser reutilizado e não fica preso ao navegador.

## 2. O que eu vou fazer
1. **Separar a montagem do servidor (`buildApp`)** do `listen`. Isso permite testar a lista completa de rotas sem subir o servidor. Também removo o `multipart`, que não é usado. O cliente no WhatsApp não percebe nada.
2. **Criar duas variáveis novas no `.env`**: `ADMIN_API_KEY` e `APP_SIGNING_SECRET`, cada uma com 32 caracteres ou mais e diferentes entre si. Também crio uma comparação de tempo constante. O cliente não percebe nada. Você precisa colocar as duas no `.env`, senão o servidor não sobe.
3. **Proteger todas as rotas que não são webhook**. A rota passa a exigir `Authorization: Bearer <chave>`. Sem chave, ou com chave errada, a resposta é sempre o mesmo 401. Depois de 10 erros em 15 minutos, aquele IP recebe 429. Os webhooks do WhatsApp, Meta Ads e Google Ads e o `GET /` continuam abertos, cada um com a verificação que já tem. O cliente não percebe nada.
4. **Apagar `POST /conversations/:id/messages`**. Essa rota pula a rotação de conversa, aceita mensagens "system" e "assistant" e chama o Gemini de verdade. O WhatsApp não usa essa rota, então o cliente não percebe nada.
5. **Link de conexão do Google com uso único**. O admin pede o link com a chave e recebe uma URL com um `ticket` assinado. O ticket vale 10 minutos e só funciona uma vez. A chave nunca aparece na URL, e o ticket é mascarado no log.
6. **Endurecer o `state` do OAuth**. Ele passa a expirar em 10 minutos, vale uma vez só e fica preso ao navegador por um cookie HttpOnly. O callback não repete mais o texto de erro que vem na URL e não grava o erro inteiro do Google no log.
7. **Validar `GOOGLE_REDIRECT_URI`**. Precisa ser uma URL válida que termina em `/auth/google/callback`, com https em produção.
8. **Adicionar headers de segurança** (nosniff, bloqueio de iframe, no-referrer, no-store). O CORS continua desligado, de propósito.
9. **Comparar os tokens dos webhooks em tempo constante**. Hoje eles usam `===`. O comportamento continua igual.
10. **Atualizar o CODEMAP e o `.env.example`** (só os nomes das variáveis).

Cada passo começa com um teste falhando. Os testes de webhook precisam continuar verdes.

## 3. O que NÃO vou mexer
Lógica dos webhooks, dedup, rotação, outbox, tasks, prompts, banco e migrations. Não vou construir a tela de admin. Não vou adicionar paginação em `/leads`. Não vou adicionar nenhuma dependência npm nova.

## 4. Riscos
- **O servidor não sobe sem as variáveis novas.** O erro de env aparece logo no boot.
- **Quem chama essas rotas hoje passa a receber 401** (Postman, script). Isso aparece na hora, no primeiro uso.
- **Atrás do ngrok, todo mundo chega com o mesmo IP.** Um atacante pode travar o admin por 15 minutos. O WhatsApp não é afetado. A solução é `TRUST_PROXY_HOPS=1`.
- **Os tickets e states usados ficam guardados na memória.** Num restart essa lista se perde, mas cada um expira em 10 minutos. Com mais de uma instância isso não funciona sem banco.

Tela de admin no futuro: login com sessão em cookie (não JWT), papéis `admin` e `consultant`, e login com Google. Isso precisa de tabelas novas, então fica travado pelo congelamento de migrations. O código desta tarefa já deixa o espaço pronto (`request.principal`).

## 5. Decisões que preciso de você
- **Q1: o servidor fica acessível pela internet?** Em dev ele está no ngrok. E em produção, onde ele roda? *Recomendo tratar como público. O plano já assume isso.*
- **D-1: quem vai usar a tela de admin?** Só você? Os consultores também? *Recomendo: você como `admin` e os consultores como `consultant` (só a própria agenda), mais tarde.*
- **D-2: apagar `POST /conversations/:id/messages`?** *Recomendo apagar.* O passo 4 está BLOQUEADO até você responder.
- **D-3: algo chama essas rotas hoje** (Postman, script, front)? *Se sim, passa a mandar a chave Bearer.*
- **D-4: remover o `@fastify/multipart`, que não é usado?** *Recomendo sim.*
- **D-5: comparar os tokens dos webhooks em tempo constante?** *Recomendo sim.*
- **D-6: deixar o HSTS para quando o host de produção estiver definido?** *Recomendo sim.*
- **D-7: usar `TRUST_PROXY_HOPS=1` atrás do ngrok?** *Recomendo sim.*
- **D-8: limiter e headers feitos em casa, sem dependência nova?** *Recomendo sim. A alternativa é usar `@fastify/rate-limit` e `@fastify/helmet`.*

## 6. Pedido de permissão
Posso seguir com este plano? Responda: aprovo / aprovo com mudanças (diga quais) / não aprovo.
