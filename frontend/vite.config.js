import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base — путь, под которым сайт будет опубликован на GitHub Pages.
// Для project page (https://<org>.github.io/<repo>/) укажите '/<repo>/'.
// Для user/org page (https://<org>.github.io/) оставьте '/'.
export default defineConfig({
  plugins: [react()],
  base: "/collapsar-reports/",
});
