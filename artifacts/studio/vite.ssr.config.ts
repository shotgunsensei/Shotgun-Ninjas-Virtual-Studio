import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/server"),
    emptyOutDir: true,
    ssr: "src/entry-server.tsx",
    rollupOptions: {
      input: "src/entry-server.tsx",
      output: {
        entryFileNames: "entry-server.js",
      },
    },
  },
});
