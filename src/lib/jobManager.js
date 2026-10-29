/* Global Background Job Runner + Persistent IndexedDB State for:
 * 1) Server Scans (/v1) AI Analyze & Auto-Next-Page Sync Job
 * 2) Local Batch Queue AI Extraction Job
 *
 * Continues running when switching tabs inside the app, and persists live state
 * in IndexedDB (`meta` store) so refreshing or re-opening the page automatically
 * restores & resumes active jobs without losing progress.
 */
import { getAll, put, metaGet, metaSet, getSettings } from './db.js';
import {
  getScanApiConfig,
  analyzeAndSyncScansPages,
  fetchScansPage,
  resolveScanImageUrl,
} from './scanApi.js';
import { extractWithAI, isAiAccessibilityError } from './ai.js';
import { blobToDataUrl, uid } from './util.js';

const SERVER_JOB_META_KEY = 'serverScanJobState_v1';
const LOCAL_QUEUE_META_KEY = 'localQueueJobState_v1';

const listeners = new Set();
let wakeLockSentinel = null;
let initialized = false;

async function acquireWakeLock() {
  try {
    if (typeof navigator !== 'undefined' && navigator.wakeLock && !wakeLockSentinel) {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => {
        wakeLockSentinel = null;
      });
    }
  } catch (_) {
    // WakeLock not supported or permission denied — ignore
  }
}

async function releaseWakeLockIfIdle() {
  if (!serverJobState.running && !localQueueState.running && wakeLockSentinel) {
    try {
      await wakeLockSentinel.release();
    } catch (_) {}
    wakeLockSentinel = null;
  }
}

// Default in-memory state for Server Scans (/v1) job
let serverJobState = {
  running: false,
  paused: false,
  stopping: false,
  autoPausedReason: null,
  startedAt: null,
  updatedAt: null,
  page: 0,
  size: '50',
  sort: 'createdAt,desc',
  filters: {
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
  },
  updateMode: 'single',
  autoNextPage: true,
  skipApproved: false,
  continuousLoop: false,
  loopInterval: 15,
  reanalyzeEmptyItems: true,
  targetMode: 'pending_and_empty',
  waitingNextPass: false,
  nextPassCountdown: null,
  passesCompleted: 0,
  onlyScanIds: null,
  stats: {
    analyzed: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    pagesProcessed: 0,
    currentScanIndex: 0,
    totalOnPage: 0,
    bannerMsg: '',
  },
  etaMs: null,
  activeScan: null, // { id, imageUrl, invoiceNo, dealerCode, vehicleCode, stage, itemsCount, ms }
  scanStatuses: {}, // { [scanId]: { stage, message, itemsCount, invoiceNo, ms, error } }
  activityFeed: [], // [{ id, ts, scanId, invoiceNo, dealerCode, itemsCount, stage, message, ms }]
  lastPageData: null,
};

// Default in-memory state for Local Batch Queue job
let localQueueState = {
  running: false,
  paused: false,
  stopping: false,
  autoPausedReason: null,
  chunk: '25',
  chunkCustom: '25',
  etaMs: null,
  okCount: 0,
  errCount: 0,
  currentFile: null,
};

const serverTimings = [];
const queueTimings = [];
let serverStopFlag = false;
let serverPauseFlag = false;

function emitChange() {
  const snapshot = getJobManagerSnapshot();
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch (_) {}
  });
}

export function getJobManagerSnapshot() {
  return {
    serverJob: {
      ...serverJobState,
      stats: { ...serverJobState.stats },
      scanStatuses: { ...serverJobState.scanStatuses },
      activityFeed: [...serverJobState.activityFeed],
    },
    localQueue: { ...localQueueState },
  };
}

export function subscribeJobManager(listener) {
  listeners.add(listener);
  listener(getJobManagerSnapshot());
  return () => listeners.delete(listener);
}

async function persistServerJobState(overrides = {}) {
  serverJobState = {
    ...serverJobState,
    ...overrides,
    updatedAt: new Date().toISOString(),
  };
  emitChange();
  try {
    // Keep at most 150 scanStatuses and 30 activityFeed items in IndexedDB to stay fast
    const statusEntries = Object.entries(serverJobState.scanStatuses || {});
    const trimmedStatuses = Object.fromEntries(statusEntries.slice(-150));
    const toStore = {
      ...serverJobState,
      scanStatuses: trimmedStatuses,
      activityFeed: (serverJobState.activityFeed || []).slice(0, 30),
      lastPageData: null, // Avoid storing full page payload in meta
    };
    await metaSet(SERVER_JOB_META_KEY, toStore);
  } catch (_) {}
}

function pushActivityEvent(evt) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    ts: new Date().toLocaleTimeString([], { hour12: false }),
    scanId: evt.scanId,
    invoiceNo: evt.invoiceNo || evt.scan?.invoiceNo || null,
    dealerCode: evt.scan?.dealerCode || null,
    itemsCount: evt.itemsCount ?? null,
    stage: evt.stage,
    message: evt.message,
    ms: evt.ms || null,
  };
  serverJobState.activityFeed = [entry, ...(serverJobState.activityFeed || [])].slice(0, 30);
}

/**
 * Updates UI filter/pagination configuration in the persistent server job state
 * so even when the user refreshes the page while idle, their filters & page are preserved.
 * If a job is actively running, we avoid mutating the active job's processing page.
 */
export async function saveServerViewConfig(partial = {}) {
  if (serverJobState.running) {
    const { page, ...rest } = partial;
    if (Object.keys(rest).length > 0) {
      await persistServerJobState(rest);
    }
    return;
  }
  await persistServerJobState(partial);
}

/**
 * Dynamically switches POST mode ('single' | 'batch' | 'both') while a job is running or idle.
 */
export async function setServerJobUpdateMode(mode) {
  if (!mode) return;
  serverJobState.updateMode = mode;
  await persistServerJobState({ updateMode: mode });
  emitChange();
}

/**
 * Dynamically updates batch concurrency (e.g. 1 to 5 concurrent AI analyses).
 */
export async function setServerJobBatchConcurrency(concurrency) {
  const c = Math.max(1, Math.min(5, Number(concurrency) || 3));
  serverJobState.batchConcurrency = c;
  await persistServerJobState({ batchConcurrency: c });
  emitChange();
}

/**
 * Starts or resumes the Server Scans (/v1) AI Analyze & Sync job in the background.
 */
export async function startServerScanJob({
  page,
  size,
  sort,
  filters,
  updateMode,
  autoNextPage,
  skipApproved,
  continuousLoop,
  loopInterval,
  reanalyzeEmptyItems,
  targetMode,
  onlyScanIds = null,
  isResume = false,
  onToast,
  onRecordsChanged,
  onNeedSettings,
} = {}) {
  if (serverJobState.running) return;

  const s = getSettings();
  if (!s.base?.trim()) {
    onToast?.('Please configure your AI API Base URL in Settings to analyze scans.', true);
    onNeedSettings?.();
    return;
  }

  const cfg = getScanApiConfig();
  const startPage = page !== undefined ? Number(page) || 0 : Number(serverJobState.page) || 0;
  const effectiveSize = size ?? serverJobState.size ?? cfg.v1PageSize ?? '50';
  const effectiveSort = sort ?? serverJobState.sort ?? 'createdAt,desc';
  const effectiveFilters = filters ?? serverJobState.filters ?? {};
  const effectiveUpdateMode = updateMode ?? serverJobState.updateMode ?? cfg.v1UpdateMode ?? 'single';
  const effectiveAutoNext = autoNextPage !== undefined ? !!autoNextPage : !!serverJobState.autoNextPage;
  const effectiveSkipApproved =
    skipApproved !== undefined
      ? !!skipApproved
      : serverJobState.skipApproved !== undefined
      ? !!serverJobState.skipApproved
      : !!cfg.v1SkipApproved;
  const effectiveContinuousLoop =
    continuousLoop !== undefined
      ? !!continuousLoop
      : serverJobState.continuousLoop !== undefined
      ? !!serverJobState.continuousLoop
      : !!cfg.v1ContinuousLoop;
  const effectiveLoopInterval =
    Number(loopInterval ?? serverJobState.loopInterval ?? cfg.v1LoopInterval) || 15;
  const effectiveReanalyzeEmptyItems =
    reanalyzeEmptyItems !== undefined
      ? !!reanalyzeEmptyItems
      : serverJobState.reanalyzeEmptyItems !== undefined
      ? !!serverJobState.reanalyzeEmptyItems
      : cfg.v1ReanalyzeEmptyItems !== undefined
      ? !!cfg.v1ReanalyzeEmptyItems
      : true;
  const effectiveTargetMode =
    targetMode || serverJobState.targetMode || cfg.v1TargetMode || 'pending_and_empty';

  serverStopFlag = false;
  serverPauseFlag = false;

  const baseStats = isResume
    ? {
        ...serverJobState.stats,
        bannerMsg: effectiveContinuousLoop
          ? `Resumed 24/7 Overtime Runner on page ${startPage + 1}…`
          : `Resumed /v1 scan analysis on page ${startPage + 1}…`,
      }
    : {
        analyzed: 0,
        updated: 0,
        failed: 0,
        skipped: 0,
        pagesProcessed: 0,
        currentScanIndex: 0,
        totalOnPage: 0,
        bannerMsg: effectiveContinuousLoop
          ? 'Starting 24/7 Overtime Continuous AI Runner…'
          : 'Starting /v1 scan AI pipeline…',
      };

  await persistServerJobState({
    running: true,
    paused: false,
    stopping: false,
    autoPausedReason: null,
    startedAt: isResume && serverJobState.startedAt ? serverJobState.startedAt : new Date().toISOString(),
    page: startPage,
    size: effectiveSize,
    sort: effectiveSort,
    filters: effectiveFilters,
    updateMode: effectiveUpdateMode,
    autoNextPage: onlyScanIds ? false : effectiveAutoNext,
    skipApproved: effectiveSkipApproved,
    continuousLoop: effectiveContinuousLoop,
    loopInterval: effectiveLoopInterval,
    reanalyzeEmptyItems: effectiveReanalyzeEmptyItems,
    targetMode: effectiveTargetMode,
    waitingNextPass: false,
    nextPassCountdown: null,
    onlyScanIds,
    stats: baseStats,
  });

  await acquireWakeLock();

  const sessionAnalyzedIds = new Set();
  const sessionUpdatedIds = new Set();

  try {
    const summary = await analyzeAndSyncScansPages({
      startPage,
      size: effectiveSize,
      sort: effectiveSort,
      filters: effectiveFilters,
      updateMode: effectiveUpdateMode,
      getUpdateMode: () => serverJobState.updateMode,
      batchConcurrency: serverJobState.batchConcurrency || 3,
      getBatchConcurrency: () => serverJobState.batchConcurrency || 3,
      autoNextPage: onlyScanIds ? false : effectiveAutoNext,
      getAutoNextPage: () => (onlyScanIds ? false : serverJobState.autoNextPage),
      skipApproved: effectiveSkipApproved,
      getSkipApproved: () => serverJobState.skipApproved,
      targetMode: effectiveTargetMode,
      reanalyzeEmptyItems: effectiveReanalyzeEmptyItems,
      continuousLoop: effectiveContinuousLoop,
      loopInterval: effectiveLoopInterval,
      onlyScanIds,
      shouldStop: () => serverStopFlag || serverPauseFlag,
      onPageLoaded: (loadedPageData, loadedPageIndex) => {
        serverJobState.lastPageData = loadedPageData;
        persistServerJobState({
          page: loadedPageIndex,
          waitingNextPass: false,
          nextPassCountdown: null,
          stats: {
            ...serverJobState.stats,
            bannerMsg: `Loaded page ${loadedPageIndex + 1} of ${loadedPageData.totalPages} (${loadedPageData.content.length} scans)…`,
          },
        });
      },
      onScanProgress: (evt) => {
        if (evt.scanId != null) {
          serverJobState.scanStatuses = {
            ...serverJobState.scanStatuses,
            [evt.scanId]: {
              stage: evt.stage,
              message: evt.message,
              itemsCount: evt.itemsCount,
              invoiceNo: evt.invoiceNo,
              ms: evt.ms,
              error: evt.error,
            },
          };
          serverJobState.activeScan = {
            id: evt.scanId,
            imageUrl: evt.scan ? resolveScanImageUrl(evt.scan) : null,
            invoiceNo: evt.invoiceNo || evt.scan?.invoiceNo || null,
            dealerCode: evt.scan?.dealerCode || null,
            vehicleCode: evt.scan?.vehicleCode || null,
            originalFilename: evt.scan?.originalFilename || null,
            stage: evt.stage,
            itemsCount: evt.itemsCount ?? null,
            ms: evt.ms ?? null,
            message: evt.message,
            indexOnPage: (evt.indexOnPage ?? 0) + 1,
            totalOnPage: evt.totalOnPage ?? 1,
          };
        }

        if (evt.ms) {
          serverTimings.push(evt.ms);
          if (serverTimings.length > 12) serverTimings.shift();
          const avg = serverTimings.reduce((a, b) => a + b, 0) / serverTimings.length;
          serverJobState.etaMs = avg;
        }

        if (evt.scan && evt.scanId != null && serverJobState.lastPageData) {
          serverJobState.lastPageData = {
            ...serverJobState.lastPageData,
            content: serverJobState.lastPageData.content.map((row) =>
              String(row.id) === String(evt.scanId)
                ? {
                    ...row,
                    ...evt.scan,
                    imageUrl: resolveScanImageUrl(evt.scan || row),
                    invoiceNo: evt.invoiceNo || evt.scan.invoiceNo || row.invoiceNo,
                    dealerCode: evt.scan?.dealerCode || row.dealerCode,
                    reviewStatus: evt.stage === 'updated' ? 'APPROVED' : row.reviewStatus,
                    status: evt.stage === 'updated' ? 'COMPLETED' : row.status,
                  }
                : row
            ),
          };
        }

        if (
          evt.stage === 'updated' ||
          evt.stage === 'error' ||
          evt.stage === 'batch_posting' ||
          evt.stage === 'skipped'
        ) {
          pushActivityEvent(evt);
        }

        const nextStats = {
          ...serverJobState.stats,
          currentScanIndex: (evt.indexOnPage ?? serverJobState.stats.currentScanIndex) + 1,
          totalOnPage: evt.totalOnPage ?? serverJobState.stats.totalOnPage,
          bannerMsg: evt.message || serverJobState.stats.bannerMsg,
        };

        if (evt.scanId != null) {
          const sId = String(evt.scanId);
          if (evt.stage === 'analyzed' || evt.stage === 'updated') {
            if (!sessionAnalyzedIds.has(sId)) {
              sessionAnalyzedIds.add(sId);
              nextStats.analyzed = (serverJobState.stats.analyzed || 0) + 1;
            }
          }
          if (evt.stage === 'updated') {
            if (!sessionUpdatedIds.has(sId)) {
              sessionUpdatedIds.add(sId);
              nextStats.updated = (serverJobState.stats.updated || 0) + 1;
            }
          } else if (evt.stage === 'error') {
            nextStats.failed = (serverJobState.stats.failed || 0) + 1;
          }
        } else if (evt.stage === 'skipped') {
          nextStats.skipped = (serverJobState.stats.skipped || 0) + (evt.count || 1);
        }

        persistServerJobState({
          stats: nextStats,
          waitingNextPass: false,
          nextPassCountdown: null,
        });

        if (evt.stage === 'updated' || evt.stage === 'analyzed') {
          onRecordsChanged?.();
        }
      },
      onPageSynced: (info) => {
        let syncMsg = `Page ${info.page + 1}/${info.totalPages} synced (${info.pageSuccessCount} updated, ${info.pageFailCount} failed`;
        if (info.totalSkipped) {
          syncMsg += `, ${info.totalSkipped} skipped`;
        }
        syncMsg += ')';
        if (info.totalSkipped > 0 && info.pageSuccessCount === 0 && info.pageFailCount === 0) {
          syncMsg = `Page ${info.page + 1}/${info.totalPages}: Skipped ${info.totalSkipped} approved scan(s)`;
        }

        persistServerJobState({
          page: info.page,
          stats: {
            ...serverJobState.stats,
            pagesProcessed: (serverJobState.stats.pagesProcessed || 0) + 1,
            bannerMsg: syncMsg,
          },
        });
      },
      onLoopWaiting: (waitInfo) => {
        persistServerJobState({
          waitingNextPass: true,
          nextPassCountdown: waitInfo.secondsRemaining,
          stats: {
            ...serverJobState.stats,
            bannerMsg: waitInfo.message,
          },
        });
      },
      onLoopPassComplete: (passInfo) => {
        persistServerJobState({
          passesCompleted: passInfo.passesCompleted,
        });
      },
    });

    const wasPaused = serverPauseFlag;
    const wasStopped = serverStopFlag;

    // Refresh final page data so UI table is up to date
    try {
      const refreshed = await fetchScansPage({
        page: summary.lastPage,
        size: effectiveSize,
        sort: effectiveSort,
        filters: effectiveFilters,
      });
      serverJobState.lastPageData = refreshed;
    } catch (_) {}

    const skipSummary = serverJobState.stats.skipped
      ? ` (${serverJobState.stats.skipped} already APPROVED skipped)`
      : '';

    await persistServerJobState({
      running: false,
      paused: wasPaused,
      stopping: false,
      waitingNextPass: false,
      nextPassCountdown: null,
      page: summary.lastPage,
      onlyScanIds: null,
      activeScan: null,
      stats: {
        ...serverJobState.stats,
        bannerMsg: wasPaused
          ? `Paused on page ${summary.lastPage + 1} (${serverJobState.stats.updated} updated so far)`
          : wasStopped
          ? `Stopped — ${serverJobState.stats.updated} scan(s) updated to APPROVED${skipSummary}`
          : `Completed — ${serverJobState.stats.updated} scan(s) updated to APPROVED${skipSummary}`,
      },
    });

    if (wasPaused) {
      onToast?.(`Job paused — ${serverJobState.stats.updated} scan(s) updated so far`);
    } else if (wasStopped) {
      onToast?.(`Stopped — ${serverJobState.stats.updated} scan(s) updated to APPROVED${skipSummary}`);
    } else {
      const skipToast = serverJobState.stats.skipped
        ? `, ${serverJobState.stats.skipped} skipped`
        : '';
      onToast?.(
        `Finished — ${serverJobState.stats.updated} scan(s) updated to APPROVED${skipToast}` +
          (serverJobState.stats.failed ? `, ${serverJobState.stats.failed} failed` : ''),
        serverJobState.stats.failed > 0
      );
    }
  } catch (err) {
    const isAiErr = isAiAccessibilityError(err);
    if (isAiErr) {
      // Auto-pause immediately to prevent failing all subsequent scans
      await persistServerJobState({
        running: false,
        paused: true,
        stopping: false,
        autoPausedReason: err.message || 'Unable to access AI API',
        activeScan: null,
        stats: {
          ...serverJobState.stats,
          bannerMsg: `Auto-Paused: Unable to reach AI API (${err.message}). Check Settings and click Resume.`,
        },
      });
      onToast?.(`Auto-paused: Unable to reach AI Base URL (${err.message})`, true);
      onNeedSettings?.();
    } else {
      await persistServerJobState({
        running: false,
        paused: false,
        stopping: false,
        autoPausedReason: null,
        activeScan: null,
        stats: {
          ...serverJobState.stats,
          bannerMsg: `Error: ${err.message}`,
        },
      });
      onToast?.('Batch sync error: ' + err.message, true);
    }
  } finally {
    await releaseWakeLockIfIdle();
  }
}

export async function pauseServerScanJob(onToast) {
  if (!serverJobState.running) return;
  serverPauseFlag = true;
  await persistServerJobState({
    paused: true,
    stopping: true,
    stats: {
      ...serverJobState.stats,
      bannerMsg: 'Pausing after current scan finishes…',
    },
  });
  onToast?.('Pausing after current scan…');
}

export async function stopServerScanJob(onToast) {
  serverStopFlag = true;
  serverPauseFlag = false;
  if (!serverJobState.running) {
    await persistServerJobState({
      running: false,
      paused: false,
      stopping: false,
      autoPausedReason: null,
      onlyScanIds: null,
      activeScan: null,
    });
    return;
  }
  await persistServerJobState({
    paused: false,
    stopping: true,
    autoPausedReason: null,
    stats: {
      ...serverJobState.stats,
      bannerMsg: 'Stopping after current scan finishes…',
    },
  });
  onToast?.('Stopping after current scan…');
}

export async function clearServerJobHistory() {
  serverJobState.scanStatuses = {};
  serverJobState.activityFeed = [];
  serverJobState.autoPausedReason = null;
  serverJobState.stats = {
    analyzed: 0,
    updated: 0,
    failed: 0,
    pagesProcessed: 0,
    currentScanIndex: 0,
    totalOnPage: 0,
    bannerMsg: '',
  };
  await persistServerJobState({});
}

/* ============================================================================
 * Local Batch Queue Background Runner (persists across tabs & page refreshes)
 * ============================================================================ */

let localQueueCancelFlag = false;
let localQueuePauseFlag = false;

async function persistLocalQueueState(overrides = {}) {
  localQueueState = {
    ...localQueueState,
    ...overrides,
  };
  emitChange();
  try {
    await metaSet(LOCAL_QUEUE_META_KEY, {
      running: localQueueState.running,
      paused: localQueueState.paused,
      autoPausedReason: localQueueState.autoPausedReason || null,
      chunk: localQueueState.chunk,
      chunkCustom: localQueueState.chunkCustom,
    });
    await metaSet('wasRunning', localQueueState.running);
  } catch (_) {}
}

export async function startLocalQueueJob({
  onToast,
  onRecordsChanged,
  onNeedSettings,
  onQueueUpdated,
} = {}) {
  if (localQueueState.running) return;
  const s = getSettings();
  if (!s.base?.trim()) {
    onToast?.('Please configure your AI API Base URL in Settings to run the queue.', true);
    onNeedSettings?.();
    return;
  }

  const all = await getAll('queue');
  // Recover any items that were stuck in "running" state from an interrupted refresh/crash
  for (const item of all) {
    if (item.status === 'running') {
      item.status = 'pending';
      await put('queue', item);
    }
  }

  const freshAll = await getAll('queue');
  if (!freshAll.some((q) => q.status === 'pending' || q.status === 'error')) {
    onToast?.('Queue is empty — add documents first');
    return;
  }

  localQueueCancelFlag = false;
  localQueuePauseFlag = false;
  await persistLocalQueueState({
    running: true,
    paused: false,
    stopping: false,
    autoPausedReason: null,
    okCount: 0,
    errCount: 0,
  });
  await acquireWakeLock();

  let okCount = 0;
  let errCount = 0;

  try {
    while (!localQueueCancelFlag && !localQueuePauseFlag) {
      const pending = (await getAll('queue'))
        .filter((q) => q.status === 'pending')
        .sort((a, b) => String(a.path || a.name).localeCompare(String(b.path || b.name)));
      if (!pending.length) break;

      const c = localQueueState.chunk;
      const cc = localQueueState.chunkCustom;
      const cs =
        c === 'all'
          ? Infinity
          : c === 'custom'
          ? Math.max(1, parseInt(cc, 10) || 25)
          : parseInt(c, 10) || 25;

      const batch = cs === Infinity ? pending : pending.slice(0, cs);

      for (const q of batch) {
        if (localQueueCancelFlag || localQueuePauseFlag) break;

        q.status = 'running';
        await put('queue', q);
        await persistLocalQueueState({ currentFile: q.name });
        onQueueUpdated?.(q);

        const t0 = performance.now();
        try {
          const dataUrl = await blobToDataUrl(q.blob);
          const rec = await extractWithAI(dataUrl);
          q.record = {
            ...rec,
            id: uid(),
            scanId: rec.scanId != null ? rec.scanId : q.scanId,
            originalFile: q.name,
            folder: q.folder,
            path: q.path,
            image: dataUrl,
            saved_at: new Date().toISOString(),
          };
          q.recordId = q.record.id;
          q.docNo = rec.no || null;
          q.itemsCount = (rec.items || []).length;
          q.status = 'done';
          q.error = null;
          okCount++;
          onRecordsChanged?.();
        } catch (err) {
          const isAiErr = isAiAccessibilityError(err);
          if (isAiErr) {
            // Revert candidate from error/running back to pending so user can resume seamlessly
            q.status = 'pending';
            q.error = `Auto-paused: ${err.message || 'Unable to access AI API'}`;
            q.ms = null;
            await put('queue', q);
            onQueueUpdated?.(q);

            localQueuePauseFlag = true;
            localQueueState.autoPausedReason = err.message || 'Unable to reach AI API';
            await persistLocalQueueState({
              running: false,
              paused: true,
              stopping: false,
              autoPausedReason: err.message || 'Unable to reach AI API',
              currentFile: null,
            });
            onToast?.(`Auto-paused queue: Unable to reach AI API (${err.message})`, true);
            onNeedSettings?.();
            break;
          }

          q.status = 'error';
          q.error = err.message || 'Extraction failed';
          errCount++;
        }

        q.ms = Math.round(performance.now() - t0);
        if (q.status === 'done') {
          queueTimings.push(q.ms);
          if (queueTimings.length > 10) queueTimings.shift();
          const avg = queueTimings.reduce((a, b) => a + b, 0) / queueTimings.length;
          localQueueState.etaMs = avg;
        }
        try {
          await put('queue', q);
        } catch (_) {}
        await persistLocalQueueState({ okCount, errCount });
        onQueueUpdated?.(q);
      }

      if (localQueueCancelFlag || localQueuePauseFlag) break;
    }
  } finally {
    const stopped = localQueueCancelFlag || localQueuePauseFlag;
    await persistLocalQueueState({
      running: false,
      paused: localQueuePauseFlag,
      stopping: false,
      currentFile: null,
    });
    await releaseWakeLockIfIdle();
    onQueueUpdated?.();
    if (!stopped) {
      onToast?.(
        `Batch finished — ${okCount} completed` + (errCount ? `, ${errCount} failed` : ''),
        errCount > 0
      );
    }
  }
}

export async function pauseLocalQueueJob(onToast) {
  if (!localQueueState.running) return;
  localQueuePauseFlag = true;
  await persistLocalQueueState({ paused: true, stopping: true });
  onToast?.('Pausing after current file…');
}

export async function cancelLocalQueueJob(onToast) {
  localQueueCancelFlag = true;
  localQueuePauseFlag = false;
  await persistLocalQueueState({ paused: false, stopping: true, autoPausedReason: null });
  onToast?.('Cancelling after current file…');
}

export async function setLocalQueueChunkConfig(chunk, chunkCustom) {
  if (chunk !== undefined) {
    localQueueState.chunk = chunk;
    await metaSet('chunk', chunk);
  }
  if (chunkCustom !== undefined) {
    localQueueState.chunkCustom = chunkCustom;
    await metaSet('chunkCustom', chunkCustom);
  }
  emitChange();
}

/**
 * Bootstraps persistent jobs on app startup:
 * - Restores Server Scans (/v1) job state & auto-resumes if it was running when the page refreshed.
 * - Restores Local Batch Queue state & auto-resumes if it was running when the page refreshed.
 */
export async function bootPersistentJobs({
  onToast,
  onRecordsChanged,
  onNeedSettings,
} = {}) {
  if (initialized) return;
  initialized = true;

  // 1. Restore Local Queue config & auto-resume if it was running before refresh
  try {
    const chunkSaved = await metaGet('chunk');
    const chunkCustomSaved = await metaGet('chunkCustom');
    const wasLocalRunning = await metaGet('wasRunning');
    const savedLocalMeta = await metaGet(LOCAL_QUEUE_META_KEY);

    localQueueState = {
      ...localQueueState,
      chunk: chunkSaved || savedLocalMeta?.chunk || '25',
      chunkCustom: String(chunkCustomSaved || savedLocalMeta?.chunkCustom || '25'),
      paused: !!savedLocalMeta?.paused,
      autoPausedReason: savedLocalMeta?.autoPausedReason || null,
    };

    // Reset any items left in 'running' state by a hard page reload
    const allQueue = await getAll('queue');
    let resetCount = 0;
    for (const q of allQueue) {
      if (q.status === 'running') {
        q.status = 'pending';
        await put('queue', q);
        resetCount++;
      }
    }

    const s = getSettings();
    const shouldResumeLocal =
      (wasLocalRunning || savedLocalMeta?.running || resetCount > 0) &&
      s.key &&
      s.base &&
      allQueue.some((q) => q.status === 'pending');

    if (shouldResumeLocal) {
      onToast?.('Auto-resuming Batch Queue after page reload…');
      setTimeout(() => {
        startLocalQueueJob({ onToast, onRecordsChanged, onNeedSettings });
      }, 250);
    }
  } catch (_) {}

  // 2. Restore Server Scans (/v1) job state & auto-resume if it was running before refresh
  try {
    const savedServerJob = await metaGet(SERVER_JOB_META_KEY);
    if (savedServerJob && typeof savedServerJob === 'object') {
      const wasRunningBeforeUnload = !!savedServerJob.running && !savedServerJob.stopping && !savedServerJob.paused;
      serverJobState = {
        ...serverJobState,
        ...savedServerJob,
        running: false,
        stopping: false,
      };
      emitChange();

      const s = getSettings();
      if (wasRunningBeforeUnload && s.base?.trim()) {
        const loopModeMsg = savedServerJob.continuousLoop ? ' in 24/7 Overtime Mode' : '';
        onToast?.(`Auto-resuming Server Scans job${loopModeMsg} on page ${(savedServerJob.page || 0) + 1}…`);
        setTimeout(() => {
          startServerScanJob({
            page: savedServerJob.page || 0,
            size: savedServerJob.size,
            sort: savedServerJob.sort,
            filters: savedServerJob.filters,
            updateMode: savedServerJob.updateMode,
            autoNextPage: savedServerJob.autoNextPage,
            skipApproved: savedServerJob.skipApproved,
            continuousLoop: savedServerJob.continuousLoop,
            loopInterval: savedServerJob.loopInterval,
            reanalyzeEmptyItems: savedServerJob.reanalyzeEmptyItems,
            targetMode: savedServerJob.targetMode,
            onlyScanIds: savedServerJob.onlyScanIds,
            isResume: true,
            onToast,
            onRecordsChanged,
            onNeedSettings,
          });
        }, 350);
      }
    }
  } catch (_) {}

  emitChange();
}
