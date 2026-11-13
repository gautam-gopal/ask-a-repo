import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth.jsx";
import { ErrorMessage, Spinner, useTitle } from "../components.jsx";
import { getConfig } from "../api.js";
import { validateAuth } from "../authHelpers.js";

export default function LoginPage() {
  const { status, login, signup, loginDemo } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null); // server error
  const [busy, setBusy] = useState(null); // null | "form" | "demo"
  const [demoOn, setDemoOn] = useState(false);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);

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
    const problems = validateAuth(mode, cleanEmail, password);
    setFieldErrors(problems);
    setError(null);
    const first = problems.email
      ? emailRef
      : problems.password
        ? passwordRef
        : null;
    if (first) return first.current?.focus();
    setBusy("form");
    try {
      await (isSignup ? signup : login)(cleanEmail, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  function switchMode(next) {
    if (next === mode) return;
    setMode(next);
    setError(null);
    setFieldErrors({});
  }

  async function onDemo() {
    setError(null);
    setBusy("demo");
    try {
      await loginDemo();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const passwordDescribedBy =
    [isSignup && "password-hint", fieldErrors.password && "password-error"]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-head">
          <h1>Ask-a-Repo</h1>
          <p>
            Ask questions about any public GitHub repository and get answers
            that cite exact lines.
          </p>
        </div>

        {demoOn && (
          <>
            <button
              type="button"
              className="btn btn-lg btn-block"
              onClick={onDemo}
              disabled={busy !== null}
              aria-busy={busy === "demo"}
            >
              {busy === "demo" ? "Please wait..." : "Try the demo"}
            </button>
            <p className="auth-hint">
              No signup. Read-only, with two pre-indexed repositories.
            </p>
            <div className="divider" aria-hidden="true">
              <span>or</span>
            </div>
          </>
        )}

        <div className="segmented" role="group" aria-label="Account">
          <button
            type="button"
            className="segmented__btn"
            aria-pressed={!isSignup}
            onClick={() => switchMode("login")}
          >
            Sign in
          </button>
          <button
            type="button"
            className="segmented__btn"
            aria-pressed={isSignup}
            onClick={() => switchMode("signup")}
          >
            Create account
          </button>
        </div>

        <form
          onSubmit={onSubmit}
          noValidate
          aria-label={isSignup ? "Create account" : "Sign in"}
        >
          <div className="field">
            <label className="field__label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              ref={emailRef}
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete={isSignup ? "email" : "username"}
              autoCapitalize="none"
              spellCheck={false}
              maxLength={254}
              aria-invalid={fieldErrors.email ? "true" : undefined}
              aria-describedby={fieldErrors.email ? "email-error" : undefined}
            />
            {fieldErrors.email && (
              <p id="email-error" className="field__error">
                {fieldErrors.email}
              </p>
            )}
          </div>
          <div className="field">
            <label className="field__label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              ref={passwordRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignup ? "new-password" : "current-password"}
              aria-invalid={fieldErrors.password ? "true" : undefined}
              aria-describedby={passwordDescribedBy}
            />
            {isSignup && (
              <p id="password-hint" className="field__hint">
                8 characters minimum, 72 bytes maximum.
              </p>
            )}
            {fieldErrors.password && (
              <p id="password-error" className="field__error">
                {fieldErrors.password}
              </p>
            )}
          </div>
          <ErrorMessage message={error} />
          <button
            type="submit"
            className={`btn btn-lg btn-block${demoOn ? " btn-secondary" : ""}`}
            disabled={busy !== null}
            aria-busy={busy === "form"}
          >
            {busy === "form"
              ? "Please wait..."
              : isSignup
                ? "Create account"
                : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
