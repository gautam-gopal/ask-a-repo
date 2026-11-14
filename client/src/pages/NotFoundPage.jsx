import { Link } from "react-router-dom";
import { useTitle } from "../components.jsx";

export default function NotFoundPage() {
  useTitle("Page not found · Ask-a-Repo");
  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="auth-head">
          <h1>Page not found</h1>
          <p>That address does not exist in Ask-a-Repo.</p>
        </div>
        <Link className="btn btn-lg btn-block" to="/repos">
          Go to repositories
        </Link>
      </div>
    </main>
  );
}
