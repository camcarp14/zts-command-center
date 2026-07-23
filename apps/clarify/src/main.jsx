import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { ToastProvider } from './ui.jsx'

// Dev-only mock mode: `VITE_MOCK=1 npm run dev` serves every Supabase/Netlify
// call from in-memory fixtures (src/dev/) — deterministic screenshots, zero
// live-DB risk. Statically false in production builds, so none of it bundles.
if (import.meta.env.DEV && import.meta.env.VITE_MOCK === '1') {
  const { install } = await import('./dev/mockServer.js')
  install()
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
)
