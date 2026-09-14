import { describe, expect, it } from "vitest";

import { mergeCacheHints } from "../../src/utils/cache";

describe("mergeCacheHints", () => {
	it("unions tags from multiple hints without duplicates", () => {
		const merged = mergeCacheHints([{ tags: ["articles", "adrs"] }, { tags: ["adrs", "incidents"] }]);

		expect(merged.tags).toHaveLength(3);
		expect(merged.tags).toEqual(expect.arrayContaining(["articles", "adrs", "incidents"]));
	});

	it("keeps the most recent lastModified across hints", () => {
		const older = new Date("2024-01-01T00:00:00Z");
		const newer = new Date("2024-06-01T00:00:00Z");

		const merged = mergeCacheHints([{ lastModified: older }, { lastModified: newer }]);

		expect(merged.lastModified).toEqual(newer);
	});

	it("omits tags/lastModified entirely when no hint carries them", () => {
		const merged = mergeCacheHints([{}, {}]);

		expect(merged.tags).toBeUndefined();
		expect(merged.lastModified).toBeUndefined();
	});

	it("handles a single hint (no merging needed)", () => {
		const merged = mergeCacheHints([{ tags: ["articles"] }]);

		expect(merged.tags).toEqual(["articles"]);
	});
});
