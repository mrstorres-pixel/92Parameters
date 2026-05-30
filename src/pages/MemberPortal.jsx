import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CreditCard, Gift, ShieldCheck } from 'lucide-react';
import db from '../db/database';
import { extractMemberCode, POINTS_PER_PESO_REDEEMED } from '../utils/loyalty';
import { formatCurrency, formatDateTime } from '../utils/formatters';

export default function MemberPortal() {
  const { code } = useParams();
  const [loading, setLoading] = useState(true);
  const [card, setCard] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => { load(); }, [code]);

  async function load() {
    setLoading(true);
    const cardCode = extractMemberCode(decodeURIComponent(code || ''));
    const foundCard = await db.membershipCards.where('cardCode').equals(cardCode).first();
    setCard(foundCard);
    if (foundCard?.customerId) {
      const foundCustomer = await db.customers.get(foundCard.customerId);
      setCustomer(foundCustomer);
      setHistory(await db.loyaltyTransactions.query({
        filters: [{ field: 'customerId', op: 'eq', value: foundCard.customerId }],
        orderBy: 'datetime',
        ascending: false,
        limit: 10,
      }));
    } else {
      setCustomer(null);
      setHistory([]);
    }
    setLoading(false);
  }

  const firstName = customer?.name ? customer.name.split(' ')[0] : '';
  const points = Number(customer?.pointsBalance || 0);
  const pesoValue = Math.floor(points / POINTS_PER_PESO_REDEEMED);

  return (
    <div className="member-public-page">
      <div className="member-public-card">
        <div className="member-brand">
          <div className="logo-icon">92</div>
          <div>
            <h1>92 Parameters</h1>
            <p>Membership Card</p>
          </div>
        </div>

        {loading ? (
          <div className="empty-state" style={{ padding: 32 }}><p>Checking card...</p></div>
        ) : !card ? (
          <div className="alert-banner alert-danger"><span>This membership card was not found.</span></div>
        ) : card.status === 'available' ? (
          <div className="alert-banner alert-warning"><span>This card has not been registered yet. Please ask staff to activate it after purchase.</span></div>
        ) : card.status !== 'active' ? (
          <div className="alert-banner alert-danger"><span>This membership card is currently {card.status}.</span></div>
        ) : (
          <>
            <div className="member-points">
              <CreditCard size={24} />
              <span>{card.cardCode}</span>
              <strong>{firstName ? `${firstName}'s Points` : 'Current Points'}</strong>
              <div>{points}</div>
              <p>Reward value: {formatCurrency(pesoValue)}</p>
            </div>

            <div className="member-public-info">
              <div><Gift size={18} /><span>{POINTS_PER_PESO_REDEEMED} points = {formatCurrency(1)} discount</span></div>
              <div><ShieldCheck size={18} /><span>Show or scan this card before paying to earn points.</span></div>
            </div>

            <h2>Recent Activity</h2>
            <div className="member-history">
              {history.map(row => (
                <div key={row.id} className="member-history-row">
                  <div>
                    <strong>{row.type}</strong>
                    <span>{formatDateTime(row.datetime)}</span>
                  </div>
                  <b>{row.points > 0 ? '+' : ''}{row.points}</b>
                </div>
              ))}
              {history.length === 0 && <p className="text-muted text-sm">No point activity yet.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
