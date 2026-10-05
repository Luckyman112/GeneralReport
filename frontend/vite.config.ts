import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Self-host: фронт раздаётся тем же процессом FastAPI по корневому пути (see
// app/main.py — StaticFiles монтируется на "/"), поэтому base — корень.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/",
  build: {
    rollupOptions: {
      // 3D «Галактики» — отдельная точка входа со стабильным именем: её грузит
      // статическая galaxy-map.html, у которой нет доступа к хэшам сборки.
      input: { main: "index.html", galaxy3d: "src/galaxy3d/entry.ts" },
      output: {
        entryFileNames: (chunk) => (chunk.name === "galaxy3d" ? "galaxy3d/galaxy3d.js" : "assets/[name]-[hash].js"),
      },
    },
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
