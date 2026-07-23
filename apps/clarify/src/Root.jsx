// Mount entry for the shell. Clarify authenticates by sending its own
// `clarify_token` bearer to the SAME clarify Supabase project the shell logs
// into — so we just mirror the shell's supabase-js session tokens into the
// localStorage keys Clarify already reads. One login, no auth rewrite. Its own
// ToastProvider stays wrapped around its subtree; `embedded` drops its
// duplicate brand/sign-out chrome so the shell owns them.
import { useEffect, useState } from "react";
import { supabase } from "@cc/supabase";
import { ToastProvider } from "./ui.jsx";
import App from "./App.jsx";

function syncToken(session) {
  try {
    if (session?.access_token) {
      localStorage.setItem("clarify_token", session.access_token);
      if (session.refresh_token) localStorage.setItem("clarify_refresh", session.refresh_token);
    }
  } catch { /* storage unavailable — App falls back to its own auth check */ }
}

export default function ClarifyRoot() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let off;
    (async () => {
      const { data } = (await supabase?.auth.getSession()) || { data: {} };
      syncToken(data?.session);
      setReady(true);
      const { data: sub } = supabase?.auth.onAuthStateChange((_e, s) => syncToken(s)) || { data: null };
      off = () => sub?.subscription?.unsubscribe();
    })();
    return () => off?.();
  }, []);
  if (!ready) return null;
  return (
    <ToastProvider>
      <App embedded />
    </ToastProvider>
  );
}
