from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.rank import Rank


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
