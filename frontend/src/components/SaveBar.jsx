// sticky=true: for use inside a scrollable modal, position:fixed anchors to
// viewport not the modal, so it drifts over content on scroll otherwise
export function SaveBar({ visible, saving, label = "Есть несохранённые изменения", onSave, onReset, sticky = false }) {
  if (!visible) return null;

  return (
    <div className={`save-bar fade-in-up${sticky ? " save-bar-sticky" : ""}`}>
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
