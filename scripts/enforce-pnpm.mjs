import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const userAgent = process.env.npm_config_user_agent ?? "";

for (const filename of ["package-lock.json", "yarn.lock"]) {
  rmSync(resolve(workspaceRoot, filename), { force: true });
}

if (!userAgent.startsWith("pnpm/")) {
  console.error("Use pnpm instead of npm or yarn for this workspace.");
  process.exit(1);
}
