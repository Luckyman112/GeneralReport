import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { PageLoading } from "../components/PageLoading";
import { useToast } from "../components/ToastContext";
import { useLiveEvents } from "../hooks/useLiveEvents";
import { formatFullName } from "../utils/formatName";

const POLL_INTERVAL_MS = 60000;

/** Заявки на перевод между формированиями, ожидающие решения — видны
 * заместителю+ формирования-источника И/ИЛИ формирования-цели (см.
 * app/api/transfer_requests.py::list_transfer_requests). Каждая сторона
 * одобряет отдельно; заместитель+ формирования-цели дополнительно выставляет
 * звание, с которым боец придёт в новое формирование. */
export function TransferRequestsPage() {
  const { token, access } = useAuth();
  const showToast = useToast();
  const [requests, setRequests] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [rankDraft, setRankDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const canActOn = (regimentId) =>
    access?.is_admin || access?.is_high_command || (access?.commander_regiment_ids || []).includes(regimentId);

  const load = useCallback(() => {
    api
      .listTransferRequests(token)
      .then(setRequests)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useLiveEvents("transfer_requests", load);

  useEffect(() => {
    load();
    api.getRanks(token).then(setTiers).catch(() => setTiers([]));
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load, token]);

  async function handleApproveSource(id) {
    try {
      await api.approveTransferSource(token, id);
      showToast("Одобрено со стороны формирования-источника");
      load();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function handleApproveTarget(id) {
    const rankId = rankDraft[id];
    if (!rankId) {
      showToast("Сначала выберите звание", "error");
      return;
    }
    try {
      await api.approveTransferTarget(token, id, Number(rankId));
      showToast("Одобрено со стороны формирования-цели");
      load();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function handleReject(id) {
    try {
      await api.rejectTransferRequest(token, id, "");
      showToast("Заявка отклонена");
      load();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  if (loading) return <PageLoading />;

  return (
    <div className="violations-page">
      <h2>Переводы между формированиями</h2>
      <p className="hint-text">
        Нужно одобрение заместителя+ обеих сторон. Заместитель+ формирования-получателя выставляет звание, с
        которым боец придёт в новое формирование.
      </p>

      {error && <p className="error-text">{error}</p>}

      {requests.length === 0 ? (
        <EmptyState text="Заявок нет." />
      ) : (
        <div className="report-list">
          {requests.map((r) => (
            <div key={r.id} className="report-row fade-in-up">
              <div className="report-row-header">
                <span className="report-regiment">
                  {r.from_regiment.name} · {formatFullName(r.user)}
                </span>
                <span className="report-category">
                  {r.from_regiment.name} → {r.to_regiment.name}
                </span>
              </div>
              <p className="report-content">Причина перевода: {r.reason}</p>
              <p className="hint-text">
                Источник: {r.approved_by_source ? `одобрил ${r.approved_by_source.username}` : "ожидает"} · Цель:{" "}
                {r.approved_by_target
                  ? `одобрил ${r.approved_by_target.username} (звание: ${r.target_rank?.code})`
                  : "ожидает"}
              </p>
              <div className="report-row-actions">
                {canActOn(r.from_regiment.id) && !r.approved_by_source && (
                  <button className="primary icon-button" onClick={() => handleApproveSource(r.id)}>
                    Одобрить как источник
                  </button>
                )}
                {canActOn(r.to_regiment.id) && !r.approved_by_target && (
                  <>
                    <select
                      value={rankDraft[r.id] ?? ""}
                      onChange={(e) => setRankDraft((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    >
                      <option value="">— звание —</option>
                      {tiers
                        .filter((tier) => (r.to_regiment.is_jedi_order ? tier.is_jedi : !tier.is_jedi))
                        .flatMap((tier) =>
                          tier.ranks.map((rank) => (
                            <option key={rank.id} value={rank.id}>
                              {rank.code} — {rank.name}
                            </option>
                          ))
                        )}
                    </select>
                    <button className="primary icon-button" onClick={() => handleApproveTarget(r.id)}>
                      Одобрить как цель
                    </button>
                  </>
                )}
                {(canActOn(r.from_regiment.id) || canActOn(r.to_regiment.id)) && (
                  <button className="icon-button" onClick={() => handleReject(r.id)}>
                    Отклонить
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
