import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

/** Replace the `__SN_SW_VERSION__` token in the emitted sw.js with the
 * build timestamp so every new build invalidates the prior cache and
 * triggers the in-app "App Update Available" toast. */
function snVirtualStudioPwaPlugin(): Plugin {
  const version = `v${Date.now().toString(36)}`;
  let outDir = "";
  return {
    name: "sn-virtual-studio-pwa",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async closeBundle() {
      // Files under public/ are copied verbatim by Vite — they never
      // pass through the rollup bundle, so we patch the emitted sw.js
      // on disk after the build completes. We also inject a precache
      // list of the hashed JS/CSS chunks so an offline first-launch
      // (after one successful online load) has every shell-critical
      // asset already in cache, not just the HTML.
      const fs = await import("node:fs/promises");
      const swPath = path.join(outDir, "sw.js");
      try {
        const assetsDir = path.join(outDir, "assets");
        let precache: string[] = [];
        try {
          const entries = await fs.readdir(assetsDir, { withFileTypes: true });
          precache = entries
            .filter(
              (e) =>
                e.isFile() &&
                (e.name.endsWith(".js") || e.name.endsWith(".css")),
            )
            .map((e) => `assets/${e.name}`);
        } catch {
          /* no assets dir — nothing to precache */
        }
        const src = await fs.readFile(swPath, "utf8");
        const patched = src
          .replaceAll("__SN_SW_VERSION__", version)
          .replaceAll(
            "__SN_PRECACHE_URLS__",
            JSON.stringify(precache),
          );
        await fs.writeFile(swPath, patched);
      } catch (err) {
        // Surface as a warning so a missing sw.js doesn't silently ship
        // an unversioned worker that would never invalidate its cache.
        this.warn(
          `sw.js not patched with build version: ${(err as Error).message}`,
        );
      }
    },
  };
}

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    snVirtualStudioPwaPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
