import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Self-host: фронт раздаётся тем же процессом FastAPI по корневому пути (see
// app/main.py — StaticFiles монтируется на "/"), поэтому base — корень.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/",
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
