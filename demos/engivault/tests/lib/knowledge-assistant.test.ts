import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSearch, mockGetEmDashEntry, mockExtractPlainText } = vi.hoisted(() => ({
	mockSearch: vi.fn(),
	mockGetEmDashEntry: vi.fn(),
	mockExtractPlainText: vi.fn(),
}));

vi.mock("emdash", () => ({
	search: mockSearch,
	getEmDashEntry: mockGetEmDashEntry,
	extractPlainText: mockExtractPlainText,
}));

import {
	askAssistant,
	AskConfigError,
	AskUpstreamError,
	buildSearchQuery,
} from "../../src/lib/knowledge-assistant";

describe("buildSearchQuery", () => {
	it("strips common stopwords and OR-joins the remaining keywords", () => {
		// EmDash's search() AND-joins bare terms, so a natural-language
		// question would otherwise require every stopword to also appear
		// in the matched document.
		expect(buildSearchQuery("Why did we choose PostgreSQL?")).toBe("choose OR postgresql");
	});

	it("falls back to the raw question when every word is a stopword", () => {
		expect(buildSearchQuery("What is it?")).toBe("What is it?");
	});

	it("deduplicates repeated keywords", () => {
		expect(buildSearchQuery("Postgres postgres POSTGRES")).toBe("postgres");
	});
});

describe("askAssistant", () => {
	beforeEach(() => {
		mockSearch.mockReset();
		mockGetEmDashEntry.mockReset();
		mockExtractPlainText.mockReset();
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it("returns a canned answer with no sources and never calls the LLM when nothing is retrieved", async () => {
		mockSearch.mockResolvedValue({ items: [] });

		const result = await askAssistant("What is the airspeed velocity of an unladen swallow?");

		expect(result.sources).toEqual([]);
		expect(result.answer).toMatch(/couldn't find/i);
		expect(fetch).not.toHaveBeenCalled();
		expect(mockGetEmDashEntry).not.toHaveBeenCalled();
	});

	it("grounds sources in the retrieved documents regardless of what the model says", async () => {
		vi.stubEnv("LLM_API_KEY", "test-key");
		mockSearch.mockResolvedValue({
			items: [{ collection: "adrs", id: "adr1", slug: "postgres-vs-mongo", title: "PostgreSQL vs MongoDB" }],
		});
		mockGetEmDashEntry.mockResolvedValue({
			entry: {
				data: {
					title: "PostgreSQL vs MongoDB",
					problem: "We need a datastore.",
					decision: "We chose PostgreSQL.",
					alternatives: "MongoDB was considered.",
					consequences: "Relational queries are now easy.",
				},
			},
		});
		vi.mocked(fetch).mockResolvedValue(
			new Response(
				JSON.stringify({
					choices: [{ message: { content: "We chose PostgreSQL for relational queries." } }],
				}),
				{ status: 200 },
			),
		);

		const result = await askAssistant("Why did we choose PostgreSQL?");

		expect(result.answer).toBe("We chose PostgreSQL for relational queries.");
		// The source list comes from what was actually retrieved, not from
		// anything the model mentions in its answer text.
		expect(result.sources).toEqual([
			{
				type: "adr",
				title: "PostgreSQL vs MongoDB",
				slug: "postgres-vs-mongo",
				url: "/adrs/postgres-vs-mongo",
				description: undefined,
			},
		]);
	});

	it("throws AskConfigError when no LLM API key is configured", async () => {
		vi.stubEnv("LLM_API_KEY", "");
		vi.stubEnv("GEMINI_API_KEY", "");
		mockSearch.mockResolvedValue({
			items: [{ collection: "articles", id: "a1", slug: "some-article", title: "Some Article" }],
		});
		mockGetEmDashEntry.mockResolvedValue({
			entry: { data: { title: "Some Article", summary: "A summary." } },
		});

		await expect(askAssistant("Anything?")).rejects.toThrow(AskConfigError);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("throws AskUpstreamError when the LLM provider responds with a non-OK status", async () => {
		vi.stubEnv("LLM_API_KEY", "test-key");
		mockSearch.mockResolvedValue({
			items: [{ collection: "articles", id: "a1", slug: "some-article", title: "Some Article" }],
		});
		mockGetEmDashEntry.mockResolvedValue({
			entry: { data: { title: "Some Article", summary: "A summary." } },
		});
		vi.mocked(fetch).mockResolvedValue(new Response("provider is down", { status: 503 }));

		await expect(askAssistant("Anything?")).rejects.toThrow(AskUpstreamError);
	});

	it("throws AskUpstreamError when the LLM response has no answer content", async () => {
		vi.stubEnv("LLM_API_KEY", "test-key");
		mockSearch.mockResolvedValue({
			items: [{ collection: "articles", id: "a1", slug: "some-article", title: "Some Article" }],
		});
		mockGetEmDashEntry.mockResolvedValue({
			entry: { data: { title: "Some Article", summary: "A summary." } },
		});
		vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }));

		await expect(askAssistant("Anything?")).rejects.toThrow(AskUpstreamError);
	});

	it("throws AskUpstreamError (mentioning a timeout) when the request is aborted", async () => {
		vi.stubEnv("LLM_API_KEY", "test-key");
		mockSearch.mockResolvedValue({
			items: [{ collection: "articles", id: "a1", slug: "some-article", title: "Some Article" }],
		});
		mockGetEmDashEntry.mockResolvedValue({
			entry: { data: { title: "Some Article", summary: "A summary." } },
		});
		const abortError = new Error("The operation was aborted.");
		abortError.name = "AbortError";
		vi.mocked(fetch).mockRejectedValue(abortError);

		await expect(askAssistant("Anything?")).rejects.toThrow(/timed out/i);
	});
});
