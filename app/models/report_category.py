from sqlalchemy import JSON, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


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
