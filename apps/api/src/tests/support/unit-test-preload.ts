// Carregado via `tsx --import` em `npm run test:unit`. Aponta `DATABASE_URL`
// para um endereço inalcançável antes de `src/env.ts` ler o `.env`: um teste
// "unitário" que tocar o banco falha em vez de alcançar o Neon.
// Depende de `src/env.ts` carregar o `.env` com `override: false` (padrão do
// dotenv): os valores gravados aqui vencem. Provado por
// `src/tests/test-env-isolation.test.ts`.
import { FAKE_EXTERNAL_ENV } from "./fake-external-env";
import { installTestNetworkGuard } from "./test-network-egress-guard";

Object.assign(process.env, FAKE_EXTERNAL_ENV, {
	DATABASE_URL: "postgresql://unit-tests-have-no-database@127.0.0.1:1/none",
	NODE_ENV: "test",
	RELIABILITY_WORKERS_ENABLED: "false",
});

installTestNetworkGuard(process.env);
