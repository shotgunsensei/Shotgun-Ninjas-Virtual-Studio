import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const pnpmCli = process.env.npm_execpath;
if (!pnpmCli || !/pnpm/i.test(pnpmCli)) {
  throw new Error("Run this gate with pnpm verify:release from the repository root.");
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return String(port);
}

function run(label, args, extraEnv = {}) {
  console.log(`\nRelease gate: ${label}`);
  const result = spawnSync(process.execPath, [pnpmCli, ...args], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      BASE_PATH: "/", REPL_ID: "", STUDIO_BUILD_SOURCEMAP: "0",
      STUDIO_TEST_REUSE_SERVER: "0", STUDIO_PRODUCTION_TEST: "0",
      ...extraEnv,
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`Release gate failed: ${label}${result.signal ? ` (${result.signal})` : ""}`);
    process.exit(result.status || 1);
  }
}

const studio = ["--filter", "@workspace/studio", "run"];
run("workspace typecheck and all production builds (including studio client, SSR, prerender)", ["run", "build"], {
  PORT: "5173", NODE_ENV: "production",
});
run("unit tests", [...studio, "test:unit"]);
run("reporter retry/failure regressions", [...studio, "test:reporter"]);
run("select-value guard", [...studio, "test:select-values"]);
run("built bundle budgets", [...studio, "test:bundle"]);
run("full development browser suite", [...studio, "test"], { STUDIO_TEST_PORT: await freePort() });
run("built static routes and save/export/reload workflow", [...studio, "test:release"], {
  STUDIO_TEST_PORT: await freePort(), STUDIO_PRODUCTION_TEST: "1",
});
console.log("\nAll release gates passed.");
