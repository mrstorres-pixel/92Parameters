import React, { useState, useEffect, useRef } from 'react';
import { Camera } from 'lucide-react';
import db from '../db/database';
import Modal from '../components/common/Modal';
import { useToast } from '../components/common/Toast';
import { useAuthStore } from '../stores/authStore';
import { formatTime, formatCurrency } from '../utils/formatters';

function getLocalDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function TimeTracking() {
  const [staff, setStaff] = useState([]);
  const [records, setRecords] = useState([]);
  const [capturing, setCapturing] = useState(null); // {staffId, type: 'in'|'out'}
  const [stream, setStream] = useState(null);
  const [filterDate, setFilterDate] = useState(getLocalDateValue());
  const [viewPhoto, setViewPhoto] = useState(null);
  const [pinPrompt, setPinPrompt] = useState(null);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState('');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const currentStaff = useAuthStore(s => s.currentStaff);
  const isOwner = currentStaff?.role === 'owner';
  const toast = useToast();

  useEffect(() => { load(); }, [filterDate]);
  async function load() {
    setStaff(await db.staff.toArray());
    setRecords(await db.timeRecords.where('date').equals(filterDate).toArray());
  }

  function getDuration(inTime, outTime) {
    if (!outTime) return '—';
    const diff = outTime - inTime;
    const hrs = Math.floor(diff/3600000);
    const mins = Math.floor((diff%3600000)/60000);
    return `${hrs}h ${mins}m`;
  }

  function startCapture(staffId, type) {
    setPinPrompt({ staffId, type });
    setPinValue('');
    setPinError('');
  }

  async function beginCapture(staffId, type) {
    setCapturing({ staffId, type });
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 } });
      setStream(s);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = s; }, 100);
    } catch { toast('Camera access denied', 'error'); setCapturing(null); }
  }

  async function confirmPin() {
    if (!pinPrompt) return;
    const selected = staff.find(s => s.id === pinPrompt.staffId);
    if (!selected?.pin) {
      setPinError('This profile needs a PIN before time tracking.');
      return;
    }
    if (pinValue !== selected.pin) {
      setPinError('Invalid PIN');
      setPinValue('');
      return;
    }
    const nextCapture = pinPrompt;
    setPinPrompt(null);
    setPinValue('');
    setPinError('');
    await beginCapture(nextCapture.staffId, nextCapture.type);
  }

  function stopCapture() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    setStream(null); setCapturing(null);
  }

  async function takePhoto() {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = 320; canvas.height = 240;
    canvas.getContext('2d').drawImage(videoRef.current, 0, 0, 320, 240);
    const photo = canvas.toDataURL('image/jpeg', 0.7);
    const now = Date.now();
    const today = getLocalDateValue();

    if (capturing.type === 'in') {
      await db.timeRecords.add({ staffId: capturing.staffId, date: today, timeIn: now, photoIn: photo, timeOut: null, photoOut: null, salaryEarned: 0 });
      toast('Time In recorded!');
    } else {
      const rec = records.find(r => r.staffId === capturing.staffId && !r.timeOut);
      if (rec) {
        const s = staff.find(x => x.id === capturing.staffId);
        const hourlyRate = s?.hourlyRate || 0;
        const diff = now - rec.timeIn;
        const hoursWorked = diff / 3600000; // milliseconds to hours
        const salaryEarned = hoursWorked * hourlyRate;

        await db.timeRecords.update(rec.id, { timeOut: now, photoOut: photo, salaryEarned });
        toast('Time Out recorded!');
      } else { toast('No active time-in found', 'error'); }
    }
    stopCapture(); load();
  }

  const getStaffName = (id) => staff.find(s => s.id === id)?.name || 'Unknown';
  const hasActiveTimeIn = (staffId) => records.some(r => r.staffId === staffId && r.timeIn && !r.timeOut);
  const attendanceStaff = staff.filter(s => s.role === 'staff' || s.role === 'manager');

  const isToday = filterDate === getLocalDateValue();

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Time Tracking</h2>
        {isOwner && (
          <div className="search-bar" style={{ background: 'var(--bg-card)' }}>
            <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} />
          </div>
        )}
      </div>

      {isToday && (
        <>
          <h3 style={{ fontSize: '1rem', marginBottom: 16, color: 'var(--text-secondary)' }}>Select Staff</h3>
          <div className="time-grid" style={{ marginBottom: 32 }}>
            {attendanceStaff.map(s => {
              const active = hasActiveTimeIn(s.id);
              return (
                <div key={s.id} className="staff-card">
                  {s.profileImage ? (
                    <img src={s.profileImage} alt="profile" style={{ width: 48, height: 48, borderRadius: 24, objectFit: 'cover', margin: '0 auto 8px' }} />
                  ) : (
                    <div className="staff-avatar">{s.name.charAt(0)}</div>
                  )}
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{s.name}</div>
                  <span className={`badge ${active ? 'badge-success' : 'badge-neutral'}`}>{active ? 'Clocked In' : 'Clocked Out'}</span>
                  <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                    <button className="btn btn-primary btn-sm" disabled={active} onClick={() => startCapture(s.id, 'in')}>Time In</button>
                    <button className="btn btn-secondary btn-sm" disabled={!active} onClick={() => startCapture(s.id, 'out')}>Time Out</button>
                  </div>
                </div>
              );
            })}
            {attendanceStaff.length === 0 && (
              <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
                <p>No staff or managers found for time tracking.</p>
              </div>
            )}
          </div>
        </>
      )}

      {isOwner && records.length > 0 && (
        <>
          <h3 style={{ fontSize: '1rem', marginBottom: 16, color: 'var(--text-secondary)' }}>Records for {filterDate}</h3>
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>Staff</th><th>Time In</th><th>Photo In</th><th>Time Out</th><th>Photo Out</th><th>Duration</th><th>Earned</th></tr></thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 500 }}>{getStaffName(r.staffId)}</td>
                    <td>{r.timeIn ? formatTime(r.timeIn) : '—'}</td>
                    <td>{r.photoIn ? <img src={r.photoIn} alt="in" onClick={() => setViewPhoto(r.photoIn)} style={{ width: 48, height: 36, borderRadius: 4, objectFit: 'cover', cursor: 'pointer' }} /> : '—'}</td>
                    <td>{r.timeOut ? formatTime(r.timeOut) : <span className="badge badge-success">Active</span>}</td>
                    <td>{r.photoOut ? <img src={r.photoOut} alt="out" onClick={() => setViewPhoto(r.photoOut)} style={{ width: 48, height: 36, borderRadius: 4, objectFit: 'cover', cursor: 'pointer' }} /> : '—'}</td>
                    <td style={{ fontWeight: 600 }}>{getDuration(r.timeIn, r.timeOut)}</td>
                    <td style={{ fontWeight: 600, color: 'var(--success)' }}>{r.timeOut ? formatCurrency(r.salaryEarned || 0) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {pinPrompt && (
        <Modal title={`Confirm PIN - ${getStaffName(pinPrompt.staffId)}`} onClose={() => setPinPrompt(null)} footer={
          <>
            <button className="btn btn-secondary" onClick={() => setPinPrompt(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={confirmPin} disabled={pinValue.length !== 4}>Continue</button>
          </>
        }>
          <div className="form-group">
            <label className="form-label">Employee PIN</label>
            <input
              className="form-input"
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pinValue}
              onChange={e => {
                setPinValue(e.target.value.replace(/\D/g, ''));
                setPinError('');
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && pinValue.length === 4) confirmPin();
              }}
              placeholder="Enter 4-digit PIN"
              autoFocus
            />
          </div>
          {pinError && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{pinError}</p>}
        </Modal>
      )}

      {capturing && (
        <Modal title={`Time ${capturing.type === 'in' ? 'In' : 'Out'} - ${getStaffName(capturing.staffId)}`} onClose={stopCapture} footer={
          <><button className="btn btn-secondary" onClick={stopCapture}>Cancel</button><button className="btn btn-primary" onClick={takePhoto}><Camera size={16} /> Capture</button></>
        }>
          <div className="webcam-container">
            <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', borderRadius: 'var(--radius)' }} />
          </div>
          <canvas ref={canvasRef} style={{ display: 'none' }} />
          <p className="text-center text-muted text-sm">Position your face in the camera and click Capture</p>
        </Modal>
      )}

      {viewPhoto && (
        <Modal title="Photo Verification" onClose={() => setViewPhoto(null)}>
          <img src={viewPhoto} alt="Verification" style={{ width: '100%', borderRadius: 'var(--radius)' }} />
        </Modal>
      )}
    </div>
  );
}
