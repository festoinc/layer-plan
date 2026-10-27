import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
    include: ["tests/unit/**/*.test.js"],
    coverage: {
      reporter: ["text", "lcov"],
      include: [
        "src/domain/**/*.js",
        "src/store/persistence.js",
        "src/store/workspaceReducer.js",
      ],
    },
  },
});
