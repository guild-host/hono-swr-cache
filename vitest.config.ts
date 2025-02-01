/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    sequence: { shuffle: true },
    coverage: {
      enabled: true,
    },
  },
});
