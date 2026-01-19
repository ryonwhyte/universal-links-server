import { Router, Request, Response } from 'express';
import { getDb } from '../../db/client.js';
import { claimByToken, claimByFingerprint, cleanupDeferredLinks } from '../../services/deferred.js';
import { generateFingerprintFromValues, getIp } from '../../services/fingerprint.js';
import { logEvent, type Platform, type Source } from '../../services/analytics.js';
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

    res.json({
      success: true,
      path: link.deep_link_path,
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

  res.json({
    success: true,
    path: link.deep_link_path,
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
