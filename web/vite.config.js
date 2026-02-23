import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { resolveStudioBrainNetworkProfile } from "../scripts/studio-network-profile.mjs";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";
  const parseCsvList = (value) =>
    String(value || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  const normalizeUrl = (value) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    const normalized = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    try {
      return new URL(normalized).toString().replace(/\/+$/, "");
    } catch {
      return "";
    }
  };
  const parsePort = (value, fallback) => {
    const parsed = Number(String(value || "").trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      return fallback;
    }
    return parsed;
  };

  const network = resolveStudioBrainNetworkProfile();
  const defaultHost = network.host || "127.0.0.1";
  const profileHosts = network.allowedStudioBrainHosts || [];
  const defaultAllowedHosts = Array.from(
    new Set(profileHosts.concat(parseCsvList(process.env.VITE_ALLOWED_HOSTS)))
  );

  const host = process.env.VITE_DEV_HOST || process.env.VITE_HOST || defaultHost;
  const port = parsePort(process.env.VITE_PORT || process.env.PORT, 5173);
  const allowedHosts = parseCsvList(process.env.VITE_ALLOWED_HOSTS).length > 0
    ? parseCsvList(process.env.VITE_ALLOWED_HOSTS)
    : defaultAllowedHosts;
  const studioBrainProxyTarget = normalizeUrl(
    process.env.VITE_STUDIO_BRAIN_PROXY_TARGET ||
      process.env.VITE_STUDIO_BRAIN_BASE_URL ||
      `http://${defaultHost}:8787`,
  );
  const functionsProxyTarget = normalizeUrl(
    process.env.VITE_FUNCTIONS_PROXY_TARGET ||
      process.env.VITE_FUNCTIONS_BASE_URL ||
      `http://${defaultHost}:5001/monsoonfire-portal/us-central1`,
  );
  const proxy = {};
  if (studioBrainProxyTarget) {
    proxy["/__studio-brain"] = {
      target: studioBrainProxyTarget,
      changeOrigin: true,
      secure: false,
      rewrite: (path) => path.replace(/^\/__studio-brain/, "") || "/",
    };
  }
  if (functionsProxyTarget) {
    proxy["/__functions"] = {
      target: functionsProxyTarget,
      changeOrigin: true,
      secure: false,
      rewrite: (path) => path.replace(/^\/__functions/, "") || "/",
    };
  }

  const plugins = [react()];
  if (!isDev) {
    plugins.push(
      VitePWA({
        registerType: "autoUpdate",
        selfDestroying: true,
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
      port,
      allowedHosts,
      strictPort: true,
      proxy,
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
