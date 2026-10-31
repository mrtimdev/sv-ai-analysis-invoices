import React, { useState, useRef, useEffect, useCallback } from 'react';
import Select from 'react-select';
import { getAll, put, del, clearStore, getSettings } from '../lib/db.js';
import {
  getJobManagerSnapshot,
  subscribeJobManager,
  startLocalQueueJob,
  pauseLocalQueueJob,
  cancelLocalQueueJob,
  setLocalQueueChunkConfig,
} from '../lib/jobManager.js';
import { ingestDataTransfer, ingestFileList, ingestFile } from '../lib/ingest.js';
import { exportExcel } from '../lib/excel.js';
import { fmtEta } from '../lib/util.js';
import { Ic } from './icons.jsx';
import { coolSelectStyles } from './coolSelectTheme.js';

const CHUNK_OPTIONS = [
  { value: '25', label: '25 files' },
  { value: '50', label: '50 files' },
  { value: '100', label: '100 files' },
  { value: 'all', label: 'All at once' },
  { value: 'custom', label: 'Custom…' },
];

export default function QueueView({ toast, openSettings, onRecordsChanged, openDetail }) {
  const initSnap = getJobManagerSnapshot().localQueue;
  const [items, setItems] = useState([]);
  const [queueJob, setQueueJob] = useState(initSnap);
  const [ingestMsg, setIngestMsg] = useState(null);

  const reload = useCallback(async () => {
    const all = await getAll('queue');
    all.sort((a, b) => String(a.path || a.name).localeCompare(String(b.path || b.name)));
    setItems(all);
    return all;
  }, []);

  useEffect(() => {
    reload();
    return subscribeJobManager((snap) => {
      setQueueJob(snap.localQueue);
      reload();
    });
  }, [reload]);

  const running = queueJob.running;
  const paused = queueJob.paused;
  const chunk = queueJob.chunk || '25';
  const chunkCustom = queueJob.chunkCustom || '25';
  const etaMs = queueJob.etaMs;

  const saveChunk = (v) => {
    setLocalQueueChunkConfig(v, undefined);
  };

  const startRun = async () => {
    await startLocalQueueJob({
      onToast: toast,
      onRecordsChanged,
      onNeedSettings: openSettings,
      onQueueUpdated: () => reload(),
    });
  };

  const pause = async () => {
    await pauseLocalQueueJob(toast);
  };

  const cancel = async () => {
    await cancelLocalQueueJob(toast);
  };

  const retryFailed = async () => {
    const errs = items.filter((q) => q.status === 'error');
    if (!errs.length) return;
    for (const q of errs) {
      q.status = 'pending';
      q.error = null;
      await put('queue', q);
    }
    await reload();
    startRun();
  };

  const clearDone = async () => {
    const done = items.filter((q) => q.status === 'done');
    if (!done.length) return;
    if (
      !window.confirm(
        'Remove ' +
          done.length +
          ' completed job' +
          (done.length > 1 ? 's' : '') +
          ' from the queue?'
      )
    )
      return;
    for (const q of done) await del('queue', q.id);
    await reload();
    toast('Completed jobs cleared');
  };

  const clearAll = async () => {
    if (!items.length) return;
    if (
      !window.confirm(
        'Clear the entire queue (' +
          items.length +
          ' jobs)?'
      )
    )
      return;
    await clearStore('queue');
    await reload();
    toast('Queue cleared');
  };

  /* ingestion */
  const [dragOver, setDragOver] = useState(false);
  const doIngestDt = async (dt) => {
    setIngestMsg({ spin: true, text: 'Reading files…' });
    try {
      const { added, found } = await ingestDataTransfer(dt, (name) =>
        setIngestMsg({ spin: true, text: 'Adding ' + name + '…' })
      );
      if (added) toast(added + ' document' + (added > 1 ? 's' : '') + ' queued');
      else
        toast(
          'No supported files found (need ZIP, JPG, PNG or WebP) — ' + found + ' file(s) scanned',
          true
        );
      await reload();
    } catch (err) {
      toast('Could not read files: ' + err.message, true);
    }
    setIngestMsg(null);
  };

  const fileInput = useRef(null);
  const dirInput = useRef(null);
  const zipInput = useRef(null);

  const doIngestFiles = async (files) => {
    if (!files.length) return;
    setIngestMsg({ spin: true, text: 'Reading files…' });
    try {
      const added = await ingestFileList(files, (name) =>
        setIngestMsg({ spin: true, text: 'Adding ' + name + '…' })
      );
      if (added) toast(added + ' document' + (added > 1 ? 's' : '') + ' queued');
      else toast('No supported files found (need ZIP, JPG, PNG or WebP)', true);
      await reload();
    } catch (err) {
      toast('Could not read files: ' + err.message, true);
    }
    setIngestMsg(null);
  };

  const doIngestDir = async (files) => {
    if (!files.length) return;
    setIngestMsg({ spin: true, text: 'Reading folder…' });
    let added = 0;
    try {
      for (const f of files) {
        setIngestMsg({ spin: true, text: 'Adding ' + (f.webkitRelativePath || f.name) + '…' });
        if (await ingestFile(f, f.webkitRelativePath || f.name)) added++;
      }
      toast(added + ' documents queued');
      await reload();
    } catch (err) {
      toast('Could not read folder: ' + err.message, true);
    }
    setIngestMsg(null);
  };

  const exportXls = async () => {
    const done = items.filter((q) => q.status === 'done' && q.record);
    const recs = [];
    for (const q of done) {
      if (q.record) recs.push(q.record);
    }
    const res = await exportExcel(recs);
    if (res.ok) toast('Excel exported ✓');
    else toast(res.error, true);
  };

  /* stats */
  const done = items.filter((q) => q.status === 'done');
  const errs = items.filter((q) => q.status === 'error');
  const pend = items.filter((q) => q.status === 'pending' || q.status === 'running');
  const folders = [...new Set(items.map((q) => q.folder).filter(Boolean))];
  const total = items.length;
  const pct = total ? Math.round((100 * done.length) / total) : 0;
  const s = getSettings();
  const apiOk = !!(s.key && s.base);

  return (
    <React.Fragment>
      <div className="card">
        <h2>Add documents</h2>
        <div className="desc">
          Drop ZIP archives, image files, or entire folders — all scanned recursively, including
          subfolders. Nothing leaves your device except a compressed copy sent to your AI API.
        </div>
        <div
          className={'drop' + (dragOver ? ' over' : '')}
          onClick={() => fileInput.current && fileInput.current.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            doIngestDt(e.dataTransfer);
          }}
        >
          <div className="icon">
            <Ic.folder />
          </div>
          <div className="big">Drop ZIP files, images, or folders here</div>
          <div className="hint">ZIP · JPG · PNG · WebP · folders with subfolders</div>
          <div className="mini">
            or{' '}
            <a
              onClick={(e) => {
                e.stopPropagation();
                fileInput.current.click();
              }}
            >
              choose files
            </a>{' '}
            ·{' '}
            <a
              onClick={(e) => {
                e.stopPropagation();
                dirInput.current.click();
              }}
            >
              choose a folder
            </a>{' '}
            ·{' '}
            <a
              onClick={(e) => {
                e.stopPropagation();
                zipInput.current.click();
              }}
            >
              choose a ZIP
            </a>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".zip,image/*"
            multiple
            hidden
            onChange={(e) => {
              const f = [...e.target.files];
              e.target.value = '';
              doIngestFiles(f);
            }}
          />
          <input
            ref={dirInput}
            type="file"
            webkitdirectory=""
            directory=""
            multiple
            hidden
            onChange={(e) => {
              const f = [...e.target.files];
              e.target.value = '';
              doIngestDir(f);
            }}
          />
          <input
            ref={zipInput}
            type="file"
            accept=".zip"
            multiple
            hidden
            onChange={(e) => {
              const f = [...e.target.files];
              e.target.value = '';
              doIngestFiles(f);
            }}
          />
        </div>
        {ingestMsg && (
          <div className="row" style={{ marginTop: 12, color: 'var(--muted)', fontSize: 13 }}>
            {ingestMsg.spin && <span className="pulse" />} {ingestMsg.text}
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
            <h2>Processing queue</h2>
            {(() => {
              let cls = 'pend';
              let text = 'idle';
              if (running && !paused) {
                cls = 'run';
                text = 'running in background';
              } else if (paused) {
                cls = queueJob.autoPausedReason ? 'err' : 'pend';
                text = queueJob.autoPausedReason ? '⚠️ auto-paused (AI unreachable)' : 'paused';
              } else if (total > 0 && pend.length === 0 && errs.length === 0) {
                cls = 'ok';
                text = '✓ completed';
              }
              return (
                <span className={'badge ' + cls}>
                  <span className="dot" /> {text}
                </span>
              );
            })()}
          </div>
          <div className="desc">
            Jobs persist in this browser and continue running when you switch tabs — if you refresh
            or close the page, active jobs automatically resume when you return.
          </div>

          {paused && queueJob.autoPausedReason && (
            <div
              style={{
                margin: '14px 0',
                padding: '14px 18px',
                borderRadius: 10,
                background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.16) 0%, rgba(245, 158, 11, 0.16) 100%)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 14,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fca5a5' }}>
                  Queue Auto-Paused · AI API Unreachable
                </div>
                <div style={{ fontSize: 12.5, color: '#fecaca', marginTop: 2, fontFamily: 'monospace' }}>
                  {queueJob.autoPausedReason}
                </div>
                <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 3 }}>
                  Active queue item was reverted to pending. Fix AI Base URL or API key in Settings, then resume.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn sm"
                  onClick={openSettings}
                  style={{ borderColor: 'rgba(245, 158, 11, 0.5)', color: '#fbbf24' }}
                >
                  <Ic.gear className="ic" /> AI Settings
                </button>
                <button
                  type="button"
                  className="btn primary sm"
                  onClick={startRun}
                  style={{ background: 'linear-gradient(135deg, #10b981, #059669)', borderColor: '#059669' }}
                >
                  <Ic.play className="ic" /> Resume Queue
                </button>
              </div>
            </div>
          )}

          <div className="stats">
            <div className="stat total">
              <div className="lbl">Total</div>
              <div className="val">{total}</div>
              <div className="sub">{folders.length ? folders.length + ' folders' : '—'}</div>
            </div>
            <div className="stat ok">
              <div className="lbl">Completed</div>
              <div className="val">{done.length}</div>
              <div className="sub">
                {done.reduce((a, q) => a + (q.itemsCount || 0), 0).toLocaleString()} item rows
              </div>
            </div>
            <div className="stat pend">
              <div className="lbl">Pending</div>
              <div className="val">{pend.length}</div>
              <div className="sub">
                {running && pend.length && etaMs ? fmtEta(etaMs * pend.length) : '—'}
              </div>
            </div>
            <div className="stat err">
              <div className="lbl">Failed</div>
              <div className="val">{errs.length}</div>
              <div className="sub">retry anytime</div>
            </div>
          </div>

          <div className={'prog' + (running ? ' run' : '')}>
            <i style={{ width: pct + '%' }} />
            <div className="pct">{pct}%</div>
          </div>

          <div className="row" style={{ margin: '14px 0 16px' }}>
            {!running ? (
              <button
                className="btn primary"
                onClick={startRun}
                disabled={!pend.length && !errs.length}
              >
                <Ic.play className="ic" />{' '}
                {paused
                  ? queueJob.autoPausedReason
                    ? 'Resume Queue (AI Fixed)'
                    : 'Continue'
                  : 'Start'}
              </button>
            ) : (
              <React.Fragment>
                {!paused && (
                  <button className="btn warn" onClick={pause}>
                    <Ic.pause className="ic" /> Pause
                  </button>
                )}
                <button className="btn" onClick={cancel}>
                  <Ic.stop className="ic" /> Cancel run
                </button>
              </React.Fragment>
            )}
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                background: '#f8fafc',
                border: '1px solid var(--line, #e2e8f0)',
                borderRadius: 10,
                padding: '2px 8px 2px 12px',
                fontSize: 12.5,
                fontWeight: 600,
              }}
            >
              <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>Per batch:</span>
              <div style={{ minWidth: 145 }}>
                <Select
                  styles={coolSelectStyles}
                  isSearchable={false}
                  options={CHUNK_OPTIONS}
                  value={CHUNK_OPTIONS.find((o) => o.value === chunk) || CHUNK_OPTIONS[1]}
                  onChange={(opt) => saveChunk(opt ? opt.value : '50')}
                  menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
                />
              </div>
              {chunk === 'custom' && (
                <input
                  type="number"
                  min="1"
                  value={chunkCustom}
                  onChange={(e) => {
                    setLocalQueueChunkConfig(undefined, e.target.value);
                  }}
                  style={{
                    width: 70,
                    height: 38,
                    borderRadius: 10,
                    border: '1px solid var(--line, #cbd5e1)',
                    padding: '0 8px',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                />
              )}
            </div>
            <span className="spacer" />
            {!running && errs.length > 0 && (
              <button className="btn" onClick={retryFailed}>
                <Ic.retry className="ic" /> Retry failed
              </button>
            )}
            {done.length > 0 && (
              <button className="btn sm" onClick={clearDone}>
                Clear completed
              </button>
            )}
            <button className="btn sm danger" onClick={clearAll}>
              <Ic.trash className="ic" /> Clear queue
            </button>
            {done.length > 0 && (
              <button className="btn primary" onClick={exportXls}>
                <Ic.export className="ic" /> Export Combined Excel
              </button>
            )}
          </div>

          {!apiOk && (
            <div className="note" style={{ marginBottom: 12 }}>
              No AI API configured — open <b>Settings</b> before starting the queue.
            </div>
          )}

          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 76 }}>Folder</th>
                  <th>File</th>
                  <th style={{ width: 82 }}>Scan ID</th>
                  <th style={{ width: 104 }}>Doc No.</th>
                  <th style={{ width: 96 }}>Status</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {items.map((q) => (
                  <tr
                    key={q.id}
                    className={q.status === 'done' && q.recordId ? 'clickable' : ''}
                    onClick={() => q.status === 'done' && q.recordId && openDetail(q.recordId)}
                  >
                    <td className="mono">{q.folder || '—'}</td>
                    <td className="mono" title={q.path || q.name}>
                      {q.name}
                    </td>
                    <td className="mono">{q.scanId || '—'}</td>
                    <td className="mono">{q.docNo || ''}</td>
                    <td>
                      {q.status === 'pending' && (
                        <span className="badge pend">
                          <span className="dot" /> pending
                        </span>
                      )}
                      {q.status === 'running' && <span className="pulse" />}
                      {q.status === 'done' && (
                        <span className="badge ok">
                          <span className="dot" /> done
                        </span>
                      )}
                      {q.status === 'error' && (
                        <span className="badge err">
                          <span className="dot" /> error
                        </span>
                      )}
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: 12 }}>
                      {q.status === 'done' ? (q.itemsCount || 0) + ' items' : q.error || ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </React.Fragment>
  );
}
