/** biome-ignore-all lint/performance/noAwaitInLoops: polling do pg_stat_activity */
import { sql } from "drizzle-orm";

import { db } from "../../db/connections";

type Executor = Pick<typeof db, "execute">;

/** PID do backend Postgres desta transação/conexão. */
export async function backendPid(executor: Executor): Promise<number> {
	const rows = (await executor.execute(
		sql`select pg_backend_pid() as pid`
	)) as unknown as { pid: number }[];
	const pid = rows[0]?.pid;
	if (typeof pid !== "number") {
		throw new Error("pg_backend_pid() returned no row");
	}
	return pid;
}

/**
 * Espera até um backend estar realmente bloqueado num lock (pg_stat_activity /
 * pg_blocking_pids), em vez de dormir um tempo fixo. Devolve o PID bloqueado.
 *
 * - `blockedBy`: o backend bloqueado espera esse PID.
 * - `blockedByAnyBlockedBy`: o backend espera algum backend que está bloqueado
 *   por esse PID (cadeia de 2 elos).
 */
export async function waitForLockWait(
	target: { blockedBy: number } | { blockedByAnyBlockedBy: number },
	{ timeoutMs = 10_000 }: { timeoutMs?: number } = {}
): Promise<number> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const rows = ("blockedBy" in target
			? await db.execute(sql`
						select a.pid from pg_stat_activity a
						where a.wait_event_type = 'Lock'
							and ${target.blockedBy}::int = any(pg_blocking_pids(a.pid))
						limit 1`)
			: await db.execute(sql`
						select a.pid from pg_stat_activity a
						where a.wait_event_type = 'Lock'
							and exists (
								select 1 from pg_stat_activity b
								where b.wait_event_type = 'Lock'
									and ${target.blockedByAnyBlockedBy}::int = any(pg_blocking_pids(b.pid))
									and b.pid = any(pg_blocking_pids(a.pid))
							)
						limit 1`)) as unknown as { pid: number }[];
		const pid = rows[0]?.pid;
		if (typeof pid === "number") {
			return pid;
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`no backend blocked as expected: ${JSON.stringify(target)}`);
}

/** SQLSTATE de um erro do driver, seguindo `cause`. */
export function sqlStateOf(error: unknown): string | undefined {
	let current = error as { cause?: unknown; code?: string } | undefined;
	while (current) {
		if (current.code) {
			return current.code;
		}
		current = current.cause as typeof current;
	}
	return undefined;
}
