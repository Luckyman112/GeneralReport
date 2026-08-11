import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { MemberSearchPicker } from "./MemberSearchPicker";
import { useToast } from "./ToastContext";
import { commanderRoleLabel } from "../utils/regimentRoles";

const ROLE_LABELS = {
  soldier: "Боец",
  deputy: "Заместитель",
  commander: "Командир",
  mentor: "Наставник",
  high_command: "Высшее командование",
};

const EXTRA_LABELS = {
  instructor: "Инструктор",
  violation_writer: "Заводить нарушения",
  violation_viewer: "Видеть все нарушения",
  broadcast: "Рассылка",
  detention_report: "Кнопка задержания",
  training_viewer: "Инструкторская: обзор обучения",
  report_appeal: "Обжалование рапортов",
};
const EXTRA_KEYS = Object.keys(EXTRA_LABELS);
// these extras need a regiment to mean anything
const REGIMENT_SCOPED_EXTRAS = new Set(["violation_writer", "violation_viewer", "report_appeal"]);

// backend actually enforces this restriction, not just cosmetic. always shown
// so admin can exit simulation even if it locked them out of the current page

export function ViewAsBar() {
  const { token, access, regiments, viewAs, applyViewAs, resetViewAs } = useAuth();
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("role");
  const [role, setRole] = useState("commander");
  const [regimentId, setRegimentId] = useState(regiments[0]?.id ?? "");
  const [extras, setExtras] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [personDiscordId, setPersonDiscordId] = useState("");

  useEffect(() => {
    if (!open || mode !== "person" || candidates.length > 0) return;
    api.getViewAsCandidates(token).then(setCandidates).catch(() => setCandidates([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  if (!access?.can_use_view_as) return null;

  const needsRegiment = role !== "high_command";

  function toggleExtra(key) {
    setExtras((prev) => (prev.includes(key) ? prev.filter((e) => e !== key) : [...prev, key]));
  }

  async function handleReset() {
    try {
      await resetViewAs();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function handleApplyRole() {
    try {
      await applyViewAs({
        mode: "role",
        role,
        regimentId: needsRegiment ? Number(regimentId) : null,
        extras,
      });
      setOpen(false);
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function handleApplyPerson() {
    if (!personDiscordId) return;
    const person = candidates.find((c) => c.discord_id === personDiscordId);
    try {
      await applyViewAs({
        mode: "person",
        discordId: personDiscordId,
        discordUsername: person?.username || personDiscordId,
      });
      setOpen(false);
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  if (viewAs.mode) {
    if (viewAs.mode === "person") {
      return (
        <div className="view-as-bar">
          Смотрите глазами: <strong>{viewAs.discordUsername}</strong>
          <button className="ghost" onClick={handleReset}>
            Выключить просмотр
          </button>
        </div>
      );
    }
    const viewAsRegiment = regiments.find((r) => r.id === viewAs.regimentId);
    const regimentName = viewAsRegiment?.name;
    const roleLabel =
      viewAs.role === "commander"
        ? commanderRoleLabel("commander", viewAsRegiment?.is_jedi_order)
        : ROLE_LABELS[viewAs.role] || viewAs.role;
    const extraLabels = (viewAs.extras || []).map((e) => EXTRA_LABELS[e]).filter(Boolean);
    return (
      <div className="view-as-bar">
        Смотрите как: <strong>{roleLabel}</strong>
        {regimentName && ` — ${regimentName}`}
        {extraLabels.length > 0 && ` + ${extraLabels.join(", ")}`}
        <button className="ghost" onClick={handleReset}>
          Выключить просмотр
        </button>
      </div>
    );
  }

  return (
    <div className="view-as-bar view-as-bar-idle">
      {open ? (
        <div className="view-as-panel">
          <div className="view-as-mode-toggle">
            <button
              type="button"
              className={mode === "role" ? "primary" : "ghost"}
              onClick={() => setMode("role")}
            >
              По роли
            </button>
            <button
              type="button"
              className={mode === "person" ? "primary" : "ghost"}
              onClick={() => setMode("person")}
            >
              Конкретный человек
            </button>
          </div>

          {mode === "role" ? (
            <>
              <div className="view-as-row">
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="soldier">Боец</option>
                  <option value="deputy">Заместитель</option>
                  <option value="commander">
                    {commanderRoleLabel("commander", regiments.find((r) => r.id === Number(regimentId))?.is_jedi_order)}
                  </option>
                  <option value="mentor">Наставник</option>
                  <option value="high_command">Высшее командование</option>
                </select>
                {needsRegiment && (
                  <select value={regimentId} onChange={(e) => setRegimentId(e.target.value)}>
                    {regiments.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="view-as-extras">
                {EXTRA_KEYS.filter((key) => !REGIMENT_SCOPED_EXTRAS.has(key) || needsRegiment).map((key) => (
                  <label key={key} className="checkbox-label field-tag">
                    <input type="checkbox" checked={extras.includes(key)} onChange={() => toggleExtra(key)} />
                    {EXTRA_LABELS[key]}
                  </label>
                ))}
              </div>

              <div className="view-as-row">
                <button className="primary" onClick={handleApplyRole} disabled={needsRegiment && !regimentId}>
                  Применить
                </button>
                <button className="ghost" onClick={() => setOpen(false)}>
                  Отмена
                </button>
              </div>
            </>
          ) : (
            <>
              <MemberSearchPicker members={candidates} selectedId={personDiscordId} onSelect={setPersonDiscordId} />
              <div className="view-as-row">
                <button className="primary" onClick={handleApplyPerson} disabled={!personDiscordId}>
                  Применить
                </button>
                <button className="ghost" onClick={() => setOpen(false)}>
                  Отмена
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <button className="ghost" onClick={() => setOpen(true)}>
          Просмотр от лица...
        </button>
      )}
    </div>
  );
}
