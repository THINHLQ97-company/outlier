import { Navigate, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AppProvider, useAppContext } from "./AppContext";
import Login from "./components/Login";
import Layout from "./components/Layout";
import SignalsQueue from "./pages/SignalsQueue";

// Placeholder cho các trang chưa xây (Step 5-6) — tránh 404 khi bấm nav.
function ComingSoon({ label }: { label: string }) {
  return (
    <div className="text-center py-16 text-stone-400 text-sm">
      {label} — đang được xây dựng (xem docs/PLAN.md).
    </div>
  );
}

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

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/signals" replace />} />
        <Route path="/signals" element={<SignalsQueue />} />
        <Route path="/scripts" element={<ComingSoon label="Kịch bản (DỊCH)" />} />
        <Route path="/image-studio" element={<ComingSoon label="Ảnh (VẼ)" />} />
        <Route path="/approval" element={<ComingSoon label="Duyệt" />} />
        <Route path="/ready" element={<ComingSoon label="Sẵn sàng đăng" />} />
        <Route path="*" element={<Navigate to="/signals" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Gate />
    </AppProvider>
  );
}
