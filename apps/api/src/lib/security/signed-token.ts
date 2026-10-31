import { createHmac, randomBytes } from "node:crypto";

import { safeEqual } from "./constant-time";

/**
 * Token curto assinado com HMAC-SHA256: `base64url(JSON).base64url(hmac)`.
 * O payload sempre carrega `purpose`, `nonce`, `iat` e `exp` (ms). Cada
 * finalidade usa uma chave própria derivada de `APP_SIGNING_SECRET`, então
 * um token de uma finalidade nunca vale em outra.
 */
export interface SignedTokenPayload {
	exp: number;
	iat: number;
	nonce: string;
	purpose: string;
	[field: string]: unknown;
}

export interface SignOptions {
	now?: () => number;
	ttlMs: number;
}

const MAX_TOKEN_LENGTH = 2048;

export function deriveSigningKey(secret: string, purpose: string): Buffer {
	return createHmac("sha256", secret)
		.update(`mariana:signed-token:${purpose}`)
		.digest();
}

export function randomNonce(): string {
	return randomBytes(32).toString("base64url");
}

function sign(key: Buffer, body: string): string {
	return createHmac("sha256", key).update(body).digest("base64url");
}

export function signToken(
	key: Buffer,
	purpose: string,
	data: Record<string, string>,
	{ now = Date.now, ttlMs }: SignOptions
): { payload: SignedTokenPayload; token: string } {
	const iat = now();
	const payload: SignedTokenPayload = {
		...data,
		exp: iat + ttlMs,
		iat,
		nonce: randomNonce(),
		purpose,
	};
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return { payload, token: `${body}.${sign(key, body)}` };
}

/** `null` para qualquer falha: formato, assinatura, finalidade ou validade. */
export function verifyToken(
	token: unknown,
	key: Buffer,
	purpose: string,
	now: () => number = Date.now
): SignedTokenPayload | null {
	if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) {
		return null;
	}
	const parts = token.split(".");
	if (parts.length !== 2) {
		return null;
	}
	const [body, signature] = parts as [string, string];
	if (!(body && signature && safeEqual(signature, sign(key, body)))) {
		return null;
	}
	let payload: unknown;
	try {
		payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
	} catch {
		return null;
	}
	if (!isPayload(payload) || payload.purpose !== purpose) {
		return null;
	}
	const current = now();
	if (current >= payload.exp || payload.iat > current) {
		return null;
	}
	return payload;
}

function isPayload(value: unknown): value is SignedTokenPayload {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		typeof record.purpose === "string" &&
		typeof record.nonce === "string" &&
		record.nonce.length > 0 &&
		Number.isFinite(record.iat) &&
		Number.isFinite(record.exp)
	);
}

/**
 * Nonces já usados, em memória, até o `exp` do token (depois disso o token
 * já é recusado por validade). Teto de chaves: o mais antigo sai.
 */
export class ConsumedNonces {
	private readonly entries = new Map<string, number>();
	private readonly maxKeys: number;
	private readonly now: () => number;

	constructor(options: { maxKeys?: number; now?: () => number } = {}) {
		this.maxKeys = options.maxKeys ?? 10_000;
		this.now = options.now ?? Date.now;
	}

	/** `true` na primeira vez; `false` se o nonce já foi usado. */
	consume(nonce: string, exp: number): boolean {
		this.prune();
		if (this.entries.has(nonce)) {
			return false;
		}
		while (this.entries.size >= this.maxKeys) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this.entries.delete(oldest);
		}
		this.entries.set(nonce, exp);
		return true;
	}

	private prune(): void {
		const current = this.now();
		for (const [nonce, exp] of this.entries) {
			if (exp <= current) {
				this.entries.delete(nonce);
			}
		}
	}
}
