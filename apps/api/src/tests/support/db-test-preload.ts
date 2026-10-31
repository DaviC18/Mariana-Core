// Carregado via `tsx --import` antes de qualquer arquivo de teste. Troca o
// `DATABASE_URL` pelo `TEST_DATABASE_URL` antes de `src/env.ts` ser lido, e
// aborta se o banco de teste não for seguro. Também troca as credenciais
// externas por valores falsos.
// Depende de `src/env.ts` carregar o `.env` com `override: false` (padrão do
// dotenv): os valores gravados aqui vencem. Provado por
// `src/tests/test-env-isolation.test.ts`.
import "dotenv/config";

import { FAKE_EXTERNAL_ENV } from "./fake-external-env";
import {
	describeDatabaseHost,
	resolveTestDatabaseEnv,
} from "./test-database-guard";
import { installTestNetworkGuard } from "./test-network-egress-guard";

const overrides = resolveTestDatabaseEnv(process.env);
Object.assign(process.env, FAKE_EXTERNAL_ENV, overrides);
installTestNetworkGuard(process.env);

if (!process.env.DB_TEST_PRELOAD_LOGGED) {
	process.env.DB_TEST_PRELOAD_LOGGED = "1";
	console.error(
		`[db-test-guard] using test database ${describeDatabaseHost(overrides.DATABASE_URL)}`
	);
}
