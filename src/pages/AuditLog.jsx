import React, { useState, useEffect } from 'react';
import { Search, History } from 'lucide-react';
import db from '../db/database';
import { formatDateTime } from '../utils/formatters';

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    const allLogs = await db.auditLog.toArray();
    setLogs(allLogs.sort((a, b) => b.datetime - a.datetime));
  }

  const filtered = logs.filter(l => 
    (l.entity || '').toLowerCase().includes(search.toLowerCase()) ||
    (l.action || '').toLowerCase().includes(search.toLowerCase()) ||
    (l.staffName || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2><History size={24} style={{ display: 'inline', marginRight: 8, verticalAlign: 'text-bottom' }}/> Inventory Audit Log</h2>
      </div>

      <div className="toolbar">
        <div className="search-bar">
          <Search size={16} />
          <input placeholder="Search item, action, staff..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="empty-state">
          <History size={48} />
          <p>No audit logs available yet.</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Action</th>
                <th>Item / Entity</th>
                <th>Staff</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(log => (
                <tr key={log.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(log.datetime)}</td>
                  <td>
                    <span className={`badge ${
                      log.action === 'CREATE' ? 'badge-success' : 
                      log.action === 'UPDATE' ? 'badge-warning' : 'badge-danger'
                    }`}>
                      {log.action}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{log.entity}</td>
                  <td>{log.staffName || 'System'}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: 300 }}>
                    {log.details}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
