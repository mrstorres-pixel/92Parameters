import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createReportingDb, seedRows, business } from './helpers/reportingDb.js';

test('read-only audit SQL and applied cash portions preserve a verifiable snapshot', async () => {
  const db=await createReportingDb();
  try {
    const date=Date.parse('2026-11-18T09:00:00+08:00');
    await seedRows(db,'transactions',[{id:1,receiptNo:'AUDIT',datetime:date,status:'completed',total:95,
      items:[{name:'Food',category:'Food',quantity:1,price:100,cost:40}],orderDiscountAmount:5,
      paymentMethod:'Cash',paymentLines:[{method:'Cash',amount:95}],cashReceived:100}]);
    await seedRows(db,'cash_drawer',[{id:1,datetime:date,type:'out',amount:10,category:'operating_expense',notes:'Salary'}]);
    const before=await business(db);
    assert.equal(before.totals.cashSalesCents,9500);
    const sql=await readFile(new URL('../supabase/audits/reports_v2_readonly.sql',import.meta.url),'utf8');
    const audit=JSON.parse((await db.query(sql)).rows[0].audit);
    assert.equal(audit.costPlusWastePreservesOriginalCost,true);
    assert.equal(audit.categoryAllocationCents,9500);
    assert.equal(audit.recordedPaymentCents,9500);
    assert.equal(audit.originalAllItemCostCents,4000);
    const after=await business(db);assert.deepEqual(before.totals,after.totals);
    assert.equal((await db.query('select count(*) as count from reporting_review_history')).rows[0].count,0);
    await db.query("update cash_drawer set category=null where id=1");
    const changed=await business(db);assert.equal(changed.totals.unclassifiedCount,1);assert.equal(before.totals.unclassifiedCount,0);
    const filtered=(await db.query("select report_cash_v2(0,9999999999999,'cash out',true) as result")).rows[0].result;
    assert.equal(filtered.matchingEntries.length,1);
    assert.equal(filtered.totals.cashOutCents,1000);
  } finally { await db.close(); }
});
