import { defineConfig } from "vitest/config";

// `vitest run --mode reworded` (npm run test:reworded): every word in the language files reworded (tests/foundry-i18n.js).
export default defineConfig(({ mode }) => ({
  test: {
    include: ["tests/**/*.test.js"],
    setupFiles: ["tests/setup.js"],
    env: mode === "reworded" ? { FASTFIGHTING_REWORD: "1" } : {},
    environment: "node"
  }
}));
