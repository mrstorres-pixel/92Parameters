import db from '../db/database.js';

export async function seedDatabase() {
  const staffCount = await db.staff.count();
  if (staffCount > 0) return;

  await db.staff.bulkAdd([
    { name: 'Roberto Owner', pin: '1111', role: 'owner' },
    { name: 'Maria Santos', pin: '1234', role: 'manager' },
    { name: 'Juan Dela Cruz', pin: '5678', role: 'cashier' },
    { name: 'Ana Reyes', pin: '9012', role: 'cashier' },
  ]);

  await db.products.bulkAdd([
    { name: 'Espresso', category: 'Drinks', price: 120, cost: 35, isAvailable: true },
    { name: 'Americano', category: 'Drinks', price: 140, cost: 38, isAvailable: true },
    { name: 'Café Latte', category: 'Drinks', price: 160, cost: 50, isAvailable: true },
    { name: 'Cappuccino', category: 'Drinks', price: 160, cost: 50, isAvailable: true },
    { name: 'Caramel Macchiato', category: 'Drinks', price: 180, cost: 58, isAvailable: true },
    { name: 'Mocha', category: 'Drinks', price: 170, cost: 55, isAvailable: true },
    { name: 'Matcha Latte', category: 'Drinks', price: 175, cost: 60, isAvailable: true },
    { name: 'Iced Tea', category: 'Drinks', price: 100, cost: 20, isAvailable: true },
    { name: 'Hot Chocolate', category: 'Drinks', price: 150, cost: 45, isAvailable: true },
    { name: 'Croissant', category: 'Food', price: 95, cost: 30, isAvailable: true },
    { name: 'Blueberry Muffin', category: 'Food', price: 85, cost: 28, isAvailable: true },
    { name: 'Chocolate Cake Slice', category: 'Food', price: 130, cost: 45, isAvailable: true },
    { name: 'Cheesecake Slice', category: 'Food', price: 140, cost: 50, isAvailable: true },
    { name: 'Ham & Cheese Sandwich', category: 'Food', price: 150, cost: 55, isAvailable: true },
    { name: 'Chicken Pesto Panini', category: 'Food', price: 175, cost: 65, isAvailable: true },
    { name: 'Caesar Salad', category: 'Food', price: 160, cost: 50, isAvailable: true },
  ]);

  await db.inventory.bulkAdd([
    { name: '12oz Paper Cup', category: 'Cups', inStock: 500, price: 5, cost: 3 },
    { name: '16oz Paper Cup', category: 'Cups', inStock: 400, price: 6, cost: 3.5 },
    { name: 'Cup Lid', category: 'Cups', inStock: 800, price: 2, cost: 1 },
    { name: 'Paper Straw', category: 'Accessories', inStock: 1000, price: 3, cost: 1.5 },
    { name: 'Napkins (pack)', category: 'Accessories', inStock: 200, price: 15, cost: 8 },
    { name: 'Takeaway Bag', category: 'Packaging', inStock: 300, price: 5, cost: 2.5 },
    { name: 'Cake Box', category: 'Packaging', inStock: 150, price: 12, cost: 6 },
    { name: 'Plastic Fork', category: 'Utensils', inStock: 500, price: 2, cost: 0.8 },
  ]);

  await db.ingredients.bulkAdd([
    { name: 'Coffee Beans', unit: 'g', inStock: 5000, unitCost: 0.8, lowThreshold: 500 },
    { name: 'Whole Milk', unit: 'ml', inStock: 10000, unitCost: 0.08, lowThreshold: 2000 },
    { name: 'Oat Milk', unit: 'ml', inStock: 3000, unitCost: 0.15, lowThreshold: 500 },
    { name: 'Sugar', unit: 'g', inStock: 3000, unitCost: 0.05, lowThreshold: 500 },
    { name: 'Caramel Syrup', unit: 'ml', inStock: 2000, unitCost: 0.2, lowThreshold: 300 },
    { name: 'Chocolate Syrup', unit: 'ml', inStock: 2000, unitCost: 0.18, lowThreshold: 300 },
    { name: 'Matcha Powder', unit: 'g', inStock: 500, unitCost: 2.5, lowThreshold: 100 },
    { name: 'Vanilla Syrup', unit: 'ml', inStock: 1500, unitCost: 0.2, lowThreshold: 300 },
    { name: 'Whipped Cream', unit: 'g', inStock: 2000, unitCost: 0.3, lowThreshold: 400 },
    { name: 'Ice', unit: 'pcs', inStock: 5000, unitCost: 0.1, lowThreshold: 500 },
  ]);

  // Link some products to ingredients
  const products = await db.products.toArray();
  const ingredients = await db.ingredients.toArray();
  const find = (arr, name) => arr.find(x => x.name === name);

  const links = [
    { product: 'Espresso', ingredient: 'Coffee Beans', quantity: 18 },
    { product: 'Americano', ingredient: 'Coffee Beans', quantity: 18 },
    { product: 'Café Latte', ingredient: 'Coffee Beans', quantity: 18 },
    { product: 'Café Latte', ingredient: 'Whole Milk', quantity: 200 },
    { product: 'Cappuccino', ingredient: 'Coffee Beans', quantity: 18 },
    { product: 'Cappuccino', ingredient: 'Whole Milk', quantity: 150 },
    { product: 'Caramel Macchiato', ingredient: 'Coffee Beans', quantity: 18 },
    { product: 'Caramel Macchiato', ingredient: 'Whole Milk', quantity: 200 },
    { product: 'Caramel Macchiato', ingredient: 'Caramel Syrup', quantity: 30 },
    { product: 'Mocha', ingredient: 'Coffee Beans', quantity: 18 },
    { product: 'Mocha', ingredient: 'Whole Milk', quantity: 180 },
    { product: 'Mocha', ingredient: 'Chocolate Syrup', quantity: 30 },
    { product: 'Matcha Latte', ingredient: 'Matcha Powder', quantity: 5 },
    { product: 'Matcha Latte', ingredient: 'Whole Milk', quantity: 250 },
    { product: 'Hot Chocolate', ingredient: 'Chocolate Syrup', quantity: 40 },
    { product: 'Hot Chocolate', ingredient: 'Whole Milk', quantity: 250 },
  ];

  for (const link of links) {
    const p = find(products, link.product);
    const ing = find(ingredients, link.ingredient);
    if (p && ing) {
      await db.productIngredients.add({ productId: p.id, ingredientId: ing.id, quantity: link.quantity });
    }
  }

  // Link some products to inventory (cups, lids)
  const inventory = await db.inventory.toArray();
  const invLinks = [
    { product: 'Espresso', inventory: '12oz Paper Cup', quantity: 1 },
    { product: 'Americano', inventory: '12oz Paper Cup', quantity: 1 },
    { product: 'Café Latte', inventory: '16oz Paper Cup', quantity: 1 },
    { product: 'Café Latte', inventory: 'Cup Lid', quantity: 1 },
    { product: 'Cappuccino', inventory: '12oz Paper Cup', quantity: 1 },
    { product: 'Caramel Macchiato', inventory: '16oz Paper Cup', quantity: 1 },
    { product: 'Caramel Macchiato', inventory: 'Cup Lid', quantity: 1 },
    { product: 'Mocha', inventory: '16oz Paper Cup', quantity: 1 },
    { product: 'Mocha', inventory: 'Cup Lid', quantity: 1 },
    { product: 'Iced Tea', inventory: '16oz Paper Cup', quantity: 1 },
    { product: 'Iced Tea', inventory: 'Cup Lid', quantity: 1 },
    { product: 'Iced Tea', inventory: 'Paper Straw', quantity: 1 },
  ];

  for (const link of invLinks) {
    const p = find(products, link.product);
    const inv = find(inventory, link.inventory);
    if (p && inv) {
      await db.productInventory.add({ productId: p.id, inventoryId: inv.id, quantity: link.quantity });
    }
  }
}
