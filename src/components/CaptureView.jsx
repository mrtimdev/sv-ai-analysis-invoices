import React, { useState, useRef } from 'react';
import { put, getSettings } from '../lib/db.js';
import { extractWithAI } from '../lib/ai.js';
import { updateSingleScanV1 } from '../lib/scanApi.js';
import { compressImage, parseScanId, uid, num } from '../lib/util.js';
import { Ic } from './icons.jsx';

const FIELDS = [
  ["no","Document No.","printed Doc No."],
  ["invoiceDate","Invoice / Transaction Date","26-10-2026"],
  ["saleOrder","Sale Order","0009542570"],
  ["vendorCode","Vendor Code","100569"],
  ["vehicleCode","Vehicle Code","3E-5024"],
  ["dealerCode","Dealer Code","PS01"],
  ["toWarehouseCode","To Warehouse Code","PS01"],
  ["fromWarehouse","From Warehouse","WF11"],
  ["warehouse","Warehouse","WF11-FC Warehouse"],
  ["route","Route","KHB-Brewery->R4-"],
  ["referenceNo","Reference No.","Ref No."],
  ["scanId","Scan ID","from filename"],
];
const DOC_TYPES = ["GOODS_TRANSFER_NOTE","DELIVERY_ORDER","Invoice","Tax Invoice","Purchase Order","Receipt","Other"];
const EXTRA_FIELDS = ["formNo","company","dealerName","dealerAddress","fromLocation","toLocation"];

const emptyItem = ()=>({ productCode:"", description:"", unit:"", orderedQuantity:"", deliveredQuantity:"", quantity:"", notes:"" });

export default function CaptureView({ toast, openSettings, onSaved, editRecord, onEditDone }){
  const [image, setImage] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [fields, setFields] = useState({});
  const [items, setItems] = useState([emptyItem()]);
  const [editingId, setEditingId] = useState(null);
  const [editingExtra, setEditingExtra] = useState({});
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  const setF = (k,v)=> setFields(p=>({...p,[k]:v}));

  /* receive a record to edit (from detail modal) */
  React.useEffect(()=>{
    if(editRecord){
      const r = editRecord;
      setEditingId(r.id);
      setImage(r.image || null);
      setEditingExtra({
        originalFile: r.originalFile, formNo: r.formNo, company: r.company,
        dealerName: r.dealerName, dealerAddress: r.dealerAddress,
        fromLocation: r.fromLocation, toLocation: r.toLocation, effectiveDate: r.effectiveDate
      });
      const f = {};
      ["no","invoiceDate","documentType","saleOrder","vendorCode","vehicleCode","dealerCode",
        "toWarehouseCode","fromWarehouse","warehouse","route","referenceNo","scanId","verificationNotes"
      ].forEach(k=> f[k] = r[k] ?? "");
      setFields(f);
      setItems((r.items && r.items.length ? r.items : [emptyItem()]).map(i=>({
        productCode: i.productCode??"", description: i.description??"", unit: i.unit??"",
        orderedQuantity: i.orderedQuantity??"", deliveredQuantity: i.deliveredQuantity??"",
        quantity: i.quantity??"", notes: i.notes??""
      })));
      setShowForm(true);
    }
  }, [editRecord]);

  const handleFile = async (file)=>{
    if(!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|bmp)$/i.test(file.name))
      return toast("Please choose an image file (JPG/PNG)", true);
    try{
      const dataUrl = await compressImage(file);
      setImage(dataUrl);
      setEditingId(null);
      setEditingExtra({ scanId: parseScanId(file.name), originalFile: file.name });
      if(parseScanId(file.name) && !fields.scanId) setF("scanId", parseScanId(file.name));
      setShowForm(true);
      const s = getSettings();
      if(s.key && s.base) doExtract(dataUrl);
      else openSettings();
    }catch(err){ toast(err.message, true); }
  };

  const doExtract = async (img)=>{
    const src = img || image;
    if(!src) return toast("Upload a document image first", true);
    const s = getSettings();
    if(!s.key || !s.base){ openSettings(); return; }
    setBusy(true);
    try{
      const rec = await extractWithAI(src);
      const extra = { ...(editingExtra||{}) };
      EXTRA_FIELDS.forEach(f=>{ if(rec[f]!=null) extra[f]=rec[f]; });
      if(rec.effectiveDate) extra.effectiveDate = rec.effectiveDate;
      setEditingExtra(extra);
      const f = {};
      Object.keys(fields).forEach(k=> f[k]=fields[k]);
      ["documentType","no","invoiceDate","dealerCode","toWarehouseCode","saleOrder","vendorCode",
        "vehicleCode","warehouse","route","referenceNo","verificationNotes","scanId"
      ].forEach(k=> f[k] = rec[k] ?? (f[k]||""));
      setFields(f);
      if(rec.items && rec.items.length){
        setItems(rec.items.map(i=>({
          productCode: i.productCode??"", description: i.description??"", unit: i.unit??"",
          orderedQuantity: i.orderedQuantity??"", deliveredQuantity: i.deliveredQuantity??"",
          quantity: i.quantity??"", notes: i.notes??""
        })));
      }
      toast("Extraction complete — review fields, then save");
    }catch(err){
      toast("Extraction failed: "+err.message, true);
    }finally{ setBusy(false); }
  };

  const setItem = (idx,k,v)=> setItems(prev=> prev.map((it,i)=> i===idx ? {...it,[k]:v} : it));
  const removeItem = (idx)=> setItems(prev=> prev.filter((_,i)=>i!==idx));
  const addItem = ()=> setItems(prev=>[...prev, emptyItem()]);

  const sum = (k)=> items.reduce((a,i)=> a + (num(i[k])??0), 0);

  const save = async (syncToServer = false)=>{
    const rec = { id: editingId || uid() };
    FIELDS.forEach(([k])=> rec[k] = fields[k] || null);
    rec.documentType = fields.documentType || null;
    rec.verificationNotes = fields.verificationNotes || null;
    EXTRA_FIELDS.forEach(f=> rec[f] = editingExtra?.[f] ?? null);
    rec.effectiveDate = editingExtra?.effectiveDate ?? null;
    rec.originalFile = editingExtra?.originalFile ?? null;
    rec.items = items.map(i=>({
      productCode: i.productCode || null, description: i.description || null, unit: i.unit || null,
      orderedQuantity: num(i.orderedQuantity), deliveredQuantity: num(i.deliveredQuantity),
      quantity: num(i.quantity), notes: i.notes || null
    }));
    rec.image = image || null;
    rec.saved_at = new Date().toISOString();
    await put("invoices", rec);
    if(syncToServer && rec.scanId){
      try{
        await updateSingleScanV1(rec.scanId, rec);
        toast("Saved locally & updated backend scan #"+rec.scanId+" (APPROVED) ✓");
      }catch(err){
        toast("Saved locally, but POST /v1/"+rec.scanId+"/scan failed: "+err.message, true);
      }
    } else {
      toast("Saved ✓ ("+(editingId?"updated":"new record")+")");
    }
    resetForm();
    if(onEditDone) onEditDone();
    onSaved();
  };

  const resetForm = ()=>{
    setEditingId(null); setImage(null); setEditingExtra({});
    setFields({}); setItems([emptyItem()]); setShowForm(false);
    if(onEditDone) onEditDone();
  };

  return (
    <React.Fragment>
      <div className="card">
        <h2>Upload document</h2>
        <div className="desc">For a single invoice or delivery order photo — AI extraction with the KHB protocol.</div>
        <div className={"drop"+(dragOver?" over":"")}
          onClick={()=> fileRef.current && fileRef.current.click()}
          onDragOver={e=>{e.preventDefault();setDragOver(true);}}
          onDragEnter={e=>{e.preventDefault();setDragOver(true);}}
          onDragLeave={e=>{e.preventDefault();setDragOver(false);}}
          onDrop={e=>{e.preventDefault();setDragOver(false);
            if(e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);}}
        >
          <div className="icon"><Ic.capture /></div>
          <div className="big">Drop a single invoice photo here</div>
          <div className="hint">JPG · PNG · WebP — images stay on your device</div>
          <input ref={fileRef} type="file" accept="image/*" hidden
            onChange={e=>{ if(e.target.files[0]) handleFile(e.target.files[0]); e.target.value=""; }} />
        </div>
        {image && (
          <div className="imgwrap" style={{marginTop:14,maxWidth:420}}>
            <img src={image} alt="document preview" />
          </div>
        )}
      </div>

      {showForm && (
        <div className="card">
          <h2>AI extraction &amp; review (KHB protocol)</h2>
          <div className="row" style={{marginBottom:14}}>
            <button className="btn primary" onClick={()=>doExtract()} disabled={busy}>
              {busy ? <span className="pulse" /> : "✦"} {busy ? "Extracting…" : "Extract with AI"}
            </button>
            <button className="btn" onClick={resetForm}>Clear form</button>
          </div>

          <div className="grid" style={{marginBottom:16}}>
            {FIELDS.map(([k,label,ph])=>(
              <label className="f" key={k}>{label}
                <input value={fields[k]||""} placeholder={ph} onChange={e=>setF(k,e.target.value)} />
              </label>
            ))}
            <label className="f">Document Type
              <select value={fields.documentType||""} onChange={e=>setF("documentType",e.target.value)}>
                <option value="">—</option>
                {DOC_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="f">Verification Notes
              <input className="full" value={fields.verificationNotes||""}
                placeholder="Uncertainties / notes from extraction"
                onChange={e=>setF("verificationNotes",e.target.value)} />
            </label>
          </div>

          <h2 style={{margin:'8px 0 10px'}}>Items</h2>
          <div style={{overflow:'auto'}}>
            <table>
              <thead><tr>
                <th style={{width:125}}>Product Code</th><th>Description</th><th style={{width:70}}>Unit</th>
                <th style={{width:85}}>Ordered</th><th style={{width:85}}>Delivered</th>
                <th style={{width:85}}>Qty</th><th style={{width:150}}>Notes</th><th style={{width:40}}></th>
              </tr></thead>
              <tbody>
                {items.map((it,idx)=>(
                  <tr key={idx}>
                    <td><input value={it.productCode} placeholder="Code" className="cellinput"
                      onChange={e=>setItem(idx,"productCode",e.target.value)} /></td>
                    <td><input value={it.description} placeholder="Description" className="cellinput"
                      onChange={e=>setItem(idx,"description",e.target.value)} /></td>
                    <td><input value={it.unit} className="cellinput"
                      onChange={e=>setItem(idx,"unit",e.target.value)} /></td>
                    <td><input value={it.orderedQuantity} placeholder="0" className="cellinput num"
                      onChange={e=>setItem(idx,"orderedQuantity",e.target.value)} /></td>
                    <td><input value={it.deliveredQuantity} placeholder="0" className="cellinput num"
                      onChange={e=>setItem(idx,"deliveredQuantity",e.target.value)} /></td>
                    <td><input value={it.quantity} placeholder="0" className="cellinput num"
                      onChange={e=>setItem(idx,"quantity",e.target.value)} /></td>
                    <td><input value={it.notes} className="cellinput"
                      onChange={e=>setItem(idx,"notes",e.target.value)} /></td>
                    <td><button className="btn sm danger" onClick={()=>removeItem(idx)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{marginTop:10,justifyContent:'space-between'}}>
            <button className="btn sm" onClick={addItem}>+ Add item</button>
            <div className="row" style={{gap:20,fontWeight:700}}>
              <span>Ordered: <b>{sum("orderedQuantity").toLocaleString()}</b></span>
              <span>Delivered: <b>{sum("deliveredQuantity").toLocaleString()}</b></span>
              <span>Qty: <b>{sum("quantity").toLocaleString()}</b></span>
            </div>
          </div>

          <div className="row" style={{marginTop:18}}>
            <button className="btn primary" onClick={()=>save(false)}>💾 {editingId ? "Update local record" : "Save to records"}</button>
            {fields.scanId && (
              <button className="btn primary" onClick={()=>save(true)}>
                ⚡ Save &amp; POST /v1/{fields.scanId}/scan (APPROVED)
              </button>
            )}
          </div>
        </div>
      )}
    </React.Fragment>
  );
}
