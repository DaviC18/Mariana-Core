# Batch E — Revisão 3 (passos 20 e 21): explicação para o Davi

## 1. O que eu entendi do problema

O guard do passo 16 só sabe que está num teste quando vê `NODE_TEST_CONTEXT` ou `--test`. Se alguém roda um arquivo de teste direto (`npx tsx src/tests/x.test.ts`, ou "Run file" da IDE sem `--test`), nenhum dos dois aparece e nenhum preload roda. Aí o `src/env.ts` lê o `.env` e o `connections.ts` abre o `DATABASE_URL` real, que é o Neon (E-12, risco médio e real hoje). Além disso, o `pg` (usado pelo drizzle-kit push) lê 3 formatos de URL de um jeito diferente do guard: espaço no começo, espaço no fim e `%xx` no nome do banco (E-11, risco baixo).

## 2. O que eu vou fazer

**Passo 20 (lote E-R3a) — arquivo de teste rodado direto também conta como teste.**
- O que muda: `isForbiddenTestConnection` passa a olhar também o script de entrada (`process.argv[1]`). Se o nome do arquivo termina em `.test.ts`/`.test.js`/`.test.mjs` etc., ou se o caminho dele está em `src/tests/`, o processo é tratado como teste. Então só um banco local de teste é aceito. No `connections.ts` só o comentário muda.
- Por que: é o único sinal que existe numa execução direta. Pesei as alternativas:
  - `NODE_ENV=test` não aparece nessa execução, e se alguém subir a produção com ele, o bot para.
  - Detectar que o `node:test` foi carregado depende de detalhes internos do Node.
  - Refazer o acesso ao banco em todos os testes é grande demais para esse risco.
  - Na produção, a entrada é `dist/server.js` (ou `src/server.ts` no dev), que não bate com nenhuma das duas regras. Um teste fixa isso.
- O que o cliente percebe no WhatsApp: nada. A mudança só pega processos de teste.

**Passo 21 (lote E-R3b) — recusar as 3 formas que o `pg` lê diferente.**
- O que muda: antes de interpretar a URL, o guard recusa qualquer espaço ou caractere de controle. Também recusa `%` no host e no nome do banco. `%40` na senha continua valendo.
- Por que: é barato (uma checagem no texto cru), só deixa a regra mais rígida e garante "uma URL, um alvo" para os dois drivers.
- O que o cliente percebe no WhatsApp: nada.

## 3. O que NÃO vou mexer

- Os passos já feitos (12 a 19): nem o texto, nem o código.
- `src/env.ts`, `fake-external-env.ts`, os preloads e o guard de rede.
- Nenhum código de produto, a não ser o comentário do `connections.ts`.
- Os arquivos do lote E-R2c, que o tester está verificando agora. A exceção são os dois testes `todo` fixados (E-11 e E-12), que perdem o `todo`.

## 4. Riscos

- **O que ainda escapa do passo 20:** um script "wrapper" próprio que importa arquivos de teste, e `node -e`/REPL. Fica listado.
- **Disparo falso:** se a produção for iniciada com o argumento `--test`, o guard recusa o Neon e o bot não sobe. Isso já existia no passo 16. Nenhum script do repo faz isso. Só listado.
- **E-12b (novo):** um teste rodado direto que não importa o banco fica com as credenciais reais do `.env` e sem o guard de rede. Testes de banco param antes, no import. Fica listado, ver decisão 3.
- **Passo 21:** se o seu `TEST_DATABASE_URL` tiver espaço (por exemplo, entre aspas), o próximo `npm run test:db` recusa com uma mensagem clara. Nada é apagado.
- **Também listados, sem passo:** os pontos cegos da regex de credencial (`_V2`, `*_PASSWORD`, `*_DSN`), E-9 (Workers) e E-9b (processos filhos).
- **Como vamos perceber:** o tester roda o arquivo direto num diretório temporário, com um `.env` falso apontando para um host `neon.tech` falso, e espera a recusa. Depois roda `test:unit` e `test:db`.

## 5. Decisões que preciso de você

1. Gatilho do E-12. **Recomendo** arquivo `*.test.*` **ou** dentro de `src/tests/`. As outras opções são só `*.test.*`, ou somar `NODE_ENV=test`, que não recomendo porque pode parar o bot.
2. E-11. **Recomendo** fazer o passo 21 agora, ou ele fica só listado?
3. E-12b. **Recomendo** listar agora e decidir depois. A alternativa é um passo que mexe em código de produto (`src/env.ts`), que você recusou na revisão 2.
4. Ordem. **Recomendo** o passo 20 assim que sair o relatório do E-R2c, depois o passo 21, com o tester verificando cada lote.

## 6. Pedido de permissão

Posso seguir com este plano? Responda: aprovo / aprovo com mudanças (diga quais) / não aprovo.
