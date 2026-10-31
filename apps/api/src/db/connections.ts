/** biome-ignore-all assist/source/organizeImports: <> */
import { relations } from "./schema/relations";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "../env";
import {
	isForbiddenTestConnection,
	UnsafeTestDatabaseError,
} from "../tests/support/test-database-guard";

// Num processo de teste (NODE_TEST_CONTEXT, --test, ou um arquivo de teste
// como script de entrada), recusa um DATABASE_URL que não seja um banco de
// teste local. Fora de testes não interfere.
if (
	isForbiddenTestConnection({
		argv: process.argv,
		env: process.env,
		execArgv: process.execArgv,
		url: env.DATABASE_URL,
	})
) {
	throw new UnsafeTestDatabaseError(
		"DATABASE_URL is not a local test database, and this is a test process. Refusing to connect. Set TEST_DATABASE_URL and use the test preloads."
	);
}

const sql = postgres(env.DATABASE_URL);

export const db = drizzle({ client: sql, relations });

export async function closeDatabase(): Promise<void> {
	await sql.end({ timeout: 5 });
}
