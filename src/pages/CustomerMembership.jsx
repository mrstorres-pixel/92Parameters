import React, { useEffect, useMemo, useState } from 'react';
import { Plus, History, Search, CreditCard, Gift, Ban, CheckCircle, Printer, UserPlus, Download, Eye, ExternalLink, Pencil } from 'lucide-react';
import db from '../db/database';
import Modal from '../components/common/Modal';
import { useToast } from '../components/common/Toast';
import { useAuthStore } from '../stores/authStore';
import { formatCurrency, formatDateTime } from '../utils/formatters';
import { generateMembershipCardCode, getBirthdayRewardStatus, getMembershipExpiry, getMemberPortalUrl, getQrImageUrl, isMembershipExpired, PESOS_PER_POINT_EARNED, POINTS_PER_PESO_REDEEMED, writeLoyaltyTransaction } from '../utils/loyalty';

const emptyCustomer = { name: '', phone: '', birthday: '' };

export default function CustomerMembership() {
  const [cards, setCards] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [showGenerate, setShowGenerate] = useState(false);
  const [batchName, setBatchName] = useState('');
  const [batchCount, setBatchCount] = useState(20);
  const [registeringCard, setRegisteringCard] = useState(null);
  const [viewingCard, setViewingCard] = useState(null);
  const [customerForm, setCustomerForm] = useState(emptyCustomer);
  const [historyCustomer, setHistoryCustomer] = useState(null);
  const [historyRows, setHistoryRows] = useState([]);
  const [adjusting, setAdjusting] = useState(null);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [editForm, setEditForm] = useState(emptyCustomer);
  const [adjustPoints, setAdjustPoints] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const currentStaff = useAuthStore(s => s.currentStaff);
  const toast = useToast();

  useEffect(() => { load(); }, []);

  async function load() {
    const [cardRows, customerRows] = await Promise.all([
      db.membershipCards.query({ orderBy: 'createdAt', ascending: false, limit: 2000 }),
      db.customers.query({ orderBy: 'createdAt', ascending: false, limit: 2000 }),
    ]);
    setCards(cardRows);
    setCustomers(customerRows);
  }

  async function generateCards() {
    const count = Math.max(1, Math.min(500, Number(batchCount || 0)));
    const now = Date.now();
    const rows = Array.from({ length: count }, () => ({
      cardCode: generateMembershipCardCode(),
      status: 'available',
      batchName: batchName.trim() || null,
      createdAt: now,
    }));
    try {
      await db.membershipCards.bulkAdd(rows);
      await db.auditLog.add({ action: 'GENERATE_MEMBERSHIP_CARDS', entity: batchName || 'Membership Cards', staffId: currentStaff?.id, staffName: currentStaff?.name, datetime: Date.now(), details: `Generated ${count} cards` });
      toast(`${count} cards generated`);
      setShowGenerate(false);
      setBatchName('');
      setBatchCount(20);
      load();
    } catch (error) {
      console.error(error);
      toast('Could not generate cards', 'error');
    }
  }

  async function registerCard() {
    if (!registeringCard || !customerForm.name.trim()) {
      toast('Customer name is required', 'error');
      return;
    }
    try {
      const now = Date.now();
      const customerData = {
        memberCode: registeringCard.cardCode,
        cardId: registeringCard.id,
        name: customerForm.name.trim(),
        phone: customerForm.phone.trim(),
        birthday: customerForm.birthday || null,
        pointsBalance: 0,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        activatedAt: now,
        expiresAt: getMembershipExpiry(now),
        birthdayRewardYear: null,
      };
      const customerId = await db.customers.add(customerData);
      await db.membershipCards.update(registeringCard.id, {
        status: 'active',
        customerId,
        customerName: customerData.name,
        activatedAt: now,
        expiresAt: customerData.expiresAt,
      });
      await db.auditLog.add({ action: 'ACTIVATE_MEMBERSHIP_CARD', entity: registeringCard.cardCode, entityId: registeringCard.id, staffId: currentStaff?.id, staffName: currentStaff?.name, datetime: now, details: `Activated for ${customerData.name}` });
      toast('Membership card activated');
      setRegisteringCard(null);
      setCustomerForm(emptyCustomer);
      load();
    } catch (error) {
      console.error(error);
      toast('Could not activate card. Check if the card is already registered.', 'error');
    }
  }

  async function setCardStatus(card, status) {
    try {
      await db.membershipCards.update(card.id, { status, disabledAt: status === 'disabled' ? Date.now() : null });
      if (card.customerId) await db.customers.update(card.customerId, { status: status === 'active' ? 'active' : 'inactive', updatedAt: Date.now() });
      toast(status === 'active' ? 'Card reactivated' : 'Card disabled');
      load();
    } catch {
      toast('Could not update card', 'error');
    }
  }

  async function openHistory(customer) {
    setHistoryCustomer(customer);
    setHistoryRows(await db.loyaltyTransactions.query({
      filters: [{ field: 'customerId', op: 'eq', value: customer.id }],
      orderBy: 'datetime',
      ascending: false,
      limit: 100,
    }));
  }

  async function applyAdjustment() {
    const points = Number(adjustPoints || 0);
    if (!adjusting || !points || !adjustReason.trim()) {
      toast('Enter points and a reason', 'error');
      return;
    }
    try {
      await writeLoyaltyTransaction({ customer: adjusting, type: 'ADJUST', points, details: adjustReason.trim(), staff: currentStaff });
      toast('Points adjusted');
      setAdjusting(null);
      setAdjustPoints('');
      setAdjustReason('');
      load();
    } catch {
      toast('Could not adjust points', 'error');
    }
  }

  function openEditCustomer(customer) {
    setEditingCustomer(customer);
    setEditForm({
      name: customer.name || '',
      phone: customer.phone || '',
      birthday: customer.birthday || '',
    });
  }

  async function saveCustomerDetails() {
    if (!editingCustomer || !editForm.name.trim()) {
      toast('Customer name is required', 'error');
      return;
    }
    const updates = {
      name: editForm.name.trim(),
      phone: editForm.phone.trim(),
      birthday: editForm.birthday || null,
      updatedAt: Date.now(),
    };
    try {
      await db.customers.update(editingCustomer.id, updates);
      const cardId = editingCustomer.cardId || cards.find(card => card.customerId === editingCustomer.id)?.id;
      if (cardId) await db.membershipCards.update(cardId, { customerName: updates.name });
      await db.auditLog.add({
        action: 'UPDATE_CUSTOMER_MEMBERSHIP',
        entity: updates.name,
        entityId: editingCustomer.id,
        staffId: currentStaff?.id,
        staffName: currentStaff?.name,
        datetime: Date.now(),
        details: `Updated membership customer details for ${updates.name}`,
      });
      toast('Customer details updated');
      setEditingCustomer(null);
      setEditForm(emptyCustomer);
      await load();
      if (viewingCard?.customerId === editingCustomer.id) {
        setViewingCard(current => current ? { ...current, customerName: updates.name } : current);
      }
    } catch (error) {
      console.error(error);
      toast('Could not update customer details', 'error');
    }
  }

  function exportCardsCsv() {
    const rows = [['cardCode', 'status', 'memberUrl', 'batchName', 'customerName']];
    cards.forEach(card => rows.push([card.cardCode, card.status, getMemberPortalUrl(card.cardCode), card.batchName || '', card.customerName || '']));
    const csv = rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `membership-cards-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function printCards() {
    const available = filteredCards.filter(card => card.status === 'available');
    const html = available.map(card => {
      const url = getMemberPortalUrl(card.cardCode);
      return `<div class="print-card"><img src="${getQrImageUrl(url, 180)}" /><h3>92 PARAMETERS</h3><p>${card.cardCode}</p><small>${url}</small></div>`;
    }).join('');
    const win = window.open('', '_blank');
    win.document.write(`<html><head><title>Membership Cards</title><style>body{font-family:Arial,sans-serif;padding:20px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.print-card{border:1px solid #222;border-radius:10px;padding:12px;text-align:center;page-break-inside:avoid}.print-card img{width:120px;height:120px}.print-card h3{margin:6px 0;font-size:14px}.print-card p{font-weight:700;font-size:12px}.print-card small{font-size:8px;word-break:break-all}@media print{button{display:none}.grid{gap:8px}}</style></head><body><button onclick="window.print()">Print</button><div class="grid">${html}</div></body></html>`);
    win.document.close();
  }

  const customerById = useMemo(() => Object.fromEntries(customers.map(c => [c.id, c])), [customers]);
  const q = search.toLowerCase();
  const filteredCards = cards.filter(card => !q ||
    (card.cardCode || '').toLowerCase().includes(q) ||
    (card.customerName || '').toLowerCase().includes(q) ||
    (card.batchName || '').toLowerCase().includes(q));
  const availableCount = cards.filter(c => c.status === 'available').length;
  const activeCount = cards.filter(c => c.status === 'active').length;
  const totalPoints = customers.reduce((sum, c) => sum + Number(c.pointsBalance || 0), 0);
  const viewingCustomer = viewingCard?.customerId ? customerById[viewingCard.customerId] : null;
  const viewingUrl = viewingCard ? getMemberPortalUrl(viewingCard.cardCode) : '';

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Membership Cards</h2>
        <div className="flex gap-8">
          <button className="btn btn-secondary" onClick={exportCardsCsv}><Download size={16} /> Export</button>
          <button className="btn btn-secondary" onClick={printCards}><Printer size={16} /> Print Available</button>
          <button className="btn btn-primary" onClick={() => setShowGenerate(true)}><Plus size={16} /> Generate Cards</button>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card"><div className="stat-label">Generated Cards</div><div className="stat-value">{cards.length}</div></div>
        <div className="stat-card"><div className="stat-label">Available / Unsold</div><div className="stat-value">{availableCount}</div></div>
        <div className="stat-card"><div className="stat-label">Active Members</div><div className="stat-value">{activeCount}</div></div>
        <div className="stat-card"><div className="stat-label">Outstanding Points</div><div className="stat-value">{totalPoints}</div></div>
      </div>

      <div className="alert-banner alert-info mb-24">
        <Gift size={18} />
        <span>Generate cards first, print the QR cards, then activate/register the card only when a customer buys it. Earn rate: every {formatCurrency(PESOS_PER_POINT_EARNED)} = 1 point. Redeem rate: {POINTS_PER_PESO_REDEEMED} point = {formatCurrency(1)}.</span>
      </div>

      <div className="toolbar">
        <div className="search-bar"><Search size={16} /><input placeholder="Search card, batch, or customer..." value={search} onChange={e => setSearch(e.target.value)} /></div>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead><tr><th>Card Code</th><th>Status</th><th>Customer</th><th>Points</th><th>Batch</th><th>QR / Link</th><th>Actions</th></tr></thead>
          <tbody>
            {filteredCards.map(card => {
              const customer = card.customerId ? customerById[card.customerId] : null;
              const expired = customer ? isMembershipExpired(customer) : false;
              return (
                <tr key={card.id} className={card.customerId ? 'clickable' : ''} onClick={() => card.customerId && setViewingCard(card)}>
                  <td style={{ fontWeight: 700 }}>{card.cardCode}</td>
                  <td><span className={`badge ${expired ? 'badge-danger' : card.status === 'active' ? 'badge-success' : card.status === 'available' ? 'badge-warning' : 'badge-danger'}`}>{expired ? 'expired' : card.status}</span></td>
                  <td>{card.customerName || '-'}</td>
                  <td style={{ fontWeight: 700, color: 'var(--accent)' }}>{customer?.pointsBalance ?? '-'}</td>
                  <td>{card.batchName || '-'}</td>
                  <td><a className="text-sm" href={`#/member/${encodeURIComponent(card.cardCode)}`} target="_blank" rel="noreferrer">Open points page</a></td>
                  <td>
                    <div className="flex gap-8">
                      {card.customerId && <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); setViewingCard(card); }} title="View Card"><Eye size={14} /></button>}
                      {card.status === 'available' && <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setRegisteringCard(card)} title="Register Sold Card"><UserPlus size={14} /></button>}
                      {customer && <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); openEditCustomer(customer); }} title="Edit Customer"><Pencil size={14} /></button>}
                      {customer && <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); openHistory(customer); }} title="History"><History size={14} /></button>}
                      {customer && <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); setAdjusting(customer); }} title="Adjust Points"><Gift size={14} /></button>}
                      {card.status === 'active'
                        ? <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); setCardStatus(card, 'disabled'); }} title="Disable"><Ban size={14} /></button>
                        : card.status === 'disabled' && <button className="btn btn-ghost btn-icon btn-sm" onClick={(e) => { e.stopPropagation(); setCardStatus(card, 'active'); }} title="Reactivate"><CheckCircle size={14} /></button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showGenerate && (
        <Modal title="Generate Membership Cards" onClose={() => setShowGenerate(false)} footer={
          <><button className="btn btn-secondary" onClick={() => setShowGenerate(false)}>Cancel</button><button className="btn btn-primary" onClick={generateCards}>Generate</button></>
        }>
          <div className="form-group"><label className="form-label">Batch Name</label><input className="form-input" value={batchName} onChange={e => setBatchName(e.target.value)} placeholder="e.g. June 2026 Batch" /></div>
          <div className="form-group"><label className="form-label">Number of Cards</label><input className="form-input" type="number" min="1" max="500" value={batchCount} onChange={e => setBatchCount(e.target.value)} /></div>
        </Modal>
      )}

      {registeringCard && (
        <Modal title={`Register Card ${registeringCard.cardCode}`} onClose={() => setRegisteringCard(null)} footer={
          <><button className="btn btn-secondary" onClick={() => setRegisteringCard(null)}>Cancel</button><button className="btn btn-primary" onClick={registerCard}>Activate Card</button></>
        }>
          <div className="membership-card mb-16">
            <img src={getQrImageUrl(getMemberPortalUrl(registeringCard.cardCode), 120)} alt="Membership QR" style={{ width: 84, height: 84 }} />
            <div>
              <div style={{ fontWeight: 800 }}>{registeringCard.cardCode}</div>
              <div className="text-muted text-sm">This card becomes active after customer details are saved.</div>
            </div>
          </div>
          <div className="form-group"><label className="form-label">Customer Name</label><input className="form-input" value={customerForm.name} onChange={e => setCustomerForm({ ...customerForm, name: e.target.value })} autoFocus /></div>
          <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={customerForm.phone} onChange={e => setCustomerForm({ ...customerForm, phone: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">Birthday</label><input className="form-input" type="date" value={customerForm.birthday || ''} onChange={e => setCustomerForm({ ...customerForm, birthday: e.target.value })} /></div>
        </Modal>
      )}

      {viewingCard && (
        <Modal title={`Membership Card ${viewingCard.cardCode}`} large onClose={() => setViewingCard(null)} footer={
          <>
            {viewingCustomer && <button className="btn btn-secondary" onClick={() => openHistory(viewingCustomer)}><History size={14} /> History</button>}
            {viewingCustomer && <button className="btn btn-secondary" onClick={() => openEditCustomer(viewingCustomer)}><Pencil size={14} /> Edit Customer</button>}
            {viewingCustomer && <button className="btn btn-secondary" onClick={() => setAdjusting(viewingCustomer)}><Gift size={14} /> Adjust Points</button>}
            <button className="btn btn-primary" onClick={() => setViewingCard(null)}>Close</button>
          </>
        }>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 20, alignItems: 'start' }}>
            <div className="membership-card" style={{ flexDirection: 'column', textAlign: 'center' }}>
              <img src={getQrImageUrl(viewingUrl, 220)} alt="Membership QR" style={{ width: 160, height: 160 }} />
              <div style={{ fontWeight: 800 }}>{viewingCard.cardCode}</div>
              <a href={`#/member/${encodeURIComponent(viewingCard.cardCode)}`} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm"><ExternalLink size={14} /> Open Page</a>
            </div>
            <div>
              <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', marginBottom: 16 }}>
                <div className="stat-card"><div className="stat-label">Status</div><div className="stat-value" style={{ fontSize: '1.05rem' }}>{viewingCard.status}</div></div>
                <div className="stat-card"><div className="stat-label">Points</div><div className="stat-value">{viewingCustomer?.pointsBalance || 0}</div></div>
              </div>
              <table className="summary-table">
                <tbody>
                  <tr><th>Customer</th><td>{viewingCustomer?.name || viewingCard.customerName || '-'}</td></tr>
                  <tr><th>Phone</th><td>{viewingCustomer?.phone || '-'}</td></tr>
                  <tr><th>Birthday</th><td>{viewingCustomer?.birthday || '-'}</td></tr>
                  <tr><th>Birthday Promo</th><td>{viewingCustomer ? getBirthdayRewardStatus(viewingCustomer).reason : '-'}</td></tr>
                  <tr><th>Batch</th><td>{viewingCard.batchName || '-'}</td></tr>
                  <tr><th>Activated</th><td>{viewingCard.activatedAt ? formatDateTime(viewingCard.activatedAt) : '-'}</td></tr>
                  <tr><th>Expires</th><td>{viewingCustomer?.expiresAt ? formatDateTime(viewingCustomer.expiresAt) : viewingCard.expiresAt ? formatDateTime(viewingCard.expiresAt) : '-'}</td></tr>
                  <tr><th>Member URL</th><td style={{ overflowWrap: 'anywhere' }}>{viewingUrl}</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}

      {adjusting && (
        <Modal title={`Adjust Points - ${adjusting.name}`} onClose={() => setAdjusting(null)} footer={
          <><button className="btn btn-secondary" onClick={() => setAdjusting(null)}>Cancel</button><button className="btn btn-primary" onClick={applyAdjustment}>Apply</button></>
        }>
          <div className="form-group"><label className="form-label">Current Points</label><div className="form-input" style={{ background: 'var(--bg-card)' }}>{adjusting.pointsBalance || 0}</div></div>
          <div className="form-group"><label className="form-label">Point Adjustment</label><input className="form-input" type="number" value={adjustPoints} onChange={e => setAdjustPoints(e.target.value)} placeholder="Use negative value to deduct" autoFocus /></div>
          <div className="form-group"><label className="form-label">Reason</label><input className="form-input" value={adjustReason} onChange={e => setAdjustReason(e.target.value)} placeholder="Manual correction, promo, etc." /></div>
        </Modal>
      )}

      {editingCustomer && (
        <Modal title={`Edit Customer - ${editingCustomer.name}`} onClose={() => setEditingCustomer(null)} footer={
          <><button className="btn btn-secondary" onClick={() => setEditingCustomer(null)}>Cancel</button><button className="btn btn-primary" onClick={saveCustomerDetails}>Save Changes</button></>
        }>
          <div className="form-group"><label className="form-label">Customer Name</label><input className="form-input" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} autoFocus /></div>
          <div className="form-group"><label className="form-label">Phone</label><input className="form-input" value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} /></div>
          <div className="form-group"><label className="form-label">Birthday</label><input className="form-input" type="date" value={editForm.birthday || ''} onChange={e => setEditForm({ ...editForm, birthday: e.target.value })} /></div>
        </Modal>
      )}

      {historyCustomer && (
        <Modal title={`${historyCustomer.name} Loyalty History`} large onClose={() => setHistoryCustomer(null)} footer={<button className="btn btn-primary" onClick={() => setHistoryCustomer(null)}>Close</button>}>
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>Date</th><th>Type</th><th>Points</th><th>Balance</th><th>Receipt</th><th>Details</th></tr></thead>
              <tbody>
                {historyRows.map(row => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.datetime)}</td>
                    <td><span className="badge badge-neutral">{row.type}</span></td>
                    <td style={{ fontWeight: 700, color: row.points >= 0 ? 'var(--success)' : 'var(--danger)' }}>{row.points > 0 ? '+' : ''}{row.points}</td>
                    <td>{row.afterPoints}</td>
                    <td>{row.receiptNo || '-'}</td>
                    <td>{row.details || '-'}</td>
                  </tr>
                ))}
                {historyRows.length === 0 && <tr><td colSpan={6} className="text-center text-muted">No loyalty history yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}
