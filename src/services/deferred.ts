import { nanoid } from 'nanoid';
import { getDb, generateId } from '../db/client.js';
import { config } from '../config.js';
import { calculateSignalScore, type DeviceSignals } from './fingerprint.js';

interface DeferredLink {
  id: string;
  app_id: string;
  fingerprint: string;
  deep_link_path: string;
  referrer_token: string | null;
  created_at: string;
  expires_at: string;
  claimed: number;
  ip: string | null;
  timezone: string | null;
  language: string | null;
  screen_width: number | null;
  screen_height: number | null;
}

/**
 * Store a deferred deep link for later retrieval.
 */
export function storeDeferredLink(
  appId: string,
  fingerprint: string,
  deepLinkPath: string,
  ip?: string,
): { id: string; referrerToken: string } {
  const db = getDb();

  const id = generateId();
  const referrerToken = nanoid(16); // Short, URL-safe token

  // Calculate expiry (24 hours from now)
  const expiresAt = new Date(Date.now() + config.deferredLinkTTL).toISOString();

  db.prepare(`
    INSERT INTO deferred_links (id, app_id, fingerprint, deep_link_path, referrer_token, expires_at, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, appId, fingerprint, deepLinkPath, referrerToken, expiresAt, ip || null);

  return { id, referrerToken };
}

/**
 * Update a deferred link with client-side signals (timezone, language, screen).
 * Called after the landing page JavaScript captures these values.
 */
export function updateDeferredLinkSignals(
  referrerToken: string,
  signals: Partial<DeviceSignals>
): boolean {
  const db = getDb();

  const result = db.prepare(`
    UPDATE deferred_links
    SET timezone = COALESCE(?, timezone),
        language = COALESCE(?, language),
        screen_width = COALESCE(?, screen_width),
        screen_height = COALESCE(?, screen_height)
    WHERE referrer_token = ? AND claimed = 0
  `).run(
    signals.timezone || null,
    signals.language || null,
    signals.screen_width || null,
    signals.screen_height || null,
    referrerToken
  );

  return result.changes > 0;
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
 * Claim a deferred link by fingerprint (iOS method - legacy).
 * Returns the most recent matching link.
 * @deprecated Use claimBySignals() for better iOS matching
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
 * Claim a deferred link by multi-signal matching (improved iOS method).
 * Matches on IP within a time window, then scores other signals.
 *
 * @param signals - Device signals from the claiming app
 * @param appId - App ID to match
 * @param matchWindowMs - Time window for matching (default from config)
 * @param minScore - Minimum signal score required (0-4, default 2)
 */
export function claimBySignals(
  signals: DeviceSignals,
  appId: string,
  matchWindowMs?: number,
  minScore: number = 2
): DeferredLink | null {
  const db = getDb();
  const windowMs = matchWindowMs || config.deferredMatchWindow || 7200000; // Default 2 hours
  const windowMinutes = Math.floor(windowMs / 60000);

  // Find candidates: same IP, within time window, not claimed, not expired
  const candidates = db.prepare(`
    SELECT * FROM deferred_links
    WHERE ip = ?
      AND app_id = ?
      AND claimed = 0
      AND expires_at > datetime('now')
      AND created_at > datetime('now', '-' || ? || ' minutes')
    ORDER BY created_at DESC
  `).all(signals.ip, appId, windowMinutes) as DeferredLink[];

  if (candidates.length === 0) {
    return null;
  }

  // Score each candidate and find the best match
  let bestMatch: DeferredLink | null = null;
  let bestScore = -1;

  for (const link of candidates) {
    const storedSignals: DeviceSignals = {
      ip: link.ip || '',
      timezone: link.timezone || undefined,
      language: link.language || undefined,
      screen_width: link.screen_width || undefined,
      screen_height: link.screen_height || undefined,
    };

    const score = calculateSignalScore(storedSignals, signals);

    // Require minimum score for a confident match
    if (score >= minScore && score > bestScore) {
      bestScore = score;
      bestMatch = link;
    }
  }

  // If we found a confident match, claim it
  if (bestMatch) {
    db.prepare('UPDATE deferred_links SET claimed = 1 WHERE id = ?').run(bestMatch.id);
    return bestMatch;
  }

  // Fallback: if no confident match but we have candidates, return the most recent
  // This is lower confidence but better than no match at all
  const fallback = candidates[0];
  db.prepare('UPDATE deferred_links SET claimed = 1 WHERE id = ?').run(fallback.id);
  return fallback;
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
