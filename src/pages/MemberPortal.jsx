import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CreditCard, Gift, ShieldCheck } from 'lucide-react';
import db from '../db/database';
import { extractMemberCode, getBirthdayRewardStatus, getMembershipExpiry, isMembershipExpired, PESOS_PER_POINT_EARNED, POINTS_PER_PESO_REDEEMED } from '../utils/loyalty';
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
  const expired = customer ? isMembershipExpired(customer) : false;
  const birthdayStatus = customer ? getBirthdayRewardStatus(customer) : null;
  const expiresAt = customer?.expiresAt || card?.expiresAt || getMembershipExpiry(customer?.activatedAt || card?.activatedAt);

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
        ) : expired ? (
          <div className="alert-banner alert-danger"><span>This membership expired on {expiresAt ? formatDateTime(expiresAt) : 'its expiration date'}. Please ask staff about renewal.</span></div>
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
              <div><Gift size={18} /><span>Every {formatCurrency(PESOS_PER_POINT_EARNED)} spent earns 1 point. {POINTS_PER_PESO_REDEEMED} point = {formatCurrency(1)} discount.</span></div>
              <div><Gift size={18} /><span>Birthday promo: {birthdayStatus?.reason || 'No birthday set'}. Free cake slice and coffee, once during birthday month.</span></div>
              <div><ShieldCheck size={18} /><span>Show or scan this card before paying to earn points.</span></div>
              <div><ShieldCheck size={18} /><span>Valid until {expiresAt ? formatDateTime(expiresAt) : 'one year after activation'}.</span></div>
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
