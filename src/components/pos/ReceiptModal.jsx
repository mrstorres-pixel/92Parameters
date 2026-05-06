import React, { useRef } from 'react';
import Modal from '../common/Modal';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { calcItemTotal } from '../../utils/calculations';

function hasItemDiscount(item) {
  return Number(item.discount || 0) > 0 || Number(item.discountAmount || 0) > 0;
}

export default function ReceiptModal({ transaction, onClose }) {
  const ref = useRef();
  const t = transaction;

  function handlePrint() {
    const win = window.open('', '_blank', 'width=350,height=600');
    win.document.write('<html><head><title>Receipt</title><style>body{font-family:Courier New,monospace;font-size:12px;padding:20px;max-width:300px;margin:0 auto}h3{margin:0}hr{border:none;border-top:1px dashed #000;margin:8px 0}.line{display:flex;justify-content:space-between;margin:2px 0}.center{text-align:center}.bold{font-weight:700}.big{font-size:16px}</style></head><body>');
    win.document.write(ref.current.innerHTML);
    win.document.write('</body></html>');
    win.document.close();
    win.print();
  }

  function buildReceiptRows() {
    const rows = [
      { type: 'center', text: '92 PARAMETERS CAFE', bold: true },
      { type: 'space' },
      { type: 'center', text: 'THIS IS NOT AN OFFICIAL RECEIPT.' },
      { type: 'center', text: 'PLEASE ASK FOR BIR SERVICE INVOICE' },
      { type: 'space' },
      { type: 'text', text: `Receipt No. : ${t.receiptNo}` },
      { type: 'divider' },
    ];

    (t.items || []).forEach(item => {
      rows.push({ type: 'pair', left: `${item.quantity} x ${item.name}`, right: formatCurrency(calcItemTotal(item)) });
      if (Number(item.discount || 0) > 0) rows.push({ type: 'pair', left: '  Discount', right: `-${item.discount}%` });
      if (Number(item.discountAmount || 0) > 0) rows.push({ type: 'pair', left: '  Cash discount', right: `-${formatCurrency(item.discountAmount)}` });
    });

    rows.push({ type: 'divider' });
    if (t.orderDiscount > 0 || t.orderDiscountAmount > 0) {
      if (t.subtotal) rows.push({ type: 'pair', left: 'Subtotal', right: formatCurrency(t.subtotal) });
      if (t.orderDiscount > 0) rows.push({ type: 'pair', left: 'Order Discount', right: `-${t.orderDiscount}%` });
      if (t.orderDiscountAmount > 0) rows.push({ type: 'pair', left: 'Order Discount Cash', right: `-${formatCurrency(t.orderDiscountAmount)}` });
    }

    rows.push({ type: 'pair', left: 'Total:', right: formatCurrency(t.total), bold: true });
    if (t.cashReceived) {
      rows.push({ type: 'pair', left: 'Cash Received:', right: formatCurrency(t.cashReceived) });
      rows.push({ type: 'pair', left: 'Change:', right: formatCurrency(t.cashReceived - t.total), bold: true });
    }
    rows.push({ type: 'space' });
    rows.push({ type: 'text', text: `Payment Method: ${t.paymentMethod}` });
    rows.push({ type: 'text', text: t.orderType });
    rows.push({ type: 'text', text: `Staff: ${t.staffName || 'Staff'}` });
    rows.push({ type: 'space' });
    rows.push({ type: 'center', text: '--- Powered by 92Parameters ---' });
    rows.push({ type: 'center', text: formatDateTime(t.datetime) });
    rows.push({ type: 'center', text: 'THANK YOU! SEE US AGAIN! :)', bold: true });
    return rows;
  }

  function wrapText(ctx, text, maxWidth) {
    const words = String(text || '').split(' ');
    const lines = [];
    let current = '';
    words.forEach(word => {
      const next = current ? `${current} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth) current = next;
      else {
        if (current) lines.push(current);
        current = word;
      }
    });
    if (current) lines.push(current);
    return lines;
  }

  function loadImage(src) {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = src;
    });
  }

  async function handleSaveImage() {
    const width = 384;
    const padding = 18;
    const lineHeight = 20;
    const logo = await loadImage('/logo.png?v=2');
    const logoWidth = logo ? 84 : 0;
    const logoHeight = logo ? Math.round((logo.height / logo.width) * logoWidth) : 0;
    const logoBlockHeight = logo ? logoHeight + 12 : 0;
    const rows = buildReceiptRows();
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    measureCtx.font = '14px "Courier New", monospace';
    const rowHeights = rows.map(row => {
      if (row.type === 'space') return 10;
      if (row.type === 'divider') return 18;
      if (row.type === 'pair') return Math.max(1, wrapText(measureCtx, row.left, 210).length) * lineHeight;
      return Math.max(1, wrapText(measureCtx, row.text, width - padding * 2).length) * lineHeight;
    });
    const height = padding * 2 + logoBlockHeight + rowHeights.reduce((sum, h) => sum + h, 0);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000';
    ctx.textBaseline = 'top';

    let y = padding;
    if (logo) {
      ctx.drawImage(logo, (width - logoWidth) / 2, y, logoWidth, logoHeight);
      y += logoBlockHeight;
    }
    rows.forEach((row, index) => {
      ctx.font = `${row.bold ? '700 ' : ''}14px "Courier New", monospace`;
      if (row.type === 'space') {
        y += rowHeights[index];
        return;
      }
      if (row.type === 'divider') {
        ctx.fillText('-'.repeat(42), padding, y);
        y += rowHeights[index];
        return;
      }
      if (row.type === 'center') {
        wrapText(ctx, row.text, width - padding * 2).forEach(line => {
          ctx.fillText(line, (width - ctx.measureText(line).width) / 2, y);
          y += lineHeight;
        });
        return;
      }
      if (row.type === 'pair') {
        const leftLines = wrapText(ctx, row.left, 210);
        leftLines.forEach((line, lineIndex) => {
          ctx.fillText(line, padding, y);
          if (lineIndex === 0) {
            const rightWidth = ctx.measureText(row.right).width;
            ctx.fillText(row.right, width - padding - rightWidth, y);
          }
          y += lineHeight;
        });
        return;
      }
      wrapText(ctx, row.text, width - padding * 2).forEach(line => {
        ctx.fillText(line, padding, y);
        y += lineHeight;
      });
    });

    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${t.receiptNo || 'receipt'}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  return (
    <Modal title="Receipt" onClose={onClose} footer={
      <>
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
        <button className="btn btn-secondary" onClick={handleSaveImage}>Save Image</button>
        <button className="btn btn-primary" onClick={handlePrint}>Print Receipt</button>
      </>
    }>
      <div ref={ref} className="receipt" style={{ color: '#000', backgroundColor: '#fff', padding: '16px', fontFamily: '"Courier New", Courier, monospace', fontSize: '13px' }}>
        <div style={{ textAlign: 'center', marginBottom: '10px' }}>
          <img src="/logo.png?v=2" alt="92Parameters" style={{ width: '80px', height: 'auto', marginBottom: '8px' }} />
          <div style={{ fontWeight: 'bold', fontSize: '14px' }}>92 PARAMETERS CAFE</div>
        </div>

        <div style={{ textAlign: 'center', fontSize: '10px', marginBottom: '10px', lineHeight: '1.2' }}>
          THIS IS NOT AN OFFICIAL RECEIPT.<br />
          PLEASE ASK FOR BIR SERVICE INVOICE
        </div>

        <div style={{ textAlign: 'center', marginBottom: '10px' }}>
          THIS IS NOT AN OFFICIAL RECEIPT
        </div>

        <div style={{ marginBottom: '10px' }}>
          Receipt No. : {t.receiptNo}
        </div>

        <div className="receipt-divider" style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

        {(t.items || []).map((item, i) => (
          <div key={i} style={{ marginBottom: '4px' }}>
            <div className="receipt-line" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{item.quantity} x {item.name}</span>
              <span>{formatCurrency(calcItemTotal(item))}</span>
            </div>
            {hasItemDiscount(item) && (
              <div style={{ fontSize: '11px', paddingLeft: '12px', color: '#333' }}>
                {Number(item.discount || 0) > 0 && (
                  <div className="receipt-line" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Discount</span>
                    <span>-{item.discount}%</span>
                  </div>
                )}
                {Number(item.discountAmount || 0) > 0 && (
                  <div className="receipt-line" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Cash discount</span>
                    <span>-{formatCurrency(item.discountAmount)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        <div className="receipt-divider" style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

        {(t.orderDiscount > 0 || t.orderDiscountAmount > 0) && (
          <div style={{ marginBottom: '8px' }}>
            {t.subtotal && (
              <div className="receipt-line" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Subtotal</span>
                <span>{formatCurrency(t.subtotal)}</span>
              </div>
            )}
            {t.orderDiscount > 0 && (
              <div className="receipt-line" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Order Discount</span>
                <span>-{t.orderDiscount}%</span>
              </div>
            )}
            {t.orderDiscountAmount > 0 && (
              <div className="receipt-line" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Order Discount Cash</span>
                <span>-{formatCurrency(t.orderDiscountAmount)}</span>
              </div>
            )}
          </div>
        )}

        <div style={{ textAlign: 'right', marginBottom: '15px' }}>
          <div className="receipt-line" style={{ display: 'flex', justifyContent: 'flex-end', gap: '20px' }}>
            <span style={{ fontWeight: 'bold' }}>Total:</span>
            <span style={{ fontWeight: 'bold' }}>{formatCurrency(t.total)}</span>
          </div>
          {t.cashReceived && (
            <>
              <div className="receipt-line" style={{ display: 'flex', justifyContent: 'flex-end', gap: '20px' }}>
                <span>Cash Received:</span>
                <span>{formatCurrency(t.cashReceived)}</span>
              </div>
              <div className="receipt-line" style={{ display: 'flex', justifyContent: 'flex-end', gap: '20px' }}>
                <span style={{ fontWeight: 'bold' }}>Change:</span>
                <span style={{ fontWeight: 'bold' }}>{formatCurrency(t.cashReceived - t.total)}</span>
              </div>
            </>
          )}
        </div>

        <div style={{ marginBottom: '10px' }}>
          Payment Method: {t.paymentMethod}<br />
          {t.orderType}
        </div>

        <div style={{ marginBottom: '15px' }}>
          Staff: {t.staffName || 'Staff'}
        </div>

        <div style={{ textAlign: 'center', fontSize: '11px' }}>
          <div style={{ marginBottom: '4px' }}>--- Powered by 92Parameters ---</div>
          <div>{formatDateTime(t.datetime)}</div>
          <div style={{ marginTop: '10px', fontWeight: 'bold' }}>THANK YOU! SEE US AGAIN! :)</div>
        </div>
      </div>
    </Modal>
  );
}
