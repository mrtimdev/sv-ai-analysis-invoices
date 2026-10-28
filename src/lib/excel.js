/* Combined Items Excel export — styled to the user's template */
import { getSettings } from './db.js';

export async function exportExcel(records, fname){
  const ExcelJS = window.ExcelJS;
  if(!ExcelJS) return { ok:false, error:"Excel library failed to load — check your internet connection" };
  if(!records.length) return { ok:false, error:"No records to export" };
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Combined Items", {views:[{state:"frozen", ySplit:5, xSplit:4}]});

  const COLS = ["Invoice No","Invoice Date","Dealer Code","Vehicle Code","Document Type","Form No",
    "Dealer Name","Reference No","Company","Dealer Address","Warehouse","Route","Sale Order",
    "Vendor Code","From Location","To Location","From Warehouse","To Warehouse","Scan ID",
    "Original File","Additional Invoice Details","Item ID","Product / Material Code","Description",
    "Unit","Ordered","Delivered","Quantity","Difference","Notes / Details","Original Scan"];
  const C_DARK = "FF0C285F", C_HEAD = "FF1E3A6D", C_SUB = "FFEAF4FC", C_WARN = "FFFFF9E6";
  const C_LINK = "FF2563EB", C_NOTETXT = "FF92400E";
  const NCOLS = COLS.length;

  ws.mergeCells(2,1,2,NCOLS);
  const t = ws.getCell(2,1);
  t.value = "COMBINED INVOICE ITEMS";
  t.font = {bold:true, size:14, name:"Arial", color:{argb:"FFFFFFFF"}};
  t.fill = {type:"pattern", pattern:"solid", fgColor:{argb:C_DARK}};
  t.alignment = {horizontal:"center", vertical:"middle"};
  ws.getRow(2).height = 30;

  const nItems = records.reduce((a,r)=>a+(r.items||[]).length,0);
  ws.getCell(3,1).value = records.length+" Invoices / "+nItems+" Item rows";
  ws.getCell(3,1).font = {size:10, name:"Arial", color:{argb:"FF6B7280"}};

  COLS.forEach((h,i)=>{
    const c = ws.getCell(5,i+1); c.value = h;
    c.font = {bold:true, size:10, name:"Arial", color:{argb:"FFFFFFFF"}};
    c.fill = {type:"pattern", pattern:"solid", fgColor:{argb:C_HEAD}};
    c.alignment = {vertical:"middle", wrapText:true};
  });
  ws.getRow(5).height = 24;

  const widths = [14,12,11,12,18,22,20,14,22,18,18,16,12,11,20,20,14,16,10,30,40,12,18,28,7,10,10,10,10,22,17];
  widths.forEach((w,i)=> ws.getColumn(i+1).width = w);

  const noCount = {};
  records.forEach(r=>{ if(r.no) noCount[r.no]=(noCount[r.no]||0)+1; });
  const scanBase = (getSettings().scanBase || "http://45.201.196.19:3002/admin/scans").replace(/\/+$/,"");

  let row = 6;
  for(const r of records){
    const items = r.items && r.items.length ? r.items : [];
    const details = [r.effectiveDate ? ("Effective Date: "+r.effectiveDate) : null,
      r.folder ? ("Folder: "+r.folder) : null].filter(Boolean).join("\n");
    const idBase = r.scanId || r.no || String(r.id).slice(0,8);

    items.forEach((it, idx)=>{
      const first = idx===0;
      const ordered = it.orderedQuantity ?? null;
      const delivered = it.deliveredQuantity ?? null;
      const quantity = it.quantity ?? delivered;
      const diff = (ordered!=null && quantity!=null) ? quantity-ordered : null;
      const headVals = first
        ? [r.no, r.invoiceDate, r.dealerCode, r.vehicleCode, r.documentType, r.formNo,
           r.dealerName, r.referenceNo, r.company, r.dealerAddress, r.warehouse, r.route, r.saleOrder,
           r.vendorCode, r.fromLocation, r.toLocation, r.fromWarehouse, r.toWarehouseCode, r.scanId,
           r.originalFile, details || null]
        : Array(21).fill(null);
      const vals = headVals.concat([idBase+"-"+(idx+1), it.productCode, it.description, it.unit,
        ordered, delivered, quantity, diff, it.notes, first ? "View original scan" : null]);
      const xr = ws.getRow(row);
      vals.forEach((v,i)=>{
        const c = xr.getCell(i+1);
        c.value = (v==="" || v===undefined) ? null : v;
        c.font = {size:10, name:"Arial"};
        if([26,27,28,29].includes(i+1)) c.numFmt = "#,##0";
        if(i===20) c.alignment = {vertical:"top", wrapText:true};
        if(i===30 && v){
          c.font = {size:10, name:"Arial", color:{argb:C_LINK}, underline:true};
          if(r.scanId) c.value = { text:"View original scan", hyperlink: scanBase+"/"+r.scanId+"/image" };
        }
      });
      row++;
    });

    const unitOrder = [...new Set(items.map(i=>i.unit || "—"))];
    unitOrder.forEach(u=>{
      const rowsU = items.filter(i=>(i.unit || "—")===u);
      const sumQ = rowsU.reduce((a,i)=>a+((i.quantity??i.deliveredQuantity)??0),0);
      const sumO = rowsU.reduce((a,i)=>a+(i.orderedQuantity??0),0);
      const sr = ws.getRow(row);
      sr.getCell(1).value = r.no;
      sr.getCell(2).value = "Subtotal · "+u;
      if(sumO) sr.getCell(26).value = sumO;
      sr.getCell(28).value = sumQ;
      for(let i=1;i<=NCOLS;i++){
        const c = sr.getCell(i);
        c.fill = {type:"pattern", pattern:"solid", fgColor:{argb:C_SUB}};
        c.font = {bold:true, size:10, name:"Arial"};
        if(i===26 || i===28) c.numFmt = "#,##0";
      }
      row++;
    });

    const notes = [];
    if(r.no && noCount[r.no]>1) notes.push("Potential duplicate invoice. Verify before using totals.");
    if(r.verificationNotes) notes.push(r.verificationNotes);
    notes.forEach(n=>{
      const wr = ws.getRow(row);
      wr.getCell(1).value = r.no;
      const bc = wr.getCell(2);
      bc.value = n;
      bc.alignment = {vertical:"top", wrapText:true};
      for(let i=1;i<=NCOLS;i++){
        const c = wr.getCell(i);
        c.fill = {type:"pattern", pattern:"solid", fgColor:{argb:C_WARN}};
        c.font = {size:10, name:"Arial", color:{argb:C_NOTETXT}};
      }
      row++;
    });
  }

  ws.autoFilter = {from:{row:5, column:1}, to:{row:Math.max(5,row-1), column:NCOLS}};
  for(let c=5;c<=21;c++) ws.getColumn(c).hidden = true;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = fname || "combined-invoice-items.xlsx"; a.click(); URL.revokeObjectURL(a.href);
  return { ok:true };
}

export function exportCsv(records){
  const head = ["Invoice No","Invoice Date","Dealer Code","Vehicle Code","Document Type","Form No",
    "Sale Order","Vendor Code","From Warehouse","To Warehouse","Scan ID","Original File",
    "Item ID","Product Code","Description","Unit","Ordered","Delivered","Quantity","Notes"];
  const lines = [head.join(",")];
  records.forEach(r=> (r.items&&r.items.length?r.items:[{}]).forEach((i,idx)=>{
    const c = v=> '"'+String(v??"").replace(/"/g,'""')+'"';
    lines.push([r.no,r.invoiceDate,r.dealerCode,r.vehicleCode,r.documentType,r.formNo,
      r.saleOrder,r.vendorCode,r.fromWarehouse,r.toWarehouseCode,r.scanId,r.originalFile,
      (r.scanId||r.no)+"-"+(idx+1),i.productCode,i.description,i.unit,
      i.orderedQuantity,i.deliveredQuantity,i.quantity,i.notes].map(c).join(","));
  }));
  const blob = new Blob(["\uFEFF"+lines.join("\n")], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
  a.download = "combined-invoice-items.csv"; a.click(); URL.revokeObjectURL(a.href);
}
