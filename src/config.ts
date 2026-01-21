import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // Database
  databasePath: process.env.DATABASE_PATH || './data/database.sqlite',

  // Session
  sessionSecret: requireEnv('SESSION_SECRET'),

  // Initial admin (only used for seeding)
  adminEmail: process.env.ADMIN_EMAIL || 'admin@example.com',
  adminPassword: process.env.ADMIN_PASSWORD || 'changeme',

  // Trust proxy
  trustProxy: process.env.TRUST_PROXY === 'true',

  // Deferred links
  deferredLinkTTL: 24 * 60 * 60 * 1000, // 24 hours in milliseconds

  // API Authentication
  apiKey: process.env.API_KEY || null,
} as const;

// Validate critical config on startup
export function validateConfig(): void {
  if (config.isProduction) {
    if (config.sessionSecret === 'change-this-to-a-random-string-in-production') {
      throw new Error('SESSION_SECRET must be changed in production');
    }
    if (config.sessionSecret.length < 32) {
      throw new Error('SESSION_SECRET should be at least 32 characters in production');
    }
  }
}
