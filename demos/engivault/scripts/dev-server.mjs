// Preview-tool launcher: chdirs into this package before starting Astro, so
// astro.config.mjs's cwd-relative paths (./data.db, ./uploads) resolve here
// regardless of the process's original working directory.
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));
const astroBin = new URL("../node_modules/astro/bin/astro.mjs", import.meta.url);

process.chdir(pkgRoot);
process.argv = [process.argv[0], "astro", "dev", "--port", "4377"];

await import(astroBin.href);
