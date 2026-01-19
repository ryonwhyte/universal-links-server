import bcrypt from 'bcrypt';
import { config } from '../config.js';
import { initializeDatabase, getDb, generateId } from './client.js';

const SALT_ROUNDS = 12;

async function seed() {
  console.log('Initializing database...');
  initializeDatabase();

  const db = getDb();

  // Check if admin user already exists
  const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(config.adminEmail);

  if (existingUser) {
    console.log(`Admin user ${config.adminEmail} already exists. Skipping seed.`);
    return;
  }

  // Create admin user
  console.log(`Creating admin user: ${config.adminEmail}`);
  const passwordHash = await bcrypt.hash(config.adminPassword, SALT_ROUNDS);

  db.prepare(`
    INSERT INTO users (id, email, password_hash)
    VALUES (?, ?, ?)
  `).run(generateId(), config.adminEmail, passwordHash);

  console.log('Admin user created successfully.');
  console.log('');
  console.log('You can now log in with:');
  console.log(`  Email: ${config.adminEmail}`);
  console.log(`  Password: ${'*'.repeat(config.adminPassword.length)} (from ADMIN_PASSWORD env var)`);
  console.log('');
  console.log('IMPORTANT: Change these credentials after first login!');
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
