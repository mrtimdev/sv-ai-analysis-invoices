import React, { useState, useEffect, useMemo } from 'react';
import Select from 'react-select';
import CreatableSelect from 'react-select/creatable';
import { getSettings, saveSettings } from '../lib/db.js';
import { getScanApiConfig, fetchScansPage } from '../lib/scanApi.js';
import { saveServerViewConfig } from '../lib/jobManager.js';
import { fetchAIModels } from '../lib/ai.js';
import { coolSelectStyles } from './coolSelectTheme.js';

const UPDATE_MODE_OPTIONS = [
  { value: 'single', label: 'Single Update (POST /v1/{scanId}/scan per scan)' },
  { value: 'batch', label: 'Batch Update (POST /v1/list/scans per page)' },
  { value: 'both', label: 'Both (Single immediately + Batch page confirm)' },
];

const PAGE_SIZE_OPTIONS = [
  { value: '25', label: '25 scans / page' },
  { value: '50', label: '50 scans / page' },
  { value: '100', label: '100 scans / page' },
  { value: '250', label: '250 scans / page' },
  { value: '500', label: '500 scans / page' },
  { value: '1000', label: '1000 scans / page' },
  { value: 'all', label: 'All scans (unpaged)' },
];

export default function SettingsModal({ open, onClose, onSaved }) {
  const s = getSettings();
  const v1Defaults = getScanApiConfig();

  // AI Vision API settings
  const [base, setBase] = useState(s.base || '');
  const [key, setKey] = useState(s.key || '');
  const [model, setModel] = useState(s.model || '');
  const [scanBase, setScanBase] = useState(s.scanBase || '');
  const [auto, setAuto] = useState(s.autoResume !== undefined ? !!s.autoResume : true);

  // Separate /v1 Scan Backend API settings
  const [apiServerBase, setApiServerBase] = useState(s.apiServerBase || v1Defaults.apiServerBase || 'http://45.201.196.19:3002');
  const [v1ListScansPath, setV1ListScansPath] = useState(s.v1ListScansPath || '/v1/list/scans');
  const [v1SingleScanPath, setV1SingleScanPath] = useState(s.v1SingleScanPath || '/v1/{scanId}/scan');
  const [v1ExportScansPath, setV1ExportScansPath] = useState(s.v1ExportScansPath || '/v1/list/scans/export');
  const [v1UpdateMode, setV1UpdateMode] = useState(s.v1UpdateMode || 'single');
  const [v1PageSize, setV1PageSize] = useState(s.v1PageSize || '50');
  const [v1AutoNextPage, setV1AutoNextPage] = useState(s.v1AutoNextPage !== undefined ? !!s.v1AutoNextPage : true);
  const [v1SkipApproved, setV1SkipApproved] = useState(!!s.v1SkipApproved);

  const [testingV1, setTestingV1] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // Model loading state
  const [availableModels, setAvailableModels] = useState([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelStatus, setModelStatus] = useState(null);

  const modelOptions = useMemo(() => {
    const list = availableModels.map((m) => ({ value: m, label: m }));
    if (model && !availableModels.includes(model)) {
      return [{ value: model, label: `${model} (custom)` }, ...list];
    }
    return list;
  }, [availableModels, model]);

  useEffect(() => {
    if (open) {
      const cur = getSettings();
      const cfg = getScanApiConfig();
      setBase(cur.base || '');
      setKey(cur.key || '');
      setModel(cur.model || '');
      setScanBase(cur.scanBase || '');
      setAuto(cur.autoResume !== undefined ? !!cur.autoResume : true);
      setApiServerBase(cur.apiServerBase || cfg.apiServerBase || 'http://45.201.196.19:3002');
      setV1ListScansPath(cur.v1ListScansPath || '/v1/list/scans');
      setV1SingleScanPath(cur.v1SingleScanPath || '/v1/{scanId}/scan');
      setV1ExportScansPath(cur.v1ExportScansPath || '/v1/list/scans/export');
      setV1UpdateMode(cur.v1UpdateMode || 'single');
      setV1PageSize(cur.v1PageSize || '50');
      setV1AutoNextPage(cur.v1AutoNextPage !== undefined ? !!cur.v1AutoNextPage : true);
      setV1SkipApproved(!!cur.v1SkipApproved);
      setTestResult(null);
      setModelStatus(null);
    }
  }, [open]);

  if (!open) return null;

  const handleLoadModels = async () => {
    if (!base.trim()) {
      setModelStatus({ ok: false, msg: 'Enter AI API Base URL first' });
      return;
    }
    setLoadingModels(true);
    setModelStatus(null);
    try {
      const list = await fetchAIModels({ base: base.trim(), key: key.trim() });
      setAvailableModels(list);
      setModelStatus({
        ok: true,
        msg: `Loaded ${list.length} model(s) from API ✓`,
      });
      if (!model.trim() && list.length > 0) {
        const preferred =
          list.find((m) => /vision|flash|4o|gemini|vl|qwen/i.test(m)) || list[0];
        setModel(preferred);
      }
    } catch (err) {
      setModelStatus({
        ok: false,
        msg: err.message || 'Failed to load models',
      });
    } finally {
      setLoadingModels(false);
    }
  };

  const testV1Connection = async () => {
    setTestingV1(true);
    setTestResult(null);
    try {
      const res = await fetchScansPage({
        page: 0,
        size: '1',
        configOverrides: {
          apiServerBase: apiServerBase.trim(),
          v1ListScansPath: v1ListScansPath.trim(),
          v1SingleScanPath: v1SingleScanPath.trim(),
        },
      });
      setTestResult({
        ok: true,
        msg: `Connected ✓ — ${res.totalElements.toLocaleString()} total scan(s) available (${res.totalPages.toLocaleString()} pages)`,
      });
    } catch (err) {
      setTestResult({
        ok: false,
        msg: err.message || 'Connection failed',
      });
    } finally {
      setTestingV1(false);
    }
  };

  const save = () => {
    saveSettings({
      base: base.trim(),
      key: key.trim(),
      model: model.trim(),
      scanBase: scanBase.trim(),
      autoResume: auto,
      apiServerBase: apiServerBase.trim() || 'http://45.201.196.19:3002',
      v1ListScansPath: v1ListScansPath.trim() || '/v1/list/scans',
      v1SingleScanPath: v1SingleScanPath.trim() || '/v1/{scanId}/scan',
      v1ExportScansPath: v1ExportScansPath.trim() || '/v1/list/scans/export',
      v1UpdateMode,
      v1PageSize,
      v1AutoNextPage,
      v1SkipApproved,
    });
    saveServerViewConfig({
      skipApproved: v1SkipApproved,
      autoNextPage: v1AutoNextPage,
    });
    onSaved();
    onClose();
  };

  return (
    <div className="mback" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="mhead">
          <h3>Settings</h3>
          <button className="x" onClick={onClose}>&times;</button>
        </div>
        <div className="mbody">
          {/* 1. AI Vision API Section */}
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <h2 style={{ fontSize: 13.5, margin: 0 }}>1. AI Vision API (Image Extraction)</h2>
            <button
              type="button"
              className="btn sm"
              onClick={handleLoadModels}
              disabled={loadingModels || !base.trim()}
              title="Query GET /models from the entered AI API Base URL"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            >
              {loadingModels ? <span className="pulse" /> : '⚡'}
              {loadingModels ? 'Loading Models…' : 'Load Models'}
            </button>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 12 }}>
            Uses an OpenAI-compatible vision API (OpenAI, OmniRoute, OpenRouter, DashScope, Ollama, etc.) with the KHB extraction protocol in <code>src/lib/ai.js</code>.
          </p>

          {modelStatus && (
            <div
              className="note"
              style={{
                marginBottom: 12,
                padding: '8px 12px',
                fontSize: 12,
                background: modelStatus.ok ? '#ecfdf5' : '#fef2f2',
                borderColor: modelStatus.ok ? '#a7f3d0' : '#fecaca',
                color: modelStatus.ok ? '#065f46' : '#991b1b',
              }}
            >
              {modelStatus.msg}
            </div>
          )}

          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label className="f" style={{ gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <span>AI API Base URL</span>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn xs"
                    style={{ fontSize: 11, padding: '2px 7px' }}
                    onClick={() => setBase('https://interpretation-let-performed-healing.trycloudflare.com/v1')}
                    title="Active Cloudflare Tunnel for local OmniRoute"
                  >
                    Cloudflare Tunnel
                  </button>
                  <button
                    type="button"
                    className="btn xs"
                    style={{ fontSize: 11, padding: '2px 7px' }}
                    onClick={() => setBase('http://127.0.0.1:20128/v1')}
                    title="Direct local OmniRoute"
                  >
                    Local 127.0.0.1:20128
                  </button>
                  <button
                    type="button"
                    className="btn xs"
                    style={{ fontSize: 11, padding: '2px 7px' }}
                    onClick={() => setBase('http://localhost:11434/v1')}
                    title="Direct local Ollama"
                  >
                    Local Ollama (11434)
                  </button>
                </div>
              </div>
              <input
                value={base}
                onChange={(e) => setBase(e.target.value)}
                placeholder="https://...trycloudflare.com/v1 or http://127.0.0.1:20128/v1"
              />
              {/* Dynamic Local Network Access Notice */}
              {typeof window !== 'undefined' &&
                /\.vercel\.app$/i.test(window.location.hostname) &&
                /:\/\/(localhost|127\.0\.0\.1)/i.test(base) && (
                  <div
                    style={{
                      marginTop: 6,
                      padding: '8px 11px',
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: 8,
                      fontSize: 11.5,
                      color: '#92400e',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 3 }}>
                      🔒 Local Network Access Notice:
                    </div>
                    <div>
                      Connecting from a cloud app (<code>vercel.app</code>) to local AI on your computer requires Chrome site permissions:
                    </div>
                    <ul style={{ margin: '4px 0 6px 18px', padding: 0, lineHeight: 1.5 }}>
                      <li>Click the <b>Tune/Settings icon</b> on the left of the URL bar &rarr; <b>Site settings</b></li>
                      <li>Set <b>Local network access</b> to <b>Allow</b></li>
                      <li>Set <b>Insecure content</b> to <b>Allow</b></li>
                      <li><i>Or recommended:</i> Click button below to use Cloudflare Tunnel (no browser permissions required!).</li>
                    </ul>
                    <button
                      type="button"
                      className="btn xs"
                      style={{ fontSize: 11, padding: '3px 9px', fontWeight: 600 }}
                      onClick={() => setBase('https://interpretation-let-performed-healing.trycloudflare.com/v1')}
                    >
                      Use Active Cloudflare Tunnel (https://interpretation-let-performed-healing.trycloudflare.com/v1)
                    </button>
                  </div>
                )}
              {typeof window !== 'undefined' && /trycloudflare\.com/i.test(base) && (
                <div
                  style={{
                    marginTop: 6,
                    padding: '5px 9px',
                    background: '#ecfdf5',
                    border: '1px solid #a7f3d0',
                    borderRadius: 8,
                    fontSize: 11.5,
                    color: '#065f46',
                  }}
                >
                  ☁️ <strong>Cloudflare HTTPS Tunnel:</strong> Encrypted HTTPS connection to local AI — completely bypasses browser mixed-content and local network restrictions.
                </div>
              )}
            </label>
            <label className="f">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <span>AI API Key</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>(Optional for OmniRoute / Ollama)</span>
              </div>
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sk-… (Leave blank for default OmniRoute key)"
              />
            </label>
            <label className="f">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span>Vision Model</span>
                {availableModels.length > 0 && (
                  <span style={{ fontSize: 11, color: '#059669', fontWeight: 600 }}>
                    {availableModels.length} models loaded
                  </span>
                )}
              </div>
              <CreatableSelect
                isClearable
                isSearchable
                menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
                styles={coolSelectStyles}
                placeholder={
                  availableModels.length > 0
                    ? `Search ${availableModels.length} models or type custom…`
                    : 'Select or type vision model…'
                }
                noOptionsMessage={() =>
                  availableModels.length === 0
                    ? 'Click "Load Models" above or type a custom model'
                    : 'No matching models'
                }
                formatCreateLabel={(val) => `Use custom model: "${val}"`}
                value={model ? { value: model, label: model } : null}
                onChange={(opt) => setModel(opt ? opt.value : '')}
                options={modelOptions}
              />
            </label>
          </div>

          {/* Quick presets for common vision models */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>Presets:</span>
            {['gpt-4o-mini', 'gpt-4o', 'gemini-2.0-flash', 'antigravity/gemini-3.8-flash-low', 'qwen-vl-max'].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setModel(p)}
                className="btn sm"
                style={{
                  padding: '1px 8px',
                  fontSize: 11,
                  borderRadius: 999,
                  border: model === p ? '1px solid var(--accent)' : '1px solid var(--line)',
                  background: model === p ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                  color: model === p ? 'var(--accent)' : 'var(--muted)',
                }}
              >
                {p}
              </button>
            ))}
          </div>

          <div style={{ height: 1, background: 'var(--line)', margin: '18px 0 14px' }} />

          {/* 2. Separate /v1 Scan Backend API Section */}
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <h2 style={{ fontSize: 13.5 }}>2. Scan Backend API (Unauthenticated <code>/v1</code> Endpoints)</h2>
            <button type="button" className="btn sm" onClick={testV1Connection} disabled={testingV1}>
              {testingV1 ? <span className="pulse" /> : '⚡'} {testingV1 ? 'Testing…' : 'Test /v1 API'}
            </button>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 12 }}>
            Separate endpoint configuration for fetching scans (<code>GET /v1/list/scans</code>), reading <code>imageUrl</code>, and posting analyzed headers + items with <code>reviewStatus = APPROVED</code>.
          </p>

          {testResult && (
            <div
              className="note"
              style={{
                marginBottom: 12,
                background: testResult.ok ? '#ecfdf5' : '#fef2f2',
                borderColor: testResult.ok ? '#a7f3d0' : '#fecaca',
                color: testResult.ok ? '#065f46' : '#991b1b',
              }}
            >
              {testResult.msg}
            </div>
          )}

          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label className="f" style={{ gridColumn: '1 / -1' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <span>Backend Server Base URL</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn xs"
                    style={{ fontSize: 11, padding: '2px 7px' }}
                    onClick={() => setApiServerBase('http://45.201.196.19:3002')}
                    title="Switch to live production server"
                  >
                    45.201.196.19:3002 (Production)
                  </button>
                  <button
                    type="button"
                    className="btn xs"
                    style={{ fontSize: 11, padding: '2px 7px' }}
                    onClick={() => setApiServerBase('http://localhost:8083')}
                    title="Switch to local dev server (port 8083)"
                  >
                    localhost:8083
                  </button>
                  <button
                    type="button"
                    className="btn xs"
                    style={{ fontSize: 11, padding: '2px 7px' }}
                    onClick={() => setApiServerBase('http://localhost:8080')}
                    title="Switch to local dev server (port 8080)"
                  >
                    localhost:8080
                  </button>
                </div>
              </div>
              <input
                value={apiServerBase}
                onChange={(e) => setApiServerBase(e.target.value)}
                placeholder="http://45.201.196.19:3002 or http://localhost:8083"
              />
              {/* Dynamic Mixed Content / Cloud Notice */}
              {typeof window !== 'undefined' &&
                window.location.protocol === 'https:' &&
                /^http:\/\//i.test(apiServerBase) &&
                !/:\/\/(localhost|127\.0\.0\.1)/i.test(apiServerBase) && (
                  <div
                    style={{
                      marginTop: 6,
                      padding: '5px 9px',
                      background: '#ecfdf5',
                      border: '1px solid #a7f3d0',
                      borderRadius: 8,
                      fontSize: 11.5,
                      color: '#065f46',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>🛡️</span>
                    <span>
                      <strong>HTTPS Mixed-Content Proxy Active:</strong> Since this app runs on HTTPS, requests to{' '}
                      <code>{apiServerBase}</code> are automatically relayed through the built-in Vercel proxy to bypass browser security blocks.
                    </span>
                  </div>
                )}
              {typeof window !== 'undefined' &&
                /\.vercel\.app$/i.test(window.location.hostname) &&
                /:\/\/(localhost|127\.0\.0\.1)/i.test(apiServerBase) && (
                  <div
                    style={{
                      marginTop: 6,
                      padding: '5px 9px',
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: 8,
                      fontSize: 11.5,
                      color: '#92400e',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 6,
                    }}
                  >
                    <span>
                      ⚠️ <strong>Notice:</strong> &quot;localhost&quot; is only reachable on your local machine. In Vercel cloud deployments, switch to Production Server.
                    </span>
                    <button
                      type="button"
                      className="btn xs"
                      style={{ whiteSpace: 'nowrap', padding: '2px 8px', fontSize: 11 }}
                      onClick={() => setApiServerBase('http://45.201.196.19:3002')}
                    >
                      Use Production
                    </button>
                  </div>
                )}
            </label>
            <label className="f">
              List &amp; Batch Endpoint (GET / POST)
              <input
                value={v1ListScansPath}
                onChange={(e) => setV1ListScansPath(e.target.value)}
                placeholder="/v1/list/scans"
              />
            </label>
            <label className="f">
              Single Scan Endpoint (GET / POST)
              <input
                value={v1SingleScanPath}
                onChange={(e) => setV1SingleScanPath(e.target.value)}
                placeholder="/v1/{scanId}/scan or /v1/scanId/scan"
              />
            </label>
            <label className="f" style={{ gridColumn: '1 / -1' }}>
              Excel Export Endpoint (GET / POST)
              <input
                value={v1ExportScansPath}
                onChange={(e) => setV1ExportScansPath(e.target.value)}
                placeholder="/v1/list/scans/export or /v1/export/scans"
              />
            </label>
            <label className="f">
              Post-Analyze Update Mode
              <Select
                isSearchable={false}
                menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
                styles={coolSelectStyles}
                value={UPDATE_MODE_OPTIONS.find((opt) => opt.value === v1UpdateMode)}
                onChange={(opt) => setV1UpdateMode(opt ? opt.value : 'single')}
                options={UPDATE_MODE_OPTIONS}
              />
            </label>
            <label className="f">
              Default Page Size
              <Select
                isSearchable={false}
                menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
                styles={coolSelectStyles}
                value={PAGE_SIZE_OPTIONS.find((opt) => opt.value === v1PageSize)}
                onChange={(opt) => setV1PageSize(opt ? opt.value : '50')}
                options={PAGE_SIZE_OPTIONS}
              />
            </label>
            <label className="f" style={{ gridColumn: '1 / -1' }}>
              Excel Hyperlink Scan Base URL (optional)
              <input
                value={scanBase}
                onChange={(e) => setScanBase(e.target.value)}
                placeholder="http://45.201.196.19:3002/admin/scans"
              />
            </label>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                className="checkbox"
                checked={v1AutoNextPage}
                onChange={(e) => setV1AutoNextPage(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                <b>Auto-switch to next page</b> — once all scans on the current page are analyzed and updated to the backend, automatically load and analyze the next page.
              </span>
            </label>

            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                className="checkbox"
                checked={v1SkipApproved}
                onChange={(e) => setV1SkipApproved(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                <b>Skip already APPROVED scans</b> on a page when running batch page analysis.
              </span>
            </label>

            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                className="checkbox"
                checked={auto}
                onChange={(e) => setAuto(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                <b>Auto-resume active jobs</b> on page refresh or re-open if Server Scans or Batch Queue was running when you left.
              </span>
            </label>
          </div>

          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={save}>Save settings</button>
          </div>
        </div>
      </div>
    </div>
  );
}
