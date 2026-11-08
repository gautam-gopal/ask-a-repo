import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { ErrorMessage, Spinner, useTitle } from "../components.jsx";
import { getConfig } from "../api.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors the server: email valid and at most 254 chars; signup password 8 chars to 72 bytes.
function validate(mode, email, password) {
  if (!EMAIL_RE.test(email) || email.length > 254)
    return "Enter a valid email address.";
  if (mode === "signup") {
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (new TextEncoder().encode(password).length > 72)
      return "Password must be at most 72 bytes.";
  } else if (!password) {
    return "Enter your password.";
  }
  return null;
}

export default function LoginPage() {
  const { status, login, signup, loginDemo } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [demoOn, setDemoOn] = useState(false);

  useTitle(mode === "signup" ? "Sign up · Ask-a-Repo" : "Log in · Ask-a-Repo");

  useEffect(() => {
    let alive = true;
    getConfig()
      .then((c) => alive && setDemoOn(c.demoEnabled === true))
      .catch(() => {}); // no config: just hide the button
    return () => {
      alive = false;
    };
  }, []);

  if (status === "loading")
    return (
      <div className="center">
        <Spinner />
      </div>
    );
  if (status === "authenticated") {
    const from = location.state?.from;
    const target =
      typeof from === "string" && from.startsWith("/") && !from.startsWith("//")
        ? from
        : "/repos";
    return <Navigate to={target} replace />;
  }

  const isSignup = mode === "signup";

  async function onSubmit(e) {
    e.preventDefault();
    const cleanEmail = email.trim();
    const problem = validate(mode, cleanEmail, password);
    if (problem) return setError(problem);
    setError(null);
    setBusy(true);
    try {
      await (isSignup ? signup : login)(cleanEmail, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function toggle() {
    setMode(isSignup ? "login" : "signup");
    setError(null);
  }

  async function onDemo() {
    setError(null);
    setBusy(true);
    try {
      await loginDemo();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container narrow">
      <h1>Ask-a-Repo</h1>
      <p className="muted">Ask questions about any public GitHub repository.</p>
      {demoOn && (
        <>
          <button
            type="button"
            className="demo-cta"
            onClick={onDemo}
            disabled={busy}
          >
            {busy ? "Please wait..." : "Try the demo"}
          </button>
          <p className="muted center-text">
            No signup. Read-only, with two pre-indexed repositories.
          </p>
        </>
      )}
      <form onSubmit={onSubmit} noValidate className="card">
        <h2>{isSignup ? "Create an account" : "Sign in"}</h2>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            maxLength={254}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignup ? "new-password" : "current-password"}
          />
        </label>
        {isSignup && <p className="hint">8 to 72 bytes.</p>}
        <ErrorMessage message={error} />
        <button type="submit" disabled={busy}>
          {busy ? "Please wait..." : isSignup ? "Sign up" : "Log in"}
        </button>
      </form>
      <p className="muted center-text">
        {isSignup ? "Already have an account?" : "No account yet?"}{" "}
        <button type="button" className="link" onClick={toggle}>
          {isSignup ? "Log in" : "Sign up"}
        </button>
      </p>
    </div>
  );
}
