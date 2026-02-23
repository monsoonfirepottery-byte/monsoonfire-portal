import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import RootErrorBoundary from "./components/RootErrorBoundary.tsx";
import RuntimeHardeningChrome from "./components/RuntimeHardeningChrome.tsx";

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
