// Test-only static host: exercise Replit's explicit rewrites without Vite's
// automatic SPA fallback. Existing files shadow rewrites, as on Replit.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function readDeployment(config, repositoryRoot) {
  const deployment =
    config.match(
      /^\[deployment\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m,
    )?.[1] ?? "";
  const publicDir = deployment.match(/^publicDir\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!/^deploymentTarget\s*=\s*"static"\s*$/m.test(deployment) || !publicDir) {
    throw new Error(
      "Release tests require a static deployment with an explicit publicDir",
    );
  }
  const rewrites = Array.from(
    config.matchAll(
      /^\[\[deployment\.rewrites\]\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/gm,
    ),
    ([, block]) => {
      const from = block.match(/^from\s*=\s*"([^"]+)"\s*$/m)?.[1];
      const to = block.match(/^to\s*=\s*"([^"]+)"\s*$/m)?.[1];
      if (
        !from?.startsWith("/") ||
        !to?.startsWith("/") ||
        from.includes("*") ||
        to.includes("*")
      ) {
        throw new Error(
          "Static release fixture supports exact from/to rewrites only",
        );
      }
      return { from, to };
    },
  );
  return { publicDir: path.resolve(repositoryRoot, publicDir), rewrites };
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};

export function createStaticReleaseServer({ publicDir, rewrites }) {
  async function fileFor(urlPath) {
    if (urlPath.includes("\\")) return null;
    let filename = path.resolve(publicDir, `.${urlPath}`);
    const relative = path.relative(publicDir, filename);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    try {
      if ((await stat(filename)).isDirectory())
        filename = path.join(filename, "index.html");
      return (await stat(filename)).isFile() ? filename : null;
    } catch {
      return null;
    }
  }
  return createServer(async (request, response) => {
    try {
      if (!["GET", "HEAD"].includes(request.method)) {
        response.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
      }
      const pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      let filename = await fileFor(pathname);
      if (!filename) {
        const rewrite = rewrites.find(({ from }) => from === pathname);
        if (rewrite) filename = await fileFor(rewrite.to);
      }
      if (!filename) {
        response.writeHead(404).end();
        return;
      }
      const body = await readFile(filename);
      response.writeHead(200, {
        "Content-Type":
          contentTypes[path.extname(filename)] ?? "application/octet-stream",
        "Content-Length": body.length,
        "Cache-Control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(400).end();
    }
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const deployment = readDeployment(
    await readFile(path.join(repositoryRoot, ".replit"), "utf8"),
    repositoryRoot,
  );
  const port = Number(process.env.STUDIO_TEST_PORT ?? "5175");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid STUDIO_TEST_PORT");
  createStaticReleaseServer(deployment).listen(port, "127.0.0.1", () => {
    console.log(`Static release fixture listening on http://127.0.0.1:${port}`);
  });
}
