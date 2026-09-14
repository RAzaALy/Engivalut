import type { APIContext } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAskAssistant } = vi.hoisted(() => ({ mockAskAssistant: vi.fn() }));

vi.mock("../../../src/lib/knowledge-assistant", async () => {
	const actual = await vi.importActual<typeof import("../../../src/lib/knowledge-assistant")>(
		"../../../src/lib/knowledge-assistant",
	);
	return {
		...actual,
		askAssistant: mockAskAssistant,
	};
});

import { AskConfigError, AskUpstreamError } from "../../../src/lib/knowledge-assistant";
import { POST } from "../../../src/pages/api/ask";

let addressCounter = 0;

/** Each call gets a fresh clientAddress so the shared rate-limit bucket
 * (a globalThis singleton, by design) doesn't leak between test cases. */
function nextAddress(): string {
	addressCounter += 1;
	return `10.0.0.${addressCounter}`;
}

function makeContext(body: unknown, clientAddress = nextAddress()): APIContext {
	const request =
		typeof body === "string"
			? new Request("http://localhost/api/ask", { method: "POST", body })
			: new Request("http://localhost/api/ask", { method: "POST", body: JSON.stringify(body) });
	return { request, clientAddress } as unknown as APIContext;
}

describe("POST /api/ask", () => {
	beforeEach(() => {
		mockAskAssistant.mockReset();
	});

	it("rejects a malformed JSON body", async () => {
		const res = await POST(makeContext("not json"));
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "Request body must be valid JSON." });
	});

	it("rejects a body without a string 'question' field", async () => {
		const res = await POST(makeContext({ question: 123 }));
		expect(res.status).toBe(400);
	});

	it("rejects an empty question", async () => {
		const res = await POST(makeContext({ question: "   " }));
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "Question cannot be empty." });
	});

	it("rejects a question over 500 characters", async () => {
		const res = await POST(makeContext({ question: "a".repeat(501) }));
		expect(res.status).toBe(400);
	});

	it("returns the assistant's answer and sources with a 200 on success", async () => {
		mockAskAssistant.mockResolvedValue({
			answer: "PostgreSQL was chosen for relational queries.",
			sources: [{ type: "adr", title: "PostgreSQL vs MongoDB", slug: "postgres-vs-mongo", url: "/adrs/postgres-vs-mongo" }],
		});

		const res = await POST(makeContext({ question: "Why did we choose PostgreSQL?" }));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.answer).toBe("PostgreSQL was chosen for relational queries.");
		expect(body.sources).toHaveLength(1);
		expect(mockAskAssistant).toHaveBeenCalledWith("Why did we choose PostgreSQL?");
	});

	it("maps AskConfigError to a 503 with the generic AI-unavailable message, never the internal detail", async () => {
		mockAskAssistant.mockRejectedValue(new AskConfigError("LLM_API_KEY is not set on the server"));

		const res = await POST(makeContext({ question: "Anything?" }));

		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.error).toBe("Engineering AI is temporarily unavailable. Please try again.");
		expect(body.error).not.toMatch(/LLM_API_KEY/);
	});

	it("maps AskUpstreamError to a 502 with the generic AI-unavailable message, never the provider's error body", async () => {
		mockAskAssistant.mockRejectedValue(new AskUpstreamError("provider responded with secret-internal-detail-500"));

		const res = await POST(makeContext({ question: "Anything?" }));

		expect(res.status).toBe(502);
		const body = await res.json();
		expect(body.error).toBe("Engineering AI is temporarily unavailable. Please try again.");
		expect(body.error).not.toMatch(/secret-internal-detail/);
	});

	it("maps an unexpected error to a 500 with the generic AI-unavailable message, never a stack trace", async () => {
		mockAskAssistant.mockRejectedValue(new Error("TypeError: cannot read property 'x' of undefined"));

		const res = await POST(makeContext({ question: "Anything?" }));

		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.error).toBe("Engineering AI is temporarily unavailable. Please try again.");
		expect(body.error).not.toMatch(/TypeError/);
	});

	it("rate-limits a client after too many requests in the window", async () => {
		mockAskAssistant.mockResolvedValue({ answer: "ok", sources: [] });
		const address = nextAddress();

		let lastStatus = 200;
		for (let i = 0; i < 11; i++) {
			const res = await POST(makeContext({ question: "Why did we choose PostgreSQL?" }, address));
			lastStatus = res.status;
		}

		expect(lastStatus).toBe(429);
	});
});
