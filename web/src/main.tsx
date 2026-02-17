import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import TrackerApp from "./tracker/TrackerApp";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing #root element");
}

const isTrackerRoute = window.location.pathname.startsWith("/tracker");

createRoot(root).render(
  <StrictMode>
    {isTrackerRoute ? <TrackerApp /> : <App />}
  </StrictMode>
);
