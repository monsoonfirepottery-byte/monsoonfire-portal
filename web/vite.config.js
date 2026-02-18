import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";
  const parseCsvList = (value) =>
    String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

  const host = process.env.VITE_DEV_HOST || process.env.VITE_HOST || "127.0.0.1";
  const allowedHosts = parseCsvList(process.env.VITE_ALLOWED_HOSTS);

  const plugins = [react()];
  if (!isDev) {
    plugins.push(
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["apple-touch-icon.png"],
        manifest: {
          name: "Monsoon Fire Portal",
          short_name: "MonsoonFire",
          start_url: "/",
          scope: "/",
          display: "standalone",
          background_color: "#0b0d0f",
          theme_color: "#0b0d0f",
          icons: [
            { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
            { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          ],
        },
      })
    );
  }

  return {
    server: {
      host,
      allowedHosts,
      strictPort: true,
      headers: {
        "Cache-Control": "no-store",
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (id.includes("firebase/auth")) return "vendor-firebase-auth";
            if (id.includes("firebase/firestore")) return "vendor-firebase-firestore";
            if (id.includes("firebase/storage")) return "vendor-firebase-storage";
            if (id.includes("firebase/app")) return "vendor-firebase-app";
            if (id.includes("firebase")) return "vendor-firebase-core";
            if (id.includes("react")) return "vendor-react";
            return "vendor";
          },
        },
      },
    },
    plugins,
  };
});
