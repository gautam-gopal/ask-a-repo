import { useEffect, useState } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { setWakingHandler } from "./api.js";
import { useAuth } from "./auth.jsx";
import { Layout, Spinner, WakingBanner } from "./components.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import ReposPage from "./pages/ReposPage.jsx";
import ChatPage from "./pages/ChatPage.jsx";
import NotFoundPage from "./pages/NotFoundPage.jsx";

function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading")
    return (
      <div className="center">
        <Spinner />
      </div>
    );
  if (status === "anonymous")
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export default function App() {
  const [waking, setWaking] = useState(false);
  useEffect(() => {
    setWakingHandler(setWaking);
    return () => setWakingHandler(null);
  }, []);

  return (
    <>
      <WakingBanner show={waking} />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route path="/repos" element={<ReposPage />} />
            <Route path="/repos/:id" element={<ChatPage />} />
          </Route>
        </Route>
        <Route path="/" element={<Navigate to="/repos" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
