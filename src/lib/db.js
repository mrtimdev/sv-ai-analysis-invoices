/* IndexedDB: invoices, queue, meta stores (v2 — same schema as previous app so existing data survives) */

let db = null;

export function openDb(){
  if(db) return Promise.resolve(db);
  return new Promise((res, rej)=>{
    const r = indexedDB.open("invoice_analyzer", 2);
    r.onupgradeneeded = ()=>{
      const d = r.result;
      if(!d.objectStoreNames.contains("invoices")) d.createObjectStore("invoices", {keyPath:"id"});
      if(!d.objectStoreNames.contains("queue")) d.createObjectStore("queue", {keyPath:"id"});
      if(!d.objectStoreNames.contains("meta")) d.createObjectStore("meta", {keyPath:"k"});
    };
    r.onsuccess = ()=>{ db = r.result; res(db); };
    r.onerror = ()=> rej(r.error);
  });
}

const st = (name, mode)=> db.transaction(name, mode).objectStore(name);
export const put = (name, rec)=> new Promise((res,rej)=>{ const q = st(name,"readwrite").put(rec); q.onsuccess=()=>res(rec); q.onerror=()=>rej(q.error); });
export const getAll = (name)=> new Promise((res,rej)=>{ const q = st(name,"readonly").getAll(); q.onsuccess=()=>res(q.result||[]); q.onerror=()=>rej(q.error); });
export const get = (name, id)=> new Promise((res,rej)=>{ const q = st(name,"readonly").get(id); q.onsuccess=()=>res(q.result); q.onerror=()=>rej(q.error); });
export const del = (name, id)=> new Promise((res,rej)=>{ const q = st(name,"readwrite").delete(id); q.onsuccess=()=>res(); q.onerror=()=>rej(q.error); });
export const clearStore = (name)=> new Promise((res,rej)=>{ const q = st(name,"readwrite").clear(); q.onsuccess=()=>res(); q.onerror=()=>rej(q.error); });
export const metaGet = (k)=> get("meta", k).then(r=> r ? r.v : undefined);
export const metaSet = (k, v)=> put("meta", {k, v});

/* Settings in localStorage (with Vite env var fallbacks for Vercel deployment) */
const SET_KEY = "invoice_analyzer_settings";

export const DEFAULT_AI_SETTINGS = {
  base: "https://interpretation-let-performed-healing.trycloudflare.com/v1",
  key: "sk-aab807185cc210e9-604bd1-ce13645d",
  model: "antigravity/gemini-3.8-flash-low",
  apiServerBase: "http://45.201.196.19:3002",
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

  return {
    ...saved,
    base: effectiveBase,
    key: effectiveKey,
    model: effectiveModel,
    apiServerBase: effectiveApiServerBase,
  };
}
export function saveSettings(s){ localStorage.setItem(SET_KEY, JSON.stringify(s)); }
