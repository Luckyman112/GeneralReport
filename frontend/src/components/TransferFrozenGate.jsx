import { useAuth } from "../auth/AuthContext";

/** Полноэкранная заглушка на время перевода: заявка одобрена обеими сторонами
 * (заместитель+ формирования-источника и формирования-цели), но роль в Discord
 * ещё не сменилась — сайт сам роль не меняет, только ждёт (см.
 * app/api/auth.py::_finalize_transfer_if_ready) и завершает перевод при
 * следующем входе, как только увидит чистый переход FROM -> TO. */
export function TransferFrozenGate() {
  const { access } = useAuth();
  const transfer = access?.active_transfer;
  if (!transfer || transfer.status !== "approved") return null;

  const soldierRegimentIds = access?.soldier_regiment_ids || [];
  const hasFrom = soldierRegimentIds.includes(transfer.from_regiment.id);
  const hasTo = soldierRegimentIds.includes(transfer.to_regiment.id);

  return (
    <div className="inactive-block">
      <h2>Перевод одобрен — ждём смены роли в Discord</h2>
      {hasFrom && !hasTo && (
        <p>
          Заявка на перевод из «{transfer.from_regiment.name}» в «{transfer.to_regiment.name}» одобрена обеими
          сторонами. Доступ к рапортам откроется автоматически, как только в Discord вам сменят роль
          «{transfer.from_regiment.name}» на «{transfer.to_regiment.name}».
        </p>
      )}
      {!(hasFrom && !hasTo) && (
        <p>
          Обнаружено несовместимое состояние ролей. Верните роль «{transfer.from_regiment.name}», затем смените её
          на «{transfer.to_regiment.name}», чтобы завершить перевод — только чистый переход с одной роли на другую
          закрывает заявку.
        </p>
      )}
    </div>
  );
}
