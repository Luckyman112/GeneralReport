import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { PageLoading } from "../components/PageLoading";
import { formatMskDate } from "../utils/formatDate";

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export function BackupsPage() {
  const { token } = useAuth();
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
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

  if (loading) return <PageLoading />;

  return (
    <div className="backups-page">
      <h2>Резервные копии базы данных</h2>
      <p className="hint-text">Хранятся только 20 последних копий — более старые удаляются автоматически.</p>

      <div className="report-form-actions">
        <button className="primary" onClick={handleCreate} disabled={creating}>
          {creating ? "Создаётся..." : "Сделать бэкап"}
        </button>
      </div>

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
                <button onClick={() => api.downloadBackup(token, b.filename)}>Скачать</button>
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
