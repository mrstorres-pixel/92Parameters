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
      <div ref={ref} className="receipt">
        <div className="receipt-header">
          <h3>92Parameters</h3>
          <div>Coffee Shop</div>
          <div style={{ marginTop: 8, fontSize: '0.75rem' }}>{formatDateTime(t.datetime)}</div>
          <div style={{ fontWeight: 700 }}>{t.receiptNo}</div>
          <div>{t.orderType}</div>
        </div>

        {(t.items || []).map((item, i) => (
          <div key={i}>
            <div className="receipt-line">
              <span>{item.name} x{item.quantity}</span>
              <span>{formatCurrency(calcItemTotal(item))}</span>
            </div>
            {item.discount > 0 && (
              <div style={{ fontSize: '0.7rem', color: '#666', paddingLeft: 8 }}>
                Discount: {item.discount}% (was {formatCurrency(item.price)} ea)
              </div>
            )}
          </div>
        ))}

        <div className="receipt-divider" />
        <div className="receipt-line receipt-total">
          <span>TOTAL</span>
          <span>{formatCurrency(t.total)}</span>
        </div>
        <div className="receipt-line">
          <span>Payment</span>
          <span>{t.paymentMethod}</span>
        </div>
        {t.cashReceived && (
          <>
            <div className="receipt-line"><span>Cash</span><span>{formatCurrency(t.cashReceived)}</span></div>
            <div className="receipt-line"><span>Change</span><span>{formatCurrency(t.cashReceived - t.total)}</span></div>
          </>
        )}
        <div className="receipt-divider" />
        <div className="receipt-footer">
          <div>Served by: {t.staffName || 'Staff'}</div>
          <div style={{ marginTop: 8 }}>Thank you for visiting!</div>
          <div>☕ 92Parameters ☕</div>
        </div>
      </div>
    </Modal>
  );
}
