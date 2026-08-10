from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.rank import Rank
    from app.models.specialization import Specialization
    from app.models.squad import Squad


class ReportCategory(Base):
    """Категория рапорта — заводится командиром для своего формирования
    (например: патруль, задержание, боевой вылет и т.д.).

    fields — список названий полей, которые нужно заполнить при оформлении рапорта
    этой категории (например ["Время поста", "Маршрут/пост", "Состав"]) — командир
    сам решает, что должно быть в теле рапорта этой категории. Пустой список — обычный
    свободный текст, без структуры.

    points — балл, который автоматически проставляется рапорту этой категории при
    одобрении (если у рапорта ещё нет балла). None — авто-начисления нет, балл можно
    выставить только вручную."""

    __tablename__ = "report_categories"
    __table_args__ = (UniqueConstraint("regiment_id", "name", name="uq_report_category_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    regiment_id: Mapped[int] = mapped_column(ForeignKey("regiments.id"))
    name: Mapped[str] = mapped_column(String(255))
    fields: Mapped[list[str]] = mapped_column(JSON, default=list)
    points: Mapped[int | None] = mapped_column(nullable=True, default=None)
    # Рапорты этой категории при одобрении автоматически становятся записью в
    # "Нарушителях" (см. app/api/reports.py) — заводить/снимать флаг может только
    # высшее командование/администратор, как и всю остальную категорию
    is_detention: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Категория "Повышение" — сюда системно дублируются заявки на повышение (см.
    # app/crud/promotion.py), заводится автоматически при создании формирования,
    # как и is_detention; вручную рапорт в ней не создать (см. app/api/reports.py)
    is_promotion: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # auto-created, mirrors manual rank demotion, not manually creatable
    is_demotion: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # instructor-only, grants specialization on approval
    is_training: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Балл, который получает КАЖДЫЙ участник рапорта (из ростер-полей, не автор) при
    # одобрении — настраивает полноправный командир/высшее командование/админ,
    # так же как обычные points. None — участникам баллы не начисляются.
    participant_points: Mapped[int | None] = mapped_column(nullable=True, default=None)
    # filing restriction: min rank and/or commander+/deputy+ only, can combine
    min_rank_id: Mapped[int | None] = mapped_column(ForeignKey("ranks.id"), nullable=True)
    commander_only: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    min_rank: Mapped["Rank | None"] = relationship()
    # Подавать рапорт этой категории может только тот, у кого есть эта
    # специализация (например "Медицинский рапорт" -> базовый класс "Медик") —
    # None означает, что такого ограничения нет, как раньше
    required_specialization_id: Mapped[int | None] = mapped_column(ForeignKey("specializations.id"), nullable=True)
    required_specialization: Mapped["Specialization | None"] = relationship()
    # Категория открыта для подачи командирам/замам ЛЮБОГО формирования, не
    # только своего (например Штаб-категории "Боевая готовность"/"Защита ОВО",
    # куда отчитываются командиры других формирований) — см. is_leadership_report
    # в app/api/reports.py. Члены СВОЕГО формирования категории по-прежнему
    # подают как обычно, независимо от этого флага.
    open_to_regiment_leadership: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Подавать рапорт этой категории может только участник этого отряда (например
    # "Рапорт о разведке" -> отряд "Разведка") — None означает, что такого
    # ограничения нет. Отряд всегда из того же формирования, что и категория.
    required_squad_id: Mapped[int | None] = mapped_column(ForeignKey("squads.id"), nullable=True)
    required_squad: Mapped["Squad | None"] = relationship()
    # Рапорты этой категории при подаче автоматически дублируются read-only копией
    # в категорию, на которую указывает это поле (обычно — категория Штаба, для
    # общего обзора всеми кмд+, см. "Обучение рекрута" в regiment_crud) — сама эта
    # категория (в Штабе) mirrors_to_category_id не имеет, она конечная точка.
    # Не настраивается через обычный API категорий, выставляется программно.
    mirrors_to_category_id: Mapped[int | None] = mapped_column(
        ForeignKey("report_categories.id"), nullable=True
    )
    # Совместная категория (например "Совместная тренировка") — рапорт живёт в
    # своём формировании (обычно Штаб), но участники набираются из нескольких
    # формирований, и каждое одобряет свою часть НЕЗАВИСИМО (см.
    # app/models/report_regiment_decision.py) — единого "одобрено на весь
    # рапорт" для такой категории нет, см. app/api/reports.py.
    is_joint: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # "Курс молодого бойца" — рапорт о ней подаёт любой Капрал+ (через min_rank_id)
    # НЕЗАВИСИМО от своего формирования (обходит обычную проверку членства, см.
    # is_recruit_promotion в app/api/reports.py), auto-approve при отправке как
    # is_training, но вместо выдачи специализации напрямую меняет rank_id цели на
    # PVT (см. _apply_approval_side_effects). Не настраивается через обычный API
    # категорий — системный флаг, как is_promotion/is_demotion/is_training.
    is_recruit_promotion: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # "Наставничество" — одобрение рапорта отмечает СЛЕДУЮЩЕЕ по порядку
    # испытание Падавана сданным (см. app/crud/jedi_trial.py — 5 испытаний,
    # обязательный разрыв в днях между ними), target_discord_id = падаван,
    # автор рапорта = наставник (получает баллы + зачёт "обучил падавана" для
    # своего перехода в Мастера). См. _apply_approval_side_effects.
    is_jedi_trial_report: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Не более N рапортов этой категории в день на одного бойца (например
    # "Деятельность специализации" у джедаев — не чаще 2 раз) — None: без лимита.
    # Проверяется в app/api/reports.py::_check_category_filing_restrictions.
    max_per_day: Mapped[int | None] = mapped_column(nullable=True, default=None)
