import { defineConfig } from "vite";

export default defineConfig({
  server: {},
  build: {
    target: "esnext", // Ensure modern build for WASM
  },
});
