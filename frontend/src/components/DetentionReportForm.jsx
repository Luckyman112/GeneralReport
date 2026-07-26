import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { MemberSearchPicker } from "./MemberSearchPicker";
import { PUNISHMENT_OPTIONS } from "../utils/punishment";

/** Рапорт о задержании — по сути та же форма нарушения (выбор нарушителя + описание),
 * но живёт в разделе "Рапорты": заводится в формировании автора и проходит обычный
 * путь черновик/отправлен/одобрен. При одобрении командиром автоматически становится
 * записью в "Нарушителях". Доступна только тем ролям/людям, кого назначил админ. */
export function DetentionReportForm({ regiments, categoriesById, onSubmit, onCancel }) {
  const { token, regiments: allRegiments } = useAuth();
  const [regimentId, setRegimentId] = useState(regiments[0]?.id ?? "");
  const [mode, setMode] = useState("discord");
  const [members, setMembers] = useState([]);
  const [targetId, setTargetId] = useState("");
  const [tiers, setTiers] = useState([]);
  const [serviceId, setServiceId] = useState("");
  const [rankId, setRankId] = useState("");
  // Формирование задержанного — всегда явное поле, независимо от способа выбора цели
  const [targetRegimentId, setTargetRegimentId] = useState("");
  const [callsign, setCallsign] = useState("");
  const [content, setContent] = useState("");
  const [punishmentType, setPunishmentType] = useState("");
  const [punishmentOtherText, setPunishmentOtherText] = useState("");
  const [punishmentAmount, setPunishmentAmount] = useState("");
  const [images, setImages] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getRanks(token).then(setTiers).catch(() => setTiers([]));
  }, [token]);

  useEffect(() => {
    if (!targetRegimentId) {
      setMembers([]);
      return;
    }
    api
      .getViolationTargetCandidates(token, targetRegimentId)
      .then(setMembers)
      .catch(() => setMembers([]));
    setTargetId("");
  }, [token, targetRegimentId]);

  const detentionCategory = Object.values(categoriesById).find(
    (c) => c.regiment_id === Number(regimentId) && c.is_detention
  );

  const isValid =
    content.trim() &&
    detentionCategory &&
    targetRegimentId &&
    punishmentType &&
    (punishmentType !== "other" || punishmentOtherText.trim()) &&
    (mode === "discord" ? Boolean(targetId) : serviceId.trim() && rankId && callsign.trim());

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        regimentId: Number(regimentId),
        categoryId: detentionCategory.id,
        content: content.trim(),
        targetDiscordId: mode === "discord" ? targetId : null,
        targetServiceId: mode === "manual" ? serviceId.trim() : null,
        targetRankId: mode === "manual" ? Number(rankId) : null,
        targetRegimentId: Number(targetRegimentId),
        targetCallsign: mode === "manual" ? callsign.trim() : null,
        punishmentType,
        punishmentOtherText: punishmentType === "other" ? punishmentOtherText.trim() : null,
        punishmentAmount: punishmentAmount.trim() || null,
        images,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="report-form fade-in-up" onSubmit={handleSubmit}>
      <h3>Рапорт о задержании</h3>

      {regiments.length > 1 && (
        <label>
          Формирование (от чьего лица подаётся)
          <select value={regimentId} onChange={(e) => setRegimentId(e.target.value)}>
            {regiments.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {!detentionCategory && (
        <p className="error-text">
          Для этого формирования не настроена категория "задержание" — обратитесь к высшему командованию.
        </p>
      )}

      <label>
        Формирование задержанного
        <select value={targetRegimentId} onChange={(e) => setTargetRegimentId(e.target.value)}>
          <option value="">— выбрать —</option>
          {allRegiments.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      <div className="violation-mode-toggle">
        <button type="button" className={mode === "discord" ? "primary" : ""} onClick={() => setMode("discord")}>
          Участник Discord
        </button>
        <button type="button" className={mode === "manual" ? "primary" : ""} onClick={() => setMode("manual")}>
          Вручную (не в Discord)
        </button>
      </div>

      {mode === "discord" ? (
        <label>
          Нарушитель
          <MemberSearchPicker members={members} selectedId={targetId} onSelect={setTargetId} />
        </label>
      ) : (
        <>
          <label>
            ИДН (4 цифры)
            <input type="text" maxLength={4} value={serviceId} onChange={(e) => setServiceId(e.target.value)} />
          </label>
          <label>
            Звание
            <select value={rankId} onChange={(e) => setRankId(e.target.value)}>
              <option value="">— выбрать —</option>
              {tiers.map((tier) => (
                <optgroup key={tier.id} label={tier.name}>
                  {tier.ranks.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} — {r.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            Позывной
            <input type="text" value={callsign} onChange={(e) => setCallsign(e.target.value)} />
          </label>
        </>
      )}

      <label>
        Нарушение
        <textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
      </label>

      <label>
        Вид наказания
        <select value={punishmentType} onChange={(e) => setPunishmentType(e.target.value)}>
          <option value="">— выбрать —</option>
          {PUNISHMENT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {punishmentType === "other" && (
        <label>
          Уточните наказание
          <input
            type="text"
            value={punishmentOtherText}
            onChange={(e) => setPunishmentOtherText(e.target.value)}
          />
        </label>
      )}

      <label>
        Кол-во (например: 20 отжиманий, 3 срока и т.п.)
        <input type="text" value={punishmentAmount} onChange={(e) => setPunishmentAmount(e.target.value)} />
      </label>

      <label>
        Скрин
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={(e) => setImages((prev) => [...prev, ...Array.from(e.target.files)])}
        />
      </label>

      {images.length > 0 && (
        <ul className="image-picker-list">
          {images.map((file, i) => (
            <li key={`${file.name}-${i}`}>
              {file.name}
              <button type="button" onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="error-text">{error}</p>}

      <div className="report-form-actions">
        <button className="primary" type="submit" disabled={submitting || !isValid}>
          Отправить
        </button>
        <button className="ghost" type="button" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}
