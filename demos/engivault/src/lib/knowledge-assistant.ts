/**
 * Retrieval + LLM logic for the Engineering AI Assistant (/api/ask).
 *
 * Retrieval reuses EmDash's existing FTS5 search() — no vector database,
 * no separate search index. Only the top-K matched documents' text is
 * ever sent to the LLM, never the whole knowledge base.
 */
import { search, getEmDashEntry, extractPlainText } from "emdash";
import { TYPE_LABEL, TYPE_PATH, COLLECTION_TO_TYPE, type KnowledgeType } from "../utils/knowledge";

const MAX_DOCS = 5;
const MAX_EXCERPT_CHARS = 900;
const LLM_TIMEOUT_MS = 20_000;
// Generous headroom: some models (e.g. Gemini's "thinking" variants) spend
// part of this budget on internal reasoning tokens before the visible
// answer, so a tight limit truncates the reply mid-sentence.
const MAX_ANSWER_TOKENS = 2048;

/**
 * Common English words that carry no retrieval signal. EmDash's search()
 * AND-joins bare terms by default, so a natural-language question like
 * "Why did we choose PostgreSQL?" would require every one of those words
 * to appear in a document — stripping stopwords and OR-joining what's left
 * (search() preserves explicit FTS5 operators like OR) turns it into a
 * query that actually matches on "postgresql".
 */
const STOPWORDS = new Set([
	"a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
	"do", "does", "did", "doing", "to", "of", "for", "in", "on", "with",
	"that", "this", "these", "those", "our", "we", "us", "you", "your",
	"i", "it", "its", "and", "or", "but", "if", "so", "than", "then",
	"why", "what", "when", "which", "who", "whom", "how", "should",
	"would", "could", "can", "will", "shall", "have", "has", "had",
	"about", "into", "over", "under", "between", "there", "here",
]);

function buildSearchQuery(question: string): string {
	const words = question
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length > 1 && !STOPWORDS.has(w));

	const keywords = [...new Set(words)];
	// Fall back to the raw question if stripping stopwords left nothing
	// (e.g. a question that's entirely stopwords) rather than searching
	// for an empty string.
	return keywords.length > 0 ? keywords.join(" OR ") : question;
}

/** The rich-text/plain-text fields worth feeding to the model, per type. */
const TEXT_FIELDS_BY_TYPE: Record<KnowledgeType, string[]> = {
	article: ["summary", "content"],
	adr: ["problem", "decision", "alternatives", "consequences"],
	incident: ["summary", "root_cause", "resolution", "lessons_learned"],
};

export interface AskSource {
	type: KnowledgeType;
	title: string;
	slug: string;
	url: string;
	description?: string;
}

interface RetrievedDoc extends AskSource {
	excerpt: string;
}

export interface AskResult {
	answer: string;
	sources: AskSource[];
}

export class AskConfigError extends Error {}
export class AskUpstreamError extends Error {}

/**
 * Find the top-K matching documents and extract enough plain text from each
 * to ground an answer — full-text search ranking, not a vector index.
 */
async function retrieveContext(question: string): Promise<RetrievedDoc[]> {
	const { items } = await search(buildSearchQuery(question), {
		collections: ["articles", "adrs", "incidents"],
		limit: MAX_DOCS,
	});

	const docs = await Promise.all(
		items.map(async (item): Promise<RetrievedDoc | null> => {
			const type = COLLECTION_TO_TYPE[item.collection] ?? "article";
			const { entry } = await getEmDashEntry(item.collection, item.id);
			if (!entry) return null;

			const data = entry.data as Record<string, unknown>;
			const title = (typeof data.title === "string" && data.title) || item.title || "Untitled";
			const routeSlug = item.slug ?? item.id;

			const textParts: string[] = [];
			for (const field of TEXT_FIELDS_BY_TYPE[type]) {
				const value = data[field];
				if (typeof value === "string" && value) {
					textParts.push(value);
				} else if (Array.isArray(value) && value.length > 0) {
					// eslint-disable-next-line typescript/no-unsafe-type-assertion -- portableText field shape, validated by the schema
					const plain = extractPlainText(value as never);
					if (plain) textParts.push(plain);
				}
			}

			const description = typeof data.summary === "string" && data.summary ? data.summary : undefined;

			return {
				type,
				title,
				slug: routeSlug,
				url: `${TYPE_PATH[type]}/${routeSlug}`,
				description,
				excerpt: textParts.join("\n\n").slice(0, MAX_EXCERPT_CHARS),
			};
		}),
	);

	return docs.filter((doc): doc is RetrievedDoc => doc !== null);
}

const SYSTEM_PROMPT = `You are the EngiVault Engineering Knowledge Assistant, answering questions for engineers using an internal engineering knowledge base of articles, architecture decision records (ADRs), and incident reports.

Rules:
- Answer only using the "Engineering Knowledge Context" provided in the user message. Do not use outside knowledge.
- Do not invent facts, dates, decisions, or details that are not present in the supplied context.
- If the context does not contain enough information to answer the question, say so plainly instead of guessing.
- When your answer draws on a specific document, mention it by title.
- Prefer concise, direct, technical explanations over filler or hedging.`;

/**
 * Answer a question grounded in retrieved EngiVault content. Returns a
 * canned "nothing found" answer (no LLM call) when retrieval finds nothing,
 * which is both cheaper and impossible to hallucinate around.
 */
export async function askAssistant(question: string): Promise<AskResult> {
	const docs = await retrieveContext(question);

	if (docs.length === 0) {
		return {
			answer:
				"I couldn't find anything in the EngiVault knowledge base about that. Try rephrasing your question, or browse Articles, ADRs, and Incidents directly.",
			sources: [],
		};
	}

	// Any OpenAI-compatible chat/completions provider works here — only the
	// base URL, key, and model name change. Defaults to Google's Gemini
	// OpenAI-compatibility endpoint (free tier via aistudio.google.com);
	// override LLM_BASE_URL/LLM_MODEL to point at Groq, OpenRouter, xAI, etc.
	// without touching this code.
	const apiKey = process.env.LLM_API_KEY || process.env.GEMINI_API_KEY;
	if (!apiKey) {
		throw new AskConfigError("LLM_API_KEY (or GEMINI_API_KEY) is not configured on the server.");
	}
	const baseUrl =
		process.env.LLM_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai";
	const model = process.env.LLM_MODEL || "gemini-3.6-flash";

	const contextBlock = docs
		.map((doc, i) => `[${i + 1}] ${TYPE_LABEL[doc.type]}: "${doc.title}"\n${doc.excerpt}`)
		.join("\n\n---\n\n");

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

	let response: Response;
	try {
		response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model,
				messages: [
					{ role: "system", content: SYSTEM_PROMPT },
					{
						role: "user",
						content: `Engineering Knowledge Context:\n\n${contextBlock}\n\n---\n\nQuestion: ${question}`,
					},
				],
				temperature: 0.2,
				max_tokens: MAX_ANSWER_TOKENS,
			}),
			signal: controller.signal,
		});
	} catch (error) {
		throw new AskUpstreamError(
			error instanceof Error && error.name === "AbortError"
				? "AI provider request timed out."
				: `AI provider request failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		clearTimeout(timeout);
	}

	if (!response.ok) {
		const bodyText = await response.text().catch(() => "");
		console.error("[ask] LLM provider error body:", bodyText.slice(0, 2000));
		throw new AskUpstreamError(`AI provider responded with HTTP ${response.status}`);
	}

	const payload = (await response.json()) as {
		choices?: Array<{ message?: { content?: string } }>;
	};
	const answer = payload.choices?.[0]?.message?.content?.trim();
	if (!answer) {
		throw new AskUpstreamError("AI provider returned an empty response.");
	}

	return {
		answer,
		sources: docs.map(({ type, title, slug, url, description }) => ({
			type,
			title,
			slug,
			url,
			description,
		})),
	};
}
