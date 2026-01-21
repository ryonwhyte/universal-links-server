import { Router, Request, Response } from 'express';
import { getDb } from '../../db/client.js';
import { claimByToken, claimByFingerprint, cleanupDeferredLinks } from '../../services/deferred.js';
import { generateFingerprintFromValues, getIp } from '../../services/fingerprint.js';
import { logEvent, type Platform, type Source } from '../../services/analytics.js';
import { createReferral, getReferralByCode, completeReferral, getReferrerIdByCode, updateMilestone, countActiveReferrals } from '../../services/referrals.js';
import { requireApiKey } from '../../middleware/apiAuth.js';
import type { App } from '../../middleware/resolveApp.js';

const router = Router();

/**
 * Claim a deferred deep link.
 *
 * Methods:
 * 1. By referrer token (Android): GET /api/deferred/claim?token=xxx
 * 2. By fingerprint (iOS): GET /api/deferred/claim?fingerprint=xxx
 *    Or let server generate fingerprint from request
 */
router.get('/deferred/claim', (req: Request, res: Response) => {
  const { token, fingerprint: providedFingerprint } = req.query;
  const app = req.app_config;

  if (!app) {
    res.status(404).json({ success: false, error: 'App not found' });
    return;
  }

  // Method 1: Claim by referrer token (Android)
  if (typeof token === 'string' && token.length > 0) {
    const link = claimByToken(token);

    if (!link) {
      res.status(404).json({
        success: false,
        error: 'Link not found or expired',
      });
      return;
    }

    // Log install event
    logEvent({
      app_id: app.id,
      event_type: 'install',
      deep_link: link.deep_link_path,
      platform: 'android',
      source: 'deferred',
    });

    // Auto-detect referral links and include referrer_id
    // Referral paths are stored as /referral/{code}
    let referrerId: string | null = null;
    let referralCode: string | null = null;
    const referralMatch = link.deep_link_path.match(/^\/referral\/([A-Z0-9]+)$/i);
    if (referralMatch) {
      referralCode = referralMatch[1];
      referrerId = getReferrerIdByCode(referralCode);
      // Auto-update milestone to "installed"
      if (referralCode) {
        updateMilestone(referralCode, 'installed');
      }
    }

    res.json({
      success: true,
      path: link.deep_link_path,
      ...(referrerId && { referrer_id: referrerId }),
      ...(referralCode && { referral_code: referralCode }),
    });
    return;
  }

  // Method 2: Claim by fingerprint (iOS)
  // First try provided fingerprint, then generate from request
  let fingerprint: string;

  if (typeof providedFingerprint === 'string' && providedFingerprint.length > 0) {
    fingerprint = providedFingerprint;
  } else {
    // Generate fingerprint from request (less reliable but can work)
    const ip = getIp(req);
    const userAgent = req.get('user-agent') || '';
    fingerprint = generateFingerprintFromValues(ip, userAgent);
  }

  const link = claimByFingerprint(fingerprint, app.id);

  if (!link) {
    res.status(404).json({
      success: false,
      error: 'Link not found or expired',
    });
    return;
  }

  // Log install event
  logEvent({
    app_id: app.id,
    event_type: 'install',
    deep_link: link.deep_link_path,
    platform: 'ios',
    source: 'deferred',
  });

  // Auto-detect referral links and include referrer_id
  // Referral paths are stored as /referral/{code}
  let referrerId: string | null = null;
  let referralCode: string | null = null;
  const referralMatch = link.deep_link_path.match(/^\/referral\/([A-Z0-9]+)$/i);
  if (referralMatch) {
    referralCode = referralMatch[1];
    referrerId = getReferrerIdByCode(referralCode);
    // Auto-update milestone to "installed"
    if (referralCode) {
      updateMilestone(referralCode, 'installed');
    }
  }

  res.json({
    success: true,
    path: link.deep_link_path,
    ...(referrerId && { referrer_id: referrerId }),
    ...(referralCode && { referral_code: referralCode }),
  });
});

/**
 * Create a referral link for a user.
 *
 * POST /api/referral/create
 * {
 *   "user_id": "userA_123",
 *   "app_domain": "go.myapp.com"  // Optional, defaults to request host
 * }
 *
 * Requires API key authentication (if API_KEY is configured).
 */
router.post('/referral/create', requireApiKey, (req: Request, res: Response) => {
  const app = req.app_config;

  if (!app) {
    res.status(404).json({ success: false, error: 'App not found' });
    return;
  }

  // Check if referrals are enabled for this app
  if (!app.referral_enabled) {
    res.status(403).json({ success: false, error: 'Referrals are not enabled for this app' });
    return;
  }

  const { user_id, metadata } = req.body;

  if (!user_id || typeof user_id !== 'string') {
    res.status(400).json({ success: false, error: 'user_id is required' });
    return;
  }

  // Check max referrals per user limit
  if (app.referral_max_per_user) {
    const activeCount = countActiveReferrals(app.id, user_id);
    if (activeCount >= app.referral_max_per_user) {
      res.status(400).json({ success: false, error: 'Maximum referrals per user reached' });
      return;
    }
  }

  try {
    const { referral, referralCode } = createReferral(app.id, user_id, metadata);

    // Build the referral URL using the app's domain
    const domains = app.domains.split(',').map((d: string) => d.trim());
    const primaryDomain = domains[0];
    const protocol = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const referralUrl = `${protocol}://${primaryDomain}/ref/${referralCode}`;

    res.json({
      success: true,
      referral_code: referralCode,
      referral_url: referralUrl,
      referral_id: referral.id,
    });
  } catch (error) {
    console.error('Create referral error:', error);
    res.status(500).json({ success: false, error: 'Failed to create referral' });
  }
});

/**
 * Complete a referral when a referred user claims.
 *
 * POST /api/referral/complete
 * {
 *   "referral_code": "ABC123XYZ",
 *   "referred_user_id": "userB_456",
 *   "milestone": "purchased"  // optional, defaults to "completed"
 * }
 *
 * Requires API key authentication (if API_KEY is configured).
 */
router.post('/referral/complete', requireApiKey, (req: Request, res: Response) => {
  const app = req.app_config;

  if (!app) {
    res.status(404).json({ success: false, error: 'App not found' });
    return;
  }

  const { referral_code, referred_user_id, milestone } = req.body;

  if (!referral_code || typeof referral_code !== 'string') {
    res.status(400).json({ success: false, error: 'referral_code is required' });
    return;
  }

  if (!referred_user_id || typeof referred_user_id !== 'string') {
    res.status(400).json({ success: false, error: 'referred_user_id is required' });
    return;
  }

  try {
    const finalMilestone = typeof milestone === 'string' ? milestone : 'completed';
    const referral = completeReferral(referral_code, referred_user_id, finalMilestone);

    if (!referral) {
      res.status(404).json({ success: false, error: 'Referral not found or already completed' });
      return;
    }

    res.json({
      success: true,
      referral: {
        id: referral.id,
        referrer_id: referral.referrer_id,
        referred_user_id: referral.referred_user_id,
        status: referral.status,
        milestone: referral.milestone,
        completed_at: referral.completed_at,
      },
    });
  } catch (error) {
    console.error('Complete referral error:', error);
    res.status(500).json({ success: false, error: 'Failed to complete referral' });
  }
});

/**
 * Update referral milestone (for tracking progress).
 *
 * POST /api/referral/milestone
 * {
 *   "referral_code": "ABC123XYZ",
 *   "milestone": "signed_up"
 * }
 *
 * Requires API key authentication (if API_KEY is configured).
 */
router.post('/referral/milestone', requireApiKey, (req: Request, res: Response) => {
  const app = req.app_config;

  if (!app) {
    res.status(404).json({ success: false, error: 'App not found' });
    return;
  }

  const { referral_code, milestone } = req.body;

  if (!referral_code || typeof referral_code !== 'string') {
    res.status(400).json({ success: false, error: 'referral_code is required' });
    return;
  }

  if (!milestone || typeof milestone !== 'string') {
    res.status(400).json({ success: false, error: 'milestone is required' });
    return;
  }

  try {
    const referral = updateMilestone(referral_code, milestone);

    if (!referral) {
      res.status(404).json({ success: false, error: 'Referral not found or expired' });
      return;
    }

    // Verify referral belongs to this app
    if (referral.app_id !== app.id) {
      res.status(404).json({ success: false, error: 'Referral not found' });
      return;
    }

    res.json({
      success: true,
      referral: {
        id: referral.id,
        referral_code: referral.referral_code,
        milestone: referral.milestone,
        status: referral.status,
      },
    });
  } catch (error) {
    console.error('Update milestone error:', error);
    res.status(500).json({ success: false, error: 'Failed to update milestone' });
  }
});

/**
 * Get referral info by code.
 *
 * GET /api/referral/:code
 */
router.get('/referral/:code', (req: Request, res: Response) => {
  const { code } = req.params;
  const app = req.app_config;

  if (!app) {
    res.status(404).json({ success: false, error: 'App not found' });
    return;
  }

  const referral = getReferralByCode(code);

  if (!referral || referral.app_id !== app.id) {
    res.status(404).json({ success: false, error: 'Referral not found' });
    return;
  }

  res.json({
    success: true,
    referral: {
      referrer_id: referral.referrer_id,
      status: referral.status,
      milestone: referral.milestone,
      created_at: referral.created_at,
    },
  });
});

/**
 * Helper endpoint to get fingerprint info (for debugging).
 * Only enabled in development.
 */
router.get('/deferred/debug', (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const ip = getIp(req);
  const userAgent = req.get('user-agent') || '';
  const fingerprint = generateFingerprintFromValues(ip, userAgent);

  res.json({
    ip,
    userAgent,
    fingerprint,
  });
});

/**
 * Cleanup expired deferred links.
 * Could be called by a cron job.
 */
router.post('/deferred/cleanup', (req: Request, res: Response) => {
  // Simple auth via header (for cron jobs)
  const authHeader = req.get('x-cleanup-key');
  const expectedKey = process.env.CLEANUP_KEY;

  // Require CLEANUP_KEY to be set and match
  if (!expectedKey || authHeader !== expectedKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const deleted = cleanupDeferredLinks();

  res.json({
    success: true,
    deleted,
  });
});

/**
 * Lookup app by domain (for apps that need to verify their config).
 */
router.get('/app/info', (req: Request, res: Response) => {
  const app = req.app_config;

  if (!app) {
    res.status(404).json({ error: 'App not found' });
    return;
  }

  // Return safe subset of app info
  res.json({
    name: app.name,
    slug: app.slug,
    has_ios: !!(app.apple_team_id && app.apple_bundle_id),
    has_android: !!(app.android_package_name),
  });
});

/**
 * Track a deep link open from an already-installed app.
 * Called by the app when it opens via a Universal/App Link.
 *
 * POST /api/path
 * {
 *   "path": "/merchant/abc123",
 *   "platform": "ios" | "android",
 *   "source": "universal_link" | "direct"
 * }
 */
router.post('/path', (req: Request, res: Response) => {
  const app = req.app_config;

  if (!app) {
    res.status(404).json({ success: false, error: 'App not found' });
    return;
  }

  const { path, platform, source } = req.body;

  if (!path || typeof path !== 'string') {
    res.status(400).json({ success: false, error: 'path is required' });
    return;
  }

  // Validate platform if provided
  const validPlatforms = ['ios', 'android', 'web', 'unknown'];
  const eventPlatform: Platform = validPlatforms.includes(platform) ? platform : 'unknown';

  // Validate source if provided
  const validSources = ['universal_link', 'direct', 'deferred'];
  const eventSource: Source = validSources.includes(source) ? source : 'universal_link';

  // Log the event
  logEvent({
    app_id: app.id,
    event_type: 'link_opened',
    deep_link: path,
    platform: eventPlatform,
    source: eventSource,
  });

  res.json({ success: true });
});

export { router as apiRoutes };
