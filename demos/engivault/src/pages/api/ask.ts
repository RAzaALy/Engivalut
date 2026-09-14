/**
 * POST /api/ask — Engineering AI Assistant.
 *
 * Retrieves relevant EngiVault content (EmDash FTS search, no vector DB),
 * builds a bounded context from just those documents, and asks the
 * configured LLM to answer grounded in that context. See
 * src/lib/knowledge-assistant.ts for the retrieval/prompt logic.
 */
import type { APIRoute } from "astro";
import { askAssistant, AskConfigError, AskUpstreamError } from "../../lib/knowledge-assistant";

export const prerender = false;

const MAX_QUESTION_LENGTH = 500;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

// Module-scope singleton on globalThis: Vite duplicates SSR modules across
// chunks, which would otherwise give each duplicate its own empty Map and
// silently defeat the rate limit.
const RATE_LIMIT_STORE_KEY = Symbol.for("engivault:ask-rate-limit");
const rateLimitStore = globalThis as Record<symbol, unknown>;
const rateLimitMap: Map<string, number[]> =
	(rateLimitStore[RATE_LIMIT_STORE_KEY] as Map<string, number[]> | undefined) ??
	(() => {
		const store = new Map<string, number[]>();
		rateLimitStore[RATE_LIMIT_STORE_KEY] = store;
		return store;
	})();

/** Fixed-window-ish limiter: keeps only recent timestamps per key. */
function isRateLimited(key: string): boolean {
	const now = Date.now();
	const recent = (rateLimitMap.get(key) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
	recent.push(now);
	rateLimitMap.set(key, recent);
	return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

function json(data: unknown, status: number): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		return json({ error: "Request body must be valid JSON." }, 400);
	}

	if (
		!rawBody ||
		typeof rawBody !== "object" ||
		typeof (rawBody as Record<string, unknown>).question !== "string"
	) {
		return json({ error: "Expected a JSON body with a string 'question' field." }, 400);
	}

	const question = (rawBody as { question: string }).question.trim();
	if (!question) {
		return json({ error: "Question cannot be empty." }, 400);
	}
	if (question.length > MAX_QUESTION_LENGTH) {
		return json({ error: `Question must be ${MAX_QUESTION_LENGTH} characters or fewer.` }, 400);
	}

	let rateLimitKey = "unknown";
	try {
		rateLimitKey = clientAddress || "unknown";
	} catch {
		// clientAddress throws on some adapters/dev setups; fall back to a
		// shared bucket rather than failing the request over it.
	}
	if (isRateLimited(rateLimitKey)) {
		return json({ error: "Too many requests. Please wait a moment and try again." }, 429);
	}

	// Every failure path below shows the same user-facing message. The
	// specifics (missing config, upstream HTTP error, timeout, malformed
	// response, unexpected exception) are only ever logged server-side —
	// never exposed to the client — so a visitor never sees a stack trace,
	// a provider error body, or a hint about how the assistant is configured.
	const AI_UNAVAILABLE_MESSAGE = "Engineering AI is temporarily unavailable. Please try again.";

	try {
		const result = await askAssistant(question);
		return json(result, 200);
	} catch (error) {
		if (error instanceof AskConfigError) {
			console.error("[ask] configuration error:", error.message);
			return json({ error: AI_UNAVAILABLE_MESSAGE }, 503);
		}
		if (error instanceof AskUpstreamError) {
			console.error("[ask] upstream error:", error.message);
			return json({ error: AI_UNAVAILABLE_MESSAGE }, 502);
		}
		console.error("[ask] unexpected error:", error);
		return json({ error: AI_UNAVAILABLE_MESSAGE }, 500);
	}
};
