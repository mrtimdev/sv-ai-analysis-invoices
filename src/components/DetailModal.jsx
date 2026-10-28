import React from 'react';

export default function DetailModal({ record, onClose, onDelete, onEdit }){
  if(!record) return null;
  const r = record;
  const kv = [
    ["Invoice / Doc No.", r.no], ["Date", r.invoiceDate], ["Document Type", r.documentType],
    ["Dealer Code", r.dealerCode], ["To Warehouse", r.toWarehouseCode], ["From Warehouse", r.fromWarehouse],
    ["Sale Order", r.saleOrder], ["Vendor Code", r.vendorCode], ["Vehicle Code", r.vehicleCode],
    ["Reference No.", r.referenceNo], ["Warehouse", r.warehouse], ["Route", r.route],
    ["Scan ID", r.scanId], ["Original File", r.originalFile], ["Verification Notes", r.verificationNotes]
  ].filter(p=>p[1]);

  return (
    <div className="mback" onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="mhead">
          <h3>{(r.documentType || "Document")} — {r.no || "(no number)"}</h3>
          <button className="x" onClick={onClose}>&times;</button>
        </div>
        <div className="mbody">
          {r.image && (
            <div className="imgwrap" style={{maxWidth:640, marginBottom:18}}>
              <img src={r.image} alt="document" />
            </div>
          )}
          <div className="kv">
            {kv.map(([k,v])=>(<React.Fragment key={k}><div>{k}</div><div>{String(v)}</div></React.Fragment>))}
          </div>
          <h2 style={{fontSize:14,margin:'6px 0 8px'}}>Items</h2>
          <div style={{overflow:'auto'}}>
            <table>
              <thead><tr>
                <th style={{width:120}}>Code</th><th>Description</th><th>Unit</th>
                <th className="num">Order</th><th className="num">Deliv.</th><th className="num">Qty</th><th>Notes</th>
              </tr></thead>
              <tbody>
                {(r.items||[]).map((i,idx)=>(
                  <tr key={idx}>
                    <td className="mono">{i.productCode || "—"}</td>
                    <td>{i.description || "—"}</td>
                    <td>{i.unit || "—"}</td>
                    <td className="num">{i.orderedQuantity ?? "—"}</td>
                    <td className="num">{i.deliveredQuantity ?? "—"}</td>
                    <td className="num">{i.quantity ?? "—"}</td>
                    <td>{i.notes || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{justifyContent:'space-between',marginTop:20}}>
            <button className="btn danger" onClick={onDelete}>Delete record</button>
            <button className="btn" onClick={onEdit}>Edit in form</button>
          </div>
        </div>
      </div>
    </div>
  );
}
