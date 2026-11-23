export function reportProductSnapshot(product) {
  let reportingType = product.reportingType;
  const name = String(product.name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!["sale", "packaging", "waste"].includes(reportingType)) {
    if (["milkwastefullcream", "milkwastefullcreammilk"].includes(name))
      reportingType = undefined;
    else if (["Takeout Box", "Packaging"].includes(product.category))
      reportingType = "packaging";
    else if (["Food", "Drinks"].includes(product.category))
      reportingType = "sale";
    else reportingType = undefined;
  }
  return {
    ...(reportingType ? { reportingType } : {}),
    costZeroConfirmed: product.costZeroConfirmed === true,
  };
}
