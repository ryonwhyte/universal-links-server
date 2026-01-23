import crypto from 'crypto';
import { Request } from 'express';

export interface DeviceSignals {
  ip: string;
  timezone?: string;
  language?: string;
  screen_width?: number;
  screen_height?: number;
}

/**
 * Generate a fingerprint from request data.
 * Uses IP + User-Agent for basic fingerprinting.
 *
 * Note: This is not 100% reliable as:
 * - IP can change between browser and app (different networks)
 * - User-Agent differs between browser and native app
 *
 * It's a best-effort approach for iOS deferred deep links.
 * @deprecated Use getServerSignals() and signal-based matching instead
 */
export function generateFingerprint(req: Request): string {
  // Get IP address (handle proxies)
  const ip = getClientIp(req);

  // Get user agent
  const userAgent = req.get('user-agent') || '';

  // Create a hash of IP + UA
  const data = `${ip}|${userAgent}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Generate a fingerprint from raw values (for app-side matching).
 * @deprecated Use signal-based matching instead
 */
export function generateFingerprintFromValues(ip: string, userAgent: string): string {
  const data = `${ip}|${userAgent}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Get server-side signals from request (IP only).
 * Client signals (timezone, language, screen) are captured via JavaScript.
 */
export function getServerSignals(req: Request): DeviceSignals {
  return {
    ip: getClientIp(req),
  };
}

/**
 * Calculate match score between two sets of signals.
 * Returns a score from 0-4 based on matching signals (excluding IP which is a prerequisite).
 *
 * @param stored - Signals stored when user visited landing page
 * @param claimed - Signals sent when app claims the link
 * @param screenTolerance - Allowed pixel difference for screen dimensions (default 50)
 */
export function calculateSignalScore(
  stored: DeviceSignals,
  claimed: DeviceSignals,
  screenTolerance: number = 50
): number {
  let score = 0;

  // Timezone match
  if (stored.timezone && claimed.timezone && stored.timezone === claimed.timezone) {
    score += 1;
  }

  // Language match
  if (stored.language && claimed.language && stored.language === claimed.language) {
    score += 1;
  }

  // Screen width match (fuzzy)
  if (stored.screen_width && claimed.screen_width) {
    if (Math.abs(stored.screen_width - claimed.screen_width) <= screenTolerance) {
      score += 1;
    }
  }

  // Screen height match (fuzzy)
  if (stored.screen_height && claimed.screen_height) {
    if (Math.abs(stored.screen_height - claimed.screen_height) <= screenTolerance) {
      score += 1;
    }
  }

  return score;
}

/**
 * Get client IP address, handling reverse proxies.
 */
function getClientIp(req: Request): string {
  // Check X-Forwarded-For header (set by proxies)
  const forwardedFor = req.get('x-forwarded-for');
  if (forwardedFor) {
    // Take the first IP in the chain (original client)
    return forwardedFor.split(',')[0].trim();
  }

  // Check X-Real-IP header (nginx)
  const realIp = req.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  // Fall back to socket remote address
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Get client IP (exported for use in other modules).
 */
export function getIp(req: Request): string {
  return getClientIp(req);
}
