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
        "src/lib/api.ts": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/components/content/screens/PlannerOverview.tsx": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/components/content/screens/PlannerLeaveDialog.tsx": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/lib/plannerNavigation.ts": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/components/content/screens/PlannerScreen.tsx": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/components/content/screens/PlannerEpicPicker.tsx": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/components/content/screens/PlannerEpicDetails.tsx": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/components/content/screens/PlannerDateRangeField.tsx": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/components/content/screens/PlannerTimeline.tsx": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/lib/planner.ts": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/components/content/screens/UnmappedCardsTab.tsx": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/components/content/DateRangeFields.tsx": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/components/content/screens/TeamDashboardScreen.tsx": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/components/content/screens/TeamDashboardIssueOverlay.tsx": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/lib/reportCompletedWork.ts": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/lib/reportInitiativeSelection.ts": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/components/content/screens/EpicMappingTab.tsx": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/components/content/screens/IntegrationsScreen.tsx": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/mcp/bridge.ts": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
        "src/mcp/DashboardApp.tsx": {
          statements: 90, branches: 90, functions: 90, lines: 90,
        },
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
        "src/mcp/main.tsx",
      ],
    },
  },
});
