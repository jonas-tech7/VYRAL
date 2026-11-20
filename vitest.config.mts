import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests share one database; run files sequentially.
    fileParallelism: false,
    setupFiles: ["tests/setup-env.ts"],
    // The pump.fun SDK's ESM build imports a CommonJS package by name; let Vite handle the interop.
    server: { deps: { inline: ["@pump-fun/pump-sdk", "@pump-fun/agent-payments-sdk"] } },
  },
});
