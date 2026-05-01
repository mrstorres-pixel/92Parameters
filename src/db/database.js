import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = createClient(supabaseUrl, supabaseKey);

function buildTable(tableName) {
  return {
    async toArray() {
      const { data, error } = await supabase.from(tableName).select('*');
      if (error) console.error(`Error fetching ${tableName}:`, error);
      return data || [];
    },
    async add(obj) {
      // Remove id to let PostgreSQL auto-increment
      const { id, ...rest } = obj;
      const { data, error } = await supabase.from(tableName).insert([rest]).select();
      if (error) console.error(`Error adding to ${tableName}:`, error);
      return data?.[0]?.id;
    },
    async update(id, obj) {
      const { error } = await supabase.from(tableName).update(obj).eq('id', id);
      if (error) console.error(`Error updating ${tableName}:`, error);
    },
    async delete(id) {
      const { error } = await supabase.from(tableName).delete().eq('id', id);
      if (error) console.error(`Error deleting from ${tableName}:`, error);
    },
    async get(id) {
      const { data, error } = await supabase.from(tableName).select('*').eq('id', id).single();
      if (error) console.error(`Error getting from ${tableName}:`, error);
      return data;
    },
    async count() {
      const { count, error } = await supabase.from(tableName).select('*', { count: 'exact', head: true });
      if (error) console.error(`Error counting ${tableName}:`, error);
      return count || 0;
    },
    async bulkAdd(arr) {
      const cleanArr = arr.map(({id, ...rest}) => rest);
      const { error } = await supabase.from(tableName).insert(cleanArr);
      if (error) console.error(`Error bulk adding to ${tableName}:`, error);
    },
    where(field) {
      return {
        equals(value) {
          return {
            async first() {
              const { data, error } = await supabase.from(tableName).select('*').eq(field, value).limit(1);
              if (error) console.error(`Error where.equals.first on ${tableName}:`, error);
              return data?.[0] || null;
            },
            async toArray() {
              const { data, error } = await supabase.from(tableName).select('*').eq(field, value);
              if (error) console.error(`Error where.equals.toArray on ${tableName}:`, error);
              return data || [];
            },
            async delete() {
              const { error } = await supabase.from(tableName).delete().eq(field, value);
              if (error) console.error(`Error where.equals.delete on ${tableName}:`, error);
            }
          };
        },
        above(value) {
          return {
            async toArray() {
              const { data, error } = await supabase.from(tableName).select('*').gt(field, value);
              if (error) console.error(`Error where.above.toArray on ${tableName}:`, error);
              return data || [];
            }
          }
        }
      };
    }
  };
}

const db = {
  staff: buildTable('staff'),
  products: buildTable('products'),
  inventory: buildTable('inventory'),
  ingredients: buildTable('ingredients'),
  productIngredients: buildTable('product_ingredients'),
  productInventory: buildTable('product_inventory'),
  transactions: buildTable('transactions'),
  cashDrawer: buildTable('cash_drawer'),
  timeRecords: buildTable('time_records'),
  voidLog: buildTable('void_log'),
  auditLog: buildTable('audit_log'),
  
  // Dummy functions to keep existing code happy
  version() { return { stores() {} }; },
  transaction() { return null; }
};

export default db;
