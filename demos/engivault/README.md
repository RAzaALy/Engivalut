# EngiVault

EngiVault is an "AI Engineering Knowledge Hub" — a consumer site (articles, architecture decision records, incident reports, search, and an AI assistant) built as an additive layer on top of [EmDash](../../README.md), the Astro-native CMS in this monorepo. It does not modify EmDash's core packages; it only uses EmDash's existing schema/seed system, Live Collections API, and FTS5 search.

See [`/architecture`](src/pages/architecture.astro) and [`/architecture/decisions`](src/pages/architecture/decisions.astro) once the site is running for the full design write-up and the real ADRs behind these choices.

## Running locally

Requires Node ≥22.16 (for `node:sqlite`).

```bash
pnpm install
pnpm --filter @emdash-cms/demo-engivault seed     # apply seed/seed.json to a local SQLite DB
pnpm --filter @emdash-cms/demo-engivault dev       # http://localhost:4321
```

The AI assistant at `/ask` needs an LLM API key. Copy `.env.example` to `.env` and set:

```
LLM_API_KEY=your-key-here
```

Any OpenAI-compatible `chat/completions` provider works (`LLM_BASE_URL` / `LLM_MODEL` override the default, which is Google's Gemini OpenAI-compatibility endpoint). Never commit `.env`.

## Testing

```bash
pnpm --filter @emdash-cms/demo-engivault test
```

Vitest covers the logic unique to this demo:

- `src/lib/knowledge-assistant.ts` — search-query construction (stopword stripping, OR-joining), retrieval grounding, and every LLM failure mode (missing config, non-OK response, malformed response, timeout), with the LLM provider and `emdash`'s `search`/`getEmDashEntry` mocked so no real network or database calls happen in tests.
- `src/pages/api/ask.ts` — the full HTTP contract: input validation, response shape, per-IP rate limiting, and that every error path returns the same generic user-facing message with no internal detail leaked.
- `src/utils/cache.ts` — cache-hint merging.

What this suite does **not** cover: page-level content listing, filtering, and full-text search behavior (`index.astro`, `knowledge.astro`, `search.astro`, the collection list/detail pages). Those call EmDash's own query engine (`getEmDashCollection`, `search`, taxonomy lookups), which already has its own real-database test suite in `packages/core`; re-testing that engine here would just duplicate it. Those pages were instead verified manually against a running dev server (golden path, empty states, invalid slugs, empty search results). A future pass could add real integration coverage using a seeded test database if EmDash exposes a public test-database harness.

## Production considerations

This was built as a time-boxed assignment, not a hardened production deployment. Known, deliberately-unaddressed gaps:

- **No authentication or authorization was added.** All EngiVault content is intentionally public; the only access control is EmDash's own admin/editor auth, unchanged from core. Adding a separate auth system for this read-only site would have been unnecessary complexity.
- **`/api/ask` rate limiting is in-memory and per-process** (a `Map` on `globalThis`, keyed by client IP). It resets on every restart and does not coordinate across multiple instances in a horizontally-scaled deployment — each instance enforces its own limit independently, so real-world throughput under load balancing is higher than the configured 10/minute. A production deployment with meaningful abuse risk should move this to a shared store (e.g. Cloudflare's rate-limiting rules, or a KV/Redis-backed limiter).
- **Rate limiting is IP-based**, so clients behind a shared NAT or corporate proxy share one bucket, and `clientAddress` can throw on some adapters/dev setups — in which case requests silently fall back to a single shared bucket rather than being rejected. No CAPTCHA or bot-detection sits in front of it.
- **Indirect prompt injection via CMS content is not specifically mitigated.** The assistant retrieves and injects EngiVault's own articles/ADRs/incidents into the LLM prompt. That content is treated as trusted because it's authored through EmDash's gated admin, but if editor accounts were ever compromised, or the admin were opened to less-trusted contributors, malicious instructions embedded in content could influence the assistant's behavior. The only mitigation is the system prompt's "answer only from the supplied context" instruction — there's no separate content-sanitization or instruction-defense layer.
- **No output moderation.** Answers are only as trustworthy as the configured LLM provider; nothing here filters or reviews model output before it's shown to the user.
- **Server-side error logging goes to `console.error` only.** That's enough to debug locally, but a real deployment should ship these to a real logging/monitoring pipeline (e.g. Sentry, Cloudflare Logs) rather than relying on stdout.
- **Astro's route-cache hints (`Astro.cache.set`) are wired up for collection and entry pages** so a CDN-fronted deployment (e.g. Cloudflare) can cache them correctly, but this hasn't been verified end-to-end — the Node adapter used for local dev/preview has no caching layer to exercise.

None of the above is claimed to be fully solved — they're the tradeoffs made to keep this assignment scoped, documented so they're not mistaken for oversights.
