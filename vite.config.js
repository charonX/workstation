import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: path.resolve(process.cwd(), "src/renderer"),
  base: "./",
  build: {
    outDir: path.resolve(process.cwd(), "dist/renderer"),
    emptyOutDir: true
  }
});
