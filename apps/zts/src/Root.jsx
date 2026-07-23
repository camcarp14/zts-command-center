// Mount entry consumed by the shell. Keeps ZTS's own ToastProvider around its
// subtree (its components call useToast from ./ui.jsx), so nothing inside ZTS
// changes. `embedded` tells App the shell owns login + the app toggle, so ZTS
// drops its duplicate brand/sign-out chrome and keeps only its own tab nav.
import { ToastProvider } from "./ui.jsx";
import App from "./App.jsx";

export default function ZtsRoot() {
  return (
    <ToastProvider>
      <App embedded />
    </ToastProvider>
  );
}
