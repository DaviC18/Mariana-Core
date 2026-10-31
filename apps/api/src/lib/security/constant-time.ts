import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string): Buffer {
	return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Compara dois segredos em tempo constante. Os dois lados viram SHA-256
 * (32 bytes) antes do `timingSafeEqual`: o tamanho da entrada não vaza e a
 * comparação nunca lança por tamanho diferente.
 */
export function safeEqual(given: string, expected: string): boolean {
	if (typeof given !== "string" || typeof expected !== "string") {
		return false;
	}
	return timingSafeEqual(digest(given), digest(expected));
}
