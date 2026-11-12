import { defineConfig } from "vite";
export default defineConfig({
  root: "web",
  base: "./",
  build: { outDir: "../dist/client", emptyOutDir: true, target: "es2022" },
  server: { host: "127.0.0.1" },
});
