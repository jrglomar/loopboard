/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { createRequire } from "node:module";

// Single source of truth for the displayed app version (v1.13, P0 — was a
// hardcoded "v1.7" pill). Bump package.json and the header pill follows.
const pkg = createRequire(import.meta.url)("./package.json") as { version: string };

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      // @/ resolves to src/ — used by shadcn components and app code
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    alias: {
      // Mirror resolve.alias for vitest so @/lib/utils etc. resolve in tests
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
