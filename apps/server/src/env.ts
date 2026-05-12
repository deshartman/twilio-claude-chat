import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load the repo-root .env regardless of cwd. Imported for its side effect
// before anything that reads process.env at module top-level.
const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(here, "../../../.env") });
