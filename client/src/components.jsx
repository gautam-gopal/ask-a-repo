// SECURITY: never use dangerouslySetInnerHTML anywhere in this project. Repo text, model
// answers and server messages are untrusted; React escapes them when rendered as plain text.
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useMatch } from "react-router-dom";
import { useAuth } from "./auth.jsx";

export function useTitle(title) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Loading" />;
}

export function Alert({ variant = "info", role, children }) {
  return (
    <div className={`alert alert-${variant}`} role={role}>
      {children}
    </div>
  );
}

export function ErrorMessage({ message }) {
  if (!message) return null;
  return (
    <Alert variant="error" role="alert">
      {message}
    </Alert>
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

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="page-header__sub">{subtitle}</p>}
      </div>
      {children && <div className="page-header__actions">{children}</div>}
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty-state">
      <h3 className="empty-state__title">{title}</h3>
      <div className="empty-state__body">{children}</div>
    </div>
  );
}

export function Layout() {
  const { user, logout, demo } = useAuth();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const chat = useMatch("/repos/:id") !== null; // chat page: no bottom padding, sticky composer

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
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app-header">
        <div className="app-header__inner">
          <Link to="/repos" className="brand">
            Ask-a-Repo
          </Link>
          <nav className="app-nav" aria-label="Main">
            <NavLink to="/repos" className="nav-link">
              Repositories
            </NavLink>
          </nav>
          <div className="app-header__user">
            {demo ? (
              <span className="pill">Demo</span>
            ) : (
              <span className="app-header__email" title={user?.email}>
                {user?.email}
              </span>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onLogout}
              disabled={busy}
              aria-busy={busy}
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      {demo && (
        <div className="notice-bar" role="status">
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
      <main
        id="main"
        tabIndex={-1}
        className={`page${chat ? " page--chat" : ""}`}
      >
        <ErrorMessage message={error} />
        <Outlet />
      </main>
    </>
  );
}
