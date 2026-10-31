/** biome-ignore-all lint/style/useFilenamingConvention: <> */

import { type GenerateContentConfig, ThinkingLevel } from "@google/genai";
import { env } from "../env";

/**
 * Configuração do modelo sem depender do cérebro v1 (2026-10-28-flow-v2, A1).
 * `agent.ts` tem as mesmas regras para o schema da v1; o teste
 * `agent-model-config.test.ts` prova que as duas montam a mesma configuração.
 */

/** Nome do modelo: vem do ambiente, nunca de uma constante no código. */
export function resolveModelName(): string {
	return env.GEMINI_MODEL;
}

/**
 * Configuração da chamada ao Gemini para um schema de resposta qualquer.
 * Função pura: nenhum teste chega à API.
 */
export function buildGeminiConfig({
	responseJsonSchema,
	systemInstruction,
}: {
	responseJsonSchema: unknown;
	systemInstruction: string;
}): GenerateContentConfig {
	return {
		maxOutputTokens: env.GEMINI_MAX_OUTPUT_TOKENS,
		responseJsonSchema,
		responseMimeType: "application/json",
		systemInstruction,
		temperature: env.GEMINI_TEMPERATURE,
		// O enum do SDK tem exatamente os mesmos valores do env.
		thinkingConfig: { thinkingLevel: ThinkingLevel[env.GEMINI_THINKING_LEVEL] },
	};
}
