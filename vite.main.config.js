import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/main/main.js",
      formats: ["es"],
      fileName: () => "main.js"
    },
    rollupOptions: {
      external: [
        "electron",
        "better-sqlite3",
        "node-cron",
        /^node:/
      ]
    }
  }
});
