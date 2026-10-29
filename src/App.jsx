import React, { useState, useEffect, useCallback, useRef } from 'react';
import { openDb, getAll, metaGet, metaSet } from './lib/db.js';
import {
  getJobManagerSnapshot,
  subscribeJobManager,
  bootPersistentJobs,
  pauseServerScanJob,
  stopServerScanJob,
  pauseLocalQueueJob,
  cancelLocalQueueJob,
} from './lib/jobManager.js';
import QueueView from './components/QueueView.jsx';
import ServerScansView from './components/ServerScansView.jsx';
import DetailModal from './components/DetailModal.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import { Ic } from './components/icons.jsx';

const TABS = [
  { id: 'server', label: 'Server Scans', icon: Ic.queue },
  { id: 'queue', label: 'Batch Queue', icon: Ic.folder },
];

export default function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('server');
  const [queuePendingCount, setQueuePendingCount] = useState(0);
  const [detailRec, setDetailRec] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [jobSnapshot, setJobSnapshot] = useState(getJobManagerSnapshot());
  const toastId = useRef(0);

  const toast = useCallback((msg, err) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3400);
  }, []);

  const refreshQueueCount = useCallback(async () => {
    try {
      const q = await getAll('queue');
      setQueuePendingCount(q.filter((x) => x.status === 'pending' || x.status === 'running').length);
    } catch (_) {}
  }, []);

  const switchTab = useCallback((nextTab) => {
    setTab(nextTab);
    metaSet('activeTab', nextTab).catch(() => {});
  }, []);

  useEffect(() => {
    openDb()
      .then(async () => {
        const savedTab = await metaGet('activeTab');
        if (savedTab && TABS.some((t) => t.id === savedTab)) {
          setTab(savedTab);
        } else {
          setTab('server');
        }
        await refreshQueueCount();
        setReady(true);
        await bootPersistentJobs({
          onToast: toast,
          onRecordsChanged: refreshQueueCount,
          onNeedSettings: () => setSettingsOpen(true),
        });
      })
      .catch(() => toast('Storage unavailable in this browser', true));
  }, [refreshQueueCount, toast]);

  useEffect(() => {
    if (!ready) return;
    return subscribeJobManager((snap) => {
      setJobSnapshot(snap);
      refreshQueueCount();
    });
  }, [ready, refreshQueueCount]);

  const openQueueDetail = useCallback((item) => {
    if (!item) return;
    setDetailRec(item.record || item);
  }, []);

  const openServerDetail = useCallback((rec) => {
    if (!rec) return;
    setDetailRec(rec);
  }, []);

  const serverRunning = jobSnapshot.serverJob?.running;
  const serverWaiting = jobSnapshot.serverJob?.waitingNextPass;
  const localRunning = jobSnapshot.localQueue?.running;

  if (!ready) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--muted)',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <span className="pulse" style={{ width: 26, height: 26, borderWidth: 3 }} />
          <div style={{ marginTop: 12, fontWeight: 600 }}>Initializing SV AI Analysis…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          <div className="mark">SV</div>
          <div>
            <div className="t">SV AI Analysis</div>
            <div className="s">24/7 Overtime Engine</div>
          </div>
        </div>
        <nav className="nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              onClick={() => switchTab(t.id)}
            >
              <t.icon className="ic" />
              <span>{t.label}</span>
              {t.id === 'server' && (serverRunning || serverWaiting) && (
                <span className={`cnt ${serverWaiting ? '' : 'live'}`} style={serverWaiting ? { background: '#f59e0b', color: '#111' } : {}}>
                  {serverWaiting ? 'IDLE' : 'LIVE'}
                </span>
              )}
              {t.id === 'queue' && (localRunning || queuePendingCount > 0) && (
                <span className={'cnt' + (localRunning ? ' live' : '')}>
                  {localRunning ? 'LIVE' : queuePendingCount}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="foot">
          24/7 continuous overtime runner · Persistent background pipeline
        </div>
      </aside>

      <main className="main">
        {/* Global Background Job Banner when user switches away from the server tab */}
        {(serverRunning || serverWaiting) && tab !== 'server' && (
          <div className="global-job-bar">
            <div className="row" style={{ gap: 10 }}>
              <span className="pulse" style={{ borderColor: serverWaiting ? '#f59e0b' : '#818cf8', borderTopColor: '#fff' }} />
              <div>
                <div style={{ fontWeight: 800, fontSize: 13 }}>
                  Server Scans 24/7 Overtime Runner Active
                </div>
                <div style={{ fontSize: 11.5, color: '#cbd5e1' }}>
                  {jobSnapshot.serverJob.stats?.bannerMsg || (serverWaiting ? `Waiting for next poll pass (${jobSnapshot.serverJob.nextPassCountdown || 0}s)…` : 'Processing server scans…')} · Updated:{' '}
                  <b>{jobSnapshot.serverJob.stats?.updated || 0}</b>
                  {jobSnapshot.serverJob.passesCompleted > 0 && ` · Passes: ${jobSnapshot.serverJob.passesCompleted}`}
                </div>
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="v1-btn-dark"
                onClick={() => switchTab('server')}
              >
                Open Server Scans
              </button>
              <button
                type="button"
                className="v1-btn-dark"
                onClick={() => pauseServerScanJob(toast)}
              >
                Pause
              </button>
              <button
                type="button"
                className="v1-btn-dark"
                onClick={() => stopServerScanJob(toast)}
              >
                Stop
              </button>
            </div>
          </div>
        )}

        {localRunning && tab !== 'queue' && (
          <div className="global-job-bar">
            <div className="row" style={{ gap: 10 }}>
              <span className="pulse" style={{ borderColor: '#818cf8', borderTopColor: '#fff' }} />
              <div>
                <div style={{ fontWeight: 800, fontSize: 13 }}>
                  Local Batch Queue Running in Background
                </div>
                <div style={{ fontSize: 11.5, color: '#cbd5e1' }}>
                  Extracting {jobSnapshot.localQueue.currentFile || 'documents'} ·{' '}
                  {queuePendingCount} remaining
                </div>
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="v1-btn-dark"
                onClick={() => switchTab('queue')}
              >
                Open Batch Queue
              </button>
              <button
                type="button"
                className="v1-btn-dark"
                onClick={() => pauseLocalQueueJob(toast)}
              >
                Pause
              </button>
              <button
                type="button"
                className="v1-btn-dark"
                onClick={() => cancelLocalQueueJob(toast)}
              >
                Stop
              </button>
            </div>
          </div>
        )}

        <div className="pagehead">
          <div>
            <h1>{TABS.find((t) => t.id === tab)?.label || 'Server Scans'}</h1>
            <div className="sub">
              {tab === 'server' &&
                '24/7 continuous overtime auto-analysis on PENDING scans and empty-item documents'}
              {tab === 'queue' && 'Drop, queue and batch-extract local document scans'}
            </div>
          </div>
          <button className="btn" onClick={() => setSettingsOpen(true)}>
            <Ic.settings className="ic" /> Settings
          </button>
        </div>

        {tab === 'server' && (
          <ServerScansView
            toast={toast}
            openSettings={() => setSettingsOpen(true)}
            onRecordsChanged={refreshQueueCount}
            openServerDetail={openServerDetail}
          />
        )}
        {tab === 'queue' && (
          <QueueView
            toast={toast}
            openSettings={() => setSettingsOpen(true)}
            onRecordsChanged={refreshQueueCount}
            openDetail={openQueueDetail}
          />
        )}
      </main>

      <DetailModal
        record={detailRec}
        onClose={() => setDetailRec(null)}
      />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => toast('Settings saved ✓')}
      />

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={'toast' + (t.err ? ' err' : '')}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
