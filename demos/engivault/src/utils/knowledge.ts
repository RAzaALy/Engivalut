/**
 * Shared helpers for rendering across the three knowledge collections
 * (articles, adrs, incidents). Deliberately thin: it normalizes display
 * concerns (a label, a path, a date format) rather than redefining the
 * content shape — the actual field types still come from EmDash's
 * generated `emdash-env.d.ts` interfaces via `getEmDashCollection`'s own
 * inference, not from anything declared here.
 */
export type KnowledgeType = "article" | "adr" | "incident";

export const TYPE_LABEL: Record<KnowledgeType, string> = {
	article: "Article",
	adr: "ADR",
	incident: "Incident",
};

export const TYPE_PATH: Record<KnowledgeType, string> = {
	article: "/articles",
	adr: "/adrs",
	incident: "/incidents",
};

/** Maps a collection slug (as returned by search()/getEmDashCollection) to its display type. */
export const COLLECTION_TO_TYPE: Record<string, KnowledgeType> = {
	articles: "article",
	adrs: "adr",
	incidents: "incident",
};

export function formatDate(date: string | Date | null | undefined): string | null {
	if (!date) return null;
	return new Date(date).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}
