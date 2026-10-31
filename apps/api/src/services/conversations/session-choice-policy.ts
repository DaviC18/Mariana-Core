// Regra de sessão (R-SES-02 v1.3): ≥ 4h sem mensagem do cliente na conversa
// ativa faz a próxima mensagem abrir uma conversa nova (session-rotation.ts).
// Deliberadamente separada de WHATSAPP_CUSTOMER_WINDOW_MS
// (whatsapp-compliance.ts): aquela janela decide envio, esta decide sessão.
// As duas regras podem evoluir em ritmos diferentes.
export const SESSION_INACTIVITY_MS = 4 * 60 * 60 * 1000;

export function isSessionInactivityGap({
	lastCustomerMessageAt,
	now,
}: {
	lastCustomerMessageAt: Date | null | undefined;
	now: Date;
}): boolean {
	if (!(lastCustomerMessageAt instanceof Date && now instanceof Date)) {
		return false;
	}
	const last = lastCustomerMessageAt.getTime();
	const current = now.getTime();
	if (!(Number.isFinite(last) && Number.isFinite(current))) {
		return false;
	}
	return current - last >= SESSION_INACTIVITY_MS;
}
