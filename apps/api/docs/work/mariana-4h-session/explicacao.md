# Explicação do plano — Alterar regra de sessão para inatividade de 4 horas

## O que eu entendi do problema
Hoje a regra pergunta "continuar ou começar nova conversa" quando passa **mais de 24 horas** sem mensagem do cliente na conversa ativa. Precisa mudar para **4 horas**.

## O que vou fazer
1. **Mudar o tempo de inatividade**
- Arquivo: `src/services/conversations/session-choice-policy.ts`
- Mudo `SESSION_INACTIVITY_MS` de 24h para 4h
- Atualizo o texto da pergunta para dizer "mais de 4 horas"

2. **Atualizar testes da política**
- Arquivo: `src/tests/session-choice-policy.test.ts`
- Ajusto testes que esperam 24h para esperarem 4h
- Atualizo a asserção do texto da pergunta

3. **Verificar outros testes**
- Olho testes relacionados a session-choice. Se algum assumir 24h explicitamente, ajusto só se necessário.

## O que NÃO vou mexer
- Janela de 24h do WhatsApp (`whatsapp-compliance.ts`)
- Fluxo de escolha de sessão (botões, handlers, store)
- Banco de dados/migrações
- Outros arquivos

## Riscos
- Se algum teste antigo assumir 24h e não for pego, pode quebrar. Vou rodar o teste unitário da política.
- Textos em outros lugares? Só a pergunta tem "24 horas" hardcoded.

## Decisões que preciso de você
- Nenhuma decisão bloqueante. Só confirmar se quer manter o resto igual.

## Pedido de permissão
Posso seguir com este plano? Responda: aprovo / aprovo com mudanças (diga quais) / não aprovo.
