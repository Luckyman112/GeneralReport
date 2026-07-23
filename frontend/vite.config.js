import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Self-host: фронт раздаётся тем же процессом FastAPI по корневому пути (see
// app/main.py — StaticFiles монтируется на "/"), поэтому base — корень.
export default defineConfig({
  plugins: [react()],
  base: "/",
});
