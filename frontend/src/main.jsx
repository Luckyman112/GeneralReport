import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { reloadForStaleChunk } from "./components/PageErrorBoundary";
import "./app/theme.css";

// Vite сообщает, что не смог подгрузить чанк (после деплоя старые файлы удалены):
// перезагружаем страницу вместо пустого экрана
window.addEventListener("vite:preloadError", (event) => {
  if (reloadForStaleChunk()) event.preventDefault();
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
