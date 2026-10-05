import createClient, { type Middleware } from "openapi-fetch";
import { getViewAs } from "../../api/client";
import type { components, paths } from "./schema";

// Типы генерируются из FastAPI: `npm run gen:api` после правок бэкенда.
// Переименовали поле на бэке — фронт не соберётся, а не упадёт у бойца.
export type Schemas = components["schemas"];

const TOKEN_STORAGE_KEY = "collapsar_token";

export class ApiError extends Error {
  status: number;
  constructor(status: number, detail?: string) {
    super(detail || `Ошибка запроса (${status})`);
    this.status = status;
  }
}

// Те же заголовки, что у старого api/client.js: JWT и "Смотреть как".
const authMiddleware: Middleware = {
  onRequest({ request }) {
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
    const viewAs = getViewAs();
    if (viewAs.mode === "person" && viewAs.discordId) {
      request.headers.set("X-View-As-Discord-Id", viewAs.discordId);
    } else if (viewAs.mode === "role" && viewAs.role) {
      request.headers.set("X-View-As-Role", viewAs.role);
      if (viewAs.regimentId) request.headers.set("X-View-As-Regiment-Id", String(viewAs.regimentId));
      if (viewAs.extras?.length) request.headers.set("X-View-As-Extra", viewAs.extras.join(","));
    }
    return request;
  },
  async onResponse({ response }) {
    if (response.ok) return response;
    let detail: string | undefined;
    try {
      const body = await response.clone().json();
      detail = typeof body?.detail === "string" ? body.detail : undefined;
    } catch {
      // тело ответа не JSON
    }
    throw new ApiError(response.status, detail);
  },
};

export const http = createClient<paths>({ baseUrl: import.meta.env.VITE_API_BASE_URL || "" });
http.use(authMiddleware);
