import crypto from 'crypto';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

export function initializeDatabase(): void {
  // Ensure data directory exists
  const dataDir = path.dirname(config.databasePath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Create database connection
  db = new Database(config.databasePath);

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL');

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Create tables
  createTables();

  // Run migrations for existing databases
  runMigrations();
}

function runMigrations(): void {
  // Add web_fallback_url to routes table if it doesn't exist
  const routeColumns = db.prepare("PRAGMA table_info(routes)").all() as { name: string }[];
  if (!routeColumns.some(col => col.name === 'web_fallback_url')) {
    db.exec('ALTER TABLE routes ADD COLUMN web_fallback_url TEXT');
  }

  // Add milestone to referrals table if it doesn't exist
  const referralColumns = db.prepare("PRAGMA table_info(referrals)").all() as { name: string }[];
  if (referralColumns.length > 0 && !referralColumns.some(col => col.name === 'milestone')) {
    db.exec("ALTER TABLE referrals ADD COLUMN milestone TEXT DEFAULT 'pending'");
  }

  // Add referral settings columns to apps table if they don't exist
  const appColumns = db.prepare("PRAGMA table_info(apps)").all() as { name: string }[];
  if (!appColumns.some(col => col.name === 'referral_enabled')) {
    db.exec("ALTER TABLE apps ADD COLUMN referral_enabled INTEGER DEFAULT 0");
  }
  if (!appColumns.some(col => col.name === 'referral_expiration_days')) {
    db.exec("ALTER TABLE apps ADD COLUMN referral_expiration_days INTEGER DEFAULT 30");
  }
  if (!appColumns.some(col => col.name === 'referral_max_per_user')) {
    db.exec("ALTER TABLE apps ADD COLUMN referral_max_per_user INTEGER");
  }
  if (!appColumns.some(col => col.name === 'referral_reward_milestone')) {
    db.exec("ALTER TABLE apps ADD COLUMN referral_reward_milestone TEXT DEFAULT 'completed'");
  }
}

function createTables(): void {
  db.exec(`
    -- Apps table
    CREATE TABLE IF NOT EXISTS apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      domains TEXT NOT NULL,
      apple_team_id TEXT,
      apple_bundle_id TEXT,
      ios_app_store_url TEXT,
      android_package_name TEXT,
      android_sha256_fingerprints TEXT,
      android_play_store_url TEXT,
      logo_url TEXT,
      primary_color TEXT DEFAULT '#667eea',
      web_fallback_url TEXT,
      referral_enabled INTEGER DEFAULT 0,
      referral_expiration_days INTEGER DEFAULT 30,
      referral_max_per_user INTEGER,
      referral_reward_milestone TEXT DEFAULT 'completed',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Routes table
    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      template TEXT DEFAULT 'generic',
      api_endpoint TEXT,
      universal_link_enabled INTEGER DEFAULT 1,
      web_fallback_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(app_id, prefix)
    );

    -- Deferred links table
    CREATE TABLE IF NOT EXISTS deferred_links (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      deep_link_path TEXT NOT NULL,
      referrer_token TEXT UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      claimed INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_deferred_fingerprint ON deferred_links(fingerprint, app_id);
    CREATE INDEX IF NOT EXISTS idx_deferred_referrer ON deferred_links(referrer_token);
    CREATE INDEX IF NOT EXISTS idx_deferred_expires ON deferred_links(expires_at);

    -- Admin users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Sessions table (for persistent sessions if needed)
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Custom templates table (for DB-stored templates)
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Analytics events table
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      deep_link TEXT,
      route_id TEXT,
      platform TEXT,
      source TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_events_app ON events(app_id);
    CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
    CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);

    -- Settings table (key-value store)
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Referrals table (user-to-user referral tracking)
    CREATE TABLE IF NOT EXISTS referrals (
      id TEXT PRIMARY KEY,
      app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
      referrer_id TEXT NOT NULL,
      referral_code TEXT UNIQUE NOT NULL,
      referred_user_id TEXT,
      status TEXT DEFAULT 'pending',
      milestone TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_referrals_app ON referrals(app_id);
    CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);
    CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id, app_id);
    CREATE INDEX IF NOT EXISTS idx_referrals_status ON referrals(status);
  `);
}

// Helper function to generate IDs
export function generateId(): string {
  return crypto.randomUUID();
}

// Cleanup expired deferred links
export function cleanupExpiredLinks(): number {
  const result = db.prepare(`
    DELETE FROM deferred_links
    WHERE expires_at < datetime('now') OR claimed = 1
  `).run();
  return result.changes;
}
