import { createRoot } from "react-dom/client";
import { ToastProvider } from "@cc/ui";
import Shell from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <ToastProvider>
    <Shell />
  </ToastProvider>
);
