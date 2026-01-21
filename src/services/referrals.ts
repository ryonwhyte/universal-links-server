import { nanoid } from 'nanoid';
import { getDb, generateId } from '../db/client.js';

export interface Referral {
  id: string;
  app_id: string;
  referrer_id: string;
  referral_code: string;
  referred_user_id: string | null;
  status: 'pending' | 'completed' | 'expired';
  milestone: string;
  created_at: string;
  completed_at: string | null;
  metadata: string | null;
}

export interface ReferralStats {
  total_referrals: number;
  pending_referrals: number;
  completed_referrals: number;
  conversion_rate: number;
  by_day: Array<{ date: string; created: number; completed: number }>;
  by_milestone: Array<{ milestone: string; count: number }>;
  top_referrers: Array<{ referrer_id: string; total: number; completed: number }>;
  recent_referrals: Referral[];
}

/**
 * Create a new referral link for a user.
 */
export function createReferral(
  appId: string,
  referrerId: string,
  metadata?: Record<string, unknown>
): { referral: Referral; referralCode: string } {
  const db = getDb();

  // Check if user already has an active referral code for this app
  const existing = db.prepare(`
    SELECT * FROM referrals
    WHERE app_id = ? AND referrer_id = ? AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(appId, referrerId) as Referral | undefined;

  if (existing) {
    return { referral: existing, referralCode: existing.referral_code };
  }

  // Generate new referral
  const id = generateId();
  const referralCode = nanoid(10).toUpperCase(); // Short, URL-friendly code

  db.prepare(`
    INSERT INTO referrals (id, app_id, referrer_id, referral_code, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, appId, referrerId, referralCode, metadata ? JSON.stringify(metadata) : null);

  const referral = db.prepare('SELECT * FROM referrals WHERE id = ?').get(id) as Referral;

  return { referral, referralCode };
}

/**
 * Get a referral by its code.
 */
export function getReferralByCode(code: string): Referral | null {
  const db = getDb();
  const referral = db.prepare('SELECT * FROM referrals WHERE referral_code = ?').get(code) as Referral | undefined;
  return referral || null;
}

/**
 * Get a referral by ID.
 */
export function getReferralById(id: string): Referral | null {
  const db = getDb();
  const referral = db.prepare('SELECT * FROM referrals WHERE id = ?').get(id) as Referral | undefined;
  return referral || null;
}

/**
 * Update the milestone for a referral.
 * Used to track progress: pending → installed → signed_up → purchased → completed
 */
export function updateMilestone(referralCode: string, milestone: string): Referral | null {
  const db = getDb();

  // Find the referral (any status except expired)
  const referral = db.prepare(`
    SELECT * FROM referrals
    WHERE referral_code = ? AND status != 'expired'
  `).get(referralCode) as Referral | undefined;

  if (!referral) {
    return null;
  }

  // Update milestone
  db.prepare(`
    UPDATE referrals
    SET milestone = ?
    WHERE id = ?
  `).run(milestone, referral.id);

  return db.prepare('SELECT * FROM referrals WHERE id = ?').get(referral.id) as Referral;
}

/**
 * Complete a referral when referred user installs and claims.
 */
export function completeReferral(
  referralCode: string,
  referredUserId: string,
  milestone: string = 'completed'
): Referral | null {
  const db = getDb();

  // Find the pending referral
  const referral = db.prepare(`
    SELECT * FROM referrals
    WHERE referral_code = ? AND status = 'pending'
  `).get(referralCode) as Referral | undefined;

  if (!referral) {
    return null;
  }

  // Mark as completed with milestone
  db.prepare(`
    UPDATE referrals
    SET referred_user_id = ?, status = 'completed', milestone = ?, completed_at = datetime('now')
    WHERE id = ?
  `).run(referredUserId, milestone, referral.id);

  return db.prepare('SELECT * FROM referrals WHERE id = ?').get(referral.id) as Referral;
}

/**
 * Get referral statistics for an app.
 */
export function getReferralStats(appId?: string, days: number = 30): ReferralStats {
  const db = getDb();

  const appFilter = appId ? 'AND app_id = ?' : '';
  const params = appId ? [appId] : [];

  // Get totals
  const totals = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
    FROM referrals
    WHERE 1=1 ${appFilter}
  `).get(...params) as { total: number; pending: number; completed: number };

  // Get daily breakdown
  const byDay = db.prepare(`
    SELECT
      date(created_at) as date,
      COUNT(*) as created,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
    FROM referrals
    WHERE created_at >= datetime('now', '-${days} days') ${appFilter}
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).all(...params) as Array<{ date: string; created: number; completed: number }>;

  // Get milestone breakdown
  const byMilestone = db.prepare(`
    SELECT
      milestone,
      COUNT(*) as count
    FROM referrals
    WHERE 1=1 ${appFilter}
    GROUP BY milestone
    ORDER BY count DESC
  `).all(...params) as Array<{ milestone: string; count: number }>;

  // Get top referrers
  const topReferrers = db.prepare(`
    SELECT
      referrer_id,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
    FROM referrals
    WHERE 1=1 ${appFilter}
    GROUP BY referrer_id
    ORDER BY completed DESC, total DESC
    LIMIT 10
  `).all(...params) as Array<{ referrer_id: string; total: number; completed: number }>;

  // Get recent referrals
  const recentReferrals = db.prepare(`
    SELECT * FROM referrals
    WHERE 1=1 ${appFilter}
    ORDER BY created_at DESC
    LIMIT 20
  `).all(...params) as Referral[];

  const total = totals.total || 0;
  const completed = totals.completed || 0;
  const conversionRate = total > 0 ? (completed / total) * 100 : 0;

  return {
    total_referrals: total,
    pending_referrals: totals.pending || 0,
    completed_referrals: completed,
    conversion_rate: Math.round(conversionRate * 10) / 10,
    by_day: byDay,
    by_milestone: byMilestone,
    top_referrers: topReferrers,
    recent_referrals: recentReferrals,
  };
}

/**
 * Get all referrals for an app.
 */
export function getReferrals(appId?: string, limit: number = 100): Referral[] {
  const db = getDb();

  if (appId) {
    return db.prepare(`
      SELECT * FROM referrals
      WHERE app_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(appId, limit) as Referral[];
  }

  return db.prepare(`
    SELECT * FROM referrals
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as Referral[];
}

/**
 * Get referrer_id for a referral code (used when claiming deferred link).
 */
export function getReferrerIdByCode(code: string): string | null {
  const referral = getReferralByCode(code);
  return referral?.referrer_id || null;
}

/**
 * Count active (pending) referrals for a user in an app.
 * Used for enforcing max referrals per user limit.
 */
export function countActiveReferrals(appId: string, referrerId: string): number {
  const db = getDb();
  const result = db.prepare(`
    SELECT COUNT(*) as count FROM referrals
    WHERE app_id = ? AND referrer_id = ? AND status = 'pending'
  `).get(appId, referrerId) as { count: number };
  return result.count;
}

/**
 * Expire old pending referrals (optional cleanup).
 */
export function expireOldReferrals(daysOld: number = 30): number {
  const db = getDb();

  const result = db.prepare(`
    UPDATE referrals
    SET status = 'expired'
    WHERE status = 'pending'
      AND created_at < datetime('now', '-' || ? || ' days')
  `).run(daysOld);

  return result.changes;
}
