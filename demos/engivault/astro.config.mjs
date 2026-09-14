import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig, fontProviders } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

// Dev convenience only: `astro dev` runs this config directly, but the
// built server (`node ./dist/server/entry.mjs`) does not, so production
// still needs XAI_API_KEY etc. set as real environment variables on the
// host — never shipped via .env.
try {
	process.loadEnvFile();
} catch {
	// No .env file present (e.g. CI) — fine, secrets come from the real
	// environment instead.
}

export default defineConfig({
	output: "server",
	adapter: node({
		mode: "standalone",
	}),
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			database: sqlite({ url: "file:./data.db" }),
			storage: local({
				directory: "./uploads",
				baseUrl: "/_emdash/api/media/file",
			}),
		}),
	],
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter",
			cssVariable: "--font-body",
			weights: [400, 500, 600, 700],
			fallbacks: ["sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "JetBrains Mono",
			cssVariable: "--font-mono",
			weights: [400, 500, 600],
			fallbacks: ["monospace"],
		},
	],
	devToolbar: { enabled: false },
});
