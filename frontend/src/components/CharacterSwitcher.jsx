import { useAuth } from "../auth/AuthContext";

/** Переключатель "текущего персонажа" — виден только тем, у кого реально есть
 * хотя бы один дополнительный персонаж (см. app/models/character.py, заводит
 * администратор вручную). Влияет на то, чьё имя/звание показано в навбаре и
 * какое формирование подставляется по умолчанию в формах — не на права
 * доступа (те по-прежнему считаются по Discord-ролям). */
export function CharacterSwitcher() {
  const { access, activeCharacter, setActiveCharacterRegimentId } = useAuth();
  const characters = access?.characters || [];
  if (characters.length === 0) return null;

  return (
    <select
      className="character-switcher"
      value={activeCharacter?.regiment.id ?? ""}
      onChange={(e) => setActiveCharacterRegimentId(e.target.value ? Number(e.target.value) : null)}
      title="Переключить персонажа"
    >
      <option value="">Основной</option>
      {characters.map((c) => (
        <option key={c.id} value={c.regiment.id}>
          {c.regiment.name}
        </option>
      ))}
    </select>
  );
}
