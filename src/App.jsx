import React, { useState, useEffect, useCallback, useRef } from 'react';
import { openDb, getAll, get, del, metaGet, metaSet } from './lib/db.js';
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
import CaptureView from './components/CaptureView.jsx';
import ListView from './components/ListView.jsx';
import DetailModal from './components/DetailModal.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import { Ic } from './components/icons.jsx';

const TABS = [
  { id: 'server', label: 'Server Scans (/v1)', icon: Ic.queue },
  { id: 'queue', label: 'Batch Queue', icon: Ic.folder },
  { id: 'capture', label: 'Capture', icon: Ic.capture },
  { id: 'list', label: 'Invoices', icon: Ic.invoices },
];

export default function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('server');
  const [records, setRecords] = useState([]);
  const [queuePendingCount, setQueuePendingCount] = useState(0);
  const [detailId, setDetailId] = useState(null);
  const [detailRec, setDetailRec] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editRecord, setEditRecord] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [jobSnapshot, setJobSnapshot] = useState(getJobManagerSnapshot());
  const toastId = useRef(0);

  const toast = useCallback((msg, err) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, err }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3400);
  }, []);

  const loadRecords = useCallback(async () => {
    const recs = (await getAll('invoices')).sort((a, b) =>
      String(b.invoiceDate || b.saved_at).localeCompare(String(a.invoiceDate || a.saved_at))
    );
    setRecords(recs);
    try {
      const q = await getAll('queue');
      setQueuePendingCount(q.filter((x) => x.status === 'pending' || x.status === 'running').length);
    } catch (_) {}
    return recs;
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
        }
        await loadRecords();
        setReady(true);
        await bootPersistentJobs({
          onToast: toast,
          onRecordsChanged: loadRecords,
          onNeedSettings: () => setSettingsOpen(true),
        });
      })
      .catch(() => toast('Storage unavailable in this browser', true));
  }, [loadRecords, toast]);

  useEffect(() => {
    if (!ready) return;
    return subscribeJobManager((snap) => {
      setJobSnapshot(snap);
      getAll('queue')
        .then((q) => {
          setQueuePendingCount(
            q.filter((x) => x.status === 'pending' || x.status === 'running').length
          );
        })
        .catch(() => {});
    });
  }, [ready]);

  const openDetail = useCallback(async (id) => {
    if (!id) return;
    const r = await get('invoices', id);
    if (!r) return;
    setDetailId(id);
    setDetailRec(r);
  }, []);

  const openServerDetail = useCallback((rec) => {
    if (!rec) return;
    setDetailId(rec.id || null);
    setDetailRec(rec);
  }, []);

  const deleteDetail = async () => {
    if (!detailId) return;
    if (!window.confirm('Delete this record?')) return;
    await del('invoices', detailId);
    setDetailRec(null);
    setDetailId(null);
    toast('Record deleted');
    loadRecords();
  };

  const editDetail = () => {
    const r = detailRec;
    setDetailRec(null);
    setDetailId(null);
    setEditRecord(r);
    switchTab('capture');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const doneCnt = records.length;
  const serverRunning = jobSnapshot.serverJob?.running;
  const localRunning = jobSnapshot.localQueue?.running;

  if (!ready)
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
          <div style={{ marginTop: 12, fontWeight: 600 }}>Opening local database…</div>
        </div>
      </div>
    );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="logo">
          <div className="mark">P</div>
          <div>
            <div className="t">Projects</div>
            <div className="s">Invoice intelligence</div>
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
              {t.id === 'server' && serverRunning && <span className="cnt live">LIVE</span>}
              {t.id === 'queue' && (localRunning || queuePendingCount > 0) && (
                <span className={'cnt' + (localRunning ? ' live' : '')}>
                  {localRunning ? 'LIVE' : queuePendingCount}
                </span>
              )}
              {t.id === 'list' && doneCnt > 0 && <span className="cnt">{doneCnt}</span>}
            </button>
          ))}
        </nav>
        <div className="foot">
          Background jobs persist across tabs &amp; page refresh · KHB v1
        </div>
      </aside>

      <main className="main">
        {/* Global Background Job Banner when user switches away from the active job tab */}
        {serverRunning && tab !== 'server' && (
          <div className="global-job-bar">
            <div className="row" style={{ gap: 10 }}>
              <span className="pulse" style={{ borderColor: '#818cf8', borderTopColor: '#fff' }} />
              <div>
                <div style={{ fontWeight: 800, fontSize: 13 }}>
                  Server Scans (/v1) AI Job Running in Background
                </div>
                <div style={{ fontSize: 11.5, color: '#cbd5e1' }}>
                  {jobSnapshot.serverJob.stats?.bannerMsg || 'Processing scans…'} · Updated:{' '}
                  <b>{jobSnapshot.serverJob.stats?.updated || 0}</b>
                </div>
              </div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="v1-btn-dark"
                onClick={() => switchTab('server')}
              >
                Open Mission Control
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
            <h1>{TABS.find((t) => t.id === tab).label}</h1>
            <div className="sub">
              {tab === 'server' &&
                'Fetch /v1/list/scans, analyze imageUrl with AI, POST update with APPROVED & auto-next page'}
              {tab === 'queue' && 'Drop, queue and batch-extract document scans'}
              {tab === 'capture' && 'Single document capture with AI extraction'}
              {tab === 'list' && 'Search, review and manage extracted records'}
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
            onRecordsChanged={loadRecords}
            openServerDetail={openServerDetail}
          />
        )}
        {tab === 'queue' && (
          <QueueView
            toast={toast}
            openSettings={() => setSettingsOpen(true)}
            onRecordsChanged={loadRecords}
            openDetail={openDetail}
          />
        )}
        {tab === 'capture' && (
          <CaptureView
            toast={toast}
            openSettings={() => setSettingsOpen(true)}
            onSaved={loadRecords}
            editRecord={editRecord}
            onEditDone={() => setEditRecord(null)}
          />
        )}
        {tab === 'list' && (
          <ListView
            records={records}
            refresh={loadRecords}
            toast={toast}
            openDetail={openDetail}
          />
        )}
      </main>

      <DetailModal
        record={detailRec}
        onClose={() => {
          setDetailRec(null);
          setDetailId(null);
        }}
        onDelete={deleteDetail}
        onEdit={editDetail}
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
