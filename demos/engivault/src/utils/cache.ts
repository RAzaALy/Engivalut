import type { CacheHint } from "emdash";

/**
 * Combine multiple CacheHints (e.g. from several getEmDashCollection calls on
 * one page) into one, so a page fetching >1 collection can still make a
 * single Astro.cache.set() call instead of the last call silently winning.
 */
export function mergeCacheHints(hints: CacheHint[]): CacheHint {
	const tags = [...new Set(hints.flatMap((h) => h.tags ?? []))];
	const lastModified = hints.reduce<Date | undefined>((latest, h) => {
		if (!h.lastModified) return latest;
		if (!latest || h.lastModified > latest) return h.lastModified;
		return latest;
	}, undefined);

	return {
		...(tags.length > 0 && { tags }),
		...(lastModified && { lastModified }),
	};
}
