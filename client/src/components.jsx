// SECURITY: never use dangerouslySetInnerHTML anywhere in this project. Repo text, model
// answers and server messages are untrusted; React escapes them when rendered as plain text.
import { useEffect, useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { useAuth } from "./auth.jsx";

export function useTitle(title) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Loading" />;
}

export function ErrorMessage({ message }) {
  if (!message) return null;
  return (
    <p className="error" role="alert">
      {message}
    </p>
  );
}

export function WakingBanner({ show }) {
  if (!show) return null;
  return (
    <div className="banner" role="status">
      Server is waking up, this can take about a minute.
    </div>
  );
}

export function Layout() {
  const { user, logout, demo } = useAuth();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onLogout() {
    setBusy(true);
    setError(null);
    try {
      await logout();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <>
      <header className="header">
        <div className="header-inner">
          <Link to="/repos" className="brand">
            Ask-a-Repo
          </Link>
          <div className="header-user">
            <span className="muted">{user?.email}</span>
            <button
              type="button"
              className="secondary"
              onClick={onLogout}
              disabled={busy}
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      {demo && (
        <div className="banner banner-demo" role="status">
          Demo mode: read-only.{" "}
          <button
            type="button"
            className="link"
            onClick={onLogout}
            disabled={busy}
          >
            Sign up
          </button>{" "}
          to add your own repository.
        </div>
      )}
      <main>
        <ErrorMessage message={error} />
        <Outlet />
      </main>
    </>
  );
}
