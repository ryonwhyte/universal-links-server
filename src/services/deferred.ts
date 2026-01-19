import { nanoid } from 'nanoid';
import { getDb, generateId } from '../db/client.js';
import { config } from '../config.js';

interface DeferredLink {
  id: string;
  app_id: string;
  fingerprint: string;
  deep_link_path: string;
  referrer_token: string | null;
  created_at: string;
  expires_at: string;
  claimed: number;
}

/**
 * Store a deferred deep link for later retrieval.
 */
export function storeDeferredLink(
  appId: string,
  fingerprint: string,
  deepLinkPath: string,
): { id: string; referrerToken: string } {
  const db = getDb();

  const id = generateId();
  const referrerToken = nanoid(16); // Short, URL-safe token

  // Calculate expiry (24 hours from now)
  const expiresAt = new Date(Date.now() + config.deferredLinkTTL).toISOString();

  db.prepare(`
    INSERT INTO deferred_links (id, app_id, fingerprint, deep_link_path, referrer_token, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, appId, fingerprint, deepLinkPath, referrerToken, expiresAt);

  return { id, referrerToken };
}

/**
 * Claim a deferred link by referrer token (Android Install Referrer method).
 */
export function claimByToken(token: string): DeferredLink | null {
  const db = getDb();

  // Find unclaimed, unexpired link
  const link = db.prepare(`
    SELECT * FROM deferred_links
    WHERE referrer_token = ?
      AND claimed = 0
      AND expires_at > datetime('now')
  `).get(token) as DeferredLink | undefined;

  if (!link) {
    return null;
  }

  // Mark as claimed
  db.prepare('UPDATE deferred_links SET claimed = 1 WHERE id = ?').run(link.id);

  return link;
}

/**
 * Claim a deferred link by fingerprint (iOS method).
 * Returns the most recent matching link.
 */
export function claimByFingerprint(fingerprint: string, appId: string): DeferredLink | null {
  const db = getDb();

  // Find unclaimed, unexpired link matching fingerprint and app
  // Get the most recent one if multiple exist
  const link = db.prepare(`
    SELECT * FROM deferred_links
    WHERE fingerprint = ?
      AND app_id = ?
      AND claimed = 0
      AND expires_at > datetime('now')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(fingerprint, appId) as DeferredLink | undefined;

  if (!link) {
    return null;
  }

  // Mark as claimed
  db.prepare('UPDATE deferred_links SET claimed = 1 WHERE id = ?').run(link.id);

  return link;
}

/**
 * Cleanup expired and claimed links.
 * Returns number of deleted links.
 */
export function cleanupDeferredLinks(): number {
  const db = getDb();

  const result = db.prepare(`
    DELETE FROM deferred_links
    WHERE expires_at < datetime('now') OR claimed = 1
  `).run();

  return result.changes;
}

/**
 * Build a Play Store URL with referrer token for deferred deep linking.
 */
export function buildPlayStoreUrl(baseUrl: string, referrerToken: string): string {
  // Parse the base URL
  const url = new URL(baseUrl);

  // Add or append to the referrer parameter
  // Format: ul_token=<token>
  const referrerValue = `ul_token=${referrerToken}`;

  // URL-encode the referrer value
  url.searchParams.set('referrer', referrerValue);

  return url.toString();
}
