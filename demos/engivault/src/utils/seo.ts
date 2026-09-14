const TRAILING_SLASH_RE = /\/+$/;

/**
 * Self-referencing canonical URL for a page that isn't a CMS entry
 * (`getSeoMeta` already covers those via the SEO panel). Strips query
 * params and any trailing slash by default, so filtered/paginated variants
 * of the same route canonicalize to one clean URL — pass `search` to keep
 * a specific query string for a variant that's genuinely worth indexing on
 * its own (e.g. a single facet of a filtered listing).
 */
export function canonicalUrl(url: URL, options: { search?: string | null } = {}): string {
	const path = url.pathname === "/" ? "/" : url.pathname.replace(TRAILING_SLASH_RE, "");
	return `${url.origin}${path}${options.search ?? ""}`;
}
