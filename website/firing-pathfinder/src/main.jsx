import React from "react";
import { createRoot } from "react-dom/client";
import { App, applyStoredDisplayOptions } from "./App.jsx";
import "./styles.css";

applyStoredDisplayOptions();

if (
  window.location.pathname.includes("/firing-services/pathfinder/") &&
  !document.querySelector("script[data-mf-site-runtime]")
) {
  const siteRuntime = document.createElement("script");
  siteRuntime.src = "../../assets/js/firing-care.js?v=2.1.13";
  siteRuntime.defer = true;
  siteRuntime.dataset.mfSiteRuntime = "true";
  document.head.append(siteRuntime);
}

class PathfinderErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("Monsoon Fire pathfinder failed safely", error);
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="failure-shell" role="alert">
          <p className="micro-label">We couldn’t open the firing planner</p>
          <h1>Nothing was submitted.</h1>
          <p>You can go back to Firing Services or email the studio.</p>
          <p>
            <a href="../">Back to firing services</a>
            <span aria-hidden="true"> · </span>
            <a href="mailto:support@monsoonfire.com">Email the studio</a>
          </p>
        </main>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PathfinderErrorBoundary>
      <App />
    </PathfinderErrorBoundary>
  </React.StrictMode>,
);
