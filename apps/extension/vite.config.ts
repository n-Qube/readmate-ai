import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (env.READMATE_RELEASE_BUILD === "1") {
    if (!env.VITE_CLERK_PUBLISHABLE_KEY?.startsWith("pk_live_")) {
      throw new Error("Release extension builds require a Clerk live publishable key.");
    }
    if (!env.VITE_READMATE_API_URL?.startsWith("https://")) {
      throw new Error("Release extension builds require an HTTPS ReadMate API URL.");
    }
    if (/accounts\.dev|localhost|127\.0\.0\.1/i.test(`${env.VITE_CLERK_SYNC_HOST} ${env.VITE_READMATE_API_URL}`)) {
      throw new Error("Release extension builds cannot target development identity or API hosts.");
    }
    if (env.VITE_ENABLE_CLERK_UI !== "true") {
      throw new Error("Release extension builds must enable Clerk UI.");
    }
  }

  return {
    logLevel: "warn",
    plugins: [react()],
    base: "./",
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: {
          sidepanel: "sidepanel.html",
          popup: "popup.html",
          background: "src/background.ts",
          content: "src/content.ts"
        },
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]"
        }
      }
    },
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.ts"],
      exclude: ["dist/**", "node_modules/**"]
    }
  };
});
