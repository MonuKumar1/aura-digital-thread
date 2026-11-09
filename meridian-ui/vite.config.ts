import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const dataDir = fileURLToPath(new URL("../data", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@data": dataDir } },
  server: {
    port: 5173,
    // The shared fixtures live in ../data, outside the Vite root.
    fs: { allow: [".", dataDir] },
    proxy: { "/api": { target: process.env.VITE_PROXY_TARGET ?? "http://localhost:8000", changeOrigin: true } },
  },
});
