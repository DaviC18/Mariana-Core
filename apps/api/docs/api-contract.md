# Contrato Real da API — Mariana Core Backend

Este documento descreve o contrato técnico real, integral e atualizado da API HTTP do Mariana Core Backend (Fastify 5.12 + Drizzle ORM + PostgreSQL), refletindo fielmente a implementação encontrada no código-fonte, incluindo cabeçalhos, rotas públicas e administrativas, esquemas de entrada/saída, códigos HTTP reais, comportamentos assíncronos e divergências/anomalias identificadas.

---

## 1. Visão Geral da Arquitetura HTTP

- **Servidor:** Fastify `v5.12.1` com `@fastify/type-provider-zod`.
- **Porta Padrão:** `3252` (configurável via `PORT`), bind em `0.0.0.0`.
- **Validação de Esquemas:** Zod com `fastify-type-provider-zod` (`validatorCompiler` e `serializerCompiler`).
- **Parsing de Payload Raw:** Rotas de webhook (`/webhooks/whatsapp`, `/webhooks/meta-ads`) utilizam parser customizado para capturar `rawBody` como string para validação criptográfica HMAC SHA-256 antes da desserialização JSON.
- **Proxying:** `trustProxy: false` configurado no Fastify. O IP identificado para auditoria e rate limiting é o peer TCP direto.

---

## 2. Segurança, Headers e Políticas Globais

### 2.1 Headers de Segurança (Hook `onSend` Global)
Todos os endpoints (públicos e administrativos, incluindo respostas de erro como `401`, `404` e `429`) injetam obrigatoriamente os seguintes headers:

```http
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

### 2.2 Políticas de Cache e CORS
- **CORS:** Desabilitado. Nenhum header `Access-Control-Allow-*` é emitido por padrão.
- **Cache-Control:**
  - Injetado como `Cache-Control: no-store` em todas as rotas sob o prefixo `/auth/google*` e em todas as rotas registradas no escopo administrativo (`requireAdmin`).

### 2.3 Rate Limiting de Falhas de Autenticação (`AuthFailureLimiter`)
- **Alvo:** Escopo administrativo e rota `/auth/google` (validação de ticket). Não afeta webhooks.
- **Regra:** Máximo de 10 falhas registradas por IP em uma janela de 15 minutos (900.000 ms).
- **Resposta ao Exceder Limite:**
  - Status HTTP: `429 Too Many Requests`
  - Header: `Retry-After: <segundos_restantes>`
  - Corpo:
    ```json
    {
      "error": "too_many_requests"
    }
    ```

---

## 3. Mecanismos de Autenticação

### 3.1 Escopo Público (Sem Header Bearer Global)
As rotas públicas implementam validações dedicadas:
1. **WhatsApp Webhooks:**
   - `GET /webhooks/whatsapp`: Verificação de token Meta (`hub.verify_token === env.WHATSAPP_VERIFY_TOKEN` e `hub.mode === 'subscribe'`).
   - `POST /webhooks/whatsapp`: Assinatura HMAC SHA-256 no header `x-hub-signature-256` calculada sobre o `rawBody` com `env.WHATSAPP_APP_SECRET`.
2. **Meta Ads Webhooks:**
   - `GET /webhooks/meta-ads`: Verificação em tempo constante (`safeEqual`) de `hub.verify_token` contra `env.META_ADS_VERIFY_TOKEN`.
   - `POST /webhooks/meta-ads`: Assinatura HMAC SHA-256 no header `x-hub-signature-256` calculada sobre o `rawBody` com `env.META_ADS_APP_SECRET`.
3. **Google Ads Webhook:**
   - `POST /webhooks/google-ads`: Campo `google_key` no corpo JSON validado via `safeEqual` contra `env.GOOGLE_ADS_WEBHOOK_KEY`.
4. **Google Calendar OAuth Flow:**
   - `GET /auth/google`: Token assinado HMAC no query param `ticket` derivado de `env.APP_SIGNING_SECRET` com finalidade `gcal_connect`, validade de 10 minutos e proteção contra replay via nonces consumidos (`ConsumedNonces`).
   - `GET /auth/google/callback`: Token assinado HMAC `state` derivado com finalidade `gcal_state`, validade de 10 minutos, uso único e validação casada contra cookie `gcal_oauth_nonce` (prevenção de Login-CSRF).

### 3.2 Escopo Administrativo (`requireAdmin`)
Todas as rotas sob o escopo de admin exigem:
- **Header:** `Authorization: Bearer <ADMIN_API_KEY>`
- O token precisa corresponder exatamente a `env.ADMIN_API_KEY` (comparação segura via `safeEqual`).
- Caso ausente, malformado ou divergente:
  - Incrementa contador de falhas do IP no `AuthFailureLimiter`.
  - Retorna imediatamente:
    ```http
    HTTP/1.1 401 Unauthorized
    Content-Type: application/json; charset=utf-8
    Cache-Control: no-store

    {
      "error": "unauthorized"
    }
    ```

---

## 4. Inventário e Contrato Detalhado dos Endpoints

O backend registra **22 endpoints** (8 públicos e 14 administrativos):

```
Rotas Públicas (8):
  GET  /
  GET  /webhooks/whatsapp
  POST /webhooks/whatsapp
  GET  /webhooks/meta-ads
  POST /webhooks/meta-ads
  POST /webhooks/google-ads
  GET  /auth/google
  GET  /auth/google/callback

Rotas Administrativas (14):
  POST /admin/google-calendar/connect-link
  GET  /leads
  POST /leads
  GET  /leads/:id
  GET  /conversations
  POST /conversations
  GET  /conversations/:id
  GET  /conversations/:conversationId/messages
  GET  /messages
  GET  /messages/:id
  GET  /appointments
  POST /appointments
  GET  /appointments/:id
  GET  /appointments/availability
```

---

### 4.1 Endpoints Públicos

#### `GET /`
- **Descrição:** Healthcheck simples da aplicação.
- **Autenticação:** Nenhuma.
- **Query / Body:** Nenhum.
- **Respostas:**
  - `200 OK`: Corpo texto `"ok"`.

---

#### `GET /webhooks/whatsapp`
- **Descrição:** Verificação de webhook da Cloud API do WhatsApp (Meta).
- **Autenticação:** Token de verificação da Meta.
- **Query Params:**
  - `hub.mode` (string): Esperado `"subscribe"`.
  - `hub.verify_token` (string): Deve coincidir com `env.WHATSAPP_VERIFY_TOKEN`.
  - `hub.challenge` (string): Código challenge enviado pela Meta.
- **Respostas:**
  - `200 OK` (`text/plain`): Retorna o valor de `hub.challenge`.
  - `403 Forbidden` (`application/json`):
    ```json
    { "error": "Forbidden" }
    ```

---

#### `POST /webhooks/whatsapp`
- **Descrição:** Recebimento assíncrono de eventos do WhatsApp (mensagens de texto e cliques em botões interativos).
- **Autenticação:** Assinatura HMAC SHA-256 no header `x-hub-signature-256`.
- **Headers Requeridos:**
  - `x-hub-signature-256`: `sha256=<hex_hmac>`
- **Corpo da Requisição:** `WhatsAppWebhookPayload` (formato padrão Cloud API).
- **Comportamento e Efeitos Colaterais:**
  1. Executa recuperação preventiva de leases expiradas em `whatsapp_webhook_events` (`status = 'processing'`, lease > 60s).
  2. Valida HMAC SHA-256 contra `env.WHATSAPP_APP_SECRET`.
  3. Ignora payloads que não pertençam ao objeto `"whatsapp_business_account"`.
  4. Deduplica mensagens por `message.id` (`whatsapp_webhook_events.externalId`).
  5. Ingesta ou atualiza lead em `leads` via `leadIngestionService.ingest`.
  6. **Política de Rotação de Sessão (4 horas):** se a última mensagem do cliente foi recebida há 4h ou mais, a conversa atual é encerrada e uma nova é aberta em transação isolada sob lock do lead (`SELECT ... FOR UPDATE`).
  7. **Interações de Botão (`interactive.button_reply`):**
     - Botões de slot (`SCHEDULING_SLOT_BUTTON_ID` UUID): enfileira tarefa `send_confirmation_request`.
     - Botões de confirmação/cancelamento (`confirm:*`, `cancel:*`): enfileira tarefa `process_button_reply`.
     - Botões legados ou toques expirados: dispara resposta fixa de toque expirado (`replyToStaleTap`).
  8. **Mensagens de Texto:**
     - Salva mensagem em `messages` com `role = 'user'`.
     - Atualiza `conversations.lastCustomerMessageAt` e checa opt-out ("PARE", "PARAR", "SAIR", etc.).
     - Enfileira tarefa autônoma `process_inbound_message` com debounce configurado em `env.MESSAGE_DEBOUNCE_MS` (padrão 15s).
- **Respostas:**
  - `200 OK`:
    ```json
    { "status": "ok" }
    ```
    ou (se evento irrelevante/ignorado):
    ```json
    { "status": "ignored" }
    ```
  - `401 Unauthorized`:
    ```json
    { "error": "Invalid signature" }
    ```

---

#### `GET /webhooks/meta-ads`
- **Descrição:** Verificação de webhook para formulários instantâneos de anúncios da Meta (Meta Leadgen).
- **Autenticação:** Token em tempo constante via `safeEqual`.
- **Query Params (Zod):**
  - `hub.challenge` (string, min 1)
  - `hub.mode` (literal `"subscribe"`)
  - `hub.verify_token` (string, min 1)
- **Respostas:**
  - `200 OK` (`text/plain`): Retorna o valor de `hub.challenge`.
  - `400 Bad Request`: Payload/query inválido.
  - `403 Forbidden`: Token divergente de `env.META_ADS_VERIFY_TOKEN`.
  - `500 Internal Server Error`: Erro inesperado.

---

#### `POST /webhooks/meta-ads`
- **Descrição:** Notificação de lead gerado em campanhas de Meta Ads.
- **Autenticação:** Assinatura HMAC SHA-256 no header `x-hub-signature-256` contra `env.META_ADS_APP_SECRET`.
- **Headers Requeridos:**
  - `x-hub-signature-256`: `sha256=<hex_hmac>`
- **Corpo da Requisição (Zod):**
  ```json
  {
    "object": "page",
    "entry": [
      {
        "id": "123456",
        "time": 1700000000,
        "changes": [
          {
            "field": "leadgen",
            "value": {
              "leadgen_id": "string",
              "form_id": "string",
              "page_id": "string",
              "ad_id": "string",
              "adgroup_id": "string",
              "created_time": 1700000000
            }
          }
        ]
      }
    ]
  }
  ```
- **Respostas:**
  - `200 OK`:
    ```json
    { "status": "ok", "leadgenEvents": 1 }
    ```
    ou (se objeto não for `page` ou sem eventos leadgen):
    ```json
    { "status": "ignored" }
    ```
  - `400 Bad Request`: Payload inválido.
  - `401 Unauthorized`: Assinatura HMAC inválida.
  - `500 Internal Server Error`: Falha no processamento.

---

#### `POST /webhooks/google-ads`
- **Descrição:** Webhook para captura de leads enviados por formulários de extensão de anúncio do Google Ads.
- **Autenticação:** Chave secreta `google_key` no próprio corpo JSON, validada via `safeEqual` contra `env.GOOGLE_ADS_WEBHOOK_KEY`.
- **Corpo da Requisição (Zod):**
  ```json
  {
    "google_key": "string",
    "lead_id": "string",
    "api_version": "string",
    "form_id": 123,
    "campaign_id": 456,
    "adgroup_id": 789,
    "creative_id": 101,
    "gcl_id": "string",
    "is_test": false,
    "user_column_data": [
      { "column_id": "FULL_NAME", "string_value": "Fulano da Silva" },
      { "column_id": "EMAIL", "string_value": "fulano@example.com" },
      { "column_id": "PHONE_NUMBER", "string_value": "+5511999998888" }
    ]
  }
  ```
- **Regras de Negócio:**
  - Campo `PHONE_NUMBER` é obrigatório em `user_column_data`.
  - Se `is_test: true`, registra log e responde `200` sem persistir no banco.
  - Executa `leadIngestionService.ingest` criando ou atualizando lead (`source = 'google_ads'`).
- **Respostas:**
  - `200 OK` (lead real):
    ```json
    {
      "status": "ok",
      "leadId": "uuid",
      "created": true
    }
    ```
  - `200 OK` (lead de teste):
    ```json
    {
      "status": "ok",
      "test": true
    }
    ```
  - `400 Bad Request`:
    ```json
    { "error": "Invalid payload" }
    ```
    ou
    ```json
    { "error": "PHONE_NUMBER is required" }
    ```
  - `401 Unauthorized`:
    ```json
    { "error": "Unauthorized" }
    ```
  - `500 Internal Server Error`: Erro no processamento.

---

#### `GET /auth/google`
- **Descrição:** Inicia o fluxo de autorização OAuth 2.0 do Google Calendar para um consultor.
- **Autenticação:** Query param `ticket` assinado HMAC (gerado previamente pelo endpoint administrativo `/admin/google-calendar/connect-link`).
- **Rate Limit:** Sujeito ao `AuthFailureLimiter` (10 falhas / 15 min).
- **Query Params:**
  - `ticket` (string): Token assinado com objetivo `gcal_connect` e validade de 10 minutos.
- **Comportamento:**
  - Consome o ticket (impossibilitando reutilização).
  - Gera token assinado `state` com validade de 10 min.
  - Define cookie seguro `gcal_oauth_nonce` contendo o nonce do state (proteção CSRF).
  - Redireciona o navegador para `https://accounts.google.com/o/oauth2/v2/auth`.
- **Respostas:**
  - `302 Found`: Redirecionamento para o Google.
    - Header: `Set-Cookie: gcal_oauth_nonce=<nonce>; Path=/auth/google/callback; Max-Age=600; HttpOnly; SameSite=Lax`
  - `400 Bad Request`:
    ```json
    { "error": "invalid_ticket" }
    ```
  - `429 Too Many Requests`:
    ```json
    { "error": "too_many_requests" }
    ```

---

#### `GET /auth/google/callback`
- **Descrição:** Callback redirecionado pelo Google após o consentimento do consultor.
- **Autenticação:** Validação cruzada entre o parâmetro `state` assinado e o cookie `gcal_oauth_nonce`.
- **Query Params:**
  - `code` (string, opcional): Código de concessão OAuth retornado pelo Google.
  - `state` (string, opcional): Token de estado assinado contendo o `consultantId`.
  - `error` (string, opcional): Código de erro caso o usuário recuse o consentimento.
- **Cookies:** `gcal_oauth_nonce`.
- **Comportamento:**
  - Sempre remove o cookie `gcal_oauth_nonce` (`Max-Age=0`).
  - Obtém credenciais via `googleOAuth2Client.getToken(code)`.
  - Exige obrigatoriamente a presença de `refresh_token`.
  - Salva ou atualiza a tabela `google_calendar_connections` associada ao consultor.
- **Respostas:**
  - `200 OK`:
    ```json
    {
      "success": true,
      "message": "Google Calendar autorizado e conexão salva.",
      "consultant": "Nome do Consultor",
      "hasAccessToken": true,
      "hasRefreshToken": true
    }
    ```
  - `400 Bad Request`:
    - `{ "success": false, "message": "Autorização Google recusada." }`
    - `{ "success": false, "message": "Código ou state de autorização não encontrado." }`
    - `{ "success": false, "message": "State OAuth inválido." }`
    - `{ "success": false, "message": "Google não retornou refresh token. Revogue a autorização anterior e autorize novamente." }`
  - `404 Not Found`:
    ```json
    { "success": false, "message": "Consultor não encontrado." }
    ```
  - `500 Internal Server Error`:
    ```json
    { "success": false, "message": "Erro ao concluir autorização do Google Calendar." }
    ```

---

### 4.2 Endpoints Administrativos (Requer `Authorization: Bearer <ADMIN_API_KEY>`)

---

#### `POST /admin/google-calendar/connect-link`
- **Descrição:** Emite link seguro e com validade temporária (10 minutos) para um consultor conectar sua conta Google Calendar.
- **Corpo da Requisição (Zod):**
  ```json
  {
    "consultantId": "uuid"
  }
  ```
- **Respostas:**
  - `200 OK`:
    ```json
    {
      "url": "https://.../auth/google?ticket=<token_assinado>",
      "expiresAt": "2026-10-31T01:10:00.000Z"
    }
    ```
  - `404 Not Found`:
    ```json
    { "error": "consultant_not_found" }
    ```

---

#### `POST /leads`
- **Descrição:** Criação manual/administrativa de lead.
- **Corpo da Requisição (Zod):**
  ```json
  {
    "name": "Nome do Lead",
    "phone": "+5511999990000",
    "consortiumType": "imovel",
    "objective": "Comprar primeiro imóvel",
    "birthDate": "1990-05-15T00:00:00.000Z" // Opcional (ISO 8601)
  }
  ```
- **Regras de Negócio:**
  - Se `birthDate` for fornecido, valida se o lead possui pelo menos 18 anos completos (`isAtLeast18`).
- **Respostas:**
  - `201 Created`:
    ```json
    {
      "lead": {
        "id": "uuid",
        "name": "Nome do Lead",
        "phone": "+5511999990000",
        "consortiumType": "imovel",
        "objective": "Comprar primeiro imóvel",
        "birthDate": "1990-05-15T00:00:00.000Z",
        "status": "new",
        "source": "whatsapp",
        "interestedInConsultant": false,
        "createdAt": "2026-10-31T00:00:00.000Z",
        "updatedAt": "2026-10-31T00:00:00.000Z"
      }
    }
    ```
  - `400 Bad Request`:
    ```json
    { "error": "Lead must be at least 18 years old" }
    ```
  - `500 Internal Server Error`:
    ```json
    { "error": "Failed to create lead" }
    ```

---

#### `GET /leads`
- **Descrição:** Lista todos os leads cadastrados no banco de dados.
- **Query Params:** Nenhum (não há paginação na implementação atual).
- **Respostas:**
  - `200 OK`:
    ```json
    {
      "leads": [
        {
          "id": "uuid",
          "name": "Fulano",
          "phone": "+5511999990000",
          "status": "qualifying",
          "consortiumType": "imovel",
          "objective": "Investimento",
          "createdAt": "2026-10-31T00:00:00.000Z",
          "updatedAt": "2026-10-31T00:00:00.000Z"
        }
      ]
    }
    ```
  - `500 Internal Server Error`:
    ```json
    { "error": "Failed to fetch leads" }
    ```

---

#### `GET /leads/:id`
- **Descrição:** Busca os dados de um lead específico pelo seu UUID.
- **Parâmetros de Rota (Zod):**
  - `id`: UUID válido.
- **Respostas:**
  - `200 OK`:
    ```json
    {
      "lead": {
        "id": "uuid",
        "name": "Fulano",
        "phone": "+5511999990000",
        "status": "new",
        "createdAt": "2026-10-31T00:00:00.000Z",
        "updatedAt": "2026-10-31T00:00:00.000Z"
      }
    }
    ```
  - `401 Unauthorized` *(Anomalia / Divergência de Implementação)*:
    Quando o lead não existe no banco, o endpoint retorna código HTTP `401` em vez de `404`:
    ```json
    { "error": "Lead not found" }
    ```
  - `500 Internal Server Error`:
    ```json
    { "error": "Failed to fetch lead" }
    ```

---

#### `POST /conversations`
- **Descrição:** Cria uma conversa para o lead especificado ou recupera a conversa atualmente ativa (idempotência por invariante de negócio: 1 conversa ativa por lead).
- **Corpo da Requisição (Zod):**
  ```json
  {
    "leadId": "uuid"
  }
  ```
- **Regras de Negócio:**
  - Executa sob lock do lead (`SELECT id FROM leads WHERE id = :leadId FOR UPDATE`).
  - Se já existe conversa com `status = 'active'`, retorna-a com status HTTP `200`.
  - Se não existe, cria nova conversa com `status = 'active'` e retorna status HTTP `201`.
- **Respostas:**
  - `201 Created` (conversa criada):
    ```json
    {
      "conversation": {
        "id": "uuid",
        "leadId": "uuid",
        "status": "active",
        "startedAt": "2026-10-31T00:00:00.000Z",
        "updatedAt": "2026-10-31T00:00:00.000Z"
      }
    }
    ```
  - `200 OK` (conversa já existia e está ativa):
    ```json
    {
      "conversation": {
        "id": "uuid",
        "leadId": "uuid",
        "status": "active",
        "startedAt": "2026-10-31T00:00:00.000Z",
        "updatedAt": "2026-10-31T00:00:00.000Z"
      }
    }
    ```
  - `404 Not Found`:
    ```json
    { "error": "Lead not found" }
    ```
  - `500 Internal Server Error`:
    ```json
    { "error": "Failed to create conversation" }
    ```

---

#### `GET /conversations`
- **Descrição:** Lista todas as conversas existentes no sistema.
- **Query Params:** Nenhum.
- **Respostas:**
  - `200 OK`:
    ```json
    {
      "conversations": [
        {
          "id": "uuid",
          "leadId": "uuid",
          "status": "active",
          "lastCustomerMessageAt": "2026-10-31T00:00:00.000Z",
          "startedAt": "2026-10-31T00:00:00.000Z",
          "updatedAt": "2026-10-31T00:00:00.000Z"
        }
      ]
    }
    ```
  - `500 Internal Server Error`:
    ```json
    { "error": "Failed to fetch conversations" }
    ```

---

#### `GET /conversations/:id`
- **Descrição:** Obtém os detalhes de uma conversa por UUID.
- **Parâmetros de Rota (Zod):**
  - `id`: UUID.
- **Respostas:**
  - `201 Created` *(Anomalia / Divergência de Implementação)*:
    Retorna código HTTP `201` em uma requisição `GET` com o objeto:
    ```json
    {
      "conversation": {
        "id": "uuid",
        "leadId": "uuid",
        "status": "active",
        "startedAt": "2026-10-31T00:00:00.000Z",
        "updatedAt": "2026-10-31T00:00:00.000Z"
      }
    }
    ```
  - `401 Unauthorized` *(Anomalia / Divergência de Implementação)*:
    Retorna código HTTP `401` quando a conversa não existe em vez de `404`:
    ```json
    { "error": "Conversation not found" }
    ```
  - `500 Internal Server Error`:
    ```json
    { "error": "Failed to fetch conversation" }
    ```

---

#### `GET /conversations/:conversationId/messages`
- **Descrição:** Lista o histórico ordenado cronologicamente de mensagens de uma conversa.
- **Parâmetros de Rota (Zod):**
  - `conversationId`: UUID.
- **Respostas:**
  - `200 OK`:
    ```json
    {
      "conversationId": "uuid",
      "messages": [
        {
          "id": "uuid",
          "conversationId": "uuid",
          "role": "user",
          "content": "Olá, gostaria de saber sobre consórcio imobiliário",
          "externalId": "wamid.HBg...",
          "createdAt": "2026-10-31T00:00:00.000Z",
          "processedAt": "2026-10-31T00:00:01.000Z"
        },
        {
          "id": "uuid",
          "conversationId": "uuid",
          "role": "assistant",
          "content": "Olá! Sou a Mariana da Ademicon...",
          "createdAt": "2026-10-31T00:00:05.000Z"
        }
      ]
    }
    ```
  - `404 Not Found`:
    ```json
    { "error": "Conversation not found" }
    ```
  - `500 Internal Server Error`:
    ```json
    { "error": "Failed to fetch conversation messages" }
    ```

---

#### `GET /messages`
- **Descrição:** Lista global de todas as mensagens do sistema ordenadas por `createdAt ASC`.
- **Query Params:** Nenhum.
- **Respostas:**
  - `201 Created` *(Anomalia / Divergência de Implementação)*:
    Retorna código HTTP `201` em requisição `GET` em vez de `200`:
    ```json
    {
      "messages": [
        {
          "id": "uuid",
          "conversationId": "uuid",
          "role": "user",
          "content": "Texto da mensagem",
          "createdAt": "2026-10-31T00:00:00.000Z"
        }
      ]
    }
    ```
  - `500 Internal Server Error`:
    ```json
    { "error": "Failed to fetch messages" }
    ```

---

#### `GET /messages/:id`
- **Descrição:** Busca uma mensagem individual por ID.
- **Parâmetros de Rota (Zod):**
  - `id`: UUID.
- **Respostas:**
  - `201 Created` *(Anomalia / Divergência de Implementação)*:
    Retorna código HTTP `201` em vez de `200` quando encontrada:
    ```json
    {
      "message": {
        "id": "uuid",
        "conversationId": "uuid",
        "role": "user",
        "content": "Texto",
        "createdAt": "2026-10-31T00:00:00.000Z"
      }
    }
    ```
  - `500 Internal Server Error` *(Defeito no Handler de Mensagem Inexistente)*:
    Quando a mensagem não é encontrada, o código executa `reply.code(404).send({ error: "Message not found" })` sem a instrução `return`. O fluxo continua e tenta acessar `message.conversationId`, causando `TypeError: Cannot read properties of undefined` capturado no bloco `catch`, resultando em resposta HTTP `500`:
    ```json
    { "error": "Failed to fetch message" }
    ```

---

#### `GET /appointments`
- **Descrição:** Consulta compromissos agendados com suporte a múltiplos filtros combinados.
- **Query Params (Zod):**
  - `consultantId` (UUID, opcional)
  - `leadId` (UUID, opcional)
  - `status` (enum, opcional): `"pending_confirmation"`, `"confirmed"`, `"expired"`, `"cancelled"`, `"completed"`, `"scheduled"`
  - `startAt` (Date ISO 8601, opcional)
  - `endAt` (Date ISO 8601, opcional)
- **Validações:**
  - Se `startAt` e `endAt` forem fornecidos simultaneamente, `startAt <= endAt`.
- **Respostas:**
  - `200 OK`:
    ```json
    {
      "appointments": [
        {
          "id": "uuid",
          "leadId": "uuid",
          "consultantId": "uuid",
          "externalEventId": "google_event_id_xyz",
          "idempotencyKey": "confirm:uuid",
          "startAt": "2026-11-03T14:00:00.000Z",
          "endAt": "2026-11-03T14:30:00.000Z",
          "status": "confirmed",
          "createdAt": "2026-10-31T00:00:00.000Z"
        }
      ]
    }
    ```
  - `400 Bad Request`:
    ```json
    { "error": "startAt must be earlier than or equal to endAt" }
    ```
  - `500 Internal Server Error`:
    ```json
    { "error": "Failed to fetch appointments" }
    ```

---

#### `GET /appointments/:id`
- **Descrição:** Busca detalhes de um agendamento por ID.
- **Parâmetros de Rota (Zod):**
  - `id`: UUID.
- **Respostas:**
  - `200 OK`:
    ```json
    {
      "appointment": {
        "id": "uuid",
        "leadId": "uuid",
        "consultantId": "uuid",
        "externalEventId": "string",
        "startAt": "2026-11-03T14:00:00.000Z",
        "endAt": "2026-11-03T14:30:00.000Z",
        "status": "confirmed",
        "createdAt": "2026-10-31T00:00:00.000Z"
      }
    }
    ```
  - `404 Not Found`:
    ```json
    { "error": "Appointment not found" }
    ```
  - `500 Internal Server Error`:
    ```json
    { "error": "Failed to fetch appointment" }
    ```

---

#### `GET /appointments/availability`
- **Descrição:** Calcula e lista os horários disponíveis de consultores para atendimento de um lead qualificado dentro de um intervalo de datas.
- **Query Params (Zod):**
  - `leadId` (UUID): ID do lead.
  - `timeMin` (Date ISO 8601): Início da janela de busca.
  - `timeMax` (Date ISO 8601): Fim da janela de busca.
- **Regras de Negócio:**
  - `timeMin` deve ser estritamente anterior a `timeMax`.
  - O lead deve existir no banco de dados.
  - Consulta agendas ativas via integração Google Calendar e exclui horários conflitantes.
- **Respostas:**
  - `200 OK`:
    ```json
    {
      "slots": [
        {
          "consultant": {
            "id": "uuid",
            "name": "Consultor Exemplo",
            "calendarId": "consultor@empresa.com"
          },
          "start": "2026-11-03T14:00:00.000Z",
          "end": "2026-11-03T14:30:00.000Z"
        }
      ]
    }
    ```
  - `400 Bad Request`:
    ```json
    { "error": "timeMin deve ser anterior a timeMax." }
    ```
  - `404 Not Found`:
    ```json
    { "error": "Lead not found" }
    ```
  - `500 Internal Server Error`:
    ```json
    { "error": "Failed to fetch appointment availability" }
    ```

---

#### `POST /appointments`
- **Descrição:** Criação manual e direta de agendamento confirmado no Google Calendar e persistência no banco de dados.
- **Corpo da Requisição (Zod):**
  ```json
  {
    "leadId": "uuid",
    "consultantId": "uuid",
    "startAt": "2026-11-03T14:00:00.000Z",
    "endAt": "2026-11-03T14:30:00.000Z"
  }
  ```
- **Regras de Negócio e Compensação:**
  - Valida se o lead existe e se o consultor existe e está ativo (`active = true`).
  - Cria o evento no Google Calendar com videoconferência Google Meet (`hangoutsMeet`).
  - Grava o registro em `appointments` com `status = 'confirmed'`.
  - Se a inserção no banco falhar, dispara rotina de compensação automática excluindo o evento criado no Google Calendar para evitar eventos órfãos.
- **Respostas:**
  - `201 Created`:
    ```json
    {
      "appointment": {
        "appointmentId": "uuid",
        "consultantId": "uuid",
        "externalEventId": "google_event_id_123",
        "startAt": "2026-11-03T14:00:00.000Z",
        "endAt": "2026-11-03T14:30:00.000Z",
        "status": "confirmed",
        "calendarEvent": {
          "id": "google_event_id_123",
          "htmlLink": "https://calendar.google.com/calendar/event?eid=...",
          "hangoutLink": "https://meet.google.com/abc-defg-hij"
        }
      }
    }
    ```
  - `400 Bad Request`: Erro de intervalo ou validação.
  - `404 Not Found`:
    ```json
    { "error": "Lead not found" }
    ```
    ou
    ```json
    { "error": "Consultor não encontrado." }
    ```
  - `409 Conflict`:
    ```json
    { "error": "O horário selecionado não está mais disponível na agenda do consultor." }
    ```
  - `500 Internal Server Error`: Falha inesperada.

---

## 5. Estrutura do Banco de Dados (Drizzle ORM)

O banco relacional Postgres (Neon) contém 11 tabelas com tipos e enums estritos:

| Tabela | Chave Primária | Índices Chave / Constraints | Propósito |
|---|---|---|---|
| `leads` | `id` (UUID) | `phoneIdx`, `statusIdx`, `unique(source, sourceLeadId)` | Dados cadastrais, qualificação e origem dos clientes |
| `conversations` | `id` (UUID) | `leadIdIdx`, `statusIdx`, FK `leadId -> leads.id (CASCADE)` | Sessão de atendimento WhatsApp (máx 1 ativa por lead) |
| `messages` | `id` (UUID) | `conversationCreatedAtIdx`, `externalIdUniqueIdx`, FK `conversationId (CASCADE)` | Mensagens enviadas/recebidas (`user`, `assistant`, `system`) |
| `consultants` | `id` (UUID) | `activeIdx`, `email (UNIQUE)`, `calendarId (UNIQUE)` | Consultores de consórcio integrados |
| `google_calendar_connections` | `id` (UUID) | `consultantId (UNIQUE)`, FK `consultantId -> consultants.id (CASCADE)` | Tokens OAuth 2.0 (refresh token) para sincronização de agenda |
| `appointments` | `id` (UUID) | `consultantStartIdx`, `leadIdIdx`, `externalEventId (UNIQUE)`, `idempotencyKey (UNIQUE)` | Reuniões agendadas com link do Google Meet |
| `scheduling_sessions` | `id` (UUID) | `unique(leadId) WHERE status = 'active'`, `statusIdx`, `workflowStageIdx` | Sessão ativa de oferta e seleção de horários |
| `scheduling_slots` | `id` (UUID) | `unique(schedulingSessionId, position)`, check `startAt < endAt` | Opções de horários propostos na sessão |
| `whatsapp_webhook_events` | `id` (UUID) | `externalId (UNIQUE)`, `statusLeaseExpiresAtIdx` | Deduplicação e buffer durável de eventos WhatsApp |
| `outbound_messages` | `id` (UUID) | `idempotencyKey (UNIQUE)`, `statusAvailableAtIdx` | Fila Outbox durável para envio confiável ao WhatsApp |
| `autonomous_tasks` | `id` (UUID) | `idempotencyKey (UNIQUE)`, `statusAvailableAtIdx`, `statusLeaseExpiresAtIdx` | Fila assíncrona com leasing e controle de concorrência |

---

## 6. Processamento Assíncrono e Background Workers

Quando `RELIABILITY_WORKERS_ENABLED=true` (padrão), o processo HTTP inicializa dois workers em polling:

1. **`autonomous-task-worker` (`env.AUTONOMOUS_TASK_POLL_MS`, padrão 2000ms):**
   - Reclama tarefas pendentes em lote (`CONVERSATION_BATCH_SIZE = 10`) com token de lease (`leaseToken`) e tempo de expiração.
   - Garante concorrência serializada por conversa: enquanto uma tarefa roda em uma conversa, outra não pode assumi-la.
   - Processa mensagens de entrada (`process_inbound_message`), toques em botões (`process_button_reply`) e confirmações (`send_confirmation_request`).
   - Se ocioso, executa `recoverStaleAutonomousTasks()` recuperando tarefas com leases expiradas.

2. **`outbound-message-worker` (`env.OUTBOUND_MESSAGE_POLL_MS`, padrão 2000ms):**
   - Reclama mensagens na fila outbox (`outbound_messages`) com `status = 'pending'` e `availableAt <= NOW()`.
   - Marca para `sending` com lease.
   - Envia via `whatsAppClient` respeitando a janela de conformidade de 24h e política de opt-out.
   - Em caso de sucesso: marca como `sent` e grava `providerMessageId`.
   - Em caso de falha de rede/timeout: marca como `unknown` (não reenvia cegamente para evitar duplicação no cliente).
   - Se ocioso, executa `recoverStaleOutboundMessages()`.

---

## 7. Mapeamento de Inconsistências e Débitos Técnicos Identificados

Durante a auditoria estrita do código-fonte das rotas, foram identificadas as seguintes discrepâncias contratuais que devem ser corrigidas em ciclo de refatoração:

1. **Retorno de Código HTTP 201 em Rotas `GET`:**
   - `GET /conversations/:id` responde `201 Created` (linha 51 de `src/routes/conversations/get-id-conversations.ts`).
   - `GET /messages` responde `201 Created` (linha 24 de `src/routes/messages/get-messages.ts`).
   - `GET /messages/:id` responde `201 Created` (linha 50 de `src/routes/messages/get-id-messages.ts`).
   *Comportamento esperado:* Resposta com código `200 OK`.

2. **Retorno de Código HTTP 401 em Vez de 404 para Recursos Inexistentes:**
   - `GET /leads/:id` responde `401 Unauthorized` com `{ error: "Lead not found" }` quando o lead não existe (linha 37 de `src/routes/leads/get-id-leads.ts`).
   - `GET /conversations/:id` responde `401 Unauthorized` com `{ error: "Conversation not found" }` quando a conversa não existe (linha 39 de `src/routes/conversations/get-id-conversations.ts`).
   *Comportamento esperado:* Resposta com código `404 Not Found`.

3. **Exceção de Execução (Unhandled Return) em `GET /messages/:id`:**
   - No arquivo `src/routes/messages/get-id-messages.ts` (linhas 29–39), quando a mensagem não existe, o manipulador chama `reply.code(404).send({ error: "Message not found" })` sem o comando `return`. A execução segue para a linha 44 onde `message.conversationId` lança `TypeError: Cannot read properties of undefined`, sendo capturado no bloco `catch` e resultando em status `500 Internal Server Error`.

4. **Objetos de Coluna Drizzle Passados Diretamente para os Logs:**
   - Em `src/routes/conversations/get-id-conversations.ts` (linhas 36, 48), o logger recebe `leadId: conversations.leadId` e `conversationId: conversations.id` (passando as instâncias de definição da coluna da tabela em vez dos valores escalares da linha).
