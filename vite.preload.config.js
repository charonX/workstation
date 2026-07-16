import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/preload/preload.js",
      formats: ["es"],
      fileName: () => "preload.js"
    },
    rollupOptions: {
      external: ["electron"]
    }
  }
});
