import db from '../db/database';

export async function adjustIngredientStock(ingredient, delta) {
  try {
    const rows = await db.rpc('adjust_ingredient_stock', {
      p_ingredient_id: ingredient.id,
      p_delta: delta,
    });
    const result = rows?.[0];
    if (result) {
      return {
        beforeStock: Number(result.before_stock),
        afterStock: Number(result.after_stock),
      };
    }
  } catch (error) {
    console.warn('Atomic ingredient stock adjustment unavailable; using app fallback.', error);
  }

  const beforeStock = Number(ingredient.inStock || 0);
  const afterStock = Math.max(0, beforeStock + Number(delta || 0));
  await db.ingredients.update(ingredient.id, { inStock: afterStock });
  return { beforeStock, afterStock };
}
