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
