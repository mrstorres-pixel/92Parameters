import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, Clock } from 'lucide-react';
import db from '../db/database';
import Modal from '../components/common/Modal';
import { useToast } from '../components/common/Toast';
import { formatDate, formatTime } from '../utils/formatters';

export default function TimeTracking() {
  const [staff, setStaff] = useState([]);
  const [records, setRecords] = useState([]);
  const [capturing, setCapturing] = useState(null); // {staffId, type: 'in'|'out'}
  const [stream, setStream] = useState(null);
  const [filterDate, setFilterDate] = useState(new Date().toISOString().slice(0,10));
  const [viewPhoto, setViewPhoto] = useState(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
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

  async function startCapture(staffId, type) {
    setCapturing({ staffId, type });
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 } });
      setStream(s);
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = s; }, 100);
    } catch { toast('Camera access denied', 'error'); setCapturing(null); }
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
    const today = new Date().toISOString().slice(0,10);

    if (capturing.type === 'in') {
      await db.timeRecords.add({ staffId: capturing.staffId, date: today, timeIn: now, photoIn: photo, timeOut: null, photoOut: null });
      toast('Time In recorded!');
    } else {
      const rec = records.find(r => r.staffId === capturing.staffId && !r.timeOut);
      if (rec) {
        await db.timeRecords.update(rec.id, { timeOut: now, photoOut: photo });
        toast('Time Out recorded!');
      } else { toast('No active time-in found', 'error'); }
    }
    stopCapture(); load();
  }

  const getStaffName = (id) => staff.find(s => s.id === id)?.name || 'Unknown';
  const hasActiveTimeIn = (staffId) => records.some(r => r.staffId === staffId && r.timeIn && !r.timeOut);

  const isToday = filterDate === new Date().toISOString().slice(0,10);

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Time Tracking</h2>
        <div className="search-bar" style={{ background: 'var(--bg-card)' }}>
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)} />
        </div>
      </div>

      {isToday && (
        <>
          <h3 style={{ fontSize: '1rem', marginBottom: 16, color: 'var(--text-secondary)' }}>Select Staff</h3>
          <div className="time-grid" style={{ marginBottom: 32 }}>
            {staff.map(s => {
              const active = hasActiveTimeIn(s.id);
              return (
                <div key={s.id} className="staff-card">
                  <div className="staff-avatar">{s.name.charAt(0)}</div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{s.name}</div>
                  <span className={`badge ${active ? 'badge-success' : 'badge-neutral'}`}>{active ? 'Clocked In' : 'Clocked Out'}</span>
                  <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                    <button className="btn btn-primary btn-sm" disabled={active} onClick={() => startCapture(s.id, 'in')}>Time In</button>
                    <button className="btn btn-secondary btn-sm" disabled={!active} onClick={() => startCapture(s.id, 'out')}>Time Out</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {records.length > 0 && (
        <>
          <h3 style={{ fontSize: '1rem', marginBottom: 16, color: 'var(--text-secondary)' }}>Records for {filterDate}</h3>
          <div className="table-container">
            <table className="data-table">
              <thead><tr><th>Staff</th><th>Time In</th><th>Photo In</th><th>Time Out</th><th>Photo Out</th><th>Duration</th></tr></thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 500 }}>{getStaffName(r.staffId)}</td>
                    <td>{r.timeIn ? formatTime(r.timeIn) : '—'}</td>
                    <td>{r.photoIn ? <img src={r.photoIn} alt="in" onClick={() => setViewPhoto(r.photoIn)} style={{ width: 48, height: 36, borderRadius: 4, objectFit: 'cover', cursor: 'pointer' }} /> : '—'}</td>
                    <td>{r.timeOut ? formatTime(r.timeOut) : <span className="badge badge-success">Active</span>}</td>
                    <td>{r.photoOut ? <img src={r.photoOut} alt="out" onClick={() => setViewPhoto(r.photoOut)} style={{ width: 48, height: 36, borderRadius: 4, objectFit: 'cover', cursor: 'pointer' }} /> : '—'}</td>
                    <td style={{ fontWeight: 600 }}>{getDuration(r.timeIn, r.timeOut)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {capturing && (
        <Modal title={`Time ${capturing.type === 'in' ? 'In' : 'Out'} — ${getStaffName(capturing.staffId)}`} onClose={stopCapture} footer={
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
