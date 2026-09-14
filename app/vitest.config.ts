import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      all: true,
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "./coverage",
      thresholds: {
        "src/components/content/PrimaryNavigation.tsx": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/components/content/index.tsx": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
      },
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "tests/**",
        "src/components/app.tsx",
        "src/main.tsx",
      ],
    },
  },
});
