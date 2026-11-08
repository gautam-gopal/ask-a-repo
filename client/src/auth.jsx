import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import * as api from "./api.js";

const AuthContext = createContext(null);
const ANON = { status: "anonymous", user: null, demo: false };

// /api/me is the only source of truth: no token or user is stored in the browser.
export function AuthProvider({ children }) {
  const [state, setState] = useState({
    status: "loading",
    user: null,
    demo: false,
  });

  useEffect(() => {
    let active = true;
    // Any 401 from a protected call lands here. Idempotent, so it cannot loop.
    api.setUnauthorizedHandler(() =>
      setState((prev) => (prev.status === "anonymous" ? prev : ANON)),
    );
    api
      .me()
      .then(
        ({ user, demo }) =>
          active &&
          setState({ status: "authenticated", user, demo: demo === true }),
      )
      .catch(() => active && setState(ANON));
    return () => {
      active = false;
      api.setUnauthorizedHandler(null);
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const { user } = await api.login(email, password);
    setState({ status: "authenticated", user, demo: false });
  }, []);
  const signup = useCallback(async (email, password) => {
    const { user } = await api.signup(email, password);
    setState({ status: "authenticated", user, demo: false });
  }, []);
  const loginDemo = useCallback(async () => {
    const { user } = await api.demoLogin();
    setState({ status: "authenticated", user, demo: true });
  }, []);
  // Throws if the server call fails, so the cookie is never left set while the UI says "signed out".
  const logout = useCallback(async () => {
    await api.logout();
    setState(ANON);
  }, []);

  const value = useMemo(
    () => ({ ...state, login, signup, loginDemo, logout }),
    [state, login, signup, loginDemo, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
