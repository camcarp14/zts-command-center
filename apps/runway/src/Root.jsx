// Mount entry for the shell.
//   • MemoryRouter: Runway is the one tool built on react-router. A MemoryRouter
//     keeps its routing in memory so it never touches the browser URL the shell
//     lives at — no basename juggling, no stale paths when you switch tools.
//   • Scoped CSS: Runway styles with global class + element selectors (its own
//     dark theme). We inject them via ?inline only while Runway is mounted and
//     remove them on unmount — and since the shell mounts one tool at a time,
//     Runway's `body {}` / `input {}` rules can never bleed onto ZTS/Clarify.
//   • Auth: Runway's supabase-js client reads the same VITE_SUPABASE_URL as the
//     shell (the clarify project), so it shares the one session automatically.
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import appCss from "./styles/app.css?inline";
import polishCss from "./styles/polish.css?inline";
import App from "./App.jsx";

// Sit Runway's full-height rail + shell below the 52px Command Center top bar.
const EMBED_OVERRIDES = `
.shell { min-height: calc(100vh - 52px); }
.rail { top: 52px; height: calc(100vh - 52px); }
`;

export default function RunwayRoot() {
  useEffect(() => {
    const el = document.createElement("style");
    el.id = "rw-scoped-styles";
    el.textContent = `${polishCss}\n${appCss}\n${EMBED_OVERRIDES}`;
    document.head.appendChild(el);
    return () => el.remove();
  }, []);
  return (
    <MemoryRouter>
      <App />
    </MemoryRouter>
  );
}
