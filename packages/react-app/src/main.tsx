import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
// Self-hosted Poppins (offline-safe; no external font request)
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "./globals.css";
// styles.css retired in Phase 2 (ADR-009) — all rules migrated to Tailwind + globals.css

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found in the document.");
}

ReactDOM.createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
