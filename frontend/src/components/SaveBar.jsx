/** Плавающая плашка снизу экрана в духе Discord: появляется, когда есть
 * несохранённые изменения, и предлагает сохранить их или отменить. */
export function SaveBar({ visible, saving, label = "Есть несохранённые изменения", onSave, onReset }) {
  if (!visible) return null;

  return (
    <div className="save-bar fade-in-up">
      <span className="save-bar-label">{label}</span>
      <div className="save-bar-actions">
        <button className="ghost" onClick={onReset} disabled={saving}>
          Отменить
        </button>
        <button className="primary" onClick={onSave} disabled={saving}>
          {saving ? "Сохранение..." : "Сохранить изменения"}
        </button>
      </div>
    </div>
  );
}
