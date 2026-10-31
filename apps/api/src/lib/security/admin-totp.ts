/** biome-ignore-all lint/suspicious/noBitwiseOperators: RFC 6238 dynamic truncation and base32 decoding require bit operations. */
import { createHmac, timingSafeEqual } from "node:crypto";

const STEP_MS = 30_000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const BASE32_PADDING = /[=]+$/;
const TOTP_CODE = /^\d{6}$/;

function base32Decode(value: string) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	const normalized = value
		.replace(/[\s-]/g, "")
		.replace(BASE32_PADDING, "")
		.toUpperCase();
	let buffer = 0;
	let bits = 0;
	const bytes: number[] = [];
	for (const character of normalized) {
		const index = alphabet.indexOf(character);
		if (index < 0) {
			throw new Error("invalid_totp_secret");
		}
		buffer = (buffer << 5) | index;
		bits += 5;
		if (bits >= 8) {
			bytes.push((buffer >>> (bits - 8)) & 0xff);
			bits -= 8;
		}
	}
	return Buffer.from(bytes);
}

function codeFor(secret: Buffer, counter: number) {
	const input = Buffer.alloc(8);
	input.writeBigUInt64BE(BigInt(counter));
	const hash = createHmac("sha1", secret).update(input).digest();
	const offset = (hash.at(-1) ?? 0) & 0x0f;
	const value =
		((hash[offset] & 0x7f) << 24) |
		(hash[offset + 1] << 16) |
		(hash[offset + 2] << 8) |
		hash[offset + 3];
	return String(value % 1_000_000).padStart(6, "0");
}

export function verifyTotp(
	secretValue: string,
	code: string,
	now = Date.now()
) {
	if (!TOTP_CODE.test(code)) {
		return false;
	}
	try {
		const secret = base32Decode(secretValue);
		const counter = Math.floor(now / STEP_MS);
		return [-1, 0, 1].some((offset) => {
			const expected = Buffer.from(codeFor(secret, counter + offset));
			return timingSafeEqual(Buffer.from(code), expected);
		});
	} catch {
		return false;
	}
}

function signature(signingSecret: string, expiresAt: number) {
	return createHmac("sha256", signingSecret)
		.update(`admin-session.${expiresAt}`)
		.digest("base64url");
}

export function createAdminSession(signingSecret: string, now = Date.now()) {
	const expiresAt = now + SESSION_TTL_MS;
	return `${expiresAt}.${signature(signingSecret, expiresAt)}`;
}

export function verifyAdminSession(
	signingSecret: string,
	token: string | undefined,
	now = Date.now()
) {
	if (!token) {
		return false;
	}
	const [expiryText, received, extra] = token.split(".");
	const expiresAt = Number(expiryText);
	if (
		extra ||
		!Number.isSafeInteger(expiresAt) ||
		expiresAt <= now ||
		!received
	) {
		return false;
	}
	const expected = signature(signingSecret, expiresAt);
	return (
		received.length === expected.length &&
		timingSafeEqual(Buffer.from(received), Buffer.from(expected))
	);
}
