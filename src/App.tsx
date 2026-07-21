import { AppProvider } from "./AppContext";

// Placeholder root — fleshed out in Step 3 (auth) and later steps once
// AppContext/Login/pages exist. Kept minimal + buildable for Step 1.
export default function App() {
  return (
    <AppProvider>
      <div className="min-h-screen flex items-center justify-center text-storm-700">
        <p className="text-sm text-stone-500">
          Ăn Nằm Với AI — Content Engine (scaffold)
        </p>
      </div>
    </AppProvider>
  );
}
