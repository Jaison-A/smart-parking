import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import { SocketProvider } from "./context/SocketContext.jsx";
import Layout from "./components/Layout.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import VideosPage from "./pages/VideosPage.jsx";
import VideoDetailPage from "./pages/VideoDetailPage.jsx";
import ViolationsPage from "./pages/ViolationsPage.jsx";
import FinesPage from "./pages/FinesPage.jsx";

function Protected({ children }) {
  const { token, loading } = useAuth();
  if (loading) return <div className="p-8 text-sm text-ink/60">Loading…</div>;
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { token } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/*"
        element={
          <Protected>
            <SocketProvider>
              <Layout>
                <Routes>
                  <Route index element={<Navigate to="/videos" replace />} />
                  <Route path="videos" element={<VideosPage />} />
                  <Route path="videos/:id" element={<VideoDetailPage />} />
                  <Route path="violations" element={<ViolationsPage />} />
                  <Route path="fines" element={<FinesPage />} />
                  <Route path="*" element={<Navigate to="/videos" replace />} />
                </Routes>
              </Layout>
            </SocketProvider>
          </Protected>
        }
      />
    </Routes>
  );
}
