// Single definition of "test file", used by ingest (via github.js filterTree) and by the eval.
// Matches /test/, /tests/, /__tests__/ directories and *.test.* / *.spec.* with js, jsx, ts, tsx.
export function isTestPath(p) {
  const s = `/${String(p).toLowerCase()}`;
  return (
    s.includes("/test/") ||
    s.includes("/tests/") ||
    s.includes("/__tests__/") ||
    /\.(test|spec)\.(js|jsx|ts|tsx)$/.test(s)
  );
}
