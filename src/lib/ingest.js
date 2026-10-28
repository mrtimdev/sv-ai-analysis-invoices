/* Ingestion: files, folders (drag & drop), ZIP archives — recursive */
import { put } from './db.js';
import { IMG_RE, uid, baseName, folderOf, parseScanId, compressImage } from './util.js';

async function ingestBlob(blob, name, folder){
  if(!IMG_RE.test(name) && !String(blob.type||"").startsWith("image/")) return false;
  const dataUrl = await compressImage(blob);
  const compressed = await (await fetch(dataUrl)).blob();
  const item = {
    id: uid(), name, folder: folder || "", path: (folder? folder+"/" : "")+name,
    scanId: parseScanId(name), status: "pending", blob: compressed,
    error: null, recordId: null, docNo: null, itemsCount: 0,
    addedAt: new Date().toISOString(), ms: null
  };
  await put("queue", item);
  return true;
}

async function ingestZip(file, onProgress){
  if(typeof window.JSZip === "undefined") throw new Error("ZIP library not loaded — check internet connection");
  const zip = await window.JSZip.loadAsync(file);
  const entries = [];
  zip.forEach((path, entry)=>{ if(!entry.dir && IMG_RE.test(path)) entries.push({entry, path}); });
  let n = 0;
  for(const e of entries){
    const blob = await e.entry.async("blob");
    await ingestBlob(blob, baseName(e.path), folderOf(e.path));
    n++;
    if(onProgress) onProgress(baseName(e.path), n, entries.length);
  }
  return n;
}

export async function ingestFile(file, path, onProgress){
  if(/\.zip$/i.test(file.name)) return (await ingestZip(file, onProgress)) > 0;
  return await ingestBlob(file, baseName(path||file.name), folderOf(path||file.name));
}

export async function ingestFileList(files, onProgress){
  let added = 0;
  for(const f of files){
    if(onProgress) onProgress(f.name);
    if(await ingestFile(f, f.name)) added++;
  }
  return added;
}

/* Drag & drop folder traversal (recursive) */
function walkEntry(entry, prefix, out){
  return new Promise((res)=>{
    if(entry.isFile){
      entry.file(f=>{ out.push({file:f, path: prefix+entry.name}); res(); }, ()=>res());
    } else if(entry.isDirectory){
      const reader = entry.createReader();
      const readSome = ()=>{
        reader.readEntries(async batch=>{
          if(!batch.length){ res(); return; }
          for(const e of batch) await walkEntry(e, prefix+entry.name+"/", out);
          readSome();
        }, ()=>res());
      };
      readSome();
    } else res();
  });
}
export async function collectFromDataTransfer(dt){
  const out = [];
  const items = [...(dt.items||[])];
  const entries = items.map(i=> (i.webkitGetAsEntry && i.webkitGetAsEntry) ? i.webkitGetAsEntry() : null).filter(Boolean);
  if(entries.length){
    for(const en of entries) await walkEntry(en, "", out);
    return out;
  }
  for(const f of (dt.files||[])) out.push({file:f, path:f.name});
  return out;
}
export async function ingestDataTransfer(dt, onProgress){
  const list = await collectFromDataTransfer(dt);
  let added = 0;
  for(const it of list){
    if(onProgress) onProgress(baseName(it.path));
    if(await ingestFile(it.file, it.path)) added++;
  }
  return { added, found: list.length };
}
