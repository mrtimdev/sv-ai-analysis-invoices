/* Shared helpers */

export const IMG_RE = /\.(jpe?g|png|webp|bmp)$/i;

export const uid = ()=> (crypto.randomUUID ? crypto.randomUUID() : "r"+Date.now()+Math.random().toString(16).slice(2));
export const baseName = p => String(p).split("/").pop();
export const folderOf = p => { const parts = String(p).split("/"); return parts.length>1 ? parts[parts.length-2] : ""; };
export function parseScanId(name){
  const m = String(name).match(/scan-?(\d+)/i);
  return m ? m[1] : null;
}
export function normDate(s){
  if(!s) return null;
  const m = String(s).match(/(\d{1,4})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
  if(!m) return null;
  let a=+m[1], b=+m[2], c=+m[3];
  if(a>31) return a + "-" + String(b).padStart(2,"0") + "-" + String(c).padStart(4,"0");
  if(c<100) c=2000+c;
  return c + "-" + String(b).padStart(2,"0") + "-" + String(a).padStart(2,"0");
}
export function blobToDataUrl(blob){
  return new Promise((res,rej)=>{
    const r = new FileReader();
    r.onload = ()=> res(r.result);
    r.onerror = ()=> rej(r.error);
    r.readAsDataURL(blob);
  });
}
export function compressImage(blob, maxDim=1800, quality=0.85){
  return new Promise((res,rej)=>{
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = ()=>{
      let w = img.naturalWidth, h = img.naturalHeight;
      const scale = Math.min(1, maxDim/Math.max(w,h));
      w = Math.max(1,Math.round(w*scale)); h = Math.max(1,Math.round(h*scale));
      const c = document.createElement("canvas"); c.width=w; c.height=h;
      c.getContext("2d").drawImage(img,0,0,w,h);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg", quality));
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); rej(new Error("Could not read image")); };
    img.src = url;
  });
}
export function fmtEta(ms){
  if(!ms || !isFinite(ms)) return "—";
  const sec = Math.max(1, Math.round(ms/1000));
  if(sec < 90) return "~"+sec+"s left";
  const min = Math.floor(sec/60);
  if(min < 90) return "~"+min+"m "+(sec%60)+"s left";
  return "~"+Math.floor(min/60)+"h "+(min%60)+"m left";
}
export const num = v=>{
  const n = parseFloat(String(v??"").replace(/,/g,""));
  return isFinite(n) ? n : null;
};
