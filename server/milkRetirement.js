import { isRetiredMilkProduct } from "../src/utils/posRules.js";

const checked = (result) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};
// Administrative release task only. No financial rows, recipes or stock are changed.
export async function retireMilkProducts(admin, { apply = false } = {}) {
  const products = [];
  for (let offset = 0; ; offset += 500) {
    const rows = checked(
      await admin
        .from("products")
        .select("id,name,isAvailable")
        .order("id")
        .range(offset, offset + 499),
    );
    products.push(...rows.filter(isRetiredMilkProduct));
    if (rows.length < 500) break;
  }
  let changed = 0;
  if (apply)
    for (const product of products) {
      if (product.isAvailable === false) continue;
      const data = {
        productId: product.id,
        previousAvailability: product.isAvailable,
        reason:
          "Retire Milk / Waste from new POS entry; preserve historical receipts, costs, stock and recipe links.",
      };
      // Write intent first, so even a retry after an interrupted release is traceable.
      checked(
        await admin
          .from("app_order_events")
          .insert({ actor_id: null, action: "RETIRE_MILK_REQUEST", data }),
      );
      let update = admin
        .from("products")
        .update({ isAvailable: false })
        .eq("id", product.id);
      update =
        product.isAvailable == null
          ? update.is("isAvailable", null)
          : update.eq("isAvailable", product.isAvailable);
      const rows = checked(await update.select("id"));
      if (rows.length !== 1)
        throw new Error(
          "Product availability changed during retirement. Retry the release audit.",
        );
      checked(
        await admin
          .from("app_order_events")
          .insert({ actor_id: null, action: "RETIRE_MILK_COMPLETE", data }),
      );
      changed++;
    }
  return { matched: products.length, changed };
}
