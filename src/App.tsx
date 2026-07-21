import { Navigate, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AppProvider, useAppContext } from "./AppContext";
import Login from "./components/Login";
import Layout from "./components/Layout";
import SignalsQueue from "./pages/SignalsQueue";
import ScriptEditor from "./pages/ScriptEditor";
import ImageStudio from "./pages/ImageStudio";
import ApprovalQueue from "./pages/ApprovalQueue";
import ReadyToPost from "./pages/ReadyToPost";
import Characters from "./pages/Characters";

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
        <Route path="/scripts" element={<ScriptEditor />} />
        <Route path="/image-studio" element={<ImageStudio />} />
        <Route path="/approval" element={<ApprovalQueue />} />
        <Route path="/ready" element={<ReadyToPost />} />
        <Route path="/characters" element={<Characters />} />
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
