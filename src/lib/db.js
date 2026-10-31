/* In-memory store (Zero IndexedDB storage)
 * Purpose: Request -> Analyze -> Update pipeline without local database storage.
 */

// If any legacy IndexedDB database exists in the browser, clean it up
if (typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined') {
  try {
    window.indexedDB.deleteDatabase('invoice_analyzer');
  } catch (_) {}
}

const memoryStores = {
  invoices: new Map(),
  queue: new Map(),
  meta: new Map(),
};

function getStore(name) {
  if (!memoryStores[name]) {
    memoryStores[name] = new Map();
  }
  return memoryStores[name];
}

export function openDb() {
  return Promise.resolve(true);
}

export const put = (name, rec) => {
  const store = getStore(name);
  const id = rec?.id ?? rec?.k ?? (typeof rec === 'object' ? JSON.stringify(rec) : String(rec));
  store.set(id, rec);
  return Promise.resolve(rec);
};

export const getAll = (name) => {
  const store = getStore(name);
  return Promise.resolve(Array.from(store.values()));
};

export const get = (name, id) => {
  const store = getStore(name);
  return Promise.resolve(store.get(id));
};

export const del = (name, id) => {
  const store = getStore(name);
  store.delete(id);
  return Promise.resolve();
};

export const clearStore = (name) => {
  const store = getStore(name);
  store.clear();
  return Promise.resolve();
};

export const metaGet = (k) => {
  try {
    const raw = localStorage.getItem(`meta_${k}`);
    if (raw !== null) {
      return Promise.resolve(JSON.parse(raw));
    }
  } catch (_) {}
  const store = getStore('meta');
  const r = store.get(k);
  return Promise.resolve(r ? r.v : undefined);
};

export const metaSet = (k, v) => {
  try {
    localStorage.setItem(`meta_${k}`, JSON.stringify(v));
  } catch (_) {}
  const store = getStore('meta');
  store.set(k, { k, v });
  return Promise.resolve({ k, v });
};

/* Settings in localStorage (with Vite env var fallbacks for Vercel deployment) */
const SET_KEY = "invoice_analyzer_settings";

export const DEFAULT_AI_SETTINGS = {
  base: "https://interpretation-let-performed-healing.trycloudflare.com/v1",
  key: "sk-aab807185cc210e9-604bd1-ce13645d",
  model: "antigravity/gemini-3.8-flash-low",
  apiServerBase: "http://45.201.196.19:3002",
  v1ContinuousLoop: false,
  v1LoopInterval: 15,
  v1ReanalyzeEmptyItems: true,
  v1TargetMode: "pending_and_empty",
};

export function getSettings(){
  let saved = {};
  try{ saved = JSON.parse(localStorage.getItem(SET_KEY)) || {}; }catch(e){ saved = {}; }
  const env = (typeof import.meta !== "undefined" && import.meta.env) ? import.meta.env : {};

  let savedBase = (saved.base || "").trim();
  if (savedBase.includes("gorgeous-sought-testing-runs")) {
    savedBase = DEFAULT_AI_SETTINGS.base;
  }
  const effectiveBase = (savedBase || env.VITE_AI_API_BASE || DEFAULT_AI_SETTINGS.base || "").trim();
  const effectiveKey = (saved.key || env.VITE_AI_API_KEY || DEFAULT_AI_SETTINGS.key || "").trim();
  const effectiveModel = (saved.model || env.VITE_AI_MODEL || DEFAULT_AI_SETTINGS.model || "").trim();
  const effectiveApiServerBase = (saved.apiServerBase || env.VITE_API_SERVER_BASE || DEFAULT_AI_SETTINGS.apiServerBase || "").trim();
  const effectiveContinuousLoop = saved.v1ContinuousLoop !== undefined ? !!saved.v1ContinuousLoop : DEFAULT_AI_SETTINGS.v1ContinuousLoop;
  const effectiveLoopInterval = Number(saved.v1LoopInterval || DEFAULT_AI_SETTINGS.v1LoopInterval) || 15;
  const effectiveReanalyzeEmptyItems = saved.v1ReanalyzeEmptyItems !== undefined ? !!saved.v1ReanalyzeEmptyItems : DEFAULT_AI_SETTINGS.v1ReanalyzeEmptyItems;
  const effectiveTargetMode = saved.v1TargetMode || DEFAULT_AI_SETTINGS.v1TargetMode;

  return {
    ...saved,
    base: effectiveBase,
    key: effectiveKey,
    model: effectiveModel,
    apiServerBase: effectiveApiServerBase,
    v1ContinuousLoop: effectiveContinuousLoop,
    v1LoopInterval: effectiveLoopInterval,
    v1ReanalyzeEmptyItems: effectiveReanalyzeEmptyItems,
    v1TargetMode: effectiveTargetMode,
  };
}
export function saveSettings(partialOrFull = {}) {
  let existing = {};
  try {
    existing = JSON.parse(localStorage.getItem(SET_KEY)) || {};
  } catch (e) {
    existing = {};
  }
  const current = getSettings();
  const merged = {
    ...current,
    ...existing,
    ...partialOrFull,
  };
  localStorage.setItem(SET_KEY, JSON.stringify(merged));
  return merged;
}
