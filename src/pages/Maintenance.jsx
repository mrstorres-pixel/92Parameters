import React, { useState } from 'react';
import { Download, Database, ShieldCheck } from 'lucide-react';
import db from '../db/database';
import { downloadJson, toBusinessDate } from '../utils/durability';
import { useToast } from '../components/common/Toast';

const TABLES = [
  ['staff', db.staff],
  ['products', db.products],
  ['inventory', db.inventory],
  ['ingredients', db.ingredients],
  ['productIngredients', db.productIngredients],
  ['productInventory', db.productInventory],
  ['transactions', db.transactions],
  ['cashDrawer', db.cashDrawer],
  ['timeRecords', db.timeRecords],
  ['voidLog', db.voidLog],
  ['auditLog', db.auditLog],
];

export default function Maintenance() {
  const [exporting, setExporting] = useState(false);
  const toast = useToast();

  async function exportAll() {
    setExporting(true);
    try {
      const entries = await Promise.all(TABLES.map(async ([name, table]) => [name, await table.toArray()]));
      downloadJson(`92parameters-backup-${toBusinessDate()}.json`, {
        exportedAt: new Date().toISOString(),
        version: '1.0',
        tables: Object.fromEntries(entries),
      });
      toast('Backup exported', 'success');
    } catch (error) {
      console.error('Export failed:', error);
      toast('Could not export backup. Please check the connection.', 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="animate-fade">
      <div className="page-header">
        <h2>Maintenance</h2>
      </div>

      <div className="dashboard-grid">
        <div className="card">
          <div className="card-header">
            <div className="card-title"><Database size={18} style={{ verticalAlign: 'text-bottom', marginRight: 8 }} /> Data Backup</div>
          </div>
          <p className="text-sm text-muted mb-16">Export a full JSON backup of operational tables for off-site storage.</p>
          <button className="btn btn-primary" onClick={exportAll} disabled={exporting}>
            <Download size={16} /> {exporting ? 'Exporting...' : 'Export Full Backup'}
          </button>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title"><ShieldCheck size={18} style={{ verticalAlign: 'text-bottom', marginRight: 8 }} /> Year-Long Stability</div>
          </div>
          <div className="table-container">
            <table className="data-table">
              <tbody>
                <tr><td>Server-side date filtering</td><td><span className="badge badge-success">Enabled</span></td></tr>
                <tr><td>Paginated logs</td><td><span className="badge badge-success">Enabled</span></td></tr>
                <tr><td>Visible write failures</td><td><span className="badge badge-success">Enabled</span></td></tr>
                <tr><td>Daily summary tables</td><td><span className="badge badge-warning">Requires migration</span></td></tr>
                <tr><td>Ingredient movement ledger</td><td><span className="badge badge-warning">Requires migration</span></td></tr>
                <tr><td>Database indexes and constraints</td><td><span className="badge badge-warning">Requires migration</span></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
