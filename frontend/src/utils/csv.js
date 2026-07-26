/** Скачивает CSV-файл прямо в браузере — без похода на бэкенд, из уже загруженных
 * на странице данных. BOM в начале — чтобы Excel корректно определил UTF-8. */
export function downloadCsv(filename, header, rows) {
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
