/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
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
