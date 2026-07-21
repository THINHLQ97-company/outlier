import { AppProvider, useAppContext } from "./AppContext";
import Login from "./components/Login";
import { Loader2 } from "lucide-react";

function Gate() {
  const { isAuthenticated, authChecked } = useAppContext();

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center text-storm-600">
        <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  if (!isAuthenticated) return <Login />;

  // Router/pages (SignalsQueue, ScriptEditor, ImageStudio, ApprovalQueue,
  // ReadyToPost) land in Step 4-6. Placeholder shell for Step 3.
  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-sm text-stone-500">Đã đăng nhập. Các màn hình nghiệp vụ đang được xây (Step 4-6).</p>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Gate />
    </AppProvider>
  );
}
