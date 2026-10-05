import { CircleHelp, LogOut } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { clsx } from "clsx";
import { useSession } from "@/shared/lib/session";
import { RosterBrowserModal } from "@/components/RosterBrowserModal";
import { ownRegimentColor, type AccessCtx } from "@/shared/lib/access";
import { resolvePath, visibleNav } from "../nav";
import { Emblem } from "./Emblem";
import { positionLabel } from "./position";

const CHARTER_URL = "https://collapsar.kossman7771.workers.dev/";

interface Props {
  open: boolean;
  onClose: () => void;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}

export function AppSidebar({ open, onClose }: Props) {
  const { user, access, regiments, logout, activeCharacter } = useSession();
  const location = useLocation();
  const [showRoster, setShowRoster] = useState(false);
  const ctx: AccessCtx = { access, regiments: regiments ?? [] };

  const needsRegistration = user?.registration_status !== "approved" && !access?.is_founder && !access?.is_real_admin;
  const tint = activeCharacter?.regiment?.color || ownRegimentColor(ctx) || "#4a90d9";
  const displayName: string = activeCharacter?.callsign || user?.username || "";
  const position = activeCharacter
    ? `${activeCharacter.regiment.name} · второй персонаж`
    : positionLabel(access, regiments ?? []);

  function isActive(path: string) {
    const [p, q] = path.split("?");
    if (location.pathname !== p) return false;
    return q ? location.search.includes(q) : !location.search.includes("regiment=");
  }

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-void/70 lg:hidden" onClick={onClose} />}
      <aside
        style={{ ["--tint" as string]: tint }}
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex h-dvh w-64 flex-col overflow-hidden border-r border-line bg-hull transition-transform duration-200 ease-holo",
          "lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Link to="/main" onClick={onClose} className="flex items-center gap-3 px-5 pt-5 pb-6 no-underline">
          <Emblem className="size-10 shrink-0" />
          <span className="flex flex-col leading-none">
            <span className="font-display text-xl font-bold tracking-[0.12em] text-ink">COLLAPSAR</span>
            <span className="eyebrow mt-1.5 text-[9px] text-muted">Портал легиона</span>
          </span>
        </Link>

        {!needsRegistration && (
          <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {visibleNav(ctx).map((group) => (
              <div key={group.label} className="mb-5">
                <div className="eyebrow mb-1.5 px-3 text-[10px] text-muted">{group.label}</div>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const path = resolvePath(item, ctx);
                  const active = path ? isActive(path) : false;
                  const cls = clsx(
                    "group flex w-full items-center gap-3 border-l-2 px-3 py-2 text-left text-[15px] no-underline transition-colors duration-150",
                    active
                      ? "border-tint bg-panel-2 text-ink"
                      : "border-transparent text-ink/75 hover:bg-panel hover:text-ink",
                  );
                  const content = (
                    <>
                      <Icon className={clsx("size-[18px] shrink-0", active ? "text-tint" : "text-muted group-hover:text-ice")} strokeWidth={1.5} />
                      <span className="truncate">{item.label}</span>
                    </>
                  );
                  if (item.action === "roster") {
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={clsx(cls, "min-h-0 border-y-0 border-r-0 bg-transparent font-sans")}
                        onClick={() => {
                          setShowRoster(true);
                          onClose();
                        }}
                      >
                        {content}
                      </button>
                    );
                  }
                  return (
                    <Link key={item.key} to={path ?? "/"} onClick={onClose} className={cls}>
                      {content}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        )}

        <div className="mt-auto shrink-0 space-y-3 border-t border-line px-3 pt-3 pb-4">
          <a
            href={CHARTER_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2.5 border border-dashed border-line-strong px-3 py-2.5 text-sm text-ink/80 no-underline hover:text-ink"
          >
            <CircleHelp className="size-4 text-muted" strokeWidth={1.5} />
            Как тут всё устроено
          </a>

          <div className="flex items-center gap-3 border border-line bg-panel p-3">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="" className="size-10 shrink-0 border-2 border-tint object-cover" />
            ) : (
              <span className="grid size-10 shrink-0 place-items-center border-2 border-tint font-mono text-sm text-tint">
                {initials(displayName || "?")}
              </span>
            )}
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate font-semibold text-tint">{displayName}</span>
              <span className="mt-0.5 block truncate font-mono text-[11px] text-muted" title={position}>
                {position}
              </span>
            </span>
            <button
              type="button"
              title="Выйти"
              aria-label="Выйти"
              onClick={logout}
              className="grid size-8 min-h-0 shrink-0 place-items-center border-0 bg-transparent p-0 text-muted hover:text-alarm"
            >
              <LogOut className="size-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </aside>

      {showRoster && <RosterBrowserModal onClose={() => setShowRoster(false)} />}
    </>
  );
}
