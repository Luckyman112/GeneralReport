import {
  ArrowLeftRight,
  Box,
  Building2,
  ChevronsUp,
  Compass,
  FileText,
  Flag,
  HardDrive,
  HeartPulse,
  Landmark,
  type LucideIcon,
  Orbit,
  Scale,
  ScanFace,
  ScrollText,
  Settings,
  ShieldCheck,
  SquareTerminal,
  UserCheck,
  UserPlus,
  Users,
  Wrench,
} from "lucide-react";
import { type AccessCtx, can } from "@/shared/lib/access";

export interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Путь роута; для «Состава» вместо пути открывается модалка (этап 4 сделает страницу). */
  to?: string | ((ctx: AccessCtx) => string);
  action?: "roster";
  visible?: (ctx: AccessCtx) => boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const hqPath = (ctx: AccessCtx) => {
  const hq = ctx.regiments.find((r) => r.name === "Штаб");
  return hq ? `/reports?regiment=${hq.id}` : "/reports";
};

// Группы по новой информационной архитектуре. Пока разделы ведут на старые
// страницы; «Входящие», «Мой путь» и т.д. появятся на следующих этапах.
export const NAV: NavGroup[] = [
  {
    label: "Служба",
    items: [
      { key: "bridge", label: "Мостик", icon: Compass, to: "/main" },
      { key: "reports", label: "Рапорты", icon: FileText, to: "/reports" },
      { key: "roster", label: "Состав", icon: Users, action: "roster" },
      { key: "wanted", label: "Розыск", icon: ScanFace, to: "/violations" },
      { key: "galaxy", label: "Галактика", icon: Orbit, to: "/galaxy" },
    ],
  },
  {
    label: "Рост",
    items: [
      { key: "career", label: "Мой путь", icon: ChevronsUp, to: "/promotions" },
      { key: "academy", label: "Академия", icon: Box, to: "/instructor-room" },
      { key: "recruits", label: "Рекрутская", icon: UserPlus, to: "/recruits" },
      { key: "medic", label: "Медицина", icon: HeartPulse, to: "/specializations/medic", visible: can.discipline("medic") },
      {
        key: "engineer",
        label: "Инженерия",
        icon: Wrench,
        to: "/specializations/engineer",
        visible: can.discipline("engineer"),
      },
    ],
  },
  {
    label: "Командование",
    items: [
      { key: "hq", label: "Штаб", icon: Landmark, to: hqPath, visible: can.hq },
      { key: "enlist", label: "Зачисление", icon: UserCheck, to: "/registrations", visible: can.review },
      { key: "transfers", label: "Переводы", icon: ArrowLeftRight, to: "/transfers", visible: can.review },
      { key: "discipline", label: "Дисциплина", icon: Scale, to: "/discipline", visible: can.disciplineDeputy },
    ],
  },
  {
    label: "Службы",
    items: [
      { key: "events", label: "Ивентрум", icon: Flag, to: "/event-room", visible: can.eventRoom },
      { key: "staff", label: "Администрация", icon: ShieldCheck, to: "/admin-staff", visible: can.adminStaff },
    ],
  },
  {
    label: "Система",
    items: [
      { key: "control", label: "Центр управления", icon: SquareTerminal, to: "/admin-panel", visible: can.admin },
      { key: "regiments", label: "Формирования", icon: Building2, to: "/regiments", visible: can.admin },
      { key: "settings", label: "Настройки", icon: Settings, to: "/settings", visible: can.admin },
      { key: "logs", label: "Журнал", icon: ScrollText, to: "/logs", visible: can.logs },
      { key: "backups", label: "Резервные копии", icon: HardDrive, to: "/backups", visible: can.admin },
    ],
  },
];

export function visibleNav(ctx: AccessCtx): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.visible || i.visible(ctx)) })).filter(
    (g) => g.items.length > 0,
  );
}

export function resolvePath(item: NavItem, ctx: AccessCtx): string | null {
  if (!item.to) return null;
  return typeof item.to === "function" ? item.to(ctx) : item.to;
}

/** Хлебные крошки «ГРУППА / РАЗДЕЛ» по текущему пути. */
export function crumbFor(pathname: string, search: string, ctx: AccessCtx): string {
  for (const g of NAV) {
    for (const i of g.items) {
      const path = resolvePath(i, ctx);
      if (!path) continue;
      const [p, q] = path.split("?");
      if (p === pathname && (!q || search.includes(q))) return `${g.label} / ${i.label}`;
    }
  }
  for (const g of NAV) {
    for (const i of g.items) {
      const path = resolvePath(i, ctx);
      if (path && path.split("?")[0] === pathname) return `${g.label} / ${i.label}`;
    }
  }
  return "COLLAPSAR";
}
