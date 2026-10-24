import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "frontend",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.GSD_API_URL || "http://127.0.0.1:3000",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (request) => {
            request.removeHeader("origin");
            request.removeHeader("sec-fetch-site");
          });
        },
      },
    },
  },
  build: { outDir: "../dist/frontend", emptyOutDir: true, sourcemap: false },
});
