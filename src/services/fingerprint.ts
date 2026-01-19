import crypto from 'crypto';
import { Request } from 'express';

/**
 * Generate a fingerprint from request data.
 * Uses IP + User-Agent for basic fingerprinting.
 *
 * Note: This is not 100% reliable as:
 * - IP can change between browser and app (different networks)
 * - User-Agent differs between browser and native app
 *
 * It's a best-effort approach for iOS deferred deep links.
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
 */
export function generateFingerprintFromValues(ip: string, userAgent: string): string {
  const data = `${ip}|${userAgent}`;
  return crypto.createHash('sha256').update(data).digest('hex');
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
