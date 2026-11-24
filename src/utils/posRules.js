export const ACTIVE_PAYMENT_METHODS = ["Cash", "Card", "Bank Transfer", "Grab"];
export const LEGACY_PAYMENT_METHODS = ["GCash", "Foodpanda"];
const retiredNames = new Set(["milkwastefullcream", "milkwastefullcreammilk"]);
export function isRetiredMilkProduct(product) {
  return retiredNames.has(
    String(product?.name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ""),
  );
}
