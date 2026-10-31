/**
 * Marca em memória das conexões do Google Calendar quebradas (`invalid_grant`)
 * — 2026-10-27-scheduling-loop, passo 5. Sem migração ainda (F-3): a marca vale
 * só neste processo e só enquanto o `updatedAt` da linha for o mesmo de quando
 * foi marcada. A reautorização faz upsert de `updatedAt`
 * (`auth-google.ts`), então o consultor volta sem reinício.
 *
 * Nunca escreve no banco nem guarda token: só connectionId → updatedAt (ms).
 */
const brokenConnections = new Map<string, number>();

/** `true` quando a conexão não estava marcada com este `updatedAt`. */
export function markBroken(connectionId: string, updatedAtMs: number): boolean {
	const isNew = brokenConnections.get(connectionId) !== updatedAtMs;
	brokenConnections.set(connectionId, updatedAtMs);
	return isNew;
}

export function isBroken(connectionId: string, updatedAtMs: number): boolean {
	const markedAt = brokenConnections.get(connectionId);

	if (markedAt === undefined) {
		return false;
	}

	if (markedAt !== updatedAtMs) {
		// Linha reautorizada depois da marca: a conexão volta ao sorteio.
		brokenConnections.delete(connectionId);
		return false;
	}

	return true;
}

export function resetForTests(): void {
	brokenConnections.clear();
}
