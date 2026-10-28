import React, { useState, useMemo } from 'react';
import { del, clearStore } from '../lib/db.js';
import { normDate } from '../lib/util.js';
import { exportExcel, exportCsv } from '../lib/excel.js';
import { Ic } from './icons.jsx';

const PAGE_SIZE = 20;

function matches(rec, q, from, to){
  if(q){
    const hay = [rec.no,rec.saleOrder,rec.vendorCode,rec.vehicleCode,rec.dealerCode,rec.dealerName,
      rec.toWarehouseCode,rec.warehouse,rec.documentType,rec.route,rec.referenceNo,rec.scanId,
      ...(rec.items||[]).map(i=>[i.productCode,i.description].join(" "))].join(" ").toLowerCase();
    if(!hay.includes(q)) return false;
  }
  const nd = normDate(rec.invoiceDate);
  if(from && (!nd || nd < from)) return false;
  if(to && (!nd || nd > to)) return false;
  return true;
}
function pageList(total, page){
  const maxPage = Math.max(1, Math.ceil(total/PAGE_SIZE));
  const want = new Set([1, 2, maxPage-1, maxPage, page-1, page, page+1]);
  const sorted = [...want].filter(p=>p>=1 && p<=maxPage).sort((a,b)=>a-b);
  const out = [];
  let prev = 0;
  for(const p of sorted){
    if(p - prev > 1) out.push("…");
    out.push(p);
    prev = p;
  }
  return out;
}

export default function ListView({ records, refresh, toast, openDetail }){
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState(new Set());

  const filtered = useMemo(()=> records.filter(r=> matches(r, q.trim().toLowerCase(), from, to)),
    [records, q, from, to]);
  const total = filtered.length;
  const maxPage = Math.max(1, Math.ceil(total/PAGE_SIZE));
  const curPage = Math.min(page, maxPage);
  const start = (curPage-1)*PAGE_SIZE;
  const pageRows = filtered.slice(start, start+PAGE_SIZE);

  const qChange = (v)=>{ setQ(v); setPage(1); };
  const dChange = (v,f)=>{ setPage(1); f==="from" ? setFrom(v) : setTo(v); };

  const allSel = total>0 && filtered.every(r=> sel.has(r.id));
  const someSel = !allSel && filtered.some(r=> sel.has(r.id));
  const toggleRow = (id, on)=>{
    setSel(prev=>{
      const n = new Set(prev);
      on ? n.add(id) : n.delete(id);
      return n;
    });
  };
  const toggleAll = (on)=>{
    setSel(prev=>{
      const n = new Set(prev);
      filtered.forEach(r=> on ? n.add(r.id) : n.delete(r.id));
      return n;
    });
  };

  const deleteSel = async ()=>{
    const ids = [...sel];
    if(!ids.length) return;
    if(!window.confirm("Delete "+ids.length+" selected record"+(ids.length>1?"s":"")+"? This cannot be undone.")) return;
    for(const id of ids) await del("invoices", id);
    setSel(new Set());
    toast(ids.length+" record"+(ids.length>1?"s":"")+" deleted");
    refresh();
  };
  const deleteAll = async ()=>{
    if(!records.length) return toast("No records to delete", true);
    if(!window.confirm("Delete ALL "+records.length+" records permanently? This cannot be undone.")) return;
    await clearStore("invoices");
    setSel(new Set()); setPage(1);
    toast("All records deleted");
    refresh();
  };

  const doCsv = ()=>{ exportCsv(filtered); toast("CSV exported"); };
  const doXls = async ()=>{
    const res = await exportExcel(filtered);
    if(res.ok) toast("Excel exported ✓");
    else toast(res.error, true);
  };

  return (
    <div className="card">
      <div className="row" style={{justifyContent:'space-between',marginBottom:6}}>
        <h2>Invoices &amp; delivery orders</h2>
        <span className="badge pend">
          {records.length + (total!==records.length ? " records · "+total+" shown" : " records")}
        </span>
      </div>

      <div className="row" style={{marginBottom:10}}>
        <input type="search" value={q} placeholder="Search doc no, sale order, vendor, vehicle, dealer, items…"
          onChange={e=>qChange(e.target.value)}
          style={{flex:1,minWidth:220,padding:'9px 12px',border:'1px solid var(--line)',borderRadius:10,fontSize:14}} />
        <input type="date" value={from} title="From date"
          onChange={e=>dChange(e.target.value,"from")}
          style={{padding:8,border:'1px solid var(--line)',borderRadius:10}} />
        <input type="date" value={to} title="To date"
          onChange={e=>dChange(e.target.value,"to")}
          style={{padding:8,border:'1px solid var(--line)',borderRadius:10}} />
        <button className="btn sm" onClick={doCsv}>⇩ CSV</button>
        <button className="btn sm primary" onClick={doXls}><Ic.export className="ic" /> Combined Excel</button>
      </div>

      <div className="row" style={{marginBottom:8}}>
        {sel.size>0 && (
          <button className="btn sm danger" onClick={deleteSel}>
            <Ic.trash className="ic" /> Delete selected ({sel.size})
          </button>
        )}
        <button className="btn sm danger" onClick={deleteAll}><Ic.trash className="ic" /> Delete all</button>
        <span className="spacer" />
        {total>0 && (
          <span className="mono" style={{color:'var(--muted)',fontSize:12.5}}>
            Showing {start+1}–{Math.min(start+PAGE_SIZE,total)} of {total}
          </span>
        )}
      </div>

      <div style={{overflow:'auto'}}>
        <table>
          <thead><tr>
            <th style={{width:34}}>
              <input type="checkbox" className="checkbox" checked={allSel} ref={el=>{ if(el) el.indeterminate = someSel; }}
                onChange={e=>toggleAll(e.target.checked)} title="Select all filtered records" />
            </th>
            <th>Date</th><th>Doc No.</th><th>Type</th><th>Sale Order</th><th>Vendor</th>
            <th>Vehicle</th><th className="hidemid">Dealer</th><th>Order</th><th>Deliv.</th><th>Var</th>
          </tr></thead>
          <tbody>
            {pageRows.map(r=>{
              const its = r.items||[];
              const o = its.reduce((a,i)=>a+(i.orderedQuantity??0),0);
              const d = its.reduce((a,i)=>a+((i.deliveredQuantity??i.quantity)??0),0);
              let vb = null;
              if(o>0){
                const v = d-o;
                vb = v<0 ? <span className="badge short">{v.toLocaleString()}</span>
                  : v>0 ? <span className="badge over">+{v.toLocaleString()}</span>
                  : <span className="badge ok">OK</span>;
              }
              return (
                <tr key={r.id} className="clickable" onClick={()=>openDetail(r.id)}>
                  <td><input type="checkbox" className="checkbox" checked={sel.has(r.id)}
                    onClick={e=>e.stopPropagation()}
                    onChange={e=>toggleRow(r.id, e.target.checked)} /></td>
                  <td>{r.invoiceDate || "—"}</td>
                  <td><b>{r.no || "—"}</b></td>
                  <td>{r.documentType ? <span className="badge type">{r.documentType}</span> : "—"}</td>
                  <td>{r.saleOrder || "—"}</td>
                  <td>{r.vendorCode || "—"}</td>
                  <td>{r.vehicleCode || "—"}</td>
                  <td className="hidemid">{r.dealerCode || "—"}</td>
                  <td style={{textAlign:'right'}}>{o ? o.toLocaleString() : "—"}</td>
                  <td style={{textAlign:'right'}}>{d ? d.toLocaleString() : "—"}</td>
                  <td>{vb}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {records.length===0 && <div className="empty">No records yet. Capture a document or run a batch first.</div>}
      {records.length>0 && total===0 && <div className="empty">No records match your search.</div>}

      {total > PAGE_SIZE && (
        <div className="pager">
          <button className={"pg"+(curPage===1?" disabled":"")} disabled={curPage===1}
            onClick={()=>{ setPage(curPage-1); window.scrollTo({top:0,behavior:'smooth'}); }}>‹ Prev</button>
          {pageList(total, curPage).map((p,i)=> p==="…" 
            ? <button key={"e"+i} className="pg ellipsis">…</button>
            : <button key={p} className={"pg"+(p===curPage?" active":"")}
                onClick={()=>{ setPage(p); window.scrollTo({top:0,behavior:'smooth'}); }}>{p}</button>
          )}
          <button className={"pg"+(curPage===maxPage?" disabled":"")} disabled={curPage===maxPage}
            onClick={()=>{ setPage(curPage+1); window.scrollTo({top:0,behavior:'smooth'}); }}>Next ›</button>
        </div>
      )}
    </div>
  );
}
