import { createContext, useContext, type ReactNode } from "react";

// Minimal placeholder — replaced with the real auth/session context in
// Step 3 (pattern: src/AppContext.tsx of share-projects/marcow-crop).
interface AppState {
  placeholder: true;
}

const AppContext = createContext<AppState | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <AppContext.Provider value={{ placeholder: true }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}
