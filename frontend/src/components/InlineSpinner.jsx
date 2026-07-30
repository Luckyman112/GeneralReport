/** Компактный индикатор загрузки для точечных мест (внутри модалок/панелей),
 * где полноразмерный PageLoading был бы слишком тяжёлым — маленькое кольцо +
 * подпись вместо голого текста "Загрузка...". */
export function InlineSpinner({ label = "Загрузка..." }) {
  return (
    <p className="inline-spinner">
      <span className="inline-spinner-ring" />
      {label}
    </p>
  );
}
