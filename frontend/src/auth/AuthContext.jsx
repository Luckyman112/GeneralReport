import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { api, clearViewAs, getViewAs, setViewAs } from "../api/client";

const STORAGE_KEY = "collapsar_token";
// localStorage, not sessionStorage - should survive relogin unlike view-as
const ACTIVE_CHARACTER_STORAGE_KEY = "collapsar_active_character_regiment_id";

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
  // "Просмотр от лица" — восстанавливается из sessionStorage (см. client.js), чтобы
  // пережить обновление страницы; сбрасывается при выходе из аккаунта
  const [viewAs, setViewAsState] = useState(() => getViewAs());
  const [activeCharacterRegimentId, setActiveCharacterRegimentIdState] = useState(() => {
    const stored = localStorage.getItem(ACTIVE_CHARACTER_STORAGE_KEY);
    return stored ? Number(stored) : null;
  });

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    clearViewAs();
    setViewAsState(getViewAs());
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
      // pass current token so backend can check discord_id if already logged in
      const result = await api.loginWithPassword(password, token);
      await applyLoginResult(result);
    },
    [applyLoginResult, token]
  );

  const applyViewAs = useCallback(
    async (state) => {
      const previous = getViewAs();
      setViewAs(state);
      setViewAsState(getViewAs());
      try {
        await loadMe(token);
      } catch (e) {
        if (previous.mode) {
          setViewAs(previous);
        } else {
          clearViewAs();
        }
        setViewAsState(getViewAs());
        throw e;
      }
    },
    [loadMe, token]
  );

  const resetViewAs = useCallback(async () => {
    clearViewAs();
    setViewAsState(getViewAs());
    await loadMe(token);
  }, [loadMe, token]);

  // null = main profile, else character's regiment id; display pref only, no access impact
  const setActiveCharacterRegimentId = useCallback((regimentId) => {
    if (regimentId == null) {
      localStorage.removeItem(ACTIVE_CHARACTER_STORAGE_KEY);
    } else {
      localStorage.setItem(ACTIVE_CHARACTER_STORAGE_KEY, String(regimentId));
    }
    setActiveCharacterRegimentIdState(regimentId ?? null);
  }, []);

  const activeCharacter = activeCharacterRegimentId
    ? (access?.characters || []).find((c) => c.regiment.id === activeCharacterRegimentId) || null
    : null;

  // React StrictMode (dev) вызывает этот эффект дважды подряд при монтировании —
  // код Discord одноразовый, поэтому без этой защиты второй обмен тем же ?code=
  // гарантированно падает с ошибкой сразу после успешного первого входа
  const exchangeStartedRef = useRef(false);

  // При первой загрузке страницы: если Discord вернул ?code= — обменять его на токен.
  // Иначе, если токен уже сохранён — проверить его через /api/me.
  useEffect(() => {
    async function init() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");

      if (code) {
        if (exchangeStartedRef.current) return;
        exchangeStartedRef.current = true;
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
    viewAs,
    applyViewAs,
    resetViewAs,
    refreshMe: () => loadMe(token),
    activeCharacter,
    setActiveCharacterRegimentId,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth должен использоваться внутри AuthProvider");
  return ctx;
}
