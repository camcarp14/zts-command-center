import React from "react";
import ReactDOM from "react-dom/client";
import { AuditApp } from "./AuditApp.jsx";

// Same dev-only mock mode as the main entry (see src/main.jsx) — lets the
// audit flow be driven end-to-end with zero network. Tree-shaken from prod.
if (import.meta.env.DEV && import.meta.env.VITE_MOCK === "1") {
  const { install } = await import("../dev/mockServer.js");
  install();
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuditApp />
  </React.StrictMode>
);
