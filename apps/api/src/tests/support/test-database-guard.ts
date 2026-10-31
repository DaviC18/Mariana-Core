/**
 * Proteção para testes que escrevem no banco. Exige um `TEST_DATABASE_URL`
 * descartável, diferente do `DATABASE_URL` de desenvolvimento, e devolve as
 * variáveis que o processo de teste deve usar.
 */
const LEADING_SLASH = /^\//;
// `URL.hostname` devolve IPv6 entre colchetes.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// `pg-connection-string` (driver do drizzle-kit push) honra chaves da query
// como `host`, `hostaddr` e `port`, que trocam o destino real da conexão.
// Por isso a query é uma allowlist, não uma denylist.
const ALLOWED_TEST_URL_QUERY_KEYS = new Set(["sslmode"]);

export class UnsafeTestDatabaseError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "UnsafeTestDatabaseError";
	}
}

// E-16: sem "//" logo depois do esquema (ou com host vazio, "postgresql:///"),
// o WHATWG URL põe o userinfo no pathname, e as mensagens que citam
// `databaseIdentity` mostrariam a senha. Recusa antes de qualquer mensagem.
const SCHEME_WITH_AUTHORITY = /^[a-z][a-z\d+.-]*:\/\//i;

function parsePostgresUrl(name: string, value: string): URL {
	if (!SCHEME_WITH_AUTHORITY.test(value)) {
		throw new UnsafeTestDatabaseError(`${name} must be a postgresql:// URL`);
	}
	// E-16b: um "/", "?" ou "#" cru na senha encerra a autoridade antes do "@"
	// (`u:1234/resto@host` vira host `u`, porta 1234), e o resto da senha cai no
	// caminho ou na query, que as mensagens citam. Recusa com texto constante.
	const afterScheme = value.slice(value.indexOf("://") + 3);
	const authorityEnd = afterScheme.search(AUTHORITY_END);
	if (authorityEnd !== -1 && afterScheme.slice(authorityEnd).includes("@")) {
		throw new UnsafeTestDatabaseError(
			`${name} has an "@" after its host. Write "/", "?", "#" and "@" in the password as %2F, %3F, %23 and %40.`
		);
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch (error) {
		// O TypeError de `new URL` guarda a URL inteira (com a senha) em `input`.
		if (error instanceof TypeError && "input" in error) {
			error.input = undefined;
		}
		throw new UnsafeTestDatabaseError(`${name} is not a valid URL`, {
			cause: error,
		});
	}
	if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
		throw new UnsafeTestDatabaseError(`${name} must be a postgresql:// URL`);
	}
	if (!url.hostname) {
		throw new UnsafeTestDatabaseError(
			`${name} must name a host (for example postgresql://user:password@localhost:5432/db).`
		);
	}
	return url;
}

// E-4: o postgres.js lê a autoridade do texto cru (depois de "://", até o
// primeiro "/" ou "?"), corta o userinfo no PRIMEIRO "@", decodifica o resto e
// trata "," como lista de hosts. O WHATWG URL corta no ÚLTIMO "@". Recusa toda
// URL que os dois leriam com hosts diferentes. Regra estrutural: não chama o
// parser de nenhum driver. As mensagens nunca mostram o userinfo.
const AUTHORITY_END = /[/?#]/;
const PORT_SUFFIX = /:\d*$/;
const SINGLE_PATH_SEGMENT = /^\/[^/]+$/;

// E-11: o WHATWG URL apara espaços e mantém %xx no caminho; o pg re-codifica
// (encodeURI) e decodifica o caminho. Por isso a checagem usa o texto cru,
// antes de `new URL`. `%` continua valendo no userinfo (senha com %40).
const WHITESPACE = /\s/;
const PATH_END = /[?#]/;

function assertNoAmbiguousCharacters(name: string, value: string) {
	const hasControl = [...value].some((char) => {
		const code = char.charCodeAt(0);
		return code <= 0x1f || code === 0x7f;
	});
	if (hasControl || WHITESPACE.test(value)) {
		throw new UnsafeTestDatabaseError(
			`${name} contains whitespace or a control character. Drivers read such URLs differently; remove it (check for quotes or trailing spaces in .env).`
		);
	}
	const schemeEnd = value.indexOf("://");
	if (schemeEnd === -1) {
		return;
	}
	const rest = value.slice(schemeEnd + 3);
	const authorityEnd = rest.search(AUTHORITY_END);
	const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
	const host = authority.slice(authority.indexOf("@") + 1);
	const [path] = (authorityEnd === -1 ? "" : rest.slice(authorityEnd)).split(
		PATH_END
	);
	if (host.includes("%") || path.includes("%")) {
		throw new UnsafeTestDatabaseError(
			`${name} has a "%" in its host or database name. Drivers decode it differently; write the host and database plainly.`
		);
	}
}

function assertDriverReadsSameHost(name: string, value: string, url: URL) {
	const schemeEnd = value.indexOf("://");
	const [authority] = (
		schemeEnd === -1 ? "" : value.slice(schemeEnd + 3)
	).split(AUTHORITY_END);
	if (authority.split("@").length > 2) {
		throw new UnsafeTestDatabaseError(
			`${name} has more than one "@" in its authority. Drivers split it differently; write an "@" in the password as %40.`
		);
	}
	let driverHost: string;
	try {
		driverHost = decodeURIComponent(
			authority.slice(authority.indexOf("@") + 1)
		);
	} catch (error) {
		throw new UnsafeTestDatabaseError(
			`${name} has an invalid percent-encoding in its host.`,
			{ cause: error }
		);
	}
	if (driverHost.includes(",") || driverHost.includes("@")) {
		throw new UnsafeTestDatabaseError(
			`${name} must name a single host. A "," or "@" in the host makes postgres.js read a host list.`
		);
	}
	if (
		driverHost.replace(PORT_SUFFIX, "").toLowerCase() !==
		url.hostname.toLowerCase()
	) {
		throw new UnsafeTestDatabaseError(
			`${name} host is read differently by the Postgres drivers. Write the host plainly, without percent-encoding.`
		);
	}
}

function databaseIdentity(url: URL): string {
	const port = url.port || "5432";
	const database = url.pathname.replace(LEADING_SLASH, "") || "postgres";
	return `${url.hostname.toLowerCase()}:${port}/${database}`;
}

// Só para comparar "mesmo banco": os aliases de loopback viram um token.
// `describeDatabaseHost` continua mostrando o host como foi escrito.
function comparableDatabaseIdentity(url: URL): string {
	const host = url.hostname.toLowerCase();
	const port = url.port || "5432";
	const database = url.pathname.replace(LEADING_SLASH, "") || "postgres";
	return `${LOCAL_HOSTS.has(host) ? "loopback" : host}:${port}/${database}`;
}

export function describeDatabaseHost(value: string): string {
	return databaseIdentity(parsePostgresUrl("database URL", value));
}

/**
 * Regras de URL de banco de teste, comuns a resolveTestDatabaseEnv,
 * assertAppliedTestDatabaseEnv e isForbiddenTestConnection: obrigatória,
 * postgresql://, nunca neon.tech, query só com sslmode, um só host lido igual
 * pelos drivers, host local (ou ALLOW_REMOTE_TEST_DB=1), porta e banco
 * explícitos. `name` é a variável citada nas mensagens. Pura, exceto pelo aviso
 * de host remoto liberado.
 */
export function assertSafeTestDatabaseUrl(
	name: string,
	value: string | undefined,
	source: { ALLOW_REMOTE_TEST_DB?: string }
): URL {
	if (!value) {
		throw new UnsafeTestDatabaseError(
			`${name} is required for DB tests. Point it at a disposable local Postgres database.`
		);
	}

	assertNoAmbiguousCharacters(name, value);
	const parsedTestUrl = parsePostgresUrl(name, value);
	if (parsedTestUrl.hostname.toLowerCase().includes("neon.tech")) {
		throw new UnsafeTestDatabaseError(
			`${name} points at neon.tech. DB tests reset the database, so they only run against a local disposable Postgres.`
		);
	}
	for (const key of parsedTestUrl.searchParams.keys()) {
		if (!ALLOWED_TEST_URL_QUERY_KEYS.has(key)) {
			throw new UnsafeTestDatabaseError(
				`${name} has a "${key}" query parameter. Only sslmode is allowed, because other keys can redirect the connection.`
			);
		}
	}
	assertDriverReadsSameHost(name, value, parsedTestUrl);
	const testIdentity = databaseIdentity(parsedTestUrl);
	const isLocal = LOCAL_HOSTS.has(parsedTestUrl.hostname.toLowerCase());
	if (!isLocal && source.ALLOW_REMOTE_TEST_DB !== "1") {
		throw new UnsafeTestDatabaseError(
			`${name} points at a non-local host (${testIdentity}). DB tests reset the database, so they only run against localhost, 127.0.0.1 or ::1. Set ALLOW_REMOTE_TEST_DB=1 to override.`
		);
	}
	// E-5: sem porta ou banco explícitos, pg e postgres.js usam PGPORT /
	// PGDATABASE do ambiente, não o 5432/postgres de `databaseIdentity`.
	if (!parsedTestUrl.port) {
		throw new UnsafeTestDatabaseError(
			`${name} must name its port explicitly (for example localhost:5432), because the drivers otherwise take PGPORT.`
		);
	}
	if (!SINGLE_PATH_SEGMENT.test(parsedTestUrl.pathname)) {
		throw new UnsafeTestDatabaseError(
			`${name} must name exactly one database in its path (for example /mariana_test), because the drivers otherwise take PGDATABASE.`
		);
	}
	if (!isLocal) {
		console.warn(
			`[test-database-guard] WARNING: ALLOW_REMOTE_TEST_DB=1 — DB tests will RESET the remote database ${testIdentity}.`
		);
	}
	return parsedTestUrl;
}

function checkTestDatabaseUrl(source: NodeJS.ProcessEnv): {
	parsedTestUrl: URL;
	testUrl: string;
} {
	const testUrl = source.TEST_DATABASE_URL;
	const parsedTestUrl = assertSafeTestDatabaseUrl(
		"TEST_DATABASE_URL",
		testUrl,
		source
	);
	return { parsedTestUrl, testUrl: testUrl as string };
}

const TEST_ENTRY_BASENAME = /\.test\.[cm]?[jt]sx?$/;
const PATH_SEPARATOR = /[\\/]/;

/**
 * Step 20 (E-12): o script de entrada `argv[1]` marca um processo de teste
 * quando o nome termina em `.test.*` ou o caminho tem os segmentos `src/tests`
 * (separadores `/` e `\`). Cobre `tsx x.test.ts` e o "Run file" de IDE.
 */
function isTestEntryScript(entry: string | undefined): boolean {
	if (!entry) {
		return false;
	}
	const segments = entry.split(PATH_SEPARATOR);
	const baseName = segments.at(-1) ?? "";
	if (TEST_ENTRY_BASENAME.test(baseName)) {
		return true;
	}
	return segments.some(
		(segment, index) => segment === "src" && segments[index + 1] === "tests"
	);
}

/**
 * Step 16: usado por `src/db/connections.ts` antes de abrir a conexão. Um
 * processo de teste é um com NODE_TEST_CONTEXT (filho do test runner, que tira
 * `--test` do execArgv), com `--test` em execArgv/argv, ou (step 20) cujo
 * script de entrada `argv[1]` é um arquivo de teste (ver `isTestEntryScript`).
 * Nele a URL precisa passar `assertSafeTestDatabaseUrl`; ALLOW_REMOTE_TEST_DB=1
 * libera host remoto, nunca neon.tech. Fora de testes, nunca recusa. Pura.
 */
export function isForbiddenTestConnection(input: {
	argv: readonly string[];
	env: { ALLOW_REMOTE_TEST_DB?: string; NODE_TEST_CONTEXT?: string };
	execArgv: readonly string[];
	url: string;
}): boolean {
	const isTestProcess =
		Boolean(input.env.NODE_TEST_CONTEXT) ||
		input.execArgv.includes("--test") ||
		input.argv.includes("--test") ||
		isTestEntryScript(input.argv[1]);
	if (!isTestProcess) {
		return false;
	}
	try {
		assertSafeTestDatabaseUrl("DATABASE_URL", input.url, input.env);
		return false;
	} catch (error) {
		if (error instanceof UnsafeTestDatabaseError) {
			return true;
		}
		throw error;
	}
}

export function resolveTestDatabaseEnv(source: NodeJS.ProcessEnv): {
	DATABASE_URL: string;
	NODE_ENV: "test";
	RELIABILITY_WORKERS_ENABLED: "false";
} {
	const { parsedTestUrl, testUrl } = checkTestDatabaseUrl(source);
	const testIdentity = databaseIdentity(parsedTestUrl);

	const devUrl = source.DATABASE_URL;
	if (devUrl) {
		const devIdentity = comparableDatabaseIdentity(
			parsePostgresUrl("DATABASE_URL", devUrl)
		);
		if (devIdentity === comparableDatabaseIdentity(parsedTestUrl)) {
			throw new UnsafeTestDatabaseError(
				`TEST_DATABASE_URL points at the same database as DATABASE_URL (${testIdentity}). Refusing to run DB tests.`
			);
		}
	}

	if (source.RELIABILITY_WORKERS_ENABLED === "true") {
		throw new UnsafeTestDatabaseError(
			"RELIABILITY_WORKERS_ENABLED=true is not allowed in test runs."
		);
	}

	return {
		DATABASE_URL: testUrl,
		NODE_ENV: "test",
		RELIABILITY_WORKERS_ENABLED: "false",
	};
}

/**
 * Valida e grava no próprio `source` (em geral `process.env`) as variáveis de
 * teste, para que nada no processo continue enxergando o `DATABASE_URL` de
 * desenvolvimento. Se a validação recusar, `source` não é alterado.
 */
export function applyTestDatabaseEnv(
	source: NodeJS.ProcessEnv
): ReturnType<typeof resolveTestDatabaseEnv> {
	const resolved = resolveTestDatabaseEnv(source);
	Object.assign(source, resolved);
	return resolved;
}

/**
 * Para o filho `drizzle-kit push` (`drizzle.test.config.ts`): exige que o
 * ambiente já tenha sido gravado por `applyTestDatabaseEnv` — `DATABASE_URL`
 * igual ao `TEST_DATABASE_URL`, `NODE_ENV=test` e workers desligados — e aplica
 * as mesmas regras de URL. Rodar a config com o `DATABASE_URL` do `.env` é
 * recusado. Devolve a URL de teste.
 */
export function assertAppliedTestDatabaseEnv(
	source: NodeJS.ProcessEnv
): string {
	const { testUrl } = checkTestDatabaseUrl(source);
	if (source.DATABASE_URL !== testUrl) {
		throw new UnsafeTestDatabaseError(
			"DATABASE_URL is not the applied TEST_DATABASE_URL. Run the test schema push only through setup-test-db.ts."
		);
	}
	if (source.NODE_ENV !== "test") {
		throw new UnsafeTestDatabaseError(
			"NODE_ENV must be test in an applied test database env."
		);
	}
	if (source.RELIABILITY_WORKERS_ENABLED !== "false") {
		throw new UnsafeTestDatabaseError(
			"RELIABILITY_WORKERS_ENABLED must be false in an applied test database env."
		);
	}
	return testUrl;
}
