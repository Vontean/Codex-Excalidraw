import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 3000,
    strictPort: false
  },
  build: {
    rollupOptions: {
      input: {
        app: resolve(__dirname, "index.html"),
        export: resolve(__dirname, "export.html"),
        mermaid: resolve(__dirname, "mermaid.html")
      }
    }
  }
});
