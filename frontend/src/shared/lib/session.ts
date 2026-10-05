import { useAuth } from "@/auth/AuthContext";
import type { Schemas } from "@/shared/api/client";
import type { Access } from "./access";

export interface Session {
  token: string | null;
  user: Schemas["UserRead"] | null;
  access: Access | null;
  regiments: Schemas["RegimentRead"][];
  loading: boolean;
  isAuthenticated: boolean;
  logout: () => void;
  refreshMe: () => Promise<void>;
  activeCharacter: Schemas["CharacterRead"] | null;
}

/** Типизированный доступ к AuthContext (сам контекст пока на JS). */
export function useSession(): Session {
  return useAuth() as unknown as Session;
}
