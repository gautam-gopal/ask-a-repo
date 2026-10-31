import { useEffect, useState } from "react";

export default function App() {
  const [health, setHealth] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/healthz")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setHealth)
      .catch((err) => setError(err.message));
  }, []);

  let line = "Checking server...";
  if (error) line = `Server unreachable: ${error}`;
  else if (health)
    line = `Server: ${health.status}, database: ${health.db}, uptime: ${health.uptime}s`;

  return (
    <main>
      <h1>Ask-a-Repo</h1>
      <p>{line}</p>
    </main>
  );
}
