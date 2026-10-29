/* Unauthenticated /v1 Scan API client + AI Analyze & Auto-Next-Page Sync Engine */
import { getSettings } from './db.js';
import { extractWithAI } from './ai.js';
import { compressImage, num, uid } from './util.js';

export const DEFAULT_SCAN_API_SETTINGS = {
  apiServerBase:
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_SERVER_BASE) ||
    (typeof window !== 'undefined' && window.location && /\.vercel\.app$/i.test(window.location.hostname)
      ? 'http://45.201.196.19:3002'
      : 'http://localhost:8080'),
  v1ListScansPath:
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_V1_LIST_SCANS_PATH) ||
    '/v1/list/scans',
  v1SingleScanPath:
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_V1_SINGLE_SCAN_PATH) ||
    '/v1/{scanId}/scan',
  v1ExportScansPath:
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_V1_EXPORT_SCANS_PATH) ||
    '/v1/list/scans/export',
  v1UpdateMode: 'single', // 'single' | 'batch' | 'both'
  v1PageSize: '50',
  v1AutoNextPage: true,
  v1SkipApproved: false,
  v1ContinuousLoop: false,
  v1LoopInterval: 15,
  v1ReanalyzeEmptyItems: true,
  v1TargetMode: 'pending_and_empty',
  useProxy: 'auto', // 'auto' | 'always' | 'never'
};

/**
 * Reads the separate /v1 Scan Backend API configuration from localStorage settings.
 */
export function getScanApiConfig(overrides = {}) {
  const s = getSettings();
  const isVercelHost =
    typeof window !== 'undefined' &&
    window.location &&
    /\.vercel\.app$/i.test(window.location.hostname);

  let defaultOrigin = DEFAULT_SCAN_API_SETTINGS.apiServerBase;
  if (
    typeof window !== 'undefined' &&
    window.location &&
    /^https?:$/i.test(window.location.protocol) &&
    !isVercelHost &&
    !(typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_SERVER_BASE)
  ) {
    defaultOrigin = window.location.origin;
  }

  let rawBase = (overrides.apiServerBase ?? s.apiServerBase ?? s.scanBase ?? defaultOrigin) || defaultOrigin;

  // If running in cloud (e.g. *.vercel.app) and saved base points to localhost, auto-switch to remote server
  if (isVercelHost && /:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(rawBase)) {
    if (!overrides.apiServerBase) {
      rawBase = 'http://45.201.196.19:3002';
    }
  }

  // Strip trailing /admin/scans or /v1/... if a full page URL was pasted into base
  const cleanBase = String(rawBase)
    .trim()
    .replace(/\/+(admin\/scans|api\/public\/scans|v1\/list\/scans).*$/i, '')
    .replace(/\/+$/, '');

  return {
    apiServerBase: cleanBase || DEFAULT_SCAN_API_SETTINGS.apiServerBase,
    v1ListScansPath: String(overrides.v1ListScansPath ?? s.v1ListScansPath ?? DEFAULT_SCAN_API_SETTINGS.v1ListScansPath).trim() || '/v1/list/scans',
    v1SingleScanPath: String(overrides.v1SingleScanPath ?? s.v1SingleScanPath ?? DEFAULT_SCAN_API_SETTINGS.v1SingleScanPath).trim() || '/v1/{scanId}/scan',
    v1ExportScansPath: String(overrides.v1ExportScansPath ?? s.v1ExportScansPath ?? DEFAULT_SCAN_API_SETTINGS.v1ExportScansPath).trim() || '/v1/list/scans/export',
    v1UpdateMode: overrides.v1UpdateMode ?? s.v1UpdateMode ?? DEFAULT_SCAN_API_SETTINGS.v1UpdateMode,
    v1PageSize: String(overrides.v1PageSize ?? s.v1PageSize ?? DEFAULT_SCAN_API_SETTINGS.v1PageSize),
    v1AutoNextPage: overrides.v1AutoNextPage ?? (s.v1AutoNextPage !== undefined ? !!s.v1AutoNextPage : DEFAULT_SCAN_API_SETTINGS.v1AutoNextPage),
    v1SkipApproved: overrides.v1SkipApproved ?? (s.v1SkipApproved !== undefined ? !!s.v1SkipApproved : DEFAULT_SCAN_API_SETTINGS.v1SkipApproved),
    v1ContinuousLoop: overrides.v1ContinuousLoop ?? (s.v1ContinuousLoop !== undefined ? !!s.v1ContinuousLoop : DEFAULT_SCAN_API_SETTINGS.v1ContinuousLoop),
    v1LoopInterval: Number(overrides.v1LoopInterval ?? s.v1LoopInterval ?? DEFAULT_SCAN_API_SETTINGS.v1LoopInterval) || 15,
    v1ReanalyzeEmptyItems: overrides.v1ReanalyzeEmptyItems ?? (s.v1ReanalyzeEmptyItems !== undefined ? !!s.v1ReanalyzeEmptyItems : DEFAULT_SCAN_API_SETTINGS.v1ReanalyzeEmptyItems),
    v1TargetMode: String(overrides.v1TargetMode ?? s.v1TargetMode ?? DEFAULT_SCAN_API_SETTINGS.v1TargetMode),
    useProxy: overrides.useProxy ?? s.useProxy ?? DEFAULT_SCAN_API_SETTINGS.useProxy,
  };
}

/**
 * Wraps a target URL with the local /api/proxy endpoint if running on HTTPS
 * and the target is an HTTP URL (to eliminate browser Mixed Content blocks).
 */
export function wrapWithProxyIfNeeded(url, configOverrides = {}) {
  if (!url || typeof window === 'undefined') return url;
  const cfg = getScanApiConfig(configOverrides);
  if (cfg.useProxy === 'never') return url;

  // Don't double wrap
  if (url.startsWith('/api/proxy') || url.includes('/api/proxy?url=')) return url;

  const isPageHttps = window.location.protocol === 'https:';
  const isTargetHttp = /^http:\/\//i.test(url);
  const isAlwaysProxy = cfg.useProxy === 'always';

  // If on HTTPS and target is HTTP (Mixed Content risk), or forced always:
  if (isAlwaysProxy || (isPageHttps && isTargetHttp)) {
    return `/api/proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

/**
 * Resolves an endpoint path against the configured apiServerBase.
 */
export function resolveScanApiUrl(pathOrUrl, configOverrides = {}) {
  const cfg = getScanApiConfig(configOverrides);
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return cfg.apiServerBase;
  if (raw.startsWith('/api/proxy') || raw.startsWith('data:') || raw.startsWith('blob:')) {
    return raw;
  }
  if (/^https?:\/\//i.test(raw)) {
    // If backend returned http://localhost/... but user configured a remote apiServerBase, rewrite origin to apiServerBase
    try {
      const parsed = new URL(raw);
      const baseParsed = new URL(cfg.apiServerBase);
      if ((parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
          baseParsed.hostname !== 'localhost' && baseParsed.hostname !== '127.0.0.1') {
        return `${baseParsed.origin}${parsed.pathname}${parsed.search}`;
      }
      return raw;
    } catch (_) {
      return raw;
    }
  }
  return `${cfg.apiServerBase}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

/**
 * Resolves the single-scan endpoint URL for a given scanId.
 * Supports both `/v1/{scanId}/scan` and `/v1/scanId/scan?scanId=...` patterns.
 */
export function buildSingleScanUrl(scanId, configOverrides = {}) {
  const cfg = getScanApiConfig(configOverrides);
  const pattern = cfg.v1SingleScanPath || '/v1/{scanId}/scan';
  if (pattern.includes('{scanId}')) {
    return resolveScanApiUrl(pattern.replace('{scanId}', encodeURIComponent(scanId)), configOverrides);
  }
  if (pattern.includes('{id}')) {
    return resolveScanApiUrl(pattern.replace('{id}', encodeURIComponent(scanId)), configOverrides);
  }
  if (/\/v1\/scanId\/scan$/i.test(pattern)) {
    const sep = pattern.includes('?') ? '&' : '?';
    return resolveScanApiUrl(`${pattern}${sep}scanId=${encodeURIComponent(scanId)}`, configOverrides);
  }
  return resolveScanApiUrl(`/v1/${encodeURIComponent(scanId)}/scan`, configOverrides);
}

/**
 * GET /v1/list/scans — Paginated & filtered scan list without authorization.
 */
export async function fetchScansPage({
  page = 0,
  size,
  sort = 'createdAt,desc',
  filters = {},
  configOverrides = {},
  signal,
} = {}) {
  const cfg = getScanApiConfig(configOverrides);
  const effectiveSize = size != null ? String(size) : cfg.v1PageSize;
  const params = new URLSearchParams();

  const filterKeys = [
    'id',
    'keyword',
    'locationId',
    'status',
    'reviewStatus',
    'duplicateStatus',
    'username',
    'invoiceNo',
    'dealerCode',
    'saleOrder',
    'vendorCode',
    'vehicleCode',
    'warehouse',
    'route',
    'invoiceDateFrom',
    'invoiceDateTo',
    'createdFrom',
    'createdTo',
  ];

  filterKeys.forEach((key) => {
    const val = filters[key];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      params.set(key, String(val).trim());
    }
  });

  params.set('page', String(Math.max(0, Number(page) || 0)));
  params.set('size', effectiveSize);
  if (sort) params.set('sort', sort);

  const baseUrl = resolveScanApiUrl(cfg.v1ListScansPath, configOverrides);
  const rawUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${params.toString()}`;
  const url = wrapWithProxyIfNeeded(rawUrl, configOverrides);

  const resp = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`GET ${cfg.v1ListScansPath} failed (${resp.status}): ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  const rawList = Array.isArray(data.content)
    ? data.content
    : Array.isArray(data.scans)
    ? data.scans
    : [];

  const content = rawList.map((scan) => ({
    ...scan,
    imageUrl: resolveScanImageUrl(scan, configOverrides),
  }));

  const pageNumber = typeof data.number === 'number'
    ? data.number
    : typeof data.page === 'number'
    ? Math.max(0, data.page - 1)
    : Math.max(0, Number(page) || 0);

  const totalElements = typeof data.totalElements === 'number'
    ? data.totalElements
    : typeof data.totalScans === 'number'
    ? data.totalScans
    : content.length;

  const totalPages = typeof data.totalPages === 'number' ? Math.max(1, data.totalPages) : 1;
  const isFirst = typeof data.first === 'boolean' ? data.first : pageNumber <= 0;
  const isLast = typeof data.last === 'boolean' ? data.last : pageNumber >= totalPages - 1;

  return {
    content,
    number: pageNumber,
    size: typeof data.size === 'number' ? data.size : content.length,
    totalPages,
    totalElements,
    first: isFirst,
    last: isLast,
    numberOfElements: content.length,
    empty: content.length === 0,
  };
}

/**
 * Resolves the scan's direct `imageUrl` using the public image endpoint:
 * `${cfg.apiServerBase}/api/public/scans/${scanId}/image`
 * (e.g. `http://45.201.196.19:3002/api/public/scans/34399/image`).
 * Returns the direct URL for <img src="..."> tags.
 */
export function resolveScanImageUrl(scan, configOverrides = {}) {
  const cfg = getScanApiConfig(configOverrides);
  if (!scan) return '';

  if (typeof scan === 'string') {
    const s = scan.trim();
    if (!s) return '';
    if (s.startsWith('data:') || s.startsWith('blob:')) return s;

    // Unwrap proxy if passed an existing /api/proxy?url=
    if (s.startsWith('/api/proxy') || s.includes('/api/proxy?url=')) {
      try {
        const u = new URL(s, 'http://localhost');
        const target = u.searchParams.get('url');
        if (target) return resolveScanImageUrl(target, configOverrides);
      } catch (_) {}
    }

    // Direct numeric ID
    if (/^\d+$/.test(s)) {
      return `${cfg.apiServerBase}/api/public/scans/${s}/image`;
    }

    // Match /scans/:id/image or /v1/:id/scan/image
    const m = s.match(/\/(?:api\/public\/)?scans\/(\d+)\/image/i) || s.match(/\/v1\/(\d+)\/scan\/image/i);
    if (m && m[1]) {
      return `${cfg.apiServerBase}/api/public/scans/${m[1]}/image`;
    }

    // Absolute HTTP(S) URL
    if (/^https?:\/\//i.test(s)) {
      try {
        const parsed = new URL(s);
        const baseParsed = new URL(cfg.apiServerBase);
        if ((parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
            baseParsed.hostname !== 'localhost' && baseParsed.hostname !== '127.0.0.1') {
          return `${baseParsed.origin}${parsed.pathname}${parsed.search}`;
        }
      } catch (_) {}
      return s;
    }

    return resolveScanApiUrl(s, configOverrides);
  }

  if (typeof scan === 'object') {
    const id = scan.id ?? scan.scanId;
    if (id != null && String(id).trim() !== '') {
      return `${cfg.apiServerBase}/api/public/scans/${encodeURIComponent(String(id).trim())}/image`;
    }
    if (scan.imageUrl) {
      return resolveScanImageUrl(scan.imageUrl, configOverrides);
    }
    if (scan.image) {
      return resolveScanImageUrl(scan.image, configOverrides);
    }
  }

  return '';
}

/**
 * Fallback error handler for <img> tags. If direct HTTP image loading fails
 * or is blocked on an HTTPS origin, automatically falls back to /api/proxy.
 */
export function handleScanImageError(e) {
  if (!e || !e.currentTarget) return;
  const img = e.currentTarget;
  const cur = img.getAttribute('src') || img.src || '';
  if (!cur || cur.includes('/api/proxy') || cur.startsWith('data:') || cur.startsWith('blob:')) {
    return;
  }
  if (/^https?:\/\//i.test(cur)) {
    img.src = `/api/proxy?url=${encodeURIComponent(cur)}`;
  }
}

/**
 * GET /v1/{scanId}/scan (or /v1/scanId/scan?scanId=...) — Single scan with headers, items, and imageUrl.
 */
export async function fetchScanById(scanId, { configOverrides = {}, signal } = {}) {
  if (scanId == null || scanId === '') throw new Error('scanId is required');
  const rawUrl = buildSingleScanUrl(scanId, configOverrides);
  const url = wrapWithProxyIfNeeded(rawUrl, configOverrides);
  const resp = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`GET scan #${scanId} failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  const scan = await resp.json();
  return {
    ...scan,
    imageUrl: resolveScanImageUrl(scan, configOverrides),
  };
}

/**
 * Downloads the image from `scan.imageUrl` (with fallback to `/v1/{scanId}/scan/image`)
 * and compresses it to a base64 JPEG dataUrl for `extractWithAI(dataUrl)`.
 */
export async function fetchScanImageDataUrl(scanOrImageUrl, scanId, { configOverrides = {}, signal } = {}) {
  const cfg = getScanApiConfig(configOverrides);
  const resolvedId = scanId ?? (typeof scanOrImageUrl === 'object' ? scanOrImageUrl?.id : null);

  const directUrl = resolveScanImageUrl(scanOrImageUrl, configOverrides) ||
    (resolvedId != null ? `${cfg.apiServerBase}/api/public/scans/${encodeURIComponent(resolvedId)}/image` : null);

  const fallbackDirect = resolvedId != null
    ? `${cfg.apiServerBase}/v1/${encodeURIComponent(resolvedId)}/scan/image`
    : null;

  const primaryUrl = directUrl ? wrapWithProxyIfNeeded(directUrl, configOverrides) : '';
  const fallbackUrl = fallbackDirect ? wrapWithProxyIfNeeded(fallbackDirect, configOverrides) : '';

  let resp;
  try {
    if (primaryUrl) {
      resp = await fetch(primaryUrl, { signal });
    }
    if ((!resp || !resp.ok) && fallbackUrl && fallbackUrl !== primaryUrl) {
      resp = await fetch(fallbackUrl, { signal });
    }
  } catch (err) {
    if (fallbackUrl && fallbackUrl !== primaryUrl) {
      resp = await fetch(fallbackUrl, { signal });
    } else {
      throw new Error(`Could not fetch scan image (${primaryUrl || directUrl}): ${err.message}`);
    }
  }

  if (!resp || !resp.ok) {
    throw new Error(`Image request failed with HTTP ${resp ? resp.status : 'network error'}`);
  }

  const blob = await resp.blob();
  return await compressImage(blob);
}

/**
 * Transforms the AI extraction result (from `extractWithAI` using `PROMPT` in `ai.js`)
 * into the request body for `POST /v1/{scanId}/scan` and `POST /v1/list/scans`
 * with `reviewStatus = "APPROVED"`.
 */
export function buildScanUpdatePayload(scanId, extracted = {}, reviewStatus = 'APPROVED') {
  const numericId = Number(scanId);
  const idVal = Number.isFinite(numericId) ? numericId : scanId;
  const invoiceNo = extracted.no || extracted.invoiceNo || extracted.documentNo || null;
  const dealerCode = extracted.dealerCode || extracted.toWarehouseCode || null;

  const headers = {};
  const headerKeys = [
    'documentType',
    'no',
    'invoiceDate',
    'dealerCode',
    'toWarehouseCode',
    'saleOrder',
    'vendorCode',
    'vehicleCode',
    'warehouse',
    'route',
    'verificationNotes',
    'formNo',
    'referenceNo',
    'company',
    'dealerName',
    'dealerAddress',
    'fromWarehouse',
    'fromLocation',
    'toLocation',
    'effectiveDate',
  ];
  headerKeys.forEach((k) => {
    if (extracted[k] !== undefined && extracted[k] !== null && extracted[k] !== '') {
      headers[k] = extracted[k];
    }
  });
  if (invoiceNo) {
    headers.no = invoiceNo;
    headers.invoiceNo = invoiceNo;
  }
  if (dealerCode) {
    headers.dealerCode = dealerCode;
  }

  const items = Array.isArray(extracted.items)
    ? extracted.items.map((item) => ({
        productCode: item.productCode ?? item.materialCode ?? null,
        description: item.description ?? null,
        unit: item.unit ?? null,
        orderedQuantity: num(item.orderedQuantity),
        deliveredQuantity: num(item.deliveredQuantity),
        quantity: num(item.quantity),
        notes: item.notes ?? null,
      }))
    : [];

  return {
    id: idVal,
    scanId: idVal,
    invoiceNo,
    invoiceDate: extracted.invoiceDate || null,
    dealerCode,
    saleOrder: extracted.saleOrder || null,
    vendorCode: extracted.vendorCode || null,
    vehicleCode: extracted.vehicleCode || null,
    warehouse: extracted.warehouse || null,
    route: extracted.route || null,
    reviewStatus: reviewStatus || 'APPROVED',
    headers,
    items,
  };
}

/**
 * POST /v1/{scanId}/scan (or /v1/scanId/scan) — Single scan update with headers, items, and reviewStatus = APPROVED.
 */
export async function updateSingleScanV1(scanId, extractedOrPayload, { configOverrides = {}, signal } = {}) {
  if (scanId == null || scanId === '') throw new Error('scanId is required for single scan update');
  const payload = extractedOrPayload && Array.isArray(extractedOrPayload.items) && ('invoiceNo' in extractedOrPayload || 'headers' in extractedOrPayload)
    ? { ...extractedOrPayload, id: Number(scanId) || scanId, scanId: Number(scanId) || scanId, reviewStatus: extractedOrPayload.reviewStatus || 'APPROVED' }
    : buildScanUpdatePayload(scanId, extractedOrPayload, 'APPROVED');

  const rawUrl = buildSingleScanUrl(scanId, configOverrides);
  const url = wrapWithProxyIfNeeded(rawUrl, configOverrides);
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`POST scan #${scanId} failed (${resp.status}): ${text.slice(0, 200)}`);
  }

  const data = await resp.json().catch(() => ({ ok: true }));
  return {
    ...data,
    imageUrl: resolveScanImageUrl(data, configOverrides),
  };
}

/**
 * POST /v1/list/scans — Batch update multiple scans by IDs with headers, items, and reviewStatus = APPROVED.
 */
export async function batchUpdateScansV1(scanPayloads, { configOverrides = {}, signal } = {}) {
  if (!Array.isArray(scanPayloads) || !scanPayloads.length) {
    throw new Error('Provide at least one scan payload for batch update');
  }
  const cfg = getScanApiConfig(configOverrides);
  const normalizedScans = scanPayloads.map((entry) => {
    const scanId = entry.id ?? entry.scanId;
    if (entry.headers && Array.isArray(entry.items) && 'invoiceNo' in entry) {
      return {
        ...entry,
        id: Number(scanId) || scanId,
        scanId: Number(scanId) || scanId,
        reviewStatus: entry.reviewStatus || 'APPROVED',
      };
    }
    return buildScanUpdatePayload(scanId, entry, entry.reviewStatus || 'APPROVED');
  });

  const rawUrl = resolveScanApiUrl(cfg.v1ListScansPath, configOverrides);
  const url = wrapWithProxyIfNeeded(rawUrl, configOverrides);
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      reviewStatus: 'APPROVED',
      scans: normalizedScans,
    }),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`POST ${cfg.v1ListScansPath} failed (${resp.status}): ${text.slice(0, 200)}`);
  }

  const data = await resp.json().catch(() => ({ ok: true }));
  const rawList = Array.isArray(data.content)
    ? data.content
    : Array.isArray(data.scans)
    ? data.scans
    : [];
  const normalized = rawList.map((s) => ({
    ...s,
    imageUrl: resolveScanImageUrl(s, configOverrides),
  }));
  return {
    ...data,
    content: normalized,
    scans: normalized,
  };
}

/**
 * Analyzes a single scan object (from `/v1/list/scans` or `/v1/{scanId}/scan`) using its `imageUrl`
 * and `PROMPT` in `src/lib/ai.js`, and posts the analyzed update to `POST /v1/{scanId}/scan` with `reviewStatus = "APPROVED"`.
 */
export async function analyzeOneServerScan(
  scan,
  {
    postImmediately = true,
    configOverrides = {},
    signal,
  } = {}
) {
  if (!scan || scan.id == null) throw new Error('Invalid scan object (missing id)');
  const dataUrl = await fetchScanImageDataUrl(scan, scan.id, { configOverrides, signal });
  const extracted = await extractWithAI(dataUrl);
  const payload = buildScanUpdatePayload(scan.id, extracted, 'APPROVED');

  let updatedScan = null;
  if (postImmediately) {
    updatedScan = await updateSingleScanV1(scan.id, payload, { configOverrides, signal });
  }

  return {
    scanId: scan.id,
    extracted,
    payload,
    updatedScan,
    dataUrl,
  };
}

/**
 * Checks if a scan is approved (either by reviewStatus === 'APPROVED' or status === 'APPROVED' or in session status).
 */
export function isScanApproved(scan, scanStatuses = {}) {
  if (!scan) return false;
  const scanId = scan.id ?? scan.scanId;
  if (scanId && scanStatuses[scanId]?.stage === 'updated') return true;

  const rev = String(scan.reviewStatus || scan.headers?.reviewStatus || '').trim().toUpperCase();
  if (rev === 'APPROVED' || rev === 'APPROVE') return true;

  const st = String(scan.status || scan.headers?.status || '').trim().toUpperCase();
  if (st === 'APPROVED' || st === 'APPROVE') return true;

  return false;
}

/**
 * Checks if a scan is pending analysis or review.
 */
export function isScanPending(scan, scanStatuses = {}) {
  if (!scan) return false;
  const scanId = scan.id ?? scan.scanId;
  if (scanId && scanStatuses[scanId]?.stage === 'updated') return false;
  return !isScanApproved(scan, scanStatuses);
}

/**
 * Checks if a scan has 0 items or no items recorded.
 */
export function isScanEmptyItems(scan, scanStatuses = {}) {
  if (!scan) return true;
  const scanId = scan.id ?? scan.scanId;
  const st = scanStatuses[scanId];
  if (st && st.itemsCount != null) {
    return st.itemsCount === 0;
  }
  if (Array.isArray(scan.items)) {
    return scan.items.length === 0;
  }
  if (scan.itemsCount != null) {
    return Number(scan.itemsCount) === 0;
  }
  return null; // Unknown from list summary
}

/**
 * Main End-to-End Pipeline:
 * 1. Calls `GET /v1/list/scans` for the current page.
 * 2. Filters candidates based on:
 *    - PENDING scans
 *    - Scans with 0 items (when reanalyzeEmptyItems is enabled)
 * 3. Accesses each scan's `imageUrl` and analyzes it with `extractWithAI`.
 * 4. Posts the analyzed headers + items to update the scan(s) with `reviewStatus = "APPROVED"`:
 *    - `updateMode === 'single'`: posts each scan immediately via `POST /v1/{scanId}/scan`
 *    - `updateMode === 'batch'`: posts all analyzed scans on the page together via `POST /v1/list/scans`
 *    - `updateMode === 'both'`: posts each scan immediately AND sends the batch confirmation at the end of the page
 * 5. Automatically switches to the next page, or in 24/7 continuous overtime mode, polls page 0 indefinitely.
 */
export async function analyzeAndSyncScansPages({
  startPage = 0,
  size,
  sort = 'createdAt,desc',
  filters = {},
  updateMode,
  getUpdateMode,
  batchConcurrency = 3,
  getBatchConcurrency,
  autoNextPage,
  getAutoNextPage,
  skipApproved,
  getSkipApproved,
  targetMode = 'pending_and_empty', // 'pending_and_empty' | 'pending_only' | 'empty_items_only' | 'all'
  reanalyzeEmptyItems = true,
  continuousLoop = false,
  loopInterval = 15,
  onlyScanIds = null,
  configOverrides = {},
  shouldStop = () => false,
  onPageLoaded = () => {},
  onScanProgress = () => {},
  onPageSynced = () => {},
  onLoopWaiting = () => {},
  onLoopPassComplete = () => {},
} = {}) {
  const cfg = getScanApiConfig(configOverrides);

  const getCurrentMode = () => {
    let m = null;
    if (typeof getUpdateMode === 'function') {
      try { m = getUpdateMode(); } catch (_) {}
    }
    return m || updateMode || cfg.v1UpdateMode || 'single';
  };

  const getConcurrency = () => {
    let c = null;
    if (typeof getBatchConcurrency === 'function') {
      try { c = getBatchConcurrency(); } catch (_) {}
    }
    const val = Number(c ?? batchConcurrency) || 3;
    const mode = getCurrentMode();
    // For single mode: sequential (1); for batch/both: concurrent parallel AI analysis (default 3)
    return mode === 'single' ? 1 : Math.max(1, Math.min(5, val));
  };

  const getEffectiveAutoNext = () => {
    let a = undefined;
    if (typeof getAutoNextPage === 'function') {
      try { a = getAutoNextPage(); } catch (_) {}
    }
    return a !== undefined ? !!a : (autoNextPage !== undefined ? !!autoNextPage : cfg.v1AutoNextPage);
  };

  const getEffectiveSkipApproved = () => {
    let s = undefined;
    if (typeof getSkipApproved === 'function') {
      try { s = getSkipApproved(); } catch (_) {}
    }
    return s !== undefined ? !!s : (skipApproved !== undefined ? !!skipApproved : cfg.v1SkipApproved);
  };

  const effectiveSize = size != null ? String(size) : cfg.v1PageSize;
  const filterSet = onlyScanIds ? new Set(onlyScanIds.map((x) => String(x))) : null;

  let currentPage = Math.max(0, Number(startPage) || 0);
  let totalAnalyzed = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  let totalSkipped = 0;
  let pagesProcessed = 0;
  let passesCompleted = 0;
  const processedScanIds = new Set();

  while (!shouldStop()) {
    const pageData = await fetchScansPage({
      page: currentPage,
      size: effectiveSize,
      sort,
      filters,
      configOverrides,
    });

    onPageLoaded(pageData, currentPage);

    if (!pageData.content.length && (!continuousLoop || currentPage > 0)) {
      if (!continuousLoop) {
        break;
      }
    }

    const candidates = [];
    const skippedOnPage = [];

    for (const scan of pageData.content) {
      if (filterSet && !filterSet.has(String(scan.id))) {
        continue;
      }
      if (processedScanIds.has(String(scan.id))) {
        continue;
      }

      const approved = isScanApproved(scan);

      // 1. Scan is PENDING
      if (!approved) {
        if (targetMode === 'empty_items_only') {
          skippedOnPage.push(scan);
        } else {
          candidates.push(scan);
        }
        continue;
      }

      // 2. Scan is APPROVED
      if (targetMode === 'pending_only' || (getEffectiveSkipApproved() && !reanalyzeEmptyItems)) {
        skippedOnPage.push(scan);
        continue;
      }

      if (targetMode === 'all') {
        candidates.push(scan);
        continue;
      }

      // Check if approved scan has 0 items
      let hasNoItems = false;
      if (Array.isArray(scan.items)) {
        hasNoItems = scan.items.length === 0;
      } else if (scan.itemsCount != null) {
        hasNoItems = Number(scan.itemsCount) === 0;
      } else {
        // Items not present on list item summary: fetch single scan detail
        try {
          const detail = await fetchScanById(scan.id, { configOverrides });
          const items = detail.items || [];
          scan.items = items;
          scan.itemsCount = items.length;
          hasNoItems = items.length === 0;
        } catch (_) {
          hasNoItems = false;
        }
      }

      if (hasNoItems) {
        candidates.push(scan);
      } else {
        skippedOnPage.push(scan);
      }
    }

    // Notify telemetry about skipped already-APPROVED scans with items
    if (skippedOnPage.length > 0) {
      totalSkipped += skippedOnPage.length;
      skippedOnPage.forEach((s) => {
        processedScanIds.add(String(s.id));
        onScanProgress({
          scanId: s.id,
          scan: s,
          page: currentPage,
          stage: 'skipped',
          count: 1,
          message: 'Skipped (Approved with items)',
        });
      });
    }

    const pagePayloads = [];
    let pageSuccessCount = 0;
    let pageFailCount = 0;

    async function flushBatch() {
      if (pagePayloads.length === 0) return;
      const toSend = [...pagePayloads];
      pagePayloads.length = 0;

      onScanProgress({
        scanId: null,
        page: currentPage,
        stage: 'batch_posting',
        message: `Batch updating ${toSend.length} scan(s) via POST ${cfg.v1ListScansPath}…`,
      });

      try {
        const batchResponse = await batchUpdateScansV1(toSend, { configOverrides });
        totalUpdated += toSend.length;
        const updatedList = batchResponse?.content || batchResponse?.scans || [];
        const updatedMap = new Map();
        updatedList.forEach((u) => {
          if (u.id != null) updatedMap.set(String(u.id), u);
        });

        toSend.forEach((p) => {
          const scanId = p.id || p.scanId;
          const u = updatedMap.get(String(scanId)) || p;
          onScanProgress({
            scanId,
            scan: {
              ...u,
              id: scanId,
              scanId,
              reviewStatus: 'APPROVED',
              status: 'COMPLETED',
            },
            page: currentPage,
            stage: 'updated',
            itemsCount: Array.isArray(u.items) ? u.items.length : p.items?.length,
            invoiceNo: u.invoiceNo || p.invoiceNo,
            message: `Batch saved (APPROVED, ${p.items?.length || 0} items) ✓`,
          });
        });
      } catch (err) {
        console.warn(`Batch POST failed (${err.message}). Falling back to per-scan updates…`);
        for (const p of toSend) {
          const scanId = p.id || p.scanId;
          try {
            const single = await updateSingleScanV1(scanId, p, { configOverrides });
            totalUpdated++;
            onScanProgress({
              scanId,
              scan: {
                ...single,
                id: scanId,
                scanId,
                reviewStatus: 'APPROVED',
                status: 'COMPLETED',
              },
              page: currentPage,
              stage: 'updated',
              itemsCount: Array.isArray(single.items) ? single.items.length : p.items?.length,
              invoiceNo: single.invoiceNo || p.invoiceNo,
              message: `Saved via per-scan fallback (APPROVED, ${p.items?.length || 0} items) ✓`,
            });
          } catch (singleErr) {
            totalFailed++;
            onScanProgress({
              scanId,
              page: currentPage,
              stage: 'error',
              error: singleErr.message,
              message: `Update failed: ${singleErr.message}`,
            });
          }
        }
      }
    }

    async function processCandidate(scan, indexOnPage) {
      if (shouldStop()) return;
      processedScanIds.add(String(scan.id));
      const t0 = performance.now();

      const activeMode = getCurrentMode();
      const isBatch = activeMode === 'batch';
      const postSingleNow = activeMode === 'single' || activeMode === 'both';

      onScanProgress({
        scanId: scan.id,
        scan,
        page: currentPage,
        indexOnPage,
        totalOnPage: candidates.length,
        stage: 'analyzing',
        message: isBatch ? 'Fast parallel AI extracting…' : 'Analyzing imageUrl with AI…',
      });

      try {
        const result = await analyzeOneServerScan(scan, {
          postImmediately: postSingleNow,
          configOverrides,
        });

        totalAnalyzed++;
        pageSuccessCount++;
        const elapsedMs = Math.round(performance.now() - t0);

        if (postSingleNow) {
          totalUpdated++;
          onScanProgress({
            scanId: scan.id,
            scan: result.updatedScan || {
              ...scan,
              ...result.payload,
              reviewStatus: 'APPROVED',
              status: 'COMPLETED',
            },
            page: currentPage,
            indexOnPage,
            totalOnPage: candidates.length,
            stage: 'updated',
            itemsCount: result.payload.items.length,
            invoiceNo: result.payload.invoiceNo,
            ms: elapsedMs,
            message: `Approved & saved (${result.payload.items.length} items) ✓`,
          });
        }

        if (isBatch || activeMode === 'both') {
          pagePayloads.push(result.payload);
          if (!postSingleNow) {
            onScanProgress({
              scanId: scan.id,
              scan: {
                ...scan,
                ...result.payload,
              },
              page: currentPage,
              indexOnPage,
              totalOnPage: candidates.length,
              stage: 'analyzed',
              itemsCount: result.payload.items.length,
              invoiceNo: result.payload.invoiceNo,
              ms: elapsedMs,
              message: `Analyzed (${result.payload.items.length} items) — Queued for batch POST`,
            });
          }

          // In batch mode, flush in progressive chunks of 10 scans so work is committed steadily
          if (pagePayloads.length >= 10 && !postSingleNow) {
            await flushBatch();
          }
        }
      } catch (err) {
        totalFailed++;
        pageFailCount++;
        onScanProgress({
          scanId: scan.id,
          scan,
          page: currentPage,
          indexOnPage,
          totalOnPage: candidates.length,
          stage: 'error',
          error: err.message || 'Analysis failed',
          message: err.message || 'Analysis failed',
        });
        if (err.message === 'NO_SETTINGS') {
          throw err;
        }
        if (continuousLoop && !shouldStop()) {
          await new Promise((r) => setTimeout(r, 6000));
        }
      }
    }

    let candIdx = 0;
    const activePromises = new Set();

    while (candIdx < candidates.length || activePromises.size > 0) {
      if (shouldStop() && activePromises.size === 0) break;

      const concurrency = getConcurrency();
      while (!shouldStop() && candIdx < candidates.length && activePromises.size < concurrency) {
        const curIdx = candIdx++;
        const candidateScan = candidates[curIdx];
        const p = Promise.resolve().then(() => processCandidate(candidateScan, curIdx));
        activePromises.add(p);
        const done = () => activePromises.delete(p);
        p.then(done, done);
      }

      if (activePromises.size > 0) {
        await Promise.race(activePromises);
      }
    }

    // Always flush any remaining batch payloads on this page (even if paused/stopped!)
    await flushBatch();

    pagesProcessed++;
    onPageSynced({
      page: currentPage,
      totalPages: pageData.totalPages,
      pageSuccessCount,
      pageFailCount,
      totalAnalyzed,
      totalUpdated,
      totalFailed,
      totalSkipped: skippedOnPage.length,
    });

    // Stop if user only requested specific scan IDs on current page
    if (filterSet) {
      break;
    }

    // If autoNextPage is off and not in continuousLoop, stop
    if (!getEffectiveAutoNext() && !continuousLoop) {
      break;
    }

    // If filtering by reviewStatus === 'PENDING' and items were updated to APPROVED on this page,
    // newly shifted pending scans are now on currentPage!
    const filteringPendingReview = String(filters.reviewStatus || '').toUpperCase() === 'PENDING';
    if (filteringPendingReview && pageSuccessCount > 0) {
      continue;
    }

    const isLastPage = pageData.last || currentPage + 1 >= pageData.totalPages;
    if (isLastPage || (!pageData.content.length && candidates.length === 0)) {
      if (!continuousLoop) {
        break;
      }

      // In 24/7 Overtime Continuous Looping Mode:
      passesCompleted++;
      onLoopPassComplete?.({ passesCompleted, totalAnalyzed, totalUpdated, totalFailed, totalSkipped });

      const waitSecs = Math.max(5, Number(loopInterval) || 15);
      for (let s = waitSecs; s > 0; s--) {
        if (shouldStop()) break;
        onLoopWaiting?.({
          passesCompleted,
          secondsRemaining: s,
          waitSecs,
          message: `24/7 Overtime Active · All pending & empty-item scans processed. Polling for new uploads in ${s}s… (Pass #${passesCompleted})`,
        });
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (shouldStop()) break;

      // Reset to page 0 to poll for newly uploaded scans!
      currentPage = 0;
      if (processedScanIds.size > 500) {
        const arr = Array.from(processedScanIds);
        processedScanIds.clear();
        arr.slice(-300).forEach((id) => processedScanIds.add(id));
      }
      continue;
    }

    currentPage += 1;
  }

  return {
    pagesProcessed,
    passesCompleted,
    lastPage: currentPage,
    totalAnalyzed,
    totalUpdated,
    totalFailed,
    totalSkipped,
  };
}

/**
 * POST /v1/list/scans/export/cancel/{jobId} — Cancels an active server-side Excel export job.
 */
export async function cancelServerScansExportJobV1(jobId, { configOverrides = {} } = {}) {
  if (!jobId) return { ok: false };
  const cfg = getScanApiConfig(configOverrides);
  const basePath = (cfg.v1ExportScansPath || '/v1/list/scans/export').replace(/\/+$/, '');
  const rawCancelUrl = resolveScanApiUrl(`${basePath}/cancel/${encodeURIComponent(jobId)}`, configOverrides);
  const cancelUrl = wrapWithProxyIfNeeded(rawCancelUrl, configOverrides);
  try {
    const resp = await fetch(cancelUrl, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    if (resp.ok) {
      return await resp.json();
    }
  } catch (_) {
    // Ignore network errors on cancel
  }
  return { ok: false };
}

/**
 * Helper to stream a fetch Response into a Blob while reporting byte download progress.
 */
async function readResponseBlobWithProgress(resp, onByteProgress) {
  const contentLengthHeader = resp.headers.get('Content-Length');
  const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
  if (!resp.body || typeof resp.body.getReader !== 'function') {
    const blob = await resp.blob();
    onByteProgress?.(blob.size, totalBytes || blob.size);
    return blob;
  }
  const reader = resp.body.getReader();
  const chunks = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      receivedBytes += value.byteLength;
      onByteProgress?.(receivedBytes, totalBytes);
    }
  }
  const contentType =
    resp.headers.get('Content-Type') ||
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return new Blob(chunks, { type: contentType });
}

/**
 * POST /v1/list/scans/export (with real-time percentage job tracking via /v1/list/scans/export/start,
 * /status/{jobId}, and /download/{jobId}, plus automatic fallback to direct stream) —
 * Downloads the Combined Items Excel (.xlsx) workbook generated by the backend
 * (`InvoiceExportService.exportSelectedOrFilteredScans`) for selected scan IDs and/or active filters,
 * supporting 10,000+ scans without timeout.
 */
export async function exportServerScansExcelV1({
  ids = null,
  filters = {},
  sort = 'createdAt,desc',
  limit = 100000,
  filename = 'combined-invoice-items.xlsx',
  configOverrides = {},
  onProgress,
  onJobStarted,
  signal,
} = {}) {
  const cfg = getScanApiConfig(configOverrides);
  const basePath = (cfg.v1ExportScansPath || '/v1/list/scans/export').replace(/\/+$/, '');
  const directRawUrl = resolveScanApiUrl(basePath, configOverrides);
  const startRawUrl = resolveScanApiUrl(`${basePath}/start`, configOverrides);
  const directUrl = wrapWithProxyIfNeeded(directRawUrl, configOverrides);
  const startUrl = wrapWithProxyIfNeeded(startRawUrl, configOverrides);

  const cleanFilters = {};
  Object.entries(filters || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      cleanFilters[k] = String(v).trim();
    }
  });

  const effectiveLimit =
    Array.isArray(ids) && ids.length > limit ? ids.length : limit;

  const payload = {
    ...cleanFilters,
    filters: cleanFilters,
    sort,
    limit: effectiveLimit,
  };
  if (Array.isArray(ids) && ids.length > 0) {
    payload.ids = ids.map((id) => (Number.isFinite(Number(id)) ? Number(id) : id));
  }

  const startedAt = Date.now();
  const emitProgress = (patch) => {
    if (typeof onProgress !== 'function') return;
    onProgress({
      percent: 0,
      state: 'RUNNING',
      stage: 'STARTING',
      processedScans: 0,
      totalScans: Array.isArray(ids) && ids.length > 0 ? ids.length : 0,
      totalItemRows: 0,
      fileSizeBytes: 0,
      downloadedBytes: 0,
      elapsedMs: Date.now() - startedAt,
      message: 'Starting Excel export…',
      ...patch,
    });
  };

  emitProgress({
    percent: 2,
    stage: 'STARTING',
    message:
      Array.isArray(ids) && ids.length > 0
        ? `Initializing export for ${ids.length.toLocaleString()} selected scan(s)…`
        : 'Initializing high-volume Excel export job…',
  });

  let resp = null;
  let finalTotalScans = Array.isArray(ids) && ids.length > 0 ? ids.length : 0;
  let finalTotalItems = 0;
  let usedAsyncJob = false;

  // 1. Try async real-time percentage job endpoint (/v1/list/scans/export/start)
  try {
    const startResp = await fetch(startUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (startResp.ok) {
      const startData = await startResp.json();
      const jobId = startData?.jobId;
      if (jobId) {
        usedAsyncJob = true;
        onJobStarted?.(jobId);
        const statusRawUrl = resolveScanApiUrl(
          startData.statusUrl || `${basePath}/status/${encodeURIComponent(jobId)}`,
          configOverrides
        );
        const statusUrl = wrapWithProxyIfNeeded(statusRawUrl, configOverrides);
        const downloadRawUrl = resolveScanApiUrl(
          startData.downloadUrl || `${basePath}/download/${encodeURIComponent(jobId)}`,
          configOverrides
        );
        const downloadUrl = wrapWithProxyIfNeeded(downloadRawUrl, configOverrides);

        while (true) {
          if (signal?.aborted) {
            await cancelServerScansExportJobV1(jobId, { configOverrides });
            throw new Error('Export cancelled by user');
          }

          const statusResp = await fetch(statusUrl, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal,
          });

          if (!statusResp.ok) {
            let errText = '';
            try {
              const errJson = await statusResp.json();
              errText = errJson.message || errJson.error || JSON.stringify(errJson);
            } catch (_) {
              errText = await statusResp.text().catch(() => '');
            }
            throw new Error(`Export status check failed (${statusResp.status}): ${errText.slice(0, 200)}`);
          }

          const status = await statusResp.json();
          const serverPct = Math.max(0, Math.min(100, Number(status.percent) || 0));
          finalTotalScans = Number(status.totalScans) || finalTotalScans;
          finalTotalItems = Number(status.totalItemRows) || finalTotalItems;

          if (status.state === 'FAILED') {
            throw new Error(status.error || status.message || 'Excel export job failed on server.');
          }
          if (status.state === 'CANCELLED') {
            throw new Error('Export cancelled by user');
          }

          if (status.state === 'COMPLETED' && status.downloadReady) {
            emitProgress({
              jobId,
              percent: 92,
              state: 'RUNNING',
              stage: 'DOWNLOADING',
              processedScans: finalTotalScans,
              totalScans: finalTotalScans,
              totalItemRows: finalTotalItems,
              fileSizeBytes: Number(status.fileSizeBytes) || 0,
              elapsedMs: Number(status.elapsedMs) || Date.now() - startedAt,
              message: `Workbook generated (${finalTotalScans.toLocaleString()} scans). Downloading .xlsx file…`,
            });
            break;
          }

          // Map server processing 0..100% into 3..91% of total progress
          const uiPct = Math.max(3, Math.min(91, Math.round(serverPct * 0.91)));
          emitProgress({
            jobId,
            percent: uiPct,
            state: status.state || 'RUNNING',
            stage: status.stage || 'PROCESSING',
            processedScans: Number(status.processedScans) || 0,
            totalScans: finalTotalScans,
            totalItemRows: finalTotalItems,
            fileSizeBytes: Number(status.fileSizeBytes) || 0,
            elapsedMs: Number(status.elapsedMs) || Date.now() - startedAt,
            message: status.message || 'Processing Excel workbook on server…',
          });

          await new Promise((resolve) => setTimeout(resolve, 220));
        }

        resp = await fetch(downloadUrl, {
          method: 'GET',
          headers: {
            Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream',
          },
          signal,
        });
      }
    } else if (startResp.status !== 404 && startResp.status !== 405) {
      let errText = '';
      try {
        const errJson = await startResp.json();
        errText = errJson.message || errJson.error || JSON.stringify(errJson);
      } catch (_) {
        errText = await startResp.text().catch(() => '');
      }
      throw new Error(`Export Excel failed (${startResp.status}): ${errText.slice(0, 220)}`);
    }
  } catch (err) {
    if (signal?.aborted || err.name === 'AbortError' || /cancelled/i.test(err.message || '')) {
      throw new Error('Export cancelled by user');
    }
    if (usedAsyncJob) {
      throw err;
    }
    // Fall through to direct synchronous export endpoint if /start is not available
  }

  // 2. Fallback: Direct synchronous POST /v1/list/scans/export with simulated progress until stream starts
  if (!resp) {
    let simPct = 8;
    const simTimer = setInterval(() => {
      simPct = Math.min(85, simPct + (simPct < 45 ? 6 : simPct < 70 ? 3 : 1));
      emitProgress({
        percent: simPct,
        stage: simPct < 35 ? 'QUERYING_SCANS' : simPct < 60 ? 'LOADING_ITEMS' : 'WRITING_ROWS',
        processedScans: 0,
        totalScans: finalTotalScans,
        message:
          simPct < 35
            ? 'Querying matching scans from server database…'
            : simPct < 60
            ? 'Loading & merging saved line items…'
            : 'Building & formatting Excel (.xlsx) rows…',
      });
    }, 300);

    try {
      resp = await fetch(directUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/json',
        },
        body: JSON.stringify(payload),
        signal,
      });
    } finally {
      clearInterval(simTimer);
    }
  }

  if (!resp.ok) {
    let errText = '';
    try {
      const errJson = await resp.json();
      errText = errJson.message || errJson.error || JSON.stringify(errJson);
    } catch (_) {
      errText = await resp.text().catch(() => '');
    }
    throw new Error(`Export Excel failed (${resp.status}): ${errText.slice(0, 220)}`);
  }

  const headerScanCount = parseInt(resp.headers.get('X-Export-Scan-Count') || '0', 10);
  if (headerScanCount > 0) {
    finalTotalScans = headerScanCount;
  }

  const blob = await readResponseBlobWithProgress(resp, (receivedBytes, totalBytes) => {
    const dlRatio = totalBytes > 0 ? Math.min(1, receivedBytes / totalBytes) : 0.5;
    const pct = Math.min(99, 92 + Math.round(dlRatio * 7));
    emitProgress({
      percent: pct,
      stage: 'DOWNLOADING',
      processedScans: finalTotalScans,
      totalScans: finalTotalScans,
      totalItemRows: finalTotalItems,
      fileSizeBytes: totalBytes || receivedBytes,
      downloadedBytes: receivedBytes,
      message:
        totalBytes > 0
          ? `Downloading workbook (${(receivedBytes / 1024).toFixed(0)} KB / ${(totalBytes / 1024).toFixed(0)} KB)…`
          : `Downloading workbook (${(receivedBytes / 1024).toFixed(0)} KB)…`,
    });
  });

  let downloadName = filename || 'combined-invoice-items.xlsx';
  const disposition = resp.headers.get('Content-Disposition');
  if (disposition) {
    const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
    if (match && match[1]) {
      downloadName = decodeURIComponent(match[1]);
    }
  }

  emitProgress({
    percent: 100,
    state: 'COMPLETED',
    stage: 'COMPLETED',
    processedScans: finalTotalScans,
    totalScans: finalTotalScans,
    totalItemRows: finalTotalItems,
    fileSizeBytes: blob.size,
    downloadedBytes: blob.size,
    message: `Export complete · ${downloadName} (${(blob.size / 1024).toFixed(1)} KB)`,
  });

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  }

  return {
    ok: true,
    filename: downloadName,
    size: blob.size,
    totalScans: finalTotalScans,
    totalItemRows: finalTotalItems,
  };
}
