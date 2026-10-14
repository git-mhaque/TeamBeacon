import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: "mcp-build",
    emptyOutDir: true,
    lib: { entry: "src/mcp/main.tsx", name: "TeamBeaconDashboard", formats: ["iife"], fileName: () => "dashboard.js" },
    cssCodeSplit: false,
  },
});
