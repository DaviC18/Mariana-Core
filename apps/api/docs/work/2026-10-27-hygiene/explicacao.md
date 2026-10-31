# Explicação — 2026-10-27-hygiene

## 1. O que eu entendi do problema
O flow-review terminou com PASS, mas deixou uma lista de pendências pequenas. Uma spec antiga ainda descreve a pergunta de preferência de consultor, e o ROADMAP está incompleto. O AC15 da escolha de sessão nunca foi fechado, e o findings.md nunca foi escrito. Há também três testes que falham de vez em quando por azar, e um comportamento novo (R-V3c-1) que precisa da sua decisão. Nenhuma dessas tarefas muda o que o cliente vê.

## 2. O que eu vou fazer

**Lote 1 (só documentação)**
1. **Spec de agendamento (D-3).** Reescrevo D3, a linha 80 e os AC3–AC5 de acordo com a R-SCH-01 v1.4: o sistema sorteia o consultor, não existe pergunta de preferência e o caminho é aceite → horários → Confirmar/Não → confirmação. A transcrição de produção e o histórico das causas (linhas 21, 45 e 49) ficam como estão. O texto exato está no plan.md, passo 1.
   - *Cliente:* nada muda. A spec só passa a descrever o que o código já faz.
2. **ROADMAP.** A D-10 passa a citar "spec v1.4". O pacote D ganha a nota do N-1 (passo 21). Os pacotes F e G ganham as notas da Rev1: fechar conversas paradas não é mais necessário para o sistema funcionar certo, e o índice único continua desejado.
   - *Cliente:* nada muda.
3. **AC15.** Acrescento uma "nota de fechamento" no final do plan.md e do test-report.md da escolha de sessão: o AC15 e o GAP-2 ficaram obsoletos. Não apago nenhum histórico. Procurei outras referências mortas e não achei nada importante no CLAUDE.md, no CODEMAP nem na spec. Sobra só um prefixo de id num teste, que entra no passo 6.

**Lote 2 (só testes)**
4. **Falso "telefone" no rastro.** O teste procura 11 dígitos seguidos na linha do rastro. Às vezes um UUID aleatório tem 11 dígitos seguidos, e o teste falha à toa. Descobri que os hashes de 12 caracteres do rastro causam o mesmo problema (cerca de 0,8 % de chance por campo). Por isso, só tirar os UUIDs não resolve. Vou criar um helper que remove os UUIDs e os valores das chaves de hash antes da checagem. Um telefone verdadeiro em qualquer outro campo continua sendo pego. Para provar a falha, vou forçar um lead com um id que termina em `012345678901`: o teste fica vermelho, e depois passa com o helper.
5. **Teste do executor (:275).** A recuperação de lease vencido vale para o banco inteiro, e os arquivos de teste rodam em paralelo. Às vezes outro arquivo recupera as tarefas deste teste antes dele, a contagem dá 0 e o teste falha. A correção é conferir as linhas do próprio teste em vez da contagem global. Para provar a falha, crio um teste que simula "outro worker recuperou antes", e ele fica vermelho.

**Lote 3**
6. **Ids falsos únicos.** Os senders e os calendários falsos montam ids com `Date.now()` ou com um valor fixo. Esses ids vão para colunas únicas (`messages.externalId` e `appointments.externalEventId`). Vou criar um `uniqueFakeId` com `randomUUID`. Para provar a falha, congelo o relógio no teste e mostro que dois ids saem iguais.
7. **findings.md do flow-review.** Recomendo escrever, sim: uma tabela única com todos os F2-xx, F-xx e E-xx e o status de cada um (corrigido / aberto / obsoleto / aceito). Só junto o que já está no plan.md e no test-report.md, sem análise nova. Nesta rodada não pude escrever: o meu ambiente proíbe criar arquivos de "findings/relatório". Por isso ficou como passo.

**Biome:** não há mais nada para corrigir. `biome check src scripts` passa limpo, e os arquivos antigos da escolha de sessão foram apagados. Os únicos erros estão nos `repro` não versionados da tarefa scheduling-loop, que é outra tarefa.

**8. R-V3c-1 (precisa da sua decisão).** O caso: o cliente toca um botão na conversa A, a tarefa desse toque falha, e o WhatsApp reenvia o mesmo toque 4h ou mais depois, com A ainda ativa.
- **Antes (até o passo 39):** o reenvio era tratado como um toque novo. A era fechada, a conversa B era aberta, e o cliente recebia "Oi! Já faz um tempo desde a nossa última conversa, então aqueles horários não valem mais. Me conta o que você procura agora?".
- **Agora:** o reenvio fica em A, onde o toque foi tratado. O cliente recebe uma única vez "Esse botão é de uma mensagem antiga…" com os botões da etapa atual. A não fecha, e o horário da última mensagem de A passa a ser "agora". Por isso, se o cliente escrever nas próximas 4h, a conversa continua em A, com o estado antigo.
- **Minha recomendação: manter como está (A).** Segue a spec v1.4 ("o reenvio não abre conversa nova", S-22) e trata texto e toque do mesmo jeito. O caso também é raro: precisa de uma tarefa falhada e de um reenvio da Meta horas depois. Se quiser, acrescento uma frase na S-22 dizendo que a regra vale também para toques.

## 3. O que NÃO vou mexer
Código de produto em `src/` (fora de `src/tests/`), prompt, migrations, Neon, `.env`, `.claude/` e `CLAUDE.md`. O texto de "sessão expirada → nova oferta" (D4/AC6) também fica como está, porque é do pacote B. Também não mexo nas outras pendências da tabela: F2-05, mídia, pacotes B/C2/D/E e os SELECTs do E3-a.

## 4. Riscos
- O helper do passo 4 pode remover demais e esconder um telefone de verdade. Os testes de controle (um telefone em outro campo continua sendo detectado) mostram isso.
- O passo 5 deixa de conferir a contagem que a função devolve. É uma perda pequena, porque o efeito real (o status de cada linha) continua sendo conferido. Em paralelo, essa contagem não é confiável de qualquer forma.
- Se algum teste do passo 6 comparar o id fixo, ele pode quebrar. Vamos perceber rodando cada arquivo sozinho.
- Passos 1 a 3: mudam só texto, e o risco é o texto ficar errado. Por isso o texto exato está no plano para você aprovar.

## 5. Decisões que preciso de você
- **Q1 (R-V3c-1):** A) manter como está *(recomendado)*; B) continuar em A, mas sem atualizar o horário da última mensagem no reenvio; C) voltar a abrir B e mandar o texto de "já faz um tempo". B e C mudam o comportamento, então viram outra tarefa, com spec própria.
- **Q2:** aprova o texto exato dos passos 1, 2 e 3 (e a frase da S-22, se escolher A com a nota)? *(recomendado: sim)*
- **Q3:** quem escreve o findings.md: o planner numa nova rodada *(recomendado)* ou o implementer?

## 6. Pedido de permissão
Posso seguir com este plano? Responda: aprovo / aprovo com mudanças (diga quais) / não aprovo.
