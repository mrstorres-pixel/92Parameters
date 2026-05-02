import React, { useState, useEffect } from 'react';
import { Search, History } from 'lucide-react';
import db from '../db/database';
import { formatDateTime } from '../utils/formatters';
import { PAGE_SIZE } from '../utils/durability';

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => { load(); }, [page]);

  async function load() {
    setLogs(await db.auditLog.query({ orderBy: 'datetime', ascending: false, limit: PAGE_SIZE, offset: page * PAGE_SIZE }));
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
                      log.action === 'CREATE' || log.action === 'RESTOCK' ? 'badge-success' :
                      log.action === 'UPDATE' ? 'badge-warning' :
                      log.action === 'DEDUCT' || log.action === 'DELETE' ? 'badge-danger' : 'badge-neutral'
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

      <div className="pagination">
        <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>Previous</button>
        <span className="text-sm text-muted">Page {page + 1}</span>
        <button className="btn btn-secondary btn-sm" onClick={() => setPage(p => p + 1)} disabled={logs.length < PAGE_SIZE}>Next</button>
      </div>
    </div>
  );
}
