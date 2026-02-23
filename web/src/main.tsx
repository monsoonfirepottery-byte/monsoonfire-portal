import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import RootErrorBoundary from "./components/RootErrorBoundary.tsx";
import RuntimeHardeningChrome from "./components/RuntimeHardeningChrome.tsx";

const CHUNK_RECOVERY_KEY = "mf:chunk-reload-at";
const CHUNK_RECOVERY_MIN_INTERVAL_MS = 15_000;

function readChunkRecoveryStamp(): number {
  try {
    const raw = window.sessionStorage.getItem(CHUNK_RECOVERY_KEY);
    const parsed = Number(raw ?? "0");
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return parsed;
  } catch {
    return 0;
  }
}

function writeChunkRecoveryStamp(value: number): void {
  try {
    window.sessionStorage.setItem(CHUNK_RECOVERY_KEY, String(value));
  } catch {
    // Ignore storage write failures.
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    const now = Date.now();
    const lastAttemptAt = readChunkRecoveryStamp();
    if (now - lastAttemptAt < CHUNK_RECOVERY_MIN_INTERVAL_MS) {
      return;
    }

    writeChunkRecoveryStamp(now);
    event.preventDefault();
    window.location.reload();
  });
}

const root = document.getElementById("root");
if (!root) {
  const fallback = document.createElement("div");
  fallback.className = "root-mount-fallback";
  fallback.innerHTML = `
    <h1>Monsoon Fire Portal</h1>
    <p>The app could not find its mount point and did not start.</p>
    <p>Try refreshing. If this keeps happening, contact support and mention code: root-missing.</p>
  `;
  document.body.appendChild(fallback);
} else {
  createRoot(root).render(
    <StrictMode>
      <RootErrorBoundary>
        <RuntimeHardeningChrome>
          <App />
        </RuntimeHardeningChrome>
      </RootErrorBoundary>
    </StrictMode>
  );
}
