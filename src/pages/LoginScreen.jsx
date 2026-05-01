import React, { useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import db from '../db/database';

export default function LoginScreen() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const login = useAuthStore(s => s.login);

  const handleKey = async (key) => {
    if (key === 'clear') { setPin(''); setError(''); return; }
    if (key === 'back') { setPin(p => p.slice(0, -1)); setError(''); return; }
    const newPin = pin + key;
    if (newPin.length > 4) return;
    setPin(newPin);
    if (newPin.length === 4) {
      const staff = await db.staff.where('pin').equals(newPin).first();
      if (staff) { login(staff); }
      else { setError('Invalid PIN'); setTimeout(() => { setPin(''); setError(''); }, 1000); }
    }
  };

  const keys = ['1','2','3','4','5','6','7','8','9','clear','0','back'];

  return (
    <div className="login-screen">
      <div className="login-card">
        <div style={{ marginBottom: 8 }}>
          <div className="logo-icon" style={{ width: 56, height: 56, fontSize: '1.1rem', margin: '0 auto 12px', background: 'var(--accent)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--bg-primary)', fontWeight: 800 }}>92</div>
        </div>
        <h1>92Parameters</h1>
        <p>Enter your PIN to clock in</p>
        <div className="pin-display">{pin.split('').map(() => '●').join(' ') || '○ ○ ○ ○'}</div>
        {error && <p style={{ color: 'var(--danger)', marginBottom: 16, fontSize: '0.85rem' }}>{error}</p>}
        <div className="pin-pad">
          {keys.map(k => (
            <button key={k} className="pin-key" onClick={() => handleKey(k)}>
              {k === 'clear' ? 'C' : k === 'back' ? '←' : k}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
