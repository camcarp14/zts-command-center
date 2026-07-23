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

// Standardize Runway's nav with the other tools: a TOP bar on desktop (matching
// ZTS/Clarify + the shell toggle), a BOTTOM bar on mobile. Runway's own
// <=820px media query already turns its rail into a bottom bar, so we scope the
// desktop conversion to >=821px and never touch the mobile rules (the previous
// unconditional `.rail{top:52px}` was clobbering the mobile bottom nav).
const EMBED_OVERRIDES = `
@media (min-width: 821px) {
  .shell { display: flex; flex-direction: column; min-height: calc(100vh - 52px); }
  .rail {
    position: sticky; top: 52px; height: auto; width: 100%;
    flex-direction: row; align-items: center; gap: 6px;
    border-right: none; border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    backdrop-filter: blur(20px) saturate(140%); -webkit-backdrop-filter: blur(20px) saturate(140%);
    padding: 8px 20px; z-index: 40;
  }
  .rail .brand { display: none; }
  .rail .nav-item { flex: 0 0 auto; }
  .rail-foot { margin-top: 0; margin-left: auto; flex-direction: row; align-items: center; gap: 14px; padding: 0; font-size: 12px; }
  .rail-foot .btn { display: none; }   /* the shell owns sign-out */
  /* Let the inner .pagefade own the width (reading pages cap at 1220, the
     kanban breaks out to 1580) instead of clamping the board to a narrow column. */
  .main { max-width: 1580px; margin: 0 auto; width: 100%; }
}
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
