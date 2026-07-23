import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "../api/client";

const STORAGE_KEY = "collapsar_token";

const AuthContext = createContext(null);

// redirect_uri вычисляется динамически от текущего адреса (self-host: фронт и бэк на
// одном origin), а не берётся из VITE_DISCORD_REDIRECT_URI — так адрес туннеля/хоста
// может меняться без пересборки фронта. В Discord Developer Portal этот адрес всё
// равно нужно один раз внести в список Redirect URI вручную.
function getRedirectUri() {
  return `${window.location.origin}/`;
}

function buildDiscordLoginUrl() {
  const params = new URLSearchParams({
    client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: "identify",
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY));
  const [user, setUser] = useState(null);
  const [access, setAccess] = useState(null);
  // Список формирований — нужен, чтобы показывать "должность + формирование" в навбаре
  const [regiments, setRegiments] = useState([]);
  // true, пока идёт первичная проверка токена или обмен OAuth-кода
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setUser(null);
    setAccess(null);
    setRegiments([]);
  }, []);

  const loadMe = useCallback(async (currentToken) => {
    const me = await api.getMe(currentToken);
    setUser(me.user);
    setAccess(me.access);
    try {
      setRegiments(await api.listRegiments(currentToken));
    } catch {
      setRegiments([]);
    }
  }, []);

  const applyLoginResult = useCallback(
    async (result) => {
      localStorage.setItem(STORAGE_KEY, result.access_token);
      setToken(result.access_token);
      await loadMe(result.access_token);
    },
    [loadMe]
  );

  const loginWithPassword = useCallback(
    async (password) => {
      setError(null);
      const result = await api.loginWithPassword(password);
      await applyLoginResult(result);
    },
    [applyLoginResult]
  );

  // При первой загрузке страницы: если Discord вернул ?code= — обменять его на токен.
  // Иначе, если токен уже сохранён — проверить его через /api/me.
  useEffect(() => {
    async function init() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");

      if (code) {
        try {
          const result = await api.loginWithDiscord(code, getRedirectUri());
          await applyLoginResult(result);
        } catch (e) {
          setError(e.message || "Не удалось войти через Discord");
        } finally {
          // убираем ?code= из адресной строки, чтобы не осталось в истории/при обновлении
          url.searchParams.delete("code");
          window.history.replaceState({}, "", url.toString());
          setLoading(false);
        }
        return;
      }

      if (token) {
        try {
          await loadMe(token);
        } catch {
          logout();
        }
      }
      setLoading(false);
    }

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = {
    token,
    user,
    access,
    regiments,
    loading,
    error,
    isAuthenticated: Boolean(token && user),
    login: () => {
      window.location.href = buildDiscordLoginUrl();
    },
    loginWithPassword,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth должен использоваться внутри AuthProvider");
  return ctx;
}
