import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The shared validation schemas import zod via an "npm:zod@x" specifier so the
// same file also works unmodified inside Deno-based Supabase Edge Functions.
// Vite/Rollup don't understand the "npm:" scheme, so this alias strips the
// prefix (and any @version suffix) back down to the plain package name that
// node_modules resolution expects.
export default defineConfig(({ mode }) => {
  // Config files run in plain Node before Vite's own env handling kicks in,
  // so .env isn't in process.env here the way it is in browser code via
  // import.meta.env - loadEnv reads the same .env file explicitly instead.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    resolve: {
      alias: [{ find: /^npm:([^@]+).*$/, replacement: "$1" }],
    },
    server: {
      proxy: {
        // Keeps the API same-origin in dev so the session cookie is
        // first-party instead of needing SameSite=None. Set
        // VITE_API_BASE_URL in .env to this project's deployed Edge
        // Functions URL - there is no local fallback since this project
        // runs against a hosted Supabase project, not the local CLI stack.
        "/api": {
          target: env.VITE_API_BASE_URL,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  };
});
