// Character reference library — read-only client (FR4.1). Endpoint:
// server/routes/characters.routes.ts (Step 3).
import { authHeaders, asError } from "./http";
import type { CharacterRow } from "../types";

export async function listCharacters(): Promise<CharacterRow[]> {
  const res = await fetch("/api/characters", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được thư viện nhân vật.");
  return res.json();
}
