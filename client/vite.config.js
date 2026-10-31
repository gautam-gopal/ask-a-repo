import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, Vite (5173) forwards API calls to Express. Change 3000 if your PORT differs.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/healthz": "http://localhost:3000",
      "/api": "http://localhost:3000",
    },
  },
});
