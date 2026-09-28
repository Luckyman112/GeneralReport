// Как требование к повышению засчитывает рапорт — см.
// app/models/promotion.py::PromotionCategoryRequirement.count_mode
export const COUNT_MODE_OPTIONS = [
  { value: "author", label: "провёл сам" },
  { value: "participant", label: "участвовал" },
  { value: "any", label: "провёл или участвовал" },
];

export function countModeLabel(mode) {
  return COUNT_MODE_OPTIONS.find((o) => o.value === mode)?.label ?? "провёл сам";
}
