import React, { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { verifyToken as apiVerifyToken, fetchMe } from "./services/auth";
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
          const me = await fetchMe(token).catch(() => null);
          if (me) setRole(me.role);
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
    <AppContext.Provider value={{ isAuthenticated, authChecked, username, role, login, logout }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}
