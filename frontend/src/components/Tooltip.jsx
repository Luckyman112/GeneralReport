import { useState } from "react";
import { InfoIcon } from "./icons";

/** Подсказка при наведении/удержании курсора — используется вместо неочевидных
 * подписей полей (или как отдельный значок инфо рядом с ярлыком). Не полагается
 * на нативный браузерный title (тот некрасивый и с задержкой не управляем). */
export function Tooltip({ text, children }) {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className="tooltip-wrap"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span className="tooltip-bubble" role="tooltip">
          {text}
        </span>
      )}
    </span>
  );
}

/** Компактный значок "i" с той же подсказкой — для мест, где не к чему привязать
 * children (например, отдельно стоящий ярлык поля). */
export function InfoHint({ text }) {
  return (
    <Tooltip text={text}>
      <InfoIcon className="info-hint-icon" tabIndex={0} />
    </Tooltip>
  );
}
