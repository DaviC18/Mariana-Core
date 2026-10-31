/**
 * Limitador de falhas de autenticação por IP, em memória (sem dependência
 * nova). Conta só falhas: `maxFailures` falhas dentro de `windowMs` bloqueiam
 * o IP até o fim da janela; um sucesso zera o contador. O mapa tem teto de
 * `maxKeys` IPs (o mais antigo sai), então um atacante com muitos IPs não
 * esgota a memória.
 */
export interface AuthFailureLimiterOptions {
	maxFailures?: number;
	maxKeys?: number;
	now?: () => number;
	windowMs?: number;
}

export type AuthLimitCheck =
	| { limited: false }
	| { limited: true; retryAfterSeconds: number };

interface Entry {
	count: number;
	windowStartedAt: number;
}

export class AuthFailureLimiter {
	private readonly entries = new Map<string, Entry>();
	private readonly maxFailures: number;
	private readonly maxKeys: number;
	private readonly now: () => number;
	private readonly windowMs: number;

	constructor(options: AuthFailureLimiterOptions = {}) {
		this.maxFailures = options.maxFailures ?? 10;
		this.maxKeys = options.maxKeys ?? 10_000;
		this.now = options.now ?? Date.now;
		this.windowMs = options.windowMs ?? 15 * 60 * 1000;
	}

	get size(): number {
		return this.entries.size;
	}

	check(key: string): AuthLimitCheck {
		const entry = this.liveEntry(key);
		if (!entry || entry.count < this.maxFailures) {
			return { limited: false };
		}
		const remainingMs = entry.windowStartedAt + this.windowMs - this.now();
		return {
			limited: true,
			retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)),
		};
	}

	recordFailure(key: string): void {
		const entry = this.liveEntry(key);
		if (entry) {
			entry.count += 1;
			return;
		}
		while (this.entries.size >= this.maxKeys) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) {
				break;
			}
			this.entries.delete(oldest);
		}
		this.entries.set(key, { count: 1, windowStartedAt: this.now() });
	}

	reset(key: string): void {
		this.entries.delete(key);
	}

	private liveEntry(key: string): Entry | undefined {
		const entry = this.entries.get(key);
		if (entry && this.now() - entry.windowStartedAt > this.windowMs) {
			this.entries.delete(key);
			return undefined;
		}
		return entry;
	}
}
