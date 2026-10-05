import type { Schemas } from "../api/client";

export type Access = Schemas["AccessInfo"];

export interface RegimentLite {
  id: number;
  name: string;
  color?: string | null;
}

export interface AccessCtx {
  access: Access | null | undefined;
  regiments: RegimentLite[];
}

const ids = (list: number[] | null | undefined) => list ?? [];

// Одна точка правды для видимости разделов вместо условий,
// разбросанных по сайдбару и страницам.
export const can = {
  review: ({ access: a }: AccessCtx) =>
    Boolean(a && (a.is_admin || a.is_high_command || ids(a.commander_regiment_ids).length > 0)),
  hq: (ctx: AccessCtx) => {
    const hq = ctx.regiments.find((r) => r.name === "Штаб");
    if (!hq || !ctx.access) return false;
    return can.review(ctx) || ids(ctx.access.soldier_regiment_ids).includes(hq.id);
  },
  disciplineDeputy: ({ access: a }: AccessCtx) => Boolean(a && (a.deputy_disciplines ?? []).length > 0),
  discipline:
    (discipline: string) =>
    ({ access: a }: AccessCtx) =>
      Boolean(
        a &&
          (a.is_admin ||
            (a.specialization_disciplines ?? []).includes(discipline) ||
            (a.instructor_disciplines ?? []).includes(discipline) ||
            (a.deputy_disciplines ?? []).includes(discipline)),
      ),
  eventRoom: ({ access: a }: AccessCtx) => Boolean(a?.can_access_event_room),
  adminStaff: ({ access: a }: AccessCtx) => Boolean(a && (a.is_admin_staff || a.is_admin)),
  admin: ({ access: a }: AccessCtx) => Boolean(a?.is_admin),
  logs: ({ access: a }: AccessCtx) => Boolean(a && (a.is_admin || (a.deputy_disciplines ?? []).length > 0)),
  editGalaxy: ({ access: a }: AccessCtx) => Boolean(a?.can_edit_galaxy_map),
};

/** Цвет своего формирования — тинт интерфейса (рамка аватара, имя, активный пункт). */
export function ownRegimentColor(ctx: AccessCtx): string | null {
  const a = ctx.access;
  if (!a) return null;
  const own = new Set([...ids(a.commander_regiment_ids), ...ids(a.soldier_regiment_ids)]);
  return ctx.regiments.find((r) => own.has(r.id) && r.color)?.color ?? null;
}
