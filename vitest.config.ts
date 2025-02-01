/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    sequence: { shuffle: true },
    coverage: {
      enabled: true,
    },
  },
});
