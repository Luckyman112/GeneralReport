import { useAuth } from "../auth/AuthContext";

/** Блокирующий экран для ЛЮБОГО пользователя (и нового, и давно
 * зарегистрированного) с ролями сразу нескольких формирований, которые не
 * объяснены ни персонажем (см. app/models/character.py), ни активной заявкой
 * на перевод (см. app/models/transfer_request.py). Рендерится в App.jsx
 * раньше RegistrationGate/InactiveBlock, чтобы перекрыть их тоже. */
export function RoleConflictGate() {
  const { access, regiments } = useAuth();
  if (!access) return null;

  const soldierRegimentIds = access.soldier_regiment_ids || [];
  if (soldierRegimentIds.length <= 1) return null;

  const knownIds = new Set((access.characters || []).map((c) => c.regiment.id));
  if (access.active_transfer) {
    knownIds.add(access.active_transfer.from_regiment.id);
    knownIds.add(access.active_transfer.to_regiment.id);
  }

  const unexplained = soldierRegimentIds.filter((id) => !knownIds.has(id));
  // Больше одной необъяснённой роли (или ровно одна необъяснённая роль сверх
  // уже известных персонажей/перевода) — конфликт. Если все роли покрыты
  // персонажами/переводом — это штатный второй персонаж, ничего не блокируем.
  if (unexplained.length === 0) return null;

  const regimentName = (id) => regiments.find((r) => r.id === id)?.name || `#${id}`;
  const allNames = soldierRegimentIds.map(regimentName).join(", ");

  return (
    <div className="inactive-block">
      <h2>Обнаружены роли сразу нескольких формирований</h2>
      <p>Одновременно у вас роли: «{allNames}».</p>
      <p>
        Если у вас действительно второй персонаж — сообщите администрации, чтобы его оформили. Если нет — попросите
        в заявке на роли убрать лишнюю/конфликтующую роль, оставив только одну.
      </p>
    </div>
  );
}
