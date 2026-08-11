export const SPECIALIZATION_CATEGORIES = [
  { value: "class", label: "Общий класс" },
  { value: "gear", label: "Общее снаряжение" },
  { value: "specialization", label: "Главная специализация" },
  { value: "additional_specialization", label: "Дополнительная специализация" },
  { value: "elite_specialization", label: "Элитная специализация" },
  { value: "medic", label: "Медицинская дисциплина" },
  { value: "pilot", label: "Пилотская дисциплина" },
  { value: "engineer", label: "Инженерная дисциплина" },
  { value: "jedi_guardian", label: "Джедаи — Защитники" },
  { value: "jedi_consular", label: "Джедаи — Консулы" },
  { value: "jedi_sentinel", label: "Джедаи — Стражи" },
  { value: "jedi_force_ability", label: "Джедаи — способность Силы" },
  { value: "jedi_saber_form", label: "Джедаи — стойка меча" },
];

// категории-дисциплины: выдаёт только инструктор соответствующей роли
// (см. Settings -> Инструкторы и дисциплины), а не любой инструктор — держим
// синхронно с app/models/specialization.py::DISCIPLINE_CATEGORIES
export const DISCIPLINE_CATEGORIES = ["medic", "pilot", "engineer"];
