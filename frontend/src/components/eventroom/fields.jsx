import { useRef, useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { formatFullName } from "../../utils/formatName";
import { MemberSearchPicker } from "../MemberSearchPicker";

/* Общие поля форм заявок Ивентрума (вынесены из EventRoomPage.jsx). */

export function emptyAudience() {
  return { mode: "role", regiment_id: null, custom_name: "", discord_ids: [] };
}

// Формат, который понимает DateTimePicker (см. его собственный formatValue) —
// нужен здесь отдельно, чтобы подставлять starts_at выбранной брони в
// "Начало брифинга" тем же форматом, что вводит сам пользователь
export function toPickerValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Роль формирования (либо своё название, если формирование нишевое и его нет
 * в каталоге CRM — см. решение пользователя) либо конкретные люди —
 * переиспользуется для "Участвующий отряд/состав" и "Приписной состав". */
export function AudienceField({ label, value, onChange, regiments, members }) {
  function setMode(mode) {
    onChange({ ...value, mode });
  }

  function addPerson(discordId) {
    if (!discordId || value.discord_ids.includes(discordId)) return;
    onChange({ ...value, discord_ids: [...value.discord_ids, discordId] });
  }

  function removePerson(discordId) {
    onChange({ ...value, discord_ids: value.discord_ids.filter((id) => id !== discordId) });
  }

  const isCustom = value.regiment_id === "__custom__";

  return (
    <div className="add-category-form">
      <label>{label}</label>
      <div className="picker-row">
        <label className="checkbox-label">
          <input type="radio" checked={value.mode === "role"} onChange={() => setMode("role")} />
          Формирование
        </label>
        <label className="checkbox-label">
          <input type="radio" checked={value.mode === "people"} onChange={() => setMode("people")} />
          Люди
        </label>
      </div>
      {value.mode === "role" ? (
        <>
          <select
            value={isCustom ? "__custom__" : value.regiment_id || ""}
            onChange={(e) => {
              if (e.target.value === "__custom__") {
                onChange({ ...value, regiment_id: "__custom__", custom_name: value.custom_name || " " });
              } else {
                onChange({ ...value, regiment_id: e.target.value ? Number(e.target.value) : null, custom_name: "" });
              }
            }}
          >
            <option value="">— формирование —</option>
            {regiments.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value="__custom__">— другое (вписать) —</option>
          </select>
          {isCustom && (
            <input
              type="text"
              placeholder="Название формирования"
              value={value.custom_name.trim()}
              onChange={(e) => onChange({ ...value, custom_name: e.target.value })}
            />
          )}
        </>
      ) : (
        <>
          <MemberSearchPicker members={members} selectedId="" onSelect={addPerson} />
          {value.discord_ids.length > 0 && (
            <ul className="chip-list">
              {value.discord_ids.map((discordId) => {
                const m = members.find((mm) => mm.discord_id === discordId);
                return (
                  <li key={discordId} className="chip">
                    {m ? formatFullName(m) : discordId}
                    <button type="button" onClick={() => removePerson(discordId)}>
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** Список задач либо доп. задач — два независимых заполняемых списка (см.
 * решение пользователя: например 3 задачи и 4 доп. задачи), каждый со своей
 * нумерацией в карточке. */
export function TasksField({ tasks, onChange, label, addLabel }) {
  // Стабильные id по позиции — plain string[] не несёт identity сам по себе,
  // а index-ключ путает React при удалении задачи не с конца (инпут ниже
  // "наследует" фокус/значение соседа вместо удаления своего).
  const nextIdRef = useRef(0);
  const idsRef = useRef(tasks.map(() => nextIdRef.current++));
  if (idsRef.current.length < tasks.length) {
    while (idsRef.current.length < tasks.length) idsRef.current.push(nextIdRef.current++);
  } else if (idsRef.current.length > tasks.length) {
    idsRef.current = idsRef.current.slice(0, tasks.length);
  }

  function setTask(idx, value) {
    onChange(tasks.map((t, i) => (i === idx ? value : t)));
  }
  function addTask() {
    idsRef.current = [...idsRef.current, nextIdRef.current++];
    onChange([...tasks, ""]);
  }
  function removeTask(idx) {
    if (tasks.length > 1) {
      idsRef.current = idsRef.current.filter((_, i) => i !== idx);
      onChange(tasks.filter((_, i) => i !== idx));
    } else {
      idsRef.current = [nextIdRef.current++];
      onChange([""]);
    }
  }

  return (
    <div className="add-category-form">
      {tasks.map((t, idx) => (
        <label key={idsRef.current[idx]}>
          {tasks.length === 1 ? label : `${label} ${idx + 1}`}
          <span className="picker-row">
            <input type="text" value={t} onChange={(e) => setTask(idx, e.target.value)} />
            <button type="button" className="ghost" onClick={() => removeTask(idx)} disabled={tasks.length === 1 && !t}>
              ×
            </button>
          </span>
        </label>
      ))}
      <button type="button" className="ghost" onClick={addTask}>
        {addLabel}
      </button>
    </div>
  );
}

export function MapImageField({ value, onChange }) {
  const { token } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { url } = await api.uploadEventMapImage(token, file);
      onChange(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <label>
      Своё изображение карты (необязательно)
      {value ? (
        <span className="picker-row">
          <img src={value} alt="Карта" style={{ maxHeight: 80, borderRadius: 6 }} />
          <button type="button" className="ghost" onClick={() => onChange("")}>
            Убрать
          </button>
        </span>
      ) : (
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} disabled={uploading} />
      )}
      {error && <p className="error-text">{error}</p>}
    </label>
  );
}
