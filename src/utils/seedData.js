import db from '../db/database.js';

let seedPromise = null;

export function seedDatabase() {
  if (!seedPromise) {
    seedPromise = performSeed();
  }
  return seedPromise;
}

async function performSeed() {
  const staffCount = await db.staff.count();
  if (staffCount > 0) return;

  // Initialize a single owner account for a brand new system setup
  await db.staff.add({ 
    name: 'Roberto Owner', 
    pin: '1111', 
    role: 'owner' 
  });
}
