import { defineConfig } from "vitest/config";
// import.meta.dirname keeps this working under the native config loader.

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
