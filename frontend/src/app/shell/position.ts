import { commanderRoleLabel } from "@/utils/regimentRoles";
import type { Access, RegimentLite } from "@/shared/lib/access";

/** Кто ты в системе: «высшее командование», «командир 501-го»… — для карточки
 * пользователя в сайдбаре. Логика перенесена из старого Navbar.jsx. */
export function positionLabel(access: Access | null | undefined, regiments: (RegimentLite & { is_jedi_order?: boolean })[]): string {
  if (!access) return "";
  const parts: string[] = [];
  if (access.is_high_command) parts.push("высшее командование");
  if (access.is_admin && !access.is_password_login) parts.push("высшая администрация");
  for (const r of regiments) {
    let role: string | null = null;
    if (access.category_manager_regiment_ids?.includes(r.id)) role = commanderRoleLabel("commander", r.is_jedi_order).toLowerCase();
    else if (access.commander_regiment_ids?.includes(r.id)) role = "заместитель";
    else if (access.soldier_regiment_ids?.includes(r.id)) role = "боец";
    if (role) parts.push(`${role} · ${r.name}`);
  }
  return parts.join(", ");
}
