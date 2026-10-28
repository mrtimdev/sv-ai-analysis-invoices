/* Unauthenticated /v1 Scan API client + AI Analyze & Auto-Next-Page Sync Engine */
import { getSettings, put } from './db.js';
import { extractWithAI } from './ai.js';
import { compressImage, num, uid } from './util.js';

export const DEFAULT_SCAN_API_SETTINGS = {
  apiServerBase:
    (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_SERVER_BASE) ||
    'http://localhost:8080',
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
};

/**
 * Reads the separate /v1 Scan Backend API configuration from localStorage settings.
 */
export function getScanApiConfig(overrides = {}) {
  const s = getSettings();
  let defaultOrigin = DEFAULT_SCAN_API_SETTINGS.apiServerBase;
  if (
    typeof window !== 'undefined' &&
    window.location &&
    /^https?:$/i.test(window.location.protocol) &&
    !/\.vercel\.app$/i.test(window.location.hostname) &&
    !(typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_SERVER_BASE)
  ) {
    defaultOrigin = window.location.origin;
  }
  const rawBase = (overrides.apiServerBase ?? s.apiServerBase ?? s.scanBase ?? defaultOrigin) || defaultOrigin;
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
  };
}

/**
 * Resolves an endpoint path against the configured apiServerBase.
 */
export function resolveScanApiUrl(pathOrUrl, configOverrides = {}) {
  const cfg = getScanApiConfig(configOverrides);
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return cfg.apiServerBase;
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
  const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${params.toString()}`;

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
 * Resolves the scan's `imageUrl` field from `/v1/list/scans` (with fallback to `/v1/{scanId}/scan/image`).
 */
export function resolveScanImageUrl(scan, configOverrides = {}) {
  if (scan && scan.imageUrl) {
    return resolveScanApiUrl(scan.imageUrl, configOverrides);
  }
  if (scan && scan.id != null) {
    return resolveScanApiUrl(`/v1/${encodeURIComponent(scan.id)}/scan/image`, configOverrides);
  }
  return '';
}

/**
 * GET /v1/{scanId}/scan (or /v1/scanId/scan?scanId=...) — Single scan with headers, items, and imageUrl.
 */
export async function fetchScanById(scanId, { configOverrides = {}, signal } = {}) {
  if (scanId == null || scanId === '') throw new Error('scanId is required');
  const url = buildSingleScanUrl(scanId, configOverrides);
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
  const primaryUrl = typeof scanOrImageUrl === 'object' && scanOrImageUrl !== null
    ? resolveScanImageUrl(scanOrImageUrl, configOverrides)
    : resolveScanApiUrl(scanOrImageUrl, configOverrides);
  const resolvedId = scanId ?? (typeof scanOrImageUrl === 'object' ? scanOrImageUrl?.id : null);
  const fallbackUrl = resolvedId != null
    ? resolveScanApiUrl(`/v1/${encodeURIComponent(resolvedId)}/scan/image`, configOverrides)
    : null;

  let resp;
  try {
    resp = await fetch(primaryUrl, { signal });
    if (!resp.ok && fallbackUrl && fallbackUrl !== primaryUrl) {
      resp = await fetch(fallbackUrl, { signal });
    }
  } catch (err) {
    if (fallbackUrl && fallbackUrl !== primaryUrl) {
      resp = await fetch(fallbackUrl, { signal });
    } else {
      throw new Error(`Could not fetch scan image (${primaryUrl}): ${err.message}`);
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

  const url = buildSingleScanUrl(scanId, configOverrides);
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

  return await resp.json();
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

  const url = resolveScanApiUrl(cfg.v1ListScansPath, configOverrides);
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

  return await resp.json();
}

/**
 * Analyzes a single scan object (from `/v1/list/scans` or `/v1/{scanId}/scan`) using its `imageUrl`
 * and `PROMPT` in `src/lib/ai.js`, saves a copy in local IndexedDB (`invoices`), and optionally posts
 * the single update to `POST /v1/{scanId}/scan` with `reviewStatus = "APPROVED"`.
 */
export async function analyzeOneServerScan(
  scan,
  {
    postImmediately = true,
    saveToLocalDb = true,
    configOverrides = {},
    signal,
  } = {}
) {
  if (!scan || scan.id == null) throw new Error('Invalid scan object (missing id)');
  const dataUrl = await fetchScanImageDataUrl(scan, scan.id, { configOverrides, signal });
  const extracted = await extractWithAI(dataUrl);
  const payload = buildScanUpdatePayload(scan.id, extracted, 'APPROVED');

  if (saveToLocalDb) {
    const localRecord = {
      ...extracted,
      id: `scan-${scan.id}`,
      scanId: String(scan.id),
      no: payload.invoiceNo,
      invoiceDate: payload.invoiceDate,
      dealerCode: payload.dealerCode,
      saleOrder: payload.saleOrder,
      vendorCode: payload.vendorCode,
      vehicleCode: payload.vehicleCode,
      warehouse: payload.warehouse,
      route: payload.route,
      items: payload.items,
      originalFile: scan.originalFilename || `scan-${scan.id}.jpg`,
      image: dataUrl,
      reviewStatus: 'APPROVED',
      saved_at: new Date().toISOString(),
    };
    try {
      await put('invoices', localRecord);
    } catch (_) {
      // Ignore local IndexedDB errors when running headless
    }
  }

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
 * Main End-to-End Pipeline:
 * 1. Calls `GET /v1/list/scans` for the current page.
 * 2. Accesses each scan's `imageUrl` and analyzes it with `extractWithAI` (following `PROMPT` in `src/lib/ai.js`).
 * 3. Posts the analyzed headers + items to update the scan(s) with `reviewStatus = "APPROVED"`:
 *    - `updateMode === 'single'`: posts each scan immediately via `POST /v1/{scanId}/scan`
 *    - `updateMode === 'batch'`: posts all analyzed scans on the page together via `POST /v1/list/scans`
 *    - `updateMode === 'both'`: posts each scan immediately AND sends the batch confirmation at the end of the page
 * 4. Automatically switches to the next page once the current page has been analyzed & updated to the backend,
 *    continuing until all pages are complete or stopped by the caller.
 */
export async function analyzeAndSyncScansPages({
  startPage = 0,
  size,
  sort = 'createdAt,desc',
  filters = {},
  updateMode,
  autoNextPage,
  skipApproved,
  onlyScanIds = null,
  configOverrides = {},
  shouldStop = () => false,
  onPageLoaded = () => {},
  onScanProgress = () => {},
  onPageSynced = () => {},
} = {}) {
  const cfg = getScanApiConfig(configOverrides);
  const effectiveMode = updateMode || cfg.v1UpdateMode || 'single';
  const effectiveSize = size != null ? String(size) : cfg.v1PageSize;
  const effectiveAutoNext = autoNextPage !== undefined ? !!autoNextPage : cfg.v1AutoNextPage;
  const effectiveSkipApproved = skipApproved !== undefined ? !!skipApproved : cfg.v1SkipApproved;
  const filterSet = onlyScanIds ? new Set(onlyScanIds.map((x) => String(x))) : null;

  let currentPage = Math.max(0, Number(startPage) || 0);
  let totalAnalyzed = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  let pagesProcessed = 0;
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

    if (!pageData.content.length) {
      break;
    }

    const candidates = pageData.content.filter((scan) => {
      if (filterSet && !filterSet.has(String(scan.id))) return false;
      if (effectiveSkipApproved && String(scan.reviewStatus || '').toUpperCase() === 'APPROVED') return false;
      if (processedScanIds.has(String(scan.id))) return false;
      return true;
    });

    const pagePayloads = [];
    let pageSuccessCount = 0;
    let pageFailCount = 0;

    for (let i = 0; i < candidates.length; i++) {
      if (shouldStop()) break;
      const scan = candidates[i];
      processedScanIds.add(String(scan.id));
      const t0 = performance.now();

      onScanProgress({
        scanId: scan.id,
        scan,
        page: currentPage,
        indexOnPage: i,
        totalOnPage: candidates.length,
        stage: 'analyzing',
        message: 'Fetching imageUrl & analyzing with AI…',
      });

      try {
        const postSingleNow = effectiveMode === 'single' || effectiveMode === 'both';
        const result = await analyzeOneServerScan(scan, {
          postImmediately: postSingleNow,
          saveToLocalDb: true,
          configOverrides,
        });

        pagePayloads.push(result.payload);
        totalAnalyzed++;
        pageSuccessCount++;
        if (postSingleNow) {
          totalUpdated++;
        }

        const elapsedMs = Math.round(performance.now() - t0);
        onScanProgress({
          scanId: scan.id,
          scan: result.updatedScan || {
            ...scan,
            ...result.payload,
            reviewStatus: 'APPROVED',
          },
          page: currentPage,
          indexOnPage: i,
          totalOnPage: candidates.length,
          stage: postSingleNow ? 'updated' : 'analyzed',
          itemsCount: result.payload.items.length,
          invoiceNo: result.payload.invoiceNo,
          ms: elapsedMs,
          message: postSingleNow
            ? `Approved & saved (${result.payload.items.length} items)`
            : `Analyzed (${result.payload.items.length} items) — pending batch POST`,
        });
      } catch (err) {
        totalFailed++;
        pageFailCount++;
        onScanProgress({
          scanId: scan.id,
          scan,
          page: currentPage,
          indexOnPage: i,
          totalOnPage: candidates.length,
          stage: 'error',
          error: err.message || 'Analysis failed',
          message: err.message || 'Analysis failed',
        });
        if (err.message === 'NO_SETTINGS') {
          throw err;
        }
      }
    }

    if (shouldStop()) break;

    // If batch mode (or 'both') is active and we have analyzed payloads on this page, POST /v1/list/scans
    let batchResponse = null;
    if ((effectiveMode === 'batch' || effectiveMode === 'both') && pagePayloads.length > 0) {
      onScanProgress({
        scanId: null,
        page: currentPage,
        stage: 'batch_posting',
        message: `Batch updating ${pagePayloads.length} scan(s) via POST ${cfg.v1ListScansPath}…`,
      });
      batchResponse = await batchUpdateScansV1(pagePayloads, { configOverrides });
      if (effectiveMode === 'batch') {
        totalUpdated += pagePayloads.length;
      }
      const updatedList = batchResponse?.content || batchResponse?.scans || [];
      updatedList.forEach((u) => {
        onScanProgress({
          scanId: u.id,
          scan: u,
          page: currentPage,
          stage: 'updated',
          itemsCount: Array.isArray(u.items) ? u.items.length : undefined,
          invoiceNo: u.invoiceNo,
          message: 'Batch updated (APPROVED)',
        });
      });
    }

    pagesProcessed++;
    onPageSynced({
      page: currentPage,
      totalPages: pageData.totalPages,
      pageSuccessCount,
      pageFailCount,
      totalAnalyzed,
      totalUpdated,
      totalFailed,
      batchResponse,
    });

    // Stop if user only requested specific scan IDs on the current page or if autoNextPage is off
    if (!effectiveAutoNext || filterSet) {
      break;
    }

    // Determine next page:
    // If filtering by reviewStatus === 'PENDING' and at least one scan on this page was updated to APPROVED,
    // remaining PENDING scans shift into the current page index; otherwise advance to currentPage + 1.
    const filteringPendingReview = String(filters.reviewStatus || '').toUpperCase() === 'PENDING';
    if (filteringPendingReview && pageSuccessCount > 0) {
      // Stay on currentPage to pick up newly shifted PENDING scans, unless no more items exist
      continue;
    }

    if (pageData.last || currentPage + 1 >= pageData.totalPages) {
      break;
    }
    currentPage += 1;
  }

  return {
    pagesProcessed,
    lastPage: currentPage,
    totalAnalyzed,
    totalUpdated,
    totalFailed,
  };
}

/**
 * POST /v1/list/scans/export/cancel/{jobId} — Cancels an active server-side Excel export job.
 */
export async function cancelServerScansExportJobV1(jobId, { configOverrides = {} } = {}) {
  if (!jobId) return { ok: false };
  const cfg = getScanApiConfig(configOverrides);
  const basePath = (cfg.v1ExportScansPath || '/v1/list/scans/export').replace(/\/+$/, '');
  const cancelUrl = resolveScanApiUrl(`${basePath}/cancel/${encodeURIComponent(jobId)}`, configOverrides);
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
  const directUrl = resolveScanApiUrl(basePath, configOverrides);
  const startUrl = resolveScanApiUrl(`${basePath}/start`, configOverrides);

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
        const statusUrl = resolveScanApiUrl(
          startData.statusUrl || `${basePath}/status/${encodeURIComponent(jobId)}`,
          configOverrides
        );
        const downloadUrl = resolveScanApiUrl(
          startData.downloadUrl || `${basePath}/download/${encodeURIComponent(jobId)}`,
          configOverrides
        );

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
