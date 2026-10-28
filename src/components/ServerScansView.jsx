import React, { useState, useEffect, useCallback } from 'react';
import { getSettings } from '../lib/db.js';
import {
  getScanApiConfig,
  fetchScansPage,
  fetchScanById,
  analyzeOneServerScan,
  batchUpdateScansV1,
} from '../lib/scanApi.js';
import {
  getJobManagerSnapshot,
  subscribeJobManager,
  startServerScanJob,
  pauseServerScanJob,
  stopServerScanJob,
  saveServerViewConfig,
  clearServerJobHistory,
} from '../lib/jobManager.js';
import { fmtEta } from '../lib/util.js';
import { Ic } from './icons.jsx';

function buildPageNumbers(currentZeroBased, totalPages) {
  const cur = currentZeroBased + 1;
  const max = Math.max(1, totalPages);
  const want = new Set([1, 2, max - 1, max, cur - 1, cur, cur + 1]);
  const sorted = [...want].filter((p) => p >= 1 && p <= max).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
}

export default function ServerScansView({ toast, openSettings, onRecordsChanged, openServerDetail }) {
  const initCfg = getScanApiConfig();
  const initialSnap = getJobManagerSnapshot().serverJob;

  const [page, setPage] = useState(initialSnap.page || 0);
  const [size, setSize] = useState(initialSnap.size || initCfg.v1PageSize || '50');
  const [sort, setSort] = useState(initialSnap.sort || 'createdAt,desc');
  const [updateMode, setUpdateMode] = useState(initialSnap.updateMode || initCfg.v1UpdateMode || 'single');
  const [autoNextPage, setAutoNextPage] = useState(
    initialSnap.autoNextPage !== undefined ? initialSnap.autoNextPage : initCfg.v1AutoNextPage
  );
  const [skipApproved, setSkipApproved] = useState(
    initialSnap.skipApproved !== undefined ? initialSnap.skipApproved : initCfg.v1SkipApproved
  );

  // Filters matching /admin/scans and GET /v1/list/scans
  const [filters, setFilters] = useState(
    initialSnap.filters || {
      keyword: '',
      id: '',
      status: '',
      reviewStatus: '',
      dealerCode: '',
      vehicleCode: '',
      invoiceNo: '',
      invoiceDateFrom: '',
      invoiceDateTo: '',
      createdFrom: '',
      createdTo: '',
    }
  );
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'grid'
  const [inspectedScan, setInspectedScan] = useState(null);
  const [loadingInspector, setLoadingInspector] = useState(false);

  const [pageData, setPageData] = useState(
    initialSnap.lastPageData || {
      content: [],
      number: 0,
      size: 50,
      totalPages: 1,
      totalElements: 0,
      first: true,
      last: true,
    }
  );
  const [loadingPage, setLoadingPage] = useState(false);
  const [pageError, setPageError] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Subscribe to the persistent background job manager so state stays live across tab switches & page refreshes
  const [jobSnap, setJobSnap] = useState(initialSnap);

  useEffect(() => {
    return subscribeJobManager((snap) => {
      setJobSnap(snap.serverJob);
      if (snap.serverJob.lastPageData) {
        setPageData(snap.serverJob.lastPageData);
        setPage(snap.serverJob.page || 0);
      }
    });
  }, []);

  const running = jobSnap.running;
  const paused = jobSnap.paused;
  const runStats = jobSnap.stats || {
    analyzed: 0,
    updated: 0,
    failed: 0,
    pagesProcessed: 0,
    currentScanIndex: 0,
    totalOnPage: 0,
    bannerMsg: '',
  };
  const scanStatuses = jobSnap.scanStatuses || {};
  const etaMs = jobSnap.etaMs;
  const activeScan = jobSnap.activeScan;
  const activityFeed = jobSnap.activityFeed || [];

  const loadPage = useCallback(
    async (targetPage = page, targetSize = size, targetSort = sort, targetFilters = filters) => {
      setLoadingPage(true);
      setPageError(null);
      try {
        const res = await fetchScansPage({
          page: targetPage,
          size: targetSize,
          sort: targetSort,
          filters: targetFilters,
        });
        setPageData(res);
        setPage(res.number);
        saveServerViewConfig({
          page: res.number,
          size: targetSize,
          sort: targetSort,
          filters: targetFilters,
        });
        return res;
      } catch (err) {
        setPageError(err.message || 'Could not load scans from /v1/list/scans');
        return null;
      } finally {
        setLoadingPage(false);
      }
    },
    [page, size, sort, filters]
  );

  useEffect(() => {
    // Load current page from server on mount (using restored page & filters)
    loadPage(page, size, sort, filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFilterField = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const applyQuickPreset = (presetFilters) => {
    const next = {
      ...filters,
      ...presetFilters,
    };
    setFilters(next);
    setSelectedIds(new Set());
    loadPage(0, size, sort, next);
  };

  const applyFilters = (e) => {
    if (e) e.preventDefault();
    setSelectedIds(new Set());
    loadPage(0, size, sort, filters);
  };

  const clearFilters = () => {
    const cleared = {
      keyword: '',
      id: '',
      status: '',
      reviewStatus: '',
      dealerCode: '',
      vehicleCode: '',
      invoiceNo: '',
      invoiceDateFrom: '',
      invoiceDateTo: '',
      createdFrom: '',
      createdTo: '',
    };
    setFilters(cleared);
    setSelectedIds(new Set());
    loadPage(0, size, sort, cleared);
  };

  const goToPage = (nextPageZeroBased) => {
    const clamped = Math.max(0, Math.min(nextPageZeroBased, Math.max(0, pageData.totalPages - 1)));
    setSelectedIds(new Set());
    loadPage(clamped, size, sort, filters);
  };

  const toggleSelectAll = (checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      pageData.content.forEach((s) => {
        if (checked) next.add(s.id);
        else next.delete(s.id);
      });
      return next;
    });
  };

  const toggleSelectRow = (id, checked) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const openQuickInspector = async (scan, openFullModal = false) => {
    setInspectedScan(scan);
    setLoadingInspector(true);
    try {
      const detail = await fetchScanById(scan.id);
      setInspectedScan(detail);
      if (openFullModal && openServerDetail) {
        openServerDetail(formatScanForDetailModal(detail));
      }
    } catch (err) {
      toast('Could not load scan #' + scan.id + ': ' + err.message, true);
    } finally {
      setLoadingInspector(false);
    }
  };

  const formatScanForDetailModal = (detail) => ({
    id: `scan-${detail.id}`,
    scanId: detail.id,
    no: detail.invoiceNo || detail.headers?.no,
    invoiceDate: detail.invoiceDate || detail.headers?.invoiceDate,
    documentType: detail.headers?.documentType || 'Server Scan',
    dealerCode: detail.dealerCode || detail.headers?.dealerCode,
    toWarehouseCode: detail.headers?.toWarehouseCode || detail.dealerCode,
    fromWarehouse: detail.headers?.fromWarehouse,
    saleOrder: detail.saleOrder || detail.headers?.saleOrder,
    vendorCode: detail.vendorCode || detail.headers?.vendorCode,
    vehicleCode: detail.vehicleCode || detail.headers?.vehicleCode,
    referenceNo: detail.headers?.referenceNo,
    warehouse: detail.warehouse || detail.headers?.warehouse,
    route: detail.route || detail.headers?.route,
    originalFile: detail.originalFilename,
    verificationNotes: detail.headers?.verificationNotes,
    image: detail.imageUrl,
    items: Array.isArray(detail.items) ? detail.items : [],
    reviewStatus: detail.reviewStatus,
  });

  const runSingleRowAnalyze = async (scan, e) => {
    if (e) e.stopPropagation();
    const s = getSettings();
    if (!s.key || !s.base) {
      openSettings();
      return;
    }
    saveServerViewConfig({
      scanStatuses: {
        ...scanStatuses,
        [scan.id]: { stage: 'analyzing', message: 'Fetching imageUrl & analyzing…' },
      },
    });
    const t0 = performance.now();
    try {
      const result = await analyzeOneServerScan(scan, {
        postImmediately: true,
        saveToLocalDb: true,
      });
      const ms = Math.round(performance.now() - t0);
      saveServerViewConfig({
        scanStatuses: {
          ...getJobManagerSnapshot().serverJob.scanStatuses,
          [scan.id]: {
            stage: 'updated',
            itemsCount: result.payload.items.length,
            invoiceNo: result.payload.invoiceNo,
            ms,
            message: `APPROVED · ${result.payload.items.length} items (${(ms / 1000).toFixed(1)}s)`,
          },
        },
      });
      const updatedRow = {
        ...scan,
        ...(result.updatedScan || result.payload),
        reviewStatus: 'APPROVED',
        status: 'COMPLETED',
      };
      setPageData((prev) => ({
        ...prev,
        content: prev.content.map((row) => (row.id === scan.id ? updatedRow : row)),
      }));
      if (inspectedScan && inspectedScan.id === scan.id) {
        setInspectedScan({
          ...inspectedScan,
          ...updatedRow,
          items: result.payload.items,
          headers: result.payload.headers,
        });
      }
      onRecordsChanged?.();
      toast(`Scan #${scan.id} analyzed & updated (APPROVED, ${result.payload.items.length} items)`);
    } catch (err) {
      saveServerViewConfig({
        scanStatuses: {
          ...getJobManagerSnapshot().serverJob.scanStatuses,
          [scan.id]: {
            stage: 'error',
            error: err.message,
            message: err.message,
          },
        },
      });
      toast(`Scan #${scan.id} failed: ${err.message}`, true);
    }
  };

  const handleStartBatch = async ({ selectedOnly = false, isResume = false } = {}) => {
    if (running) return;
    const targetIds = selectedOnly ? [...selectedIds] : null;
    if (selectedOnly && (!targetIds || !targetIds.length)) {
      toast('Select at least one scan first', true);
      return;
    }
    await startServerScanJob({
      page,
      size,
      sort,
      filters,
      updateMode,
      autoNextPage,
      skipApproved,
      onlyScanIds: targetIds,
      isResume,
      onToast: toast,
      onRecordsChanged,
      onNeedSettings: openSettings,
    });
  };

  const approveSelectedWithoutReanalyzing = async () => {
    const ids = [...selectedIds];
    if (!ids.length) {
      toast('Select at least one scan first', true);
      return;
    }
    try {
      const payloads = ids.map((id) => {
        const row = pageData.content.find((r) => r.id === id) || { id };
        return {
          id: row.id,
          scanId: row.id,
          invoiceNo: row.invoiceNo || null,
          invoiceDate: row.invoiceDate || null,
          dealerCode: row.dealerCode || null,
          saleOrder: row.saleOrder || null,
          vendorCode: row.vendorCode || null,
          vehicleCode: row.vehicleCode || null,
          warehouse: row.warehouse || null,
          route: row.route || null,
          reviewStatus: 'APPROVED',
        };
      });
      const res = await batchUpdateScansV1(payloads);
      toast(`Batch approved ${res.updatedCount || ids.length} scan(s) via POST /v1/list/scans`);
      await loadPage(page, size, sort, filters);
    } catch (err) {
      toast('Batch approve failed: ' + err.message, true);
    }
  };

  const cfg = getScanApiConfig();
  const s = getSettings();
  const aiReady = !!(s.key && s.base);
  const allOnPageSelected =
    pageData.content.length > 0 && pageData.content.every((r) => selectedIds.has(r.id));
  const approvedOnPage = pageData.content.filter(
    (r) => String(r.reviewStatus || '').toUpperCase() === 'APPROVED'
  ).length;
  const pendingOnPage = Math.max(0, pageData.content.length - approvedOnPage);
  const remainingOnPage = Math.max(0, runStats.totalOnPage - runStats.currentScanIndex);
  const pagePct =
    runStats.totalOnPage > 0
      ? Math.min(100, Math.round((runStats.currentScanIndex / runStats.totalOnPage) * 100))
      : pageData.content.length > 0
      ? Math.round((approvedOnPage / pageData.content.length) * 100)
      : 0;

  return (
    <React.Fragment>
      {/* 1. Creative Mission Control Hero Header */}
      <div className="v1-hero">
        <div className="v1-hero-top">
          <div className="v1-hero-title">
            <div className="v1-hero-icon">
              <Ic.spark />
            </div>
            <div>
              <h2>KHB Server Scans AI Mission Control</h2>
              <div className="v1-hero-sub">
                Autonomous pipeline · Fetches <code>imageUrl</code>, extracts KHB headers &amp; line items with Vision AI, and syncs <code>reviewStatus = APPROVED</code>
              </div>
            </div>
          </div>

          <div className="v1-hero-actions">
            <button type="button" className="v1-btn-dark" onClick={openSettings}>
              <Ic.settings className="ic" /> /v1 API Settings
            </button>
            <button
              type="button"
              className="v1-btn-dark"
              onClick={() => loadPage(page, size, sort, filters)}
              disabled={loadingPage}
            >
              <Ic.retry className="ic" /> {loadingPage ? 'Refreshing…' : 'Sync Page'}
            </button>
          </div>
        </div>

        <div className="v1-chip-row">
          <span className="v1-chip">
            <span className="live-dot" /> Server: <code>{cfg.apiServerBase}</code>
          </span>
          <span className="v1-chip">
            GET List: <code>{cfg.v1ListScansPath}</code>
          </span>
          <span className="v1-chip">
            POST Target:{' '}
            <code>{updateMode === 'batch' ? cfg.v1ListScansPath : cfg.v1SingleScanPath}</code>
          </span>
          <span className="v1-chip">
            <span className={aiReady ? 'live-dot' : 'warn-dot'} /> AI Model:{' '}
            <code>{s.model || 'gpt-4o-mini'}</code>
          </span>
          <span className="v1-chip">
            <Ic.bolt style={{ width: 13, height: 13, color: '#38bdf8' }} /> Persistent Background Runner:{' '}
            <b style={{ color: '#6ee7b7' }}>Active (Survives Refresh &amp; Tab Switch)</b>
          </span>
        </div>

        <div className="v1-pipeline">
          <div className={'v1-step' + (loadingPage ? ' active' : '')}>
            <div className="v1-step-num">1</div>
            <div className="v1-step-txt">
              <div className="t">GET /v1/list/scans</div>
              <div className="s">
                Page {pageData.number + 1}/{pageData.totalPages} · {pageData.totalElements.toLocaleString()} scans
              </div>
            </div>
          </div>
          <div className={'v1-step' + (running && activeScan?.stage === 'analyzing' ? ' active' : '')}>
            <div className="v1-step-num">2</div>
            <div className="v1-step-txt">
              <div className="t">Vision AI Analyze</div>
              <div className="s">Stream imageUrl → KHB JSON</div>
            </div>
          </div>
          <div
            className={
              'v1-step' +
              (running && (activeScan?.stage === 'updated' || activeScan?.stage === 'batch_posting')
                ? ' active'
                : '')
            }
          >
            <div className="v1-step-num">3</div>
            <div className="v1-step-txt">
              <div className="t">POST Update Scan</div>
              <div className="s">reviewStatus = APPROVED + items</div>
            </div>
          </div>
          <div className={'v1-step' + (autoNextPage && running ? ' active' : '')}>
            <div className="v1-step-num">4</div>
            <div className="v1-step-txt">
              <div className="t">Auto-Next Page &amp; Resume</div>
              <div className="s">{autoNextPage ? 'Enabled · Continuous loop' : 'Single page mode'}</div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Live AI Telemetry Spotlight (shown while running or paused with progress) */}
      {(running || paused || activityFeed.length > 0) && (
        <div className="v1-spotlight">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div className="v1-spot-thumb">
              {activeScan?.imageUrl ? (
                <img src={activeScan.imageUrl} alt={`Scan ${activeScan.id}`} />
              ) : pageData.content[0]?.imageUrl ? (
                <img src={pageData.content[0].imageUrl} alt="Current page scan" />
              ) : null}
              {running && <div className="v1-laser" />}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  className={'badge ' + (running ? 'run' : paused ? 'short' : 'ok')}
                  style={{ fontSize: 11 }}
                >
                  <span className="dot" />{' '}
                  {running ? 'LIVE AI PIPELINE' : paused ? 'PAUSED (SAVED IN DB)' : 'SESSION LOG'}
                </span>
                {activeScan?.id && (
                  <span className="mono" style={{ fontWeight: 800, color: '#a5b4fc' }}>
                    Scan #{activeScan.id}
                  </span>
                )}
                {etaMs && running && remainingOnPage > 0 && (
                  <span style={{ fontSize: 11.5, color: '#94a3b8' }}>
                    · {fmtEta(etaMs * remainingOnPage)} on this page (~{(etaMs / 1000).toFixed(1)}s/scan)
                  </span>
                )}
              </div>
              <div style={{ fontWeight: 700, fontSize: 14, marginTop: 4, color: '#fff' }}>
                {runStats.bannerMsg || 'Ready to analyze server scans'}
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                Updated: <b style={{ color: '#34d399' }}>{runStats.updated}</b> · Analyzed:{' '}
                <b style={{ color: '#e2e8f0' }}>{runStats.analyzed}</b> · Pages synced:{' '}
                <b style={{ color: '#e2e8f0' }}>{runStats.pagesProcessed}</b>
                {runStats.failed > 0 && (
                  <span>
                    {' '}
                    · Failed: <b style={{ color: '#f87171' }}>{runStats.failed}</b>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="v1-spot-feed">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 10.5,
                fontWeight: 700,
                color: '#94a3b8',
                textTransform: 'uppercase',
              }}
            >
              <span>Recent AI Sync Activity</span>
              {!running && activityFeed.length > 0 && (
                <button
                  type="button"
                  onClick={clearServerJobHistory}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    fontSize: 10.5,
                    textDecoration: 'underline',
                  }}
                >
                  Clear log
                </button>
              )}
            </div>
            {activityFeed.length === 0 ? (
              <div style={{ fontSize: 11.5, color: '#64748b' }}>
                Waiting for first scan completion…
              </div>
            ) : (
              activityFeed.slice(0, 4).map((ev) => (
                <div key={ev.id} className="v1-feed-row">
                  <span style={{ color: '#64748b' }}>{ev.ts}</span>
                  <span style={{ color: ev.stage === 'error' ? '#f87171' : '#34d399', fontWeight: 700 }}>
                    {ev.stage === 'error' ? '✕' : '✓'}
                  </span>
                  {ev.scanId && <b style={{ color: '#e2e8f0' }}>#{ev.scanId}</b>}
                  <span>
                    {ev.invoiceNo ? `Doc ${ev.invoiceNo}` : ev.message}
                    {ev.itemsCount != null ? ` (${ev.itemsCount} items)` : ''}
                  </span>
                </div>
              ))
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {running ? (
              <React.Fragment>
                <button
                  type="button"
                  className="btn warn sm"
                  onClick={() => pauseServerScanJob(toast)}
                >
                  <Ic.pause className="ic" /> Pause
                </button>
                <button
                  type="button"
                  className="btn danger sm"
                  onClick={() => stopServerScanJob(toast)}
                >
                  <Ic.stop className="ic" /> Stop
                </button>
              </React.Fragment>
            ) : paused ? (
              <React.Fragment>
                <button
                  type="button"
                  className="btn primary sm"
                  onClick={() => handleStartBatch({ selectedOnly: false, isResume: true })}
                >
                  <Ic.play className="ic" /> Resume Job
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => stopServerScanJob(toast)}
                >
                  Reset
                </button>
              </React.Fragment>
            ) : null}
          </div>
        </div>
      )}

      {/* 3. Smart Filter & Search Card */}
      <div className="card" style={{ padding: '18px 22px' }}>
        <div className="v1-filter-bar">
          <div className="v1-pills">
            <button
              type="button"
              className={
                'v1-pill' + (!filters.reviewStatus && !filters.status ? ' active' : '')
              }
              onClick={() => applyQuickPreset({ reviewStatus: '', status: '' })}
            >
              All Scans ({pageData.totalElements.toLocaleString()})
            </button>
            <button
              type="button"
              className={
                'v1-pill' + (filters.reviewStatus === 'PENDING' ? ' active' : '')
              }
              onClick={() => applyQuickPreset({ reviewStatus: 'PENDING' })}
            >
              ⏳ Pending Review
            </button>
            <button
              type="button"
              className={
                'v1-pill' + (filters.reviewStatus === 'APPROVED' ? ' active' : '')
              }
              onClick={() => applyQuickPreset({ reviewStatus: 'APPROVED' })}
            >
              ✓ Approved Only
            </button>
            <button
              type="button"
              className={'v1-pill' + (filters.status === 'FAILED' ? ' active' : '')}
              onClick={() => applyQuickPreset({ status: 'FAILED' })}
            >
              ⚠ Failed OCR
            </button>
          </div>

          <div className="row" style={{ gap: 8 }}>
            <div className="v1-seg">
              <button
                type="button"
                className={viewMode === 'table' ? 'active' : ''}
                onClick={() => setViewMode('table')}
              >
                <Ic.table className="ic" /> Table
              </button>
              <button
                type="button"
                className={viewMode === 'grid' ? 'active' : ''}
                onClick={() => setViewMode('grid')}
              >
                <Ic.grid className="ic" /> Visual Cards
              </button>
            </div>
            <button
              type="button"
              className="btn sm"
              onClick={() => setShowMoreFilters((v) => !v)}
            >
              <Ic.filter className="ic" /> {showMoreFilters ? 'Hide Filters' : 'Advanced Filters'}
            </button>
          </div>
        </div>

        <form onSubmit={applyFilters}>
          <div
            className="grid"
            style={{
              gridTemplateColumns: '2.2fr 1fr 1fr 1fr auto',
              alignItems: 'end',
            }}
          >
            <label className="f">
              Search Keyword
              <input
                value={filters.keyword}
                onChange={(e) => setFilterField('keyword', e.target.value)}
                placeholder="Search filename, invoice no, dealer, vehicle, OCR text…"
              />
            </label>
            <label className="f">
              Scan Status
              <select
                value={filters.status}
                onChange={(e) => {
                  const val = e.target.value;
                  setFilterField('status', val);
                  loadPage(0, size, sort, { ...filters, status: val });
                }}
              >
                <option value="">All statuses</option>
                <option value="PENDING">PENDING</option>
                <option value="PROCESSING">PROCESSING</option>
                <option value="COMPLETED">COMPLETED</option>
                <option value="FAILED">FAILED</option>
              </select>
            </label>
            <label className="f">
              Review Status
              <select
                value={filters.reviewStatus}
                onChange={(e) => {
                  const val = e.target.value;
                  setFilterField('reviewStatus', val);
                  loadPage(0, size, sort, { ...filters, reviewStatus: val });
                }}
              >
                <option value="">All review</option>
                <option value="PENDING">PENDING</option>
                <option value="APPROVED">APPROVED</option>
                <option value="REJECTED">REJECTED</option>
              </select>
            </label>
            <label className="f">
              Page Size
              <select
                value={size}
                onChange={(e) => {
                  const nextSize = e.target.value;
                  setSize(nextSize);
                  loadPage(0, nextSize, sort, filters);
                }}
              >
                <option value="25">25 / page</option>
                <option value="50">50 / page</option>
                <option value="100">100 / page</option>
                <option value="250">250 / page</option>
                <option value="500">500 / page</option>
                <option value="1000">1000 / page</option>
                <option value="all">All (unpaged)</option>
              </select>
            </label>
            <button type="submit" className="btn primary" disabled={loadingPage}>
              <Ic.search className="ic" /> Apply
            </button>
          </div>

          {showMoreFilters && (
            <div className="grid" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line-soft)' }}>
              <label className="f">
                Scan ID
                <input
                  value={filters.id}
                  onChange={(e) => setFilterField('id', e.target.value)}
                  placeholder="Exact ID e.g. 20284"
                />
              </label>
              <label className="f">
                Invoice No.
                <input
                  value={filters.invoiceNo}
                  onChange={(e) => setFilterField('invoiceNo', e.target.value)}
                  placeholder="Document / Invoice No."
                />
              </label>
              <label className="f">
                Dealer Code
                <input
                  value={filters.dealerCode}
                  onChange={(e) => setFilterField('dealerCode', e.target.value)}
                  placeholder="e.g. PS01, AVG4"
                />
              </label>
              <label className="f">
                Vehicle Code
                <input
                  value={filters.vehicleCode}
                  onChange={(e) => setFilterField('vehicleCode', e.target.value)}
                  placeholder="e.g. 3C-2453"
                />
              </label>
              <label className="f">
                Invoice From
                <input
                  type="date"
                  value={filters.invoiceDateFrom}
                  onChange={(e) => setFilterField('invoiceDateFrom', e.target.value)}
                />
              </label>
              <label className="f">
                Invoice To
                <input
                  type="date"
                  value={filters.invoiceDateTo}
                  onChange={(e) => setFilterField('invoiceDateTo', e.target.value)}
                />
              </label>
              <label className="f">
                Uploaded From
                <input
                  type="date"
                  value={filters.createdFrom}
                  onChange={(e) => setFilterField('createdFrom', e.target.value)}
                />
              </label>
              <label className="f">
                Uploaded To
                <input
                  type="date"
                  value={filters.createdTo}
                  onChange={(e) => setFilterField('createdTo', e.target.value)}
                />
              </label>
              <label className="f">
                Sort Order
                <select
                  value={sort}
                  onChange={(e) => {
                    setSort(e.target.value);
                    loadPage(0, size, e.target.value, filters);
                  }}
                >
                  <option value="createdAt,desc">Newest uploaded (createdAt,desc)</option>
                  <option value="createdAt,asc">Oldest uploaded (createdAt,asc)</option>
                  <option value="id,desc">Scan ID descending (id,desc)</option>
                  <option value="id,asc">Scan ID ascending (id,asc)</option>
                  <option value="invoiceDate,desc">Invoice date desc</option>
                  <option value="invoiceNo,asc">Invoice No. asc</option>
                </select>
              </label>
              <div className="row" style={{ alignSelf: 'end' }}>
                <button type="button" className="btn sm" onClick={clearFilters}>
                  Reset All Filters
                </button>
              </div>
            </div>
          )}
        </form>
      </div>

      {/* 4. Main Workspace + Optional Quick Inspector Split Drawer */}
      <div className={'v1-workspace' + (inspectedScan ? ' with-inspector' : '')}>
        <div className="card" style={{ marginBottom: 0 }}>
          {/* KPI Stat Cards */}
          <div className="stats">
            <div className="stat total">
              <div className="lbl">Total Matching</div>
              <div className="val">{pageData.totalElements.toLocaleString()}</div>
              <div className="sub">
                Page {pageData.number + 1} of {pageData.totalPages} ({pageData.content.length} loaded)
              </div>
            </div>
            <div className="stat ok">
              <div className="lbl">Approved on Page</div>
              <div className="val">{approvedOnPage}</div>
              <div className="sub">{pendingOnPage} pending on this page</div>
            </div>
            <div className="stat pend">
              <div className="lbl">Session Updated</div>
              <div className="val">{runStats.updated}</div>
              <div className="sub">
                {running && remainingOnPage > 0 && etaMs
                  ? fmtEta(etaMs * remainingOnPage)
                  : `${runStats.pagesProcessed} page(s) processed`}
              </div>
            </div>
            <div className="stat err">
              <div className="lbl">Session Failed</div>
              <div className="val">{runStats.failed}</div>
              <div className="sub">{running ? 'running in background…' : paused ? 'paused' : 'idle'}</div>
            </div>
          </div>

          {/* Animated Progress Bar */}
          <div className={'prog' + (running ? ' run' : '')} style={{ marginBottom: 14 }}>
            <i style={{ width: pagePct + '%' }} />
            <div className="pct">{pagePct}%</div>
          </div>

          {/* Action Control Bar */}
          <div className="row" style={{ marginBottom: 14 }}>
            {!running ? (
              <button
                type="button"
                className="btn primary"
                onClick={() => handleStartBatch({ selectedOnly: false, isResume: paused })}
                disabled={!pageData.content.length}
              >
                <Ic.play className="ic" />{' '}
                {paused
                  ? 'Resume AI Page Sync'
                  : `Analyze Page & Update Backend${autoNextPage ? ' (Auto-Next Page)' : ''}`}
              </button>
            ) : (
              <React.Fragment>
                <button
                  type="button"
                  className="btn warn"
                  onClick={() => pauseServerScanJob(toast)}
                >
                  <Ic.pause className="ic" /> Pause Job
                </button>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => stopServerScanJob(toast)}
                >
                  <Ic.stop className="ic" /> Stop after current scan
                </button>
              </React.Fragment>
            )}

            {!running && selectedIds.size > 0 && (
              <React.Fragment>
                <button
                  type="button"
                  className="btn"
                  onClick={() => handleStartBatch({ selectedOnly: true })}
                >
                  <Ic.spark className="ic" /> Analyze &amp; POST Selected ({selectedIds.size})
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={approveSelectedWithoutReanalyzing}
                >
                  <Ic.check className="ic" /> Mark Selected APPROVED ({selectedIds.size})
                </button>
              </React.Fragment>
            )}

            <div className="selbox">
              POST Mode:
              <select
                value={updateMode}
                onChange={(e) => {
                  setUpdateMode(e.target.value);
                  saveServerViewConfig({ updateMode: e.target.value });
                }}
                disabled={running}
              >
                <option value="single">Single (POST /v1/&#123;scanId&#125;/scan)</option>
                <option value="batch">Batch (POST /v1/list/scans)</option>
                <option value="both">Both (Single + Batch)</option>
              </select>
            </div>

            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                className="checkbox"
                checked={autoNextPage}
                onChange={(e) => {
                  setAutoNextPage(e.target.checked);
                  saveServerViewConfig({ autoNextPage: e.target.checked });
                }}
                disabled={running}
              />
              Auto next page
            </label>

            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12.5,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                className="checkbox"
                checked={skipApproved}
                onChange={(e) => {
                  setSkipApproved(e.target.checked);
                  saveServerViewConfig({ skipApproved: e.target.checked });
                }}
                disabled={running}
              />
              Skip APPROVED
            </label>
          </div>

          {!aiReady && (
            <div className="note" style={{ marginBottom: 12 }}>
              No AI Vision API key/base configured — click <b>/v1 API Settings</b> before running AI analysis.
            </div>
          )}

          {pageError && (
            <div
              className="note"
              style={{
                marginBottom: 12,
                background: '#fef2f2',
                borderColor: '#fecaca',
                color: '#991b1b',
              }}
            >
              {pageError}
            </div>
          )}

          {/* VIEW MODE A: Interactive Table */}
          {viewMode === 'table' ? (
            <div className="tblwrap" style={{ maxHeight: 620 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={allOnPageSelected}
                        onChange={(e) => toggleSelectAll(e.target.checked)}
                      />
                    </th>
                    <th style={{ width: 64 }}>Image</th>
                    <th style={{ width: 84 }}>Scan ID</th>
                    <th>Invoice No.</th>
                    <th>Date</th>
                    <th>Dealer</th>
                    <th>Vehicle</th>
                    <th>Scan Status</th>
                    <th>Review Status</th>
                    <th>AI Sync Telemetry</th>
                    <th style={{ width: 138 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pageData.content.map((scan) => {
                    const st = scanStatuses[scan.id];
                    const isApproved = String(scan.reviewStatus || '').toUpperCase() === 'APPROVED';
                    const isSelected = inspectedScan && inspectedScan.id === scan.id;
                    return (
                      <tr
                        key={scan.id}
                        className="clickable"
                        style={
                          isSelected
                            ? { background: '#eef2ff' }
                            : st?.stage === 'analyzing'
                            ? { background: '#f5f3ff' }
                            : undefined
                        }
                        onClick={() => openQuickInspector(scan, false)}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="checkbox"
                            checked={selectedIds.has(scan.id)}
                            onChange={(e) => toggleSelectRow(scan.id, e.target.checked)}
                          />
                        </td>
                        <td>
                          {scan.imageUrl ? (
                            <div
                              style={{
                                width: 46,
                                height: 46,
                                borderRadius: 10,
                                overflow: 'hidden',
                                border: '1px solid var(--line)',
                                background: '#0f172a',
                                position: 'relative',
                              }}
                            >
                              <img
                                src={scan.imageUrl}
                                alt={`Scan ${scan.id}`}
                                loading="lazy"
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                              {st?.stage === 'analyzing' && <div className="v1-laser" />}
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="mono">
                          <b>#{scan.id}</b>
                        </td>
                        <td className="mono">
                          <b>{scan.invoiceNo || '—'}</b>
                        </td>
                        <td className="mono">{scan.invoiceDate || '—'}</td>
                        <td>
                          {scan.dealerCode ? (
                            <span className="badge type">{scan.dealerCode}</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="mono">{scan.vehicleCode || '—'}</td>
                        <td>
                          <span
                            className={
                              'badge ' +
                              (scan.status === 'COMPLETED'
                                ? 'ok'
                                : scan.status === 'FAILED'
                                ? 'err'
                                : 'pend')
                            }
                          >
                            {scan.status || 'PENDING'}
                          </span>
                        </td>
                        <td>
                          <span className={'badge ' + (isApproved ? 'ok' : 'pend')}>
                            <span className="dot" /> {scan.reviewStatus || 'PENDING'}
                          </span>
                        </td>
                        <td
                          style={{
                            fontSize: 12,
                            color:
                              st?.stage === 'error'
                                ? 'var(--bad)'
                                : st?.stage === 'updated'
                                ? 'var(--ok)'
                                : 'var(--muted)',
                            fontWeight: st?.stage === 'updated' ? 600 : 400,
                          }}
                        >
                          {st ? (
                            <span>
                              {st.stage === 'analyzing' && (
                                <span className="pulse" style={{ marginRight: 6 }} />
                              )}
                              {st.message}
                            </span>
                          ) : (
                            scan.originalFilename || '—'
                          )}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className={'btn sm' + (isApproved ? '' : ' primary')}
                            onClick={(e) => runSingleRowAnalyze(scan, e)}
                            disabled={st?.stage === 'analyzing'}
                          >
                            {st?.stage === 'analyzing' ? 'Analyzing…' : '✦ Analyze & POST'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            /* VIEW MODE B: Creative Visual Card Grid */
            <div className="v1-cards-grid">
              {pageData.content.map((scan) => {
                const st = scanStatuses[scan.id];
                const isApproved = String(scan.reviewStatus || '').toUpperCase() === 'APPROVED';
                const isCardSelected = selectedIds.has(scan.id);
                return (
                  <div
                    key={scan.id}
                    className={
                      'v1-scan-card' +
                      (isCardSelected ? ' selected' : '') +
                      (st?.stage === 'analyzing' ? ' analyzing' : '')
                    }
                    onClick={() => openQuickInspector(scan, false)}
                  >
                    <div className="v1-card-media">
                      {scan.imageUrl ? (
                        <img src={scan.imageUrl} alt={`Scan ${scan.id}`} loading="lazy" />
                      ) : (
                        <span style={{ color: '#64748b', fontSize: 12 }}>No image</span>
                      )}
                      {st?.stage === 'analyzing' && <div className="v1-laser" />}
                      <div className="v1-card-top-badges">
                        <label
                          className="v1-card-id-pill"
                          onClick={(e) => e.stopPropagation()}
                          style={{ cursor: 'pointer' }}
                        >
                          <input
                            type="checkbox"
                            className="checkbox"
                            checked={isCardSelected}
                            onChange={(e) => toggleSelectRow(scan.id, e.target.checked)}
                            style={{ width: 14, height: 14 }}
                          />
                          #{scan.id}
                        </label>
                        <span className={'badge ' + (isApproved ? 'ok' : 'pend')}>
                          <span className="dot" /> {scan.reviewStatus || 'PENDING'}
                        </span>
                      </div>
                    </div>

                    <div className="v1-card-body">
                      <div className="v1-card-meta-grid">
                        <div>
                          <div className="k">Invoice No.</div>
                          <div className="v mono">{scan.invoiceNo || '—'}</div>
                        </div>
                        <div>
                          <div className="k">Date</div>
                          <div className="v mono">{scan.invoiceDate || '—'}</div>
                        </div>
                        <div>
                          <div className="k">Dealer Code</div>
                          <div className="v">{scan.dealerCode || '—'}</div>
                        </div>
                        <div>
                          <div className="k">Vehicle</div>
                          <div className="v mono">{scan.vehicleCode || '—'}</div>
                        </div>
                      </div>

                      <div
                        style={{
                          fontSize: 11.5,
                          color:
                            st?.stage === 'error'
                              ? 'var(--bad)'
                              : st?.stage === 'updated'
                              ? 'var(--ok)'
                              : 'var(--muted)',
                          marginTop: 2,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {st ? st.message : scan.originalFilename || `Scan #${scan.id}`}
                      </div>
                    </div>

                    <div className="v1-card-foot" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => openQuickInspector(scan, true)}
                      >
                        <Ic.eye className="ic" /> Detail
                      </button>
                      <button
                        type="button"
                        className={'btn sm' + (isApproved ? '' : ' primary')}
                        onClick={(e) => runSingleRowAnalyze(scan, e)}
                        disabled={st?.stage === 'analyzing'}
                      >
                        {st?.stage === 'analyzing' ? 'Analyzing…' : '✦ Analyze & POST'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!loadingPage && pageData.content.length === 0 && !pageError && (
            <div className="empty">
              No scans returned from <code>GET {cfg.v1ListScansPath}</code> for current filters.
            </div>
          )}

          {/* Pagination Bar */}
          {pageData.totalPages > 1 && (
            <div className="pager">
              <button
                type="button"
                className={'pg' + (pageData.first ? ' disabled' : '')}
                disabled={pageData.first || loadingPage}
                onClick={() => goToPage(pageData.number - 1)}
              >
                ‹ Prev
              </button>
              {buildPageNumbers(pageData.number, pageData.totalPages).map((p, idx) =>
                p === '…' ? (
                  <button key={'e' + idx} type="button" className="pg ellipsis" disabled>
                    …
                  </button>
                ) : (
                  <button
                    key={p}
                    type="button"
                    className={'pg' + (p === pageData.number + 1 ? ' active' : '')}
                    disabled={loadingPage}
                    onClick={() => goToPage(p - 1)}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                type="button"
                className={'pg' + (pageData.last ? ' disabled' : '')}
                disabled={pageData.last || loadingPage}
                onClick={() => goToPage(pageData.number + 1)}
              >
                Next ›
              </button>
            </div>
          )}
        </div>

        {/* Side-by-Side Quick Inspector Drawer */}
        {inspectedScan && (
          <aside className="v1-inspector">
            <div className="v1-inspector-head">
              <div>
                <div style={{ fontSize: 11, color: '#a5b4fc', fontWeight: 700 }}>
                  SCAN INSPECTOR · #{inspectedScan.id}
                </div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>
                  {inspectedScan.invoiceNo || inspectedScan.originalFilename || `Scan #${inspectedScan.id}`}
                </div>
              </div>
              <button
                type="button"
                className="x"
                style={{ color: '#cbd5e1' }}
                onClick={() => setInspectedScan(null)}
              >
                &times;
              </button>
            </div>

            <div className="v1-inspector-body">
              {inspectedScan.imageUrl && (
                <div className="imgwrap" style={{ marginBottom: 12, maxHeight: 240, overflow: 'hidden' }}>
                  <img
                    src={inspectedScan.imageUrl}
                    alt={`Scan ${inspectedScan.id}`}
                    style={{ objectFit: 'contain', maxHeight: 240, background: '#0f172a' }}
                  />
                </div>
              )}

              <div className="row" style={{ marginBottom: 12, gap: 8 }}>
                <button
                  type="button"
                  className="btn primary sm"
                  onClick={(e) => runSingleRowAnalyze(inspectedScan, e)}
                  disabled={scanStatuses[inspectedScan.id]?.stage === 'analyzing'}
                >
                  ✦ Analyze &amp; POST #{inspectedScan.id}
                </button>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => openServerDetail?.(formatScanForDetailModal(inspectedScan))}
                >
                  Full Modal / Edit
                </button>
              </div>

              {loadingInspector && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
                  <span className="pulse" style={{ marginRight: 6 }} /> Loading full scan items…
                </div>
              )}

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '115px 1fr',
                  gap: '5px 10px',
                  fontSize: 12.5,
                  marginBottom: 14,
                }}
              >
                <div style={{ color: 'var(--muted)', fontWeight: 600 }}>Review Status</div>
                <div>
                  <span
                    className={
                      'badge ' +
                      (String(inspectedScan.reviewStatus || '').toUpperCase() === 'APPROVED'
                        ? 'ok'
                        : 'pend')
                    }
                  >
                    <span className="dot" /> {inspectedScan.reviewStatus || 'PENDING'}
                  </span>
                </div>
                <div style={{ color: 'var(--muted)', fontWeight: 600 }}>Invoice No.</div>
                <div className="mono">{inspectedScan.invoiceNo || '—'}</div>
                <div style={{ color: 'var(--muted)', fontWeight: 600 }}>Invoice Date</div>
                <div className="mono">{inspectedScan.invoiceDate || '—'}</div>
                <div style={{ color: 'var(--muted)', fontWeight: 600 }}>Dealer Code</div>
                <div>{inspectedScan.dealerCode || '—'}</div>
                <div style={{ color: 'var(--muted)', fontWeight: 600 }}>Vehicle Code</div>
                <div className="mono">{inspectedScan.vehicleCode || '—'}</div>
                <div style={{ color: 'var(--muted)', fontWeight: 600 }}>Sale Order</div>
                <div className="mono">{inspectedScan.saleOrder || '—'}</div>
                <div style={{ color: 'var(--muted)', fontWeight: 600 }}>Warehouse</div>
                <div>{inspectedScan.warehouse || '—'}</div>
              </div>

              <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                Extracted Line Items ({Array.isArray(inspectedScan.items) ? inspectedScan.items.length : 0})
              </div>
              {Array.isArray(inspectedScan.items) && inspectedScan.items.length > 0 ? (
                <div className="tblwrap" style={{ maxHeight: 220 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Description</th>
                        <th>Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inspectedScan.items.map((it, idx) => (
                        <tr key={idx}>
                          <td className="mono">{it.productCode || '—'}</td>
                          <td style={{ fontSize: 11.5 }}>{it.description || '—'}</td>
                          <td className="mono">
                            {it.deliveredQuantity ?? it.quantity ?? it.orderedQuantity ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--muted)',
                    padding: '12px',
                    background: '#f8fafc',
                    borderRadius: 10,
                    textAlign: 'center',
                  }}
                >
                  No line items saved yet — click <b>✦ Analyze &amp; POST</b> to extract with AI.
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </React.Fragment>
  );
}
