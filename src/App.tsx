import { Navigate, Route, Routes } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { AppProvider, useAppContext } from "./AppContext";
import Login from "./components/Login";
import Layout from "./components/Layout";
import SignalsQueue from "./pages/SignalsQueue";
import Studio from "./pages/Studio";
import Library from "./pages/Library";
import Brands from "./pages/Brands";
import Radar from "./pages/Radar";
import Channels from "./pages/Channels";
import Deconstruct from "./pages/Deconstruct";
import Remake from "./pages/Remake";
import Videos from "./pages/Videos";
import AdminUsers from "./pages/AdminUsers";
import Costs from "./pages/Costs";
import ConnectClaude from "./pages/ConnectClaude";

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
        <Route path="/" element={<Navigate to="/studio" replace />} />
        <Route path="/studio" element={<Studio />} />
        <Route path="/library" element={<Library />} />
        <Route path="/brands" element={<Brands />} />
        <Route path="/radar" element={<Radar />} />
        <Route path="/channels" element={<Channels />} />
        <Route path="/deconstruct" element={<Deconstruct />} />
        <Route path="/remakes" element={<Remake />} />
        <Route path="/videos" element={<Videos />} />
        <Route path="/signals" element={<SignalsQueue />} />
        <Route path="/costs" element={<Costs />} />
        <Route path="/connect" element={<ConnectClaude />} />
        <Route path="/admin/users" element={<AdminUsers />} />
        <Route path="*" element={<Navigate to="/studio" replace />} />
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
