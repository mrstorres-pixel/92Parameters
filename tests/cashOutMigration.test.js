import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('category migration preserves history, is repeatable, and rejects invalid classifications', async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      create table public.cash_drawer (id integer primary key, type text, amount numeric, notes text);
      insert into public.cash_drawer (id, type, amount, notes) values
        (1, 'out', 1000, 'Salary'), (2, 'in', 2000, 'Opening float');
    `);
    const migration = await readFile(new URL('../supabase/migrations/20261024111716_cash_out_categories.sql', import.meta.url), 'utf8');
    await database.exec(migration);
    await database.exec(migration);
    const { rows } = await database.query('select * from public.cash_drawer order by id');
    assert.deepEqual(rows, [
      { id: 1, type: 'out', amount: '1000', notes: 'Salary', category: null },
      { id: 2, type: 'in', amount: '2000', notes: 'Opening float', category: null },
    ]);
    await database.query("update public.cash_drawer set category = 'operating_expense' where id = 1");
    const reviewed = await database.query('select amount, notes, category from public.cash_drawer where id = 1');
    assert.deepEqual(reviewed.rows[0], { amount: '1000', notes: 'Salary', category: 'operating_expense' });
    for (const category of ['stock_purchase', 'owner_withdrawal', null]) {
      await database.query('update public.cash_drawer set category = $1 where id = 1', [category]);
    }
    await assert.rejects(database.query("update public.cash_drawer set category = 'invalid' where id = 1"), /cash_drawer_category_check/);
    await assert.rejects(database.query("update public.cash_drawer set category = 'operating_expense' where id = 2"), /cash_drawer_category_check/);
    await assert.rejects(database.query("insert into public.cash_drawer (id, category) values (3, 'operating_expense')"), /cash_drawer_category_check/);
  } finally { await database.close(); }
});
