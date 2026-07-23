import { useEffect, useMemo, useRef } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AppProvider, useApp, STAGES, stageLabel } from './lib/store.jsx';
import { ToastProvider, CommandK, SkBoard, SkLine, ErrorState, useToast } from './ui/primitives.jsx';
import Login from './pages/Login.jsx';
import Board from './pages/Board.jsx';
import Capture from './pages/Capture.jsx';
import JobDetail from './pages/JobDetail.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import Market from './pages/Market.jsx';
import PrintView from './pages/PrintView.jsx';

function Rail() {
  const { session, signOut, discoveries } = useApp();
  const cls = ({ isActive }) => `nav-item${isActive ? ' active' : ''}`;
  const queued = (discoveries || []).length;
  return (
    <nav className="rail">
      <div className="brand"><span className="dot" />RUNWAY</div>
      <NavLink to="/" end className={cls}>Board</NavLink>
      <NavLink to="/capture" className={cls}>
        Capture{queued > 0 && <span className="navcount" title={`${queued} discovered role${queued === 1 ? '' : 's'} to review`}>{queued}</span>}
      </NavLink>
      <NavLink to="/market" className={cls}>Insights</NavLink>
      <NavLink to="/profile" className={cls}>Profile</NavLink>
      <div className="rail-foot">
        <div><kbd>⌘K</kbd> jump anywhere</div>
        <div className="who" title={session?.user?.email}>{session?.user?.email}</div>
        <button className="btn ghost sm" onClick={signOut}>Sign out</button>
      </div>
    </nav>
  );
}

// layout-matched boot skeleton — the page develops, it doesn't arrive
function BootScreen() {
  return (
    <div className="shell">
      <div className="rail">
        <div className="brand"><span className="dot" />RUNWAY</div>
        <SkLine w="w80" /><SkLine w="w60" /><SkLine w="w80" /><SkLine w="w60" />
      </div>
      <main className="main"><SkBoard /></main>
    </div>
  );
}

function Shell() {
  const { session, jobs, loadError, refresh, moveStage, boards, runScan } = useApp();
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();

  // auto-scan watched boards on open, at most once per session and only when
  // the last scan is stale — new roles appear without hunting through tabs
  const scanTriedRef = useRef(false);
  useEffect(() => {
    if (!session || scanTriedRef.current || !boards || boards.length === 0) return;
    const last = Math.max(0, ...boards.map((b) => (b.last_scanned_at ? new Date(b.last_scanned_at).getTime() : 0)));
    if (Date.now() - last < 6 * 60 * 60 * 1000) return;
    scanTriedRef.current = true;
    runScan()
      .then((s) => {
        if (s.queued > 0) toast(`Found ${s.queued} new match${s.queued === 1 ? '' : 'es'} — review them on Capture`);
      })
      .catch(() => { /* quiet here — Scan now on Capture surfaces errors with Retry */ });
  }, [session, boards, runScan, toast]);

  const paletteItems = useMemo(() => {
    const items = [
      { label: 'Board', path: '/', hint: 'page', k: ['board', 'pipeline', 'home', 'dashboard'] },
      { label: 'Capture a job', path: '/capture', hint: 'page', k: ['add', 'new', 'paste', 'capture'] },
      { label: 'Review discovered roles', path: '/capture', hint: 'inbox', k: ['discover', 'inbox', 'scan', 'triage', 'review', 'matches'] },
      { label: 'Insights', path: '/market', hint: 'page', k: ['market', 'comp', 'salary', 'pay', 'insights', 'funnel', 'stats'] },
      { label: 'Profile & targets', path: '/profile', hint: 'page', k: ['profile', 'settings', 'resume', 'target', 'criteria'] },
    ];
    for (const j of jobs || []) {
      const co = j.company || 'Unknown';
      items.push({
        label: `${co} — ${j.title || 'Untitled'}`,
        path: `/jobs/${j.id}`,
        hint: stageLabel(j.status),
        k: [j.company, j.title, j.status],
      });
      if (j.status === 'closed') continue;
      const move = (stage, verb) => async () => {
        try {
          await moveStage(j.id, stage);
          toast(`${co} → ${stageLabel(stage)}`);
        } catch (ex) { toast(`Couldn't ${verb}: ${ex.message}`, { err: true }); }
      };
      if (j.status === 'saved' || j.status === 'researching') {
        items.push({
          label: `Log application: ${co}`,
          hint: 'action', run: move('applied', 'log it'),
          k: ['log', 'apply', 'applied', 'application', j.company],
        });
      }
      const idx = STAGES.findIndex((s) => s.id === j.status);
      const next = STAGES[idx + 1];
      if (next) {
        items.push({
          label: `Advance: ${co} → ${next.label}`,
          hint: 'action', run: move(next.id, 'advance it'),
          k: ['advance', 'move', 'stage', 'next', j.company],
        });
      }
      items.push({
        label: `Add follow-up: ${co}`,
        path: `/jobs/${j.id}?tab=followups`, hint: 'action',
        k: ['follow', 'followup', 'follow-up', 'note', 'remind', j.company],
      });
    }
    return items;
  }, [jobs, moveStage, toast]);

  if (session === undefined) return <BootScreen />;
  if (!session) return <Login />;

  return (
    <div className="shell">
      <Rail />
      <main className="main">
        {loadError ? (
          <ErrorState msg={`Couldn't load your data: ${loadError}`} onRetry={refresh} />
        ) : (
          <div className="pagefade" key={location.pathname}>
            <Routes location={location}>
              <Route path="/" element={<Board />} />
              <Route path="/capture" element={<Capture />} />
              <Route path="/jobs/:id" element={<JobDetail />} />
              <Route path="/print/:id/:kind" element={<PrintView />} />
              <Route path="/market" element={<Market />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        )}
      </main>
      <CommandK items={paletteItems} />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </AppProvider>
  );
}
