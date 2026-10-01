import { defineConfig, mergeConfig } from "vite";
import path from "node:path";
import base from "./vite.config";
export default mergeConfig(base, defineConfig({
  build: {
    outDir: path.resolve(import.meta.dirname, "../eoi-preview"),
    rollupOptions: { input: path.resolve(import.meta.dirname, "client/eoi-qa.html") },
  },
}));
