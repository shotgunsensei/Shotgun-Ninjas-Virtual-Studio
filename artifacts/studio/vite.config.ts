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
  let resolvedBase = "/";
  return {
    name: "sn-virtual-studio-pwa",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
      resolvedBase = config.base;
    },
    async closeBundle() {
      // Files under public/ are copied verbatim by Vite — they never
      // pass through the rollup bundle, so we patch the emitted sw.js
      // on disk after the build completes. We also inject a precache
      // list containing only the JS/CSS referenced directly by index.html.
      // Lazy Studio/panel chunks are cached on first use instead of being
      // downloaded during service-worker installation.
      const fs = await import("node:fs/promises");
      const swPath = path.join(outDir, "sw.js");
      try {
        let precache: string[] = [];
        try {
          const indexHtml = await fs.readFile(path.join(outDir, "index.html"), "utf8");
          const urls = Array.from(
            indexHtml.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g),
            (match) => match[1],
          );
          precache = Array.from(
            new Set(
              urls.map((url) => {
                const withoutBase = url.startsWith(resolvedBase)
                  ? url.slice(resolvedBase.length)
                  : url;
                return withoutBase.replace(/^\.\//, "").replace(/^\//, "");
              }),
            ),
          );
        } catch {
          /* no emitted index yet — static shell files are still precached */
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

const rawPort = process.env.PORT ?? "5173";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";
const emitSourceMaps = process.env.STUDIO_BUILD_SOURCEMAP === "1";

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
    manifest: true,
    // Public source maps exposed more than 8 MB of original source and slowed
    // production builds. Opt in for private diagnostics when explicitly needed.
    sourcemap: emitSourceMaps ? "hidden" : false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replaceAll("\\", "/");
          if (
            normalized.includes("/node_modules/tone/") ||
            normalized.includes("/node_modules/standardized-audio-context/")
          ) {
            // Tone is the largest stable dependency in the Studio route.
            // Keeping it separate avoids reparsing/re-downloading it when app
            // code changes and lets the browser compile it in parallel.
            return "audio-vendor";
          }
          return undefined;
        },
      },
    },
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
