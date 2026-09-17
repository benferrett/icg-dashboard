import {defineConfig,mergeConfig} from "vite";
import path from "node:path";
import base from "./vite.config";
export default mergeConfig(base,defineConfig({
 build:{
  outDir:path.resolve(import.meta.dirname,"../attendance-preview"),
  rollupOptions:{input:path.resolve(import.meta.dirname,"client/attendance-qa.html")},
 },
}));
