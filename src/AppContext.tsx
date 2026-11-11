import React, { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { verifyToken as apiVerifyToken, fetchMe } from "./services/auth";
import { authHeaders } from "./services/http";
import type { Role } from "./types";

// Global auth/session state — pattern copied from
// share-projects/marcow-crop/src/AppContext.tsx (trimmed down: no
// aistudio/characters/settings state, this app's per-page state lives in
// its own pages, see src/pages/*.tsx from Step 4 onward).
interface AppState {
  isAuthenticated: boolean;
  authChecked: boolean;
  username: string | null;
  role: Role | null;
  isAdmin: boolean;
  login: (username: string, token: string, role: Role) => void;
  logout: () => void;
}

const AppContext = createContext<AppState | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);

  useEffect(() => {
    async function verify() {
      const token = localStorage.getItem("authToken");
      if (!token) {
        setAuthChecked(true);
        return;
      }
      try {
        const result = await apiVerifyToken(token);
        if (result.valid) {
          setIsAuthenticated(true);
          setUsername(result.username || localStorage.getItem("authUser"));
          // GET /api/me — role dùng để ẩn/hiện menu Quản trị. Lỗi (server tạm
          // gián đoạn...) → fallback "member", KHÔNG chặn app (không throw).
          const me = await fetchMe(token).catch(() => null);
          setRole(me?.role || "member");
        } else {
          localStorage.removeItem("authToken");
          localStorage.removeItem("authUser");
        }
      } catch {
        // Server unreachable — keep the token, let the user retry.
      }
      setAuthChecked(true);
    }
    verify();
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    let lastInteraction = Date.now();
    const touch = () => { lastInteraction = Date.now(); };
    const beat = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastInteraction > 3 * 60_000) return;
      void fetch("/api/activity/heartbeat", { method: "POST", headers: authHeaders(false) }).catch(() => {});
    };
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    window.addEventListener("scroll", touch, { passive: true });
    beat();
    const timer = window.setInterval(beat, 60_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      window.removeEventListener("scroll", touch);
    };
  }, [isAuthenticated]);

  const login = (u: string, token: string, r: Role) => {
    localStorage.setItem("authToken", token);
    localStorage.setItem("authUser", u);
    setUsername(u);
    setRole(r);
    setIsAuthenticated(true);
  };

  const logout = () => {
    localStorage.removeItem("authToken");
    localStorage.removeItem("authUser");
    setIsAuthenticated(false);
    setUsername(null);
    setRole(null);
  };

  return (
    <AppContext.Provider
      value={{ isAuthenticated, authChecked, username, role, isAdmin: role === "admin", login, logout }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}
