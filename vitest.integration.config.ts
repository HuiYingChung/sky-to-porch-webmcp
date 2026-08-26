import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": resolve(__dirname, "./src") },
  },
  test: {
    name: "integration",
    globals: true,
    environment: "node",
    include: ["src/__tests__/integration/**/*.test.ts"],
  },
});
