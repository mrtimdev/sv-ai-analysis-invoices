import React, { useState, useEffect } from 'react';
import { getSettings, saveSettings } from '../lib/db.js';
import { getScanApiConfig, fetchScansPage } from '../lib/scanApi.js';

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
  const [apiServerBase, setApiServerBase] = useState(s.apiServerBase || v1Defaults.apiServerBase || 'http://localhost:8080');
  const [v1ListScansPath, setV1ListScansPath] = useState(s.v1ListScansPath || '/v1/list/scans');
  const [v1SingleScanPath, setV1SingleScanPath] = useState(s.v1SingleScanPath || '/v1/{scanId}/scan');
  const [v1ExportScansPath, setV1ExportScansPath] = useState(s.v1ExportScansPath || '/v1/list/scans/export');
  const [v1UpdateMode, setV1UpdateMode] = useState(s.v1UpdateMode || 'single');
  const [v1PageSize, setV1PageSize] = useState(s.v1PageSize || '50');
  const [v1AutoNextPage, setV1AutoNextPage] = useState(s.v1AutoNextPage !== undefined ? !!s.v1AutoNextPage : true);
  const [v1SkipApproved, setV1SkipApproved] = useState(!!s.v1SkipApproved);

  const [testingV1, setTestingV1] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    if (open) {
      const cur = getSettings();
      const cfg = getScanApiConfig();
      setBase(cur.base || '');
      setKey(cur.key || '');
      setModel(cur.model || '');
      setScanBase(cur.scanBase || '');
      setAuto(cur.autoResume !== undefined ? !!cur.autoResume : true);
      setApiServerBase(cur.apiServerBase || cfg.apiServerBase || 'http://localhost:8080');
      setV1ListScansPath(cur.v1ListScansPath || '/v1/list/scans');
      setV1SingleScanPath(cur.v1SingleScanPath || '/v1/{scanId}/scan');
      setV1ExportScansPath(cur.v1ExportScansPath || '/v1/list/scans/export');
      setV1UpdateMode(cur.v1UpdateMode || 'single');
      setV1PageSize(cur.v1PageSize || '50');
      setV1AutoNextPage(cur.v1AutoNextPage !== undefined ? !!cur.v1AutoNextPage : true);
      setV1SkipApproved(!!cur.v1SkipApproved);
      setTestResult(null);
    }
  }, [open]);

  if (!open) return null;

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
      apiServerBase: apiServerBase.trim() || 'http://localhost:8080',
      v1ListScansPath: v1ListScansPath.trim() || '/v1/list/scans',
      v1SingleScanPath: v1SingleScanPath.trim() || '/v1/{scanId}/scan',
      v1ExportScansPath: v1ExportScansPath.trim() || '/v1/list/scans/export',
      v1UpdateMode,
      v1PageSize,
      v1AutoNextPage,
      v1SkipApproved,
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
          <h2 style={{ fontSize: 13.5, marginBottom: 6 }}>1. AI Vision API (Image Extraction)</h2>
          <p style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 12 }}>
            Uses an OpenAI-compatible vision API (OpenAI, OmniRoute, OpenRouter, DashScope, etc.) with the KHB extraction protocol in <code>src/lib/ai.js</code>.
          </p>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <label className="f" style={{ gridColumn: '1 / -1' }}>
              AI API Base URL
              <input value={base} onChange={(e) => setBase(e.target.value)} placeholder="http://127.0.0.1:20128/v1 or https://api.openai.com/v1" />
            </label>
            <label className="f">
              AI API Key
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" />
            </label>
            <label className="f">
              Vision Model
              <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="antigravity/gemini-3.8-flash-low" />
            </label>
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
              Backend Server Base URL
              <input
                value={apiServerBase}
                onChange={(e) => setApiServerBase(e.target.value)}
                placeholder="http://localhost:8080 or http://45.201.196.19:3002"
              />
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
              <select value={v1UpdateMode} onChange={(e) => setV1UpdateMode(e.target.value)}>
                <option value="single">Single Update (POST /v1/&#123;scanId&#125;/scan per scan)</option>
                <option value="batch">Batch Update (POST /v1/list/scans per page)</option>
                <option value="both">Both (Single immediately + Batch page confirm)</option>
              </select>
            </label>
            <label className="f">
              Default Page Size
              <select value={v1PageSize} onChange={(e) => setV1PageSize(e.target.value)}>
                <option value="25">25 scans / page</option>
                <option value="50">50 scans / page</option>
                <option value="100">100 scans / page</option>
                <option value="250">250 scans / page</option>
                <option value="500">500 scans / page</option>
                <option value="1000">1000 scans / page</option>
                <option value="all">All scans (unpaged)</option>
              </select>
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
                <b>Auto-resume active jobs</b> on page refresh or re-open if Server Scans (/v1) or Batch Queue was running when you left.
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
