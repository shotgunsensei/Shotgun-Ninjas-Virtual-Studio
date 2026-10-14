import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createStaticReleaseServer,
  readDeployment,
} from "./static-release-server.mjs";

test("static deployment serves only existing files and explicitly configured client routes", async () => {
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const config = await readFile(path.join(repositoryRoot, ".replit"), "utf8");
  const deployment = readDeployment(config, repositoryRoot);
  assert.equal(
    deployment.publicDir,
    path.join(repositoryRoot, "artifacts/studio/dist/public"),
  );
  const publicDir = await mkdtemp(path.join(tmpdir(), "studio-static-"));
  await writeFile(
    path.join(publicDir, "index.html"),
    "<div>studio shell</div>",
  );
  const server = createStaticReleaseServer({ ...deployment, publicDir });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    for (const route of [
      "/",
      "/studio",
      "/studio/",
      "/changelog",
      "/credits",
      "/press",
    ]) {
      const response = await fetch(`${origin}${route}?disableAudio=1`);
      assert.equal(response.status, 200, route);
      assert.equal(await response.text(), "<div>studio shell</div>");
    }
    // A real static file shadows its rewrite on Replit.
    await writeFile(path.join(publicDir, "studio"), "actual file");
    assert.equal(await (await fetch(`${origin}/studio`)).text(), "actual file");
    for (const route of [
      "/missing-page",
      "/assets/missing.js",
      "/src/main.tsx",
      "/api/healthz",
    ]) {
      assert.equal((await fetch(`${origin}${route}`)).status, 404, route);
    }
    assert.equal((await fetch(`${origin}/`, { method: "HEAD" })).status, 200);
    assert.equal(
      (await fetch(`${origin}/studio`, { method: "POST" })).status,
      405,
    );
    assert.equal((await fetch(`${origin}/%2e%2e%2f.replit`)).status, 404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(publicDir, { recursive: true, force: true });
  }
});
