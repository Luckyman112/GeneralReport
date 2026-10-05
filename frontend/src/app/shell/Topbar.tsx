import { Megaphone, Menu, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSession } from "@/shared/lib/session";
import { BroadcastModal } from "@/components/BroadcastModal";
import { CharacterSwitcher } from "@/components/CharacterSwitcher";
import { GlobalSearch } from "@/components/GlobalSearch";
import { NotificationBell } from "@/components/NotificationBell";
import { PasswordEscalation } from "@/components/PasswordEscalation";
import { crumbFor } from "../nav";

function useMskClock() {
  const fmt = () =>
    new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date());
  const [time, setTime] = useState(fmt);
  useEffect(() => {
    const id = setInterval(() => setTime(fmt()), 15_000);
    return () => clearInterval(id);
  }, []);
  return time;
}

interface Props {
  sidebarOpen: boolean;
  onBurgerClick: () => void;
}

export function Topbar({ sidebarOpen, onBurgerClick }: Props) {
  const { access, regiments } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const time = useMskClock();
  const [showBroadcast, setShowBroadcast] = useState(false);
  const crumb = crumbFor(location.pathname, location.search, { access, regiments: regiments ?? [] });

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-hull/95 px-4 py-2.5 backdrop-blur lg:px-6">
      <button
        type="button"
        className="grid size-10 min-h-0 place-items-center p-0 lg:hidden"
        aria-label={sidebarOpen ? "Закрыть меню" : "Открыть меню"}
        aria-expanded={sidebarOpen}
        onClick={onBurgerClick}
      >
        {sidebarOpen ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>

      <span className="eyebrow hidden shrink-0 text-[11px] text-muted md:block">{crumb}</span>

      <div className="min-w-0 max-w-md flex-1">
        <GlobalSearch variant="bar" />
      </div>

      <span className="eyebrow ml-auto hidden shrink-0 items-center gap-2 text-[11px] text-muted xl:flex">
        <span className="size-2 bg-ok shadow-[0_0_6px_var(--color-ok)]" />
        HOLONET · {time} МСК
      </span>

      <div className="flex shrink-0 items-center gap-2 max-xl:ml-auto">
        {access?.can_send_broadcast && (
          <button
            type="button"
            title="Объявление всем"
            className="grid size-10 min-h-0 place-items-center p-0"
            onClick={() => setShowBroadcast(true)}
          >
            <Megaphone className="size-[18px]" strokeWidth={1.5} />
          </button>
        )}
        <NotificationBell />
        <CharacterSwitcher />
        {!access?.is_password_login && access?.can_escalate_password_login && <PasswordEscalation />}
        <button
          type="button"
          className="primary flex items-center gap-2 px-4"
          onClick={() => navigate("/reports?new=1")}
        >
          <Plus className="size-4" strokeWidth={2.5} />
          <span className="max-sm:hidden">Рапорт</span>
        </button>
      </div>

      {showBroadcast && <BroadcastModal onClose={() => setShowBroadcast(false)} />}
    </header>
  );
}
