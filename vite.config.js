import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return "react";
          }
          if (id.includes("node_modules/lucide-react/")) return "icons";
          return "vendor";
        },
      },
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.{js,ts}",
      "tests/api/**/*.test.ts",
      "tests/contract/**/*.test.ts",
    ],
    coverage: {
      reporter: ["text", "lcov"],
      include: [
        "src/domain/**/*.ts",
        "src/api/**/*.ts",
        "src/store/workspaceReducer.ts",
        "server/db/**/*.ts",
        "server/api/**/*.ts",
      ],
    },
  },
});
