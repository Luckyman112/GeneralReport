import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog } from "./ConfirmDialog";
import { InlineSpinner } from "./InlineSpinner";
import { SaveBar } from "./SaveBar";
import { useToast } from "./ToastContext";
import { StatusBadge } from "./StatusBadge";
import { useLiveEvents } from "../hooks/useLiveEvents";
import { formatMskDate } from "../utils/formatDate";
import { formatFullName, formatFullNameAtRank } from "../utils/formatName";
import { steamProfileUrl } from "../utils/steam";
import { discordProfileUrl } from "../utils/discord";
import { DISCIPLINE_CATEGORIES } from "../utils/specialization";

function profileSnapshot(member) {
  return {
    serviceId: member.service_id ?? "",
    callsign: member.callsign ?? "",
    rankId: member.rank?.id ?? "",
    isInactive: member.is_inactive ?? false,
  };
}

export function MemberDetailModal({ member, regimentId, canEdit, onClose, onSaved }) {
  const { token, access, regiments } = useAuth();
  const regiment = regiments.find((r) => r.id === regimentId);
  const showToast = useToast();
  const [baseline, setBaseline] = useState(() => profileSnapshot(member));
  const [photoUrl, setPhotoUrl] = useState(member.photo_url ?? null);
  const [serviceId, setServiceId] = useState(baseline.serviceId);
  const [callsign, setCallsign] = useState(baseline.callsign);
  const [rankId, setRankId] = useState(baseline.rankId);
  const [isInactive, setIsInactive] = useState(baseline.isInactive);
  const [tiers, setTiers] = useState([]);
  const [reports, setReports] = useState([]);
  const [reprimands, setReprimands] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [promotionStatus, setPromotionStatus] = useState(null);
  const [newReprimandReason, setNewReprimandReason] = useState("");
  const [newReprimandSeverity, setNewReprimandSeverity] = useState("strict");
  const [newReprimandPoints, setNewReprimandPoints] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [expandedRankKey, setExpandedRankKey] = useState(null);
  const [showReprimandHistory, setShowReprimandHistory] = useState(false);
  const [confirmDeleteReprimandId, setConfirmDeleteReprimandId] = useState(null);
  const [showProfileHistory, setShowProfileHistory] = useState(false);
  const [profileHistory, setProfileHistory] = useState(null);
  const [earlyPromotionReason, setEarlyPromotionReason] = useState("");
  const [specializations, setSpecializations] = useState([]);
  const [specializationCatalog, setSpecializationCatalog] = useState([]);
  const [newSpecializationId, setNewSpecializationId] = useState("");
  const [specializationBans, setSpecializationBans] = useState([]);
  const [newBanSpecializationId, setNewBanSpecializationId] = useState("");
  const [newBanUntilDate, setNewBanUntilDate] = useState("");
  const [newBanPermanent, setNewBanPermanent] = useState(false);
  const [newBanReason, setNewBanReason] = useState("");

  // Баллы за рапорт (Report.points) относятся к автору рапорта — для рапортов, где
  // боец лишь указан участником, здесь этой суммы нет (баллы участника хранятся
  // отдельно на ReportParticipant.points, эта ручка их не отдаёт), поэтому в общий
  // итог их не включаем, чтобы не приписывать бойцу чужие баллы за рапорт
  const totalPoints = reports
    .filter((r) => r.author?.discord_id === member.discord_id)
    .reduce((sum, r) => sum + (r.points ?? 0), 0);

  // Рапорты, свёрнутые по званию автора на момент подачи — клик по званию
  // открывает список рапортов, поданных в этом звании (не показываем все сразу)
  const reportsByRank = useMemo(() => {
    const groups = new Map();
    for (const r of reports) {
      const key = r.author_rank?.id ?? "none";
      if (!groups.has(key)) {
        groups.set(key, { key, rank: r.author_rank, reports: [] });
      }
      groups.get(key).reports.push(r);
    }
    return Array.from(groups.values());
  }, [reports]);
  const memberReprimands = reprimands.filter((r) => r.target.discord_id === member.discord_id);
  const activeReprimands = memberReprimands.filter((r) => !r.revoked_at);
  const hasActiveReprimand = memberReprimands.some((r) => !r.revoked_at && r.severity !== "verbal");
  const memberLeaveRequests = leaveRequests.filter((r) => r.user.discord_id === member.discord_id);

  const LEAVE_STATUS_LABELS = { pending: "ожидает решения", approved: "одобрена", rejected: "отклонена" };

  const loadReprimands = useCallback(() => {
    api
      .listReprimands(token, regimentId)
      .then(setReprimands)
      .catch(() => setReprimands([]));
  }, [token, regimentId]);

  useLiveEvents("reprimands", loadReprimands);

  function loadPromotionStatus() {
    api
      .getMemberPromotionStatus(token, regimentId, member.discord_id)
      .then(setPromotionStatus)
      .catch(() => setPromotionStatus(null));
  }

  function loadSpecializations() {
    api
      .listMemberSpecializations(token, member.discord_id)
      .then(setSpecializations)
      .catch(() => setSpecializations([]));
  }

  function loadSpecializationBans() {
    api
      .listSpecializationBans(token, member.discord_id)
      .then(setSpecializationBans)
      .catch(() => setSpecializationBans([]));
  }

  useEffect(() => {
    api
      .getMemberReports(token, regimentId, member.discord_id)
      .then(setReports)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    loadReprimands();
    api
      .listLeaveRequests(token)
      .then(setLeaveRequests)
      .catch(() => setLeaveRequests([]));
    loadPromotionStatus();
    loadSpecializations();
    loadSpecializationBans();
    api.listSpecializations(token).then(setSpecializationCatalog).catch(() => setSpecializationCatalog([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, regimentId, member.discord_id]);

  useEffect(() => {
    api.getRanks(token).then(setTiers).catch(() => setTiers([]));
  }, [token]);

  async function handleIssueReprimand(e) {
    e.preventDefault();
    if (!newReprimandReason.trim()) return;
    setError(null);
    try {
      await api.issueReprimand(token, regimentId, {
        targetDiscordId: member.discord_id,
        reason: newReprimandReason.trim(),
        severity: newReprimandSeverity,
        pointsRequired: newReprimandPoints ? Number(newReprimandPoints) : 0,
      });
      setNewReprimandReason("");
      setNewReprimandPoints("");
      loadReprimands();
      loadPromotionStatus();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRevokeReprimand(reprimandId) {
    try {
      await api.revokeReprimand(token, regimentId, reprimandId);
      loadReprimands();
      loadPromotionStatus();
    } catch (e) {
      setError(e.message);
    }
  }

  const canDeleteReprimandHistory = access?.is_admin || access?.is_high_command;

  // дисциплинарные категории (медик/пилот/инженер) выдаёт только инструктор
  // соответствующей дисциплины или универсальный (см. Settings -> Инструкторы и
  // дисциплины)
  const canGrantCategory = (category) =>
    access?.is_admin ||
    access?.is_universal_instructor ||
    (access?.instructor_disciplines || []).includes(category) ||
    !DISCIPLINE_CATEGORIES.includes(category);

  const grantedSpecializationIds = new Set(specializations.map((s) => s.specialization.id));
  const availableSpecializations = specializationCatalog.filter(
    (s) =>
      !grantedSpecializationIds.has(s.id) &&
      canGrantCategory(s.category) &&
      // подспециализация — сначала нужна родительская
      (s.parent_id == null || grantedSpecializationIds.has(s.parent_id))
  );

  async function handleGrantSpecialization() {
    if (!newSpecializationId) return;
    setError(null);
    try {
      await api.grantSpecialization(token, member.discord_id, Number(newSpecializationId));
      setNewSpecializationId("");
      loadSpecializations();
      showToast("Специализация выдана");
    } catch (e) {
      setError(e.message);
      showToast(e.message, "error");
    }
  }

  async function handleRevokeSpecialization(grantId) {
    setError(null);
    try {
      await api.revokeSpecialization(token, member.discord_id, grantId);
      loadSpecializations();
      showToast("Специализация снята");
    } catch (e) {
      setError(e.message);
      showToast(e.message, "error");
    }
  }

  async function handleCreateBan() {
    if (!newBanPermanent && !newBanUntilDate) return;
    setError(null);
    try {
      await api.createSpecializationBan(token, member.discord_id, {
        specializationId: newBanSpecializationId ? Number(newBanSpecializationId) : null,
        untilDate: newBanPermanent ? null : newBanUntilDate,
        reason: newBanReason.trim(),
      });
      setNewBanSpecializationId("");
      setNewBanUntilDate("");
      setNewBanPermanent(false);
      setNewBanReason("");
      loadSpecializationBans();
      showToast("Запрет на обучение выставлен");
    } catch (e) {
      setError(e.message);
      showToast(e.message, "error");
    }
  }

  async function handleDeleteBan(banId) {
    setError(null);
    try {
      await api.deleteSpecializationBan(token, member.discord_id, banId);
      loadSpecializationBans();
      showToast("Запрет снят");
    } catch (e) {
      setError(e.message);
      showToast(e.message, "error");
    }
  }

  async function handleDeleteReprimand(reprimandId) {
    try {
      await api.deleteReprimand(token, regimentId, reprimandId);
      loadReprimands();
    } catch (e) {
      setError(e.message);
    }
  }

  const isDirty = serviceId !== baseline.serviceId || callsign !== baseline.callsign || rankId !== baseline.rankId;

  function handleResetProfile() {
    setServiceId(baseline.serviceId);
    setCallsign(baseline.callsign);
    setRankId(baseline.rankId);
    setEarlyPromotionReason("");
  }

  const [confirmDischarge, setConfirmDischarge] = useState(false);

  async function handleDischarge() {
    setConfirmDischarge(false);
    setError(null);
    try {
      await api.setMemberProfile(token, regimentId, member.discord_id, { is_inactive: true });
      showToast("Боец разжалован");
      onSaved();
      onClose();
    } catch (e) {
      setError(e.message);
      showToast(e.message, "error");
    }
  }

  async function handleReinstate() {
    setError(null);
    try {
      await api.setMemberProfile(token, regimentId, member.discord_id, { is_inactive: false });
      setIsInactive(false);
      showToast("Боец восстановлен в строй");
      loadPromotionStatus();
      onSaved();
    } catch (e) {
      setError(e.message);
      showToast(e.message, "error");
    }
  }

  async function handlePhotoUpload(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const updated = await api.uploadMemberPhoto(token, regimentId, member.discord_id, file);
      setPhotoUrl(updated.photo_url);
      showToast("Фото загружено");
      onSaved();
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    }
  }

  async function handlePhotoDelete() {
    setError(null);
    try {
      const updated = await api.deleteMemberPhoto(token, regimentId, member.discord_id);
      setPhotoUrl(updated.photo_url);
      showToast("Фото удалено");
      onSaved();
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    }
  }

  async function handleSaveProfile() {
    setSaving(true);
    setError(null);
    try {
      const rankChanged = rankId !== baseline.rankId;
      await api.setMemberProfile(token, regimentId, member.discord_id, {
        service_id: serviceId.trim() || null,
        callsign: callsign.trim() || null,
        rank_id: rankId === "" ? null : Number(rankId),
        ...(rankChanged ? { early_promotion_reason: earlyPromotionReason.trim() || null } : {}),
      });
      setBaseline({ serviceId, callsign, rankId, isInactive });
      setEarlyPromotionReason("");
      showToast("Профиль сохранён");
      loadPromotionStatus();
      onSaved();
    } catch (e) {
      setError(e.message);
      showToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Закрыть" onClick={onClose}>
          ×
        </button>
        <button
          type="button"
          className="ghost no-print member-detail-print-button"
          onClick={() => window.print()}
          title="Печать / сохранить как PDF"
        >
          Печать / PDF
        </button>
        <div className="member-detail-header">
          {(photoUrl || member.avatar_url) && (
            <img src={photoUrl || member.avatar_url} alt="" className="member-detail-photo" />
          )}
          <div>
            <h3>{member.username}</h3>
            <p className="hint-text">
              Discord:{" "}
              <a href={discordProfileUrl(member.discord_id)} target="_blank" rel="noreferrer">
                {member.discord_username}
              </a>
            </p>
            {member.steam_id && (
              <p className="hint-text">
                Steam ID:{" "}
                {steamProfileUrl(member.steam_id) ? (
                  <a href={steamProfileUrl(member.steam_id)} target="_blank" rel="noreferrer">
                    {member.steam_id}
                  </a>
                ) : (
                  member.steam_id
                )}
              </p>
            )}
            <p className="hint-text">
              Последний вход: {member.last_login_at ? `${formatMskDate(member.last_login_at)} МСК` : "не входил"}
            </p>
          </div>
        </div>
        {canEdit && (
          <div className="no-print member-detail-photo-controls">
            <label className="ghost" style={{ cursor: "pointer" }}>
              {photoUrl ? "Заменить фото" : "Загрузить фото"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: "none" }}
                onChange={handlePhotoUpload}
              />
            </label>
            {photoUrl && (
              <button type="button" className="ghost" onClick={handlePhotoDelete}>
                Убрать фото
              </button>
            )}
          </div>
        )}

        {canEdit ? (
          <div className="member-profile-form">
            <label>
              ИДН (4 цифры)
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="0000"
              />
            </label>
            <label>
              Звание
              <select value={rankId} onChange={(e) => setRankId(e.target.value)}>
                <option value="">— не назначено —</option>
                {tiers
                  .filter((tier) => (regiment?.is_jedi_order ? tier.is_jedi : !tier.is_jedi))
                  .map((tier) => (
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
              Позывной (он же веб-ник — используется везде, включая рапорты)
              <input type="text" value={callsign} onChange={(e) => setCallsign(e.target.value)} />
            </label>
            {rankId !== baseline.rankId && (
              <label>
                Причина досрочного повышения
                <input
                  type="text"
                  value={earlyPromotionReason}
                  onChange={(e) => setEarlyPromotionReason(e.target.value)}
                />
              </label>
            )}
            {member.early_promoted_by_username && (
              <p className="hint-text">
                Досрочно повысил: {member.early_promoted_by_username}
                {member.early_promotion_reason && ` — ${member.early_promotion_reason}`}
              </p>
            )}
            {isInactive ? (
              <div className="discharge-panel">
                <p className="hint-text">Боец разжалован — не может писать рапорты и не отображается в составе.</p>
                <button type="button" className="ghost" onClick={handleReinstate}>
                  Восстановить в строй
                </button>
              </div>
            ) : (
              <div className="discharge-panel">
                <button type="button" className="ghost error-text" onClick={() => setConfirmDischarge(true)}>
                  Разжаловать
                </button>
                <p className="hint-text">
                  Профиль обнулится (ИДН/звание/позывной), боец пропадёт из состава и при восстановлении пройдёт
                  регистрацию заново.
                </p>
              </div>
            )}
            <ConfirmDialog
              open={confirmDischarge}
              message={`Разжаловать ${formatFullName(member)}? Профиль обнулится, боец пропадёт из состава и пройдёт регистрацию заново при восстановлении.`}
              confirmLabel="Разжаловать"
              onConfirm={handleDischarge}
              onCancel={() => setConfirmDischarge(false)}
            />
            <SaveBar
              visible={isDirty}
              saving={saving}
              label="Есть несохранённые изменения в профиле"
              onSave={handleSaveProfile}
              onReset={handleResetProfile}
              sticky
            />
          </div>
        ) : (
          member.rank && (
            <p className="hint-text">
              {member.rank.code} — {member.rank.name}
              {member.callsign && ` · ${member.callsign}`}
            </p>
          )
        )}
        {error && <p className="error-text">{error}</p>}

        <h4>Специализации</h4>
        {specializations.length === 0 ? (
          <p className="hint-text">Специализаций пока не выдано.</p>
        ) : (
          <ul className="chip-list">
            {specializations.map((s) => (
              <li key={s.id} className="chip" title={`Выдал: ${formatFullName(s.granted_by)} · ${formatMskDate(s.granted_at)} МСК`}>
                {s.specialization.code} — {s.specialization.name}
                {access?.can_grant_specializations && (
                  <button type="button" onClick={() => handleRevokeSpecialization(s.id)}>
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {access?.can_grant_specializations && (
          <div className="add-category-form">
            <select value={newSpecializationId} onChange={(e) => setNewSpecializationId(e.target.value)}>
              <option value="">— выбрать специализацию —</option>
              {availableSpecializations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
            <button type="button" disabled={!newSpecializationId} onClick={handleGrantSpecialization}>
              Выдать
            </button>
          </div>
        )}

        {specializationBans.length > 0 && (
          <>
            <h4>Запреты на обучение</h4>
            <ul className="member-report-list">
              {specializationBans.map((b) => {
                const isActive = !b.until_date || new Date(b.until_date) >= new Date(new Date().toDateString());
                return (
                  <li key={b.id}>
                    <span className={isActive ? "error-text" : "hint-text"}>
                      {b.specialization ? `${b.specialization.code} — ${b.specialization.name}` : "Всё обучение"}
                      {" "}
                      {b.until_date ? `до ${b.until_date}` : "навсегда"}
                      {!isActive && " (истёк)"}
                    </span>
                    {b.reason && <p className="member-report-content">{b.reason}</p>}
                    {access?.can_grant_specializations && (
                      <button className="ghost" onClick={() => handleDeleteBan(b.id)}>
                        Снять
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {access?.can_grant_specializations && (
          <div className="add-category-form">
            <select value={newBanSpecializationId} onChange={(e) => setNewBanSpecializationId(e.target.value)}>
              <option value="">— весь состав (любое обучение) —</option>
              {specializationCatalog.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={newBanUntilDate}
              onChange={(e) => setNewBanUntilDate(e.target.value)}
              disabled={newBanPermanent}
              placeholder={newBanPermanent ? "навсегда" : undefined}
            />
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={newBanPermanent}
                onChange={(e) => {
                  setNewBanPermanent(e.target.checked);
                  if (e.target.checked) setNewBanUntilDate("");
                }}
              />
              Навсегда
            </label>
            <input
              type="text"
              placeholder="Причина (необязательно)"
              value={newBanReason}
              onChange={(e) => setNewBanReason(e.target.value)}
            />
            <button type="button" disabled={!newBanPermanent && !newBanUntilDate} onClick={handleCreateBan}>
              Запретить обучение
            </button>
          </div>
        )}

        {canEdit && (
          <>
            <button
              type="button"
              className="ghost rank-accordion-header"
              onClick={() => {
                if (!showProfileHistory && profileHistory === null) {
                  api
                    .getMemberHistory(token, regimentId, member.discord_id)
                    .then(setProfileHistory)
                    .catch((e) => setError(e.message));
                }
                setShowProfileHistory((v) => !v);
              }}
            >
              <span className={`rank-accordion-arrow ${showProfileHistory ? "rank-accordion-arrow-open" : ""}`}>▸</span>
              <span>История изменений профиля</span>
            </button>
            {showProfileHistory && (
              profileHistory === null ? (
                <p className="hint-text">Загрузка...</p>
              ) : profileHistory.length === 0 ? (
                <p className="hint-text">Изменений пока не было.</p>
              ) : (
                <ul className="member-report-list">
                  {profileHistory.map((entry) => (
                    <li key={entry.id}>
                      <span className="member-report-date">{formatMskDate(entry.created_at)} МСК</span>
                      <p className="member-report-content">
                        <strong>{formatFullName(entry.actor)}</strong>: {entry.details}
                      </p>
                    </li>
                  ))}
                </ul>
              )
            )}
          </>
        )}

        {promotionStatus?.next_rank && (
          <div className="regiment-panel fade-in-up">
            <h4>Осталось до повышения</h4>
            <p className="hint-text">
              {promotionStatus.current_rank?.code} → <strong>{promotionStatus.next_rank.code}</strong> —{" "}
              {promotionStatus.next_rank.name}
            </p>
            <p className="hint-text">
              Баллы: {promotionStatus.points_current} / {promotionStatus.points_required}
              {promotionStatus.days_required != null &&
                ` · Дней в звании: ${promotionStatus.days_in_rank ?? 0} / ${promotionStatus.days_required}`}
            </p>
            {promotionStatus.category_requirements?.length > 0 && (
              <ul className="requirement-checklist">
                {promotionStatus.category_requirements.map((req) => (
                  <li
                    key={req.requirement_id}
                    className={req.satisfied ? "requirement-item requirement-item-done" : "requirement-item"}
                  >
                    <span className="requirement-check">{req.satisfied && "✓"}</span>
                    <span className="requirement-label">
                      {req.category_name} ({req.count_current} / {req.count_required})
                      {req.is_mandatory && <span className="tag-mandatory">обязательное</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {promotionStatus.has_active_reprimand && (
              <p className="error-text">Есть непогашенный строгий выговор — повышение недоступно.</p>
            )}
          </div>
        )}

        <h4>
          Выговоры {hasActiveReprimand && <span className="member-inactive-badge">есть непогашенный (строгий)</span>}
        </h4>
        {activeReprimands.length === 0 ? (
          <p className="hint-text">Активных выговоров нет.</p>
        ) : (
          <ul className="member-report-list">
            {activeReprimands.map((r) => (
              <li key={r.id}>
                <span className="error-text">действует</span>{" "}
                <span className="hint-text">{r.severity === "verbal" ? "устный" : "строгий"}</span>
                {r.auto_escalated && <span className="hint-text"> (авто-эскалация)</span>}
                <span className="member-report-date">{formatMskDate(r.issued_at)} МСК</span>
                <p className="member-report-content">{r.reason}</p>
                {r.points_required > 0 && (
                  <p className="hint-text">
                    Для снятия нужно баллов: {r.points_required} (набрано: {r.points_earned})
                  </p>
                )}
                {canEdit && (
                  <button className="ghost" onClick={() => handleRevokeReprimand(r.id)}>
                    Снять
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {memberReprimands.length > 0 && (
          <button
            type="button"
            className="ghost rank-accordion-header"
            onClick={() => setShowReprimandHistory((v) => !v)}
          >
            <span className={`rank-accordion-arrow ${showReprimandHistory ? "rank-accordion-arrow-open" : ""}`}>▸</span>
            <span>История выговоров ({memberReprimands.length})</span>
          </button>
        )}
        {showReprimandHistory && (
          <ul className="member-report-list">
            {memberReprimands.map((r) => (
              <li key={r.id}>
                <span className={r.revoked_at ? "hint-text" : "error-text"}>
                  {r.revoked_at ? "снят" : "действует"}
                </span>{" "}
                <span className="hint-text">{r.severity === "verbal" ? "устный" : "строгий"}</span>
                {r.auto_escalated && <span className="hint-text"> (авто-эскалация)</span>}
                <span className="member-report-date">{formatMskDate(r.issued_at)} МСК</span>
                <p className="member-report-content">{r.reason}</p>
                {r.points_required > 0 && (
                  <p className="hint-text">
                    Для снятия нужно баллов: {r.points_required} (набрано: {r.points_earned})
                  </p>
                )}
                {canDeleteReprimandHistory && (
                  <button className="ghost error-text" onClick={() => setConfirmDeleteReprimandId(r.id)}>
                    Удалить из истории
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <ConfirmDialog
          open={confirmDeleteReprimandId !== null}
          message="Удалить эту запись о выговоре из истории навсегда? Действие необратимо."
          onConfirm={() => {
            handleDeleteReprimand(confirmDeleteReprimandId);
            setConfirmDeleteReprimandId(null);
          }}
          onCancel={() => setConfirmDeleteReprimandId(null)}
        />
        {canEdit && (
          <form onSubmit={handleIssueReprimand} className="add-category-form">
            <input
              type="text"
              placeholder="Причина выговора"
              value={newReprimandReason}
              onChange={(e) => setNewReprimandReason(e.target.value)}
            />
            <select value={newReprimandSeverity} onChange={(e) => setNewReprimandSeverity(e.target.value)}>
              <option value="strict">Строгий</option>
              <option value="verbal">Устный</option>
            </select>
            <input
              type="number"
              min={0}
              placeholder="Баллов для снятия"
              value={newReprimandPoints}
              onChange={(e) => setNewReprimandPoints(e.target.value)}
              style={{ width: "9rem" }}
            />
            <button type="submit">Выдать выговор</button>
          </form>
        )}

        <h4>Отпуска</h4>
        {memberLeaveRequests.length === 0 ? (
          <p className="hint-text">Заявок на отпуск нет.</p>
        ) : (
          <ul className="member-report-list">
            {memberLeaveRequests.map((r) => (
              <li key={r.id}>
                <span className="hint-text">{LEAVE_STATUS_LABELS[r.status]}</span>
                <span className="member-report-date">
                  {r.start_date} — {r.end_date}
                </span>
                <p className="member-report-content">{r.reason}</p>
                {r.decided_by_user && (
                  <p className="hint-text">Решение: {formatFullName(r.decided_by_user)}</p>
                )}
              </li>
            ))}
          </ul>
        )}

        <h4>Рапорты {!loading && reports.length > 0 && <span className="category-points-badge">— всего баллов: {totalPoints}</span>}</h4>
        {loading ? (
          <InlineSpinner />
        ) : reports.length === 0 ? (
          <p className="hint-text">Рапортов нет.</p>
        ) : (
          <ul className="rank-accordion">
            {reportsByRank.map((group) => {
              const isOpen = expandedRankKey === group.key;
              const groupPoints = group.reports.reduce((sum, r) => sum + (r.points ?? 0), 0);
              return (
                <li key={group.key} className="rank-accordion-group">
                  <button
                    type="button"
                    className="rank-accordion-header"
                    onClick={() => setExpandedRankKey(isOpen ? null : group.key)}
                  >
                    <span className={`rank-accordion-arrow ${isOpen ? "rank-accordion-arrow-open" : ""}`}>▸</span>
                    <span>{group.rank ? `${group.rank.code} — ${group.rank.name}` : "Без звания"}</span>
                    <span className="hint-text">
                      {group.reports.length} · {groupPoints} баллов
                    </span>
                  </button>
                  {isOpen && (
                    <ul className="member-report-list">
                      {group.reports.map((r) => (
                        <li key={r.id}>
                          <StatusBadge status={r.status} />
                          {r.category_name && <span className="report-category">{r.category_name}</span>}
                          <span className="hint-text">
                            {" "}
                            {r.author?.discord_id === member.discord_id ? "проводил" : "участвовал"}
                          </span>
                          {r.points !== null && r.author?.discord_id === member.discord_id && (
                            <span className="category-points-badge"> Баллы: {r.points}</span>
                          )}
                          <span className="member-report-date">{formatMskDate(r.created_at)} МСК</span>
                          <p className="report-byline">Докладывает: {formatFullNameAtRank(r.author, r.author_rank)}</p>
                          {r.status === "approved" && r.updated_by_user && (
                            <p className="report-byline">
                              Одобрил: {formatFullNameAtRank(r.updated_by_user, r.updated_by_rank)}
                            </p>
                          )}
                          {r.status === "rejected" && r.rejection_reason && (
                            <p className="report-rejection-reason">Причина отклонения: {r.rejection_reason}</p>
                          )}
                          <p className="member-report-content">{r.content}</p>
                          {r.images.length > 0 && (
                            <div className="report-images">
                              {r.images.map((img) => (
                                <a key={img.id} href={img.url} target="_blank" rel="noreferrer" className="report-image-thumb">
                                  <img src={img.url} alt="" />
                                </a>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
