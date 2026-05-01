import React, { useRef } from 'react';
import Modal from '../common/Modal';
import { formatCurrency, formatDateTime } from '../../utils/formatters';
import { calcItemTotal, calcItemDiscountedPrice } from '../../utils/calculations';

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

  return (
    <Modal title="Receipt" onClose={onClose} footer={
      <>
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
        <button className="btn btn-primary" onClick={handlePrint}>Print Receipt</button>
      </>
    }>
      <div ref={ref} className="receipt" style={{ color: '#000', backgroundColor: '#fff', padding: '16px', fontFamily: '"Courier New", Courier, monospace', fontSize: '13px' }}>
        <div style={{ textAlign: 'center', marginBottom: '10px' }}>
          <img src="/logo.png" alt="92Parameters" style={{ width: '80px', height: 'auto', marginBottom: '8px' }} />
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
          </div>
        ))}

        <div className="receipt-divider" style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

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
