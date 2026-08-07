import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const SERVICE_ID_RE = /^\d{4}$/;
const STEAM_ID_RE = /^STEAM_[0-5]:[01]:\d+$/;
const STEAM_ID64_RE = /^\d{17}$/;

const FIELD_STEPS = [
  {
    key: "callsign",
    label: "ПОЗЫВНОЙ",
    ask: "Введите позывной, под которым вас будут знать в строю.",
    hint: "2–18 символов.",
    validate: (v) => (v.trim().length >= 2 && v.trim().length <= 18) || "Позывной должен быть от 2 до 18 символов.",
  },
  {
    key: "serviceId",
    label: "ИДН",
    ask: "Введите личный номер (ИДН) — ровно 4 цифры.",
    hint: "Например: 0417.",
    validate: (v) => SERVICE_ID_RE.test(v.trim()) || "ИДН должен состоять ровно из 4 цифр.",
  },
];

const STEP_LABELS = ["Discord подтверждён", "Steam-аккаунт", "Позывной", "Личный номер (ИДН)", "Проверка и отправка"];
const CONFIRM_WORDS = ["ДА", "DA", "YES", "Y", "+"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Терминал зачисления — печатающий CRT-датапад, но с реальными полями бэкенда
 * и реальной отправкой. Steam ID теперь подтверждается настоящим входом через
 * Steam (OpenID, см. app/api/steam.py) вместо ручного набора — убирает целый
 * класс опечаток; ручной ввод остаётся запасным вариантом (кнопка ниже поля).
 * Шаг "Проверка" перед отправкой — защита от опечаток в ИДН (можно свериться и
 * вернуться Shift+Tab, не отправляя заявку с ошибкой). Дубликаты ИДН/Steam ID
 * отклоняет сервер — см. app/api/registration.py и app/api/steam.py. */
export function RegistrationGate() {
  const { token, user, access, regiments, refreshMe } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const [lines, setLines] = useState([]);
  const [step, setStep] = useState(0); // 0 intro, 1 steam, 2-3 поля, 4 проверка, 5 отправлено
  const [busy, setBusy] = useState(true);
  const [inputValue, setInputValue] = useState("");
  const [dossier, setDossier] = useState({ callsign: "", serviceId: "", steamId: "" });
  const [steamManual, setSteamManual] = useState(false);

  const linesRef = useRef([]);
  const dataRef = useRef({ callsign: "", serviceId: "", steamId: "" });
  const inputRef = useRef(null);
  const scrRef = useRef(null);
  const startedRef = useRef(false); // защита от двойного запуска в StrictMode
  const steamStatusRef = useRef(searchParams.get("steam")); // ?steam=linked|error|duplicate после редиректа

  const alreadySubmitted = Boolean(user?.service_id) && user?.registration_status === "pending";
  const isRejected = user?.registration_status === "rejected";

  const detectedRegimentNames = regiments
    .filter((r) => (access?.commander_regiment_ids || []).includes(r.id) || (access?.soldier_regiment_ids || []).includes(r.id))
    .map((r) => r.name);

  useEffect(() => {
    if (searchParams.get("steam")) setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pushLine(tone, text) {
    linesRef.current = [...linesRef.current, { tone, text }];
    setLines(linesRef.current);
  }

  async function typeLine(tone, text, speed = 8) {
    const idx = linesRef.current.length;
    linesRef.current = [...linesRef.current, { tone, text: "" }];
    setLines(linesRef.current);
    let acc = "";
    for (let i = 0; i < text.length; i++) {
      acc += text[i];
      linesRef.current = linesRef.current.map((l, j) => (j === idx ? { tone, text: acc } : l));
      setLines(linesRef.current);
      if (i % 2 === 0) await sleep(speed);
    }
  }

  function focusInput() {
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function askSteamStep() {
    setBusy(true);
    setSteamManual(false);

    if (user?.steam_id) {
      dataRef.current = { ...dataRef.current, steamId: user.steam_id };
      setDossier({ ...dataRef.current });
      await typeLine("g", `✓ Steam-аккаунт подтверждён: ${user.steam_id}`);
      pushLine("", "");
      setBusy(false);
      setStep(2);
      await askField(2);
      return;
    }

    if (steamStatusRef.current === "duplicate") {
      await typeLine("r", "✕ Этот Steam-аккаунт уже привязан к другому бойцу.");
      pushLine("dim", "      Если это ошибка — обратитесь к командованию.");
    } else if (steamStatusRef.current === "error") {
      await typeLine("r", "✕ Не удалось подтвердить Steam-аккаунт. Попробуйте ещё раз.");
    }
    steamStatusRef.current = null;

    await typeLine("", "Подтвердите Steam-аккаунт настоящим входом через Steam.");
    pushLine("dim", "      Разовая проверка владения аккаунтом — не пароль, ничего кроме SteamID мы не получаем.");
    setBusy(false);
  }

  async function handleSteamLogin() {
    setBusy(true);
    try {
      const { url } = await api.getSteamLoginUrl(token);
      window.location.href = url;
    } catch (e) {
      pushLine("r", `✕ ${e.message}`);
      setBusy(false);
    }
  }

  async function askField(n) {
    setBusy(true);
    const s = FIELD_STEPS[n - 2];
    await typeLine("", `[${n - 1}/3] ${s.ask}`);
    if (s.hint) pushLine("dim", `      ${s.hint}`);
    setInputValue(dataRef.current[s.key] || "");
    setBusy(false);
    focusInput();
  }

  async function askReview() {
    setBusy(true);
    await typeLine("", "Проверьте данные — при ошибке Shift+Tab возвращает к нужному полю.");
    pushLine("hot", `  Steam ID   ${dataRef.current.steamId}`);
    pushLine("hot", `  Позывной   ${dataRef.current.callsign}`);
    pushLine("hot", `  ИДН        ${dataRef.current.serviceId}`);
    await typeLine("", "Всё верно? Введите ДА для отправки заявки в штаб.");
    setInputValue("");
    setBusy(false);
    focusInput();
  }

  async function doSubmit() {
    setBusy(true);
    pushLine("hot", "ПРОВЕРКА> ДА");
    pushLine("", "");
    await typeLine("dim", "Отправка заявки в штаб …");
    try {
      await api.submitRegistration(token, {
        serviceId: dataRef.current.serviceId,
        callsign: dataRef.current.callsign,
        steamId: dataRef.current.steamId,
      });
      await typeLine("g", "✓ Заявка отправлена. Ожидает решения командира/заместителя формирования.");
      pushLine("dim", "Уведомление придёт в Discord.");
      setStep(5);
      await sleep(1100);
      await refreshMe();
    } catch (e) {
      await typeLine("r", `✕ ${e.message}`);
      pushLine("dim", "Исправьте данные и отправьте снова.");
      const backTo = /идн/i.test(e.message) ? 3 : 2;
      setStep(backTo);
      await askField(backTo);
    }
  }

  async function intro() {
    setBusy(true);
    await sleep(220);
    await typeLine("dim", "ТЕРМИНАЛ ЗАЧИСЛЕНИЯ · COLLAPSAR");
    await typeLine("g", `Учётная запись Discord подтверждена: ${user?.username}`);
    if (detectedRegimentNames.length > 0) {
      await typeLine("dim", `Формирование по роли Discord: ${detectedRegimentNames.join(", ")}`);
    } else {
      await typeLine("w", "Роль формирования по Discord не обнаружена — обратитесь к командованию.");
    }
    if (isRejected) {
      await typeLine("w", "Предыдущая заявка отклонена. Требуется повторная подача.");
    } else {
      await typeLine("dim", "Запись в реестре не найдена. Требуется постановка на учёт.");
    }
    pushLine("", "");
    setStep(1);
    await askSteamStep();
  }

  useEffect(() => {
    if (startedRef.current || alreadySubmitted) return;
    startedRef.current = true;
    intro();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (scrRef.current) scrRef.current.scrollTop = scrRef.current.scrollHeight;
  }, [lines, busy]);

  async function handleEnter() {
    if (busy) return;
    const v = inputValue;
    if (!v.trim()) return;

    if (step === 1 && steamManual) {
      pushLine("hot", `STEAM ID> ${v}`);
      const ok = STEAM_ID_RE.test(v.trim()) || STEAM_ID64_RE.test(v.trim());
      if (!ok) {
        pushLine("r", "  ✕ Ожидается формат STEAM_0:X:XXXXXXXX.");
        setInputValue("");
        return;
      }
      dataRef.current = { ...dataRef.current, steamId: v.trim() };
      setDossier({ ...dataRef.current });
      pushLine("g", "  ✓ принято (без подтверждения через Steam)");
      pushLine("", "");
      setInputValue("");
      setStep(2);
      await askField(2);
      return;
    }

    if (step === 2 || step === 3) {
      const s = FIELD_STEPS[step - 2];
      pushLine("hot", `${s.label}> ${v}`);
      const result = s.validate(v);
      if (result !== true) {
        pushLine("r", `  ✕ ${result}`);
        setInputValue("");
        return;
      }
      dataRef.current = { ...dataRef.current, [s.key]: v.trim() };
      setDossier({ ...dataRef.current });
      pushLine("g", "  ✓ принято");
      pushLine("", "");
      const next = step + 1;
      setStep(next);
      if (next <= 3) await askField(next);
      else await askReview();
      return;
    }

    if (step === 4) {
      if (!CONFIRM_WORDS.includes(v.trim().toUpperCase())) {
        pushLine("w", "  Введите ДА для отправки, либо Shift+Tab, чтобы исправить данные.");
        setInputValue("");
        return;
      }
      await doSubmit();
    }
  }

  async function handleBack() {
    if (busy || step <= 1) return;
    if (step === 2) {
      pushLine("dim", "← возврат к шагу «Steam-аккаунт»");
      setStep(1);
      await askSteamStep();
      return;
    }
    const prev = step === 4 ? 3 : step - 1;
    pushLine("dim", `← возврат к шагу «${FIELD_STEPS[prev - 2].label}»`);
    setStep(prev);
    await askField(prev);
  }

  function handleRestart() {
    linesRef.current = [];
    dataRef.current = { callsign: "", serviceId: "", steamId: "" };
    setLines([]);
    setDossier({ callsign: "", serviceId: "", steamId: "" });
    setInputValue("");
    setSteamManual(false);
    setStep(0);
    intro();
  }

  if (alreadySubmitted) {
    return (
      <div className="reg-console fade-in-up">
        <div className="term-top">
          <span className="term-brand">COLLAPSAR · ТЕРМИНАЛ ЗАЧИСЛЕНИЯ</span>
        </div>
        <h2>Заявка на регистрацию отправлена</h2>
        <p className="hint-text">Ожидайте одобрения от заместителя или командира вашего формирования.</p>
      </div>
    );
  }

  const promptLabel = step === 1 ? "STEAM ID" : step >= 2 && step <= 3 ? FIELD_STEPS[step - 2].label : "ПРОВЕРКА";
  const showTextPrompt = !busy && ((step === 1 && steamManual) || step === 2 || step === 3 || step === 4);
  const showSteamButton = !busy && step === 1 && !steamManual;

  return (
    <div className="reg-console fade-in-up">
      <div className="term-screws" aria-hidden="true">
        <i /><i /><i /><i />
      </div>
      <div className="term-top">
        <span className="term-brand">COLLAPSAR · ПОСТАНОВКА НА УЧЁТ</span>
        <span className="term-clearance">Портал / Регистрация / терминал зачисления</span>
      </div>

      <div className="reg-console-grid">
        <div className="term-rail" aria-hidden="true">
          <span className="term-dot term-dot-ok" />
          <span className={`term-dot ${step >= 2 ? "term-dot-ok" : ""}`} />
          <span className={`term-dot ${step >= 3 ? "term-dot-ok" : ""}`} />
          <span className="term-rail-tick" />
          <span className={`term-dot ${step >= 4 ? "term-dot-ok" : ""}`} />
          <span className={`term-dot ${step === 5 ? "term-dot-ok" : ""}`} />
          <span className="term-rail-label">учёт · связь · штаб</span>
        </div>

        <aside className="reg-steps">
          <h4>Этапы</h4>
          <ul>
            {STEP_LABELS.map((label, i) => {
              const done = i === 0 || i < step;
              const now = i === step && i !== 0;
              return (
                <li key={label} className={done ? "reg-step reg-step-done" : now ? "reg-step reg-step-now" : "reg-step"}>
                  <span className="reg-step-icon">{done ? "✓" : now ? "→" : i}</span>
                  {label}
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="term-bezel">
          <div className="term-crt">
            <div className="term-scr" ref={scrRef}>
              {lines.map((l, i) => (
                <p key={i} className={l.tone ? `term-${l.tone}` : undefined}>
                  {l.text || " "}
                </p>
              ))}

              {showSteamButton && (
                <p className="reg-steam-actions">
                  <button type="button" className="term-key term-key-primary" onClick={handleSteamLogin}>
                    Войти через Steam
                  </button>
                  <button
                    type="button"
                    className="term-key"
                    onClick={() => {
                      setSteamManual(true);
                      focusInput();
                    }}
                  >
                    Ввести вручную
                  </button>
                </p>
              )}

              {showTextPrompt && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleEnter();
                  }}
                >
                  <p>
                    <span className="term-hot">{promptLabel}&gt; </span>
                    <input
                      ref={inputRef}
                      className="term-input"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Tab" && e.shiftKey) {
                          e.preventDefault();
                          handleBack();
                        }
                      }}
                      aria-label={promptLabel}
                      autoFocus
                      maxLength={64}
                      autoComplete="off"
                      spellCheck={false}
                      enterKeyHint="done"
                    />
                  </p>
                </form>
              )}
            </div>
            <div className="term-sweep" aria-hidden="true" />
            <div className="term-flicker" aria-hidden="true" />
          </div>
        </div>

        <aside className="reg-dossier">
          <h4>Личное дело</h4>
          <div className="reg-dossier-row">
            <span>Discord</span>
            <b>{user?.username}</b>
          </div>
          <div className="reg-dossier-row">
            <span>Steam ID</span>
            <b className={dossier.steamId ? "mono-num" : "hint-text"}>
              {dossier.steamId || "— не задано —"}
              {user?.steam_verified && dossier.steamId && <span className="reg-verified-badge"> ✓ подтверждён</span>}
            </b>
          </div>
          <div className="reg-dossier-row">
            <span>Позывной</span>
            <b className={dossier.callsign ? "" : "hint-text"}>{dossier.callsign || "— не задано —"}</b>
          </div>
          <div className="reg-dossier-row">
            <span>ИДН</span>
            <b className={dossier.serviceId ? "mono-num" : "hint-text"}>{dossier.serviceId || "— не задано —"}</b>
          </div>
          <div className="reg-dossier-row">
            <span>Звание при зачислении</span>
            <b>RCT — Рекрут</b>
          </div>
        </aside>
      </div>

      <div className="term-deck">
        <div className="term-keys">
          <button type="button" className="term-key" onClick={handleBack} disabled={busy || step <= 1}>
            Shift+Tab — назад
          </button>
          <button type="button" className="term-key" onClick={handleRestart}>
            Начать заново
          </button>
        </div>
        <span className="term-hint">Ввод с клавиатуры · Enter подтверждает</span>
      </div>
    </div>
  );
}
