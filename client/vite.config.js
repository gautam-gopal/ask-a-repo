import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local dev needs TWO terminals: `npm run dev` (Express on PORT, default 3000) and
// `npm run dev:client` (Vite on 5173, open this one). Vite forwards /api and /healthz to
// Express, so cookies work same-origin. Change 3000 below if your PORT differs.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/healthz": "http://localhost:3000",
      "/api": "http://localhost:3000",
    },
  },
});
