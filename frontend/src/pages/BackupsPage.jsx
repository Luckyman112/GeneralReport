import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { PageLoading } from "../components/PageLoading";
import { useToast } from "../components/ToastContext";
import { formatMskDate } from "../utils/formatDate";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export function BackupsPage() {
  const { token, logout } = useAuth();
  const showToast = useToast();
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [exportingSettings, setExportingSettings] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    try {
      setBackups(await api.listBackups(token));
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      await api.createBackup(token);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(filename) {
    try {
      await api.deleteBackup(token, filename);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleExportSettings() {
    setExportingSettings(true);
    setError(null);
    try {
      await api.downloadSettingsExport(token);
    } catch (e) {
      setError(e.message);
    } finally {
      setExportingSettings(false);
    }
  }

  async function handleDownload(filename) {
    try {
      await api.downloadBackup(token, filename);
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function handleRevokeAll() {
    setConfirmRevoke(false);
    setRevoking(true);
    setError(null);
    try {
      await api.revokeAllSessions(token);
      showToast("Все сессии отозваны — выполняется выход...");
      logout();
    } catch (e) {
      setError(e.message);
      setRevoking(false);
    }
  }

  if (loading) return <PageLoading />;

  return (
    <div className="backups-page">
      <h2>Резервные копии базы данных</h2>
      <p className="hint-text">Хранятся только 20 последних копий — более старые удаляются автоматически.</p>

      <div className="report-form-actions">
        <button className="primary" onClick={handleCreate} disabled={creating}>
          {creating ? "Создаётся..." : "Сделать бэкап"}
        </button>
        <button onClick={handleExportSettings} disabled={exportingSettings}>
          {exportingSettings ? "Выгружается..." : "Выгрузить настройки (JSON)"}
        </button>
      </div>
      <p className="hint-text">
        «Выгрузить настройки» сохраняет только составы/звания/категории рапортов/каталог
        специализаций (без участников и рапортов) — для переноса конфигурации на другой
        сервер или быстрого сравнения/отката настроек.
      </p>

      <h3>Сессии</h3>
      <p className="hint-text">
        На случай утечки или компрометации пароля — принудительно завершает все активные
        сессии (включая вашу собственную, придётся войти заново).
      </p>
      <div className="report-form-actions">
        <button className="danger-outline" onClick={() => setConfirmRevoke(true)} disabled={revoking}>
          {revoking ? "Выполняется..." : "Выйти у всех"}
        </button>
      </div>

      <ConfirmDialog
        open={confirmRevoke}
        message="Завершить все активные сессии? Все, включая вас, будут разлогинены и должны войти заново."
        confirmLabel="Выйти у всех"
        onConfirm={handleRevokeAll}
        onCancel={() => setConfirmRevoke(false)}
      />

      {error && <p className="error-text">{error}</p>}

      {backups.length === 0 ? (
        <EmptyState text="Резервных копий пока нет." />
      ) : (
        <ul className="category-list">
          {backups.map((b) => (
            <li key={b.filename}>
              <span>
                {b.filename} — {formatSize(b.size_bytes)} — {formatMskDate(b.created_at)} МСК
              </span>
              <span className="report-form-actions">
                <button onClick={() => handleDownload(b.filename)}>Скачать</button>
                <button className="ghost" onClick={() => handleDelete(b.filename)}>
                  Удалить
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
