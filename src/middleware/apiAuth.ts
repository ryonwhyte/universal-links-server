import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

/**
 * Middleware to require API key authentication.
 *
 * The API key can be provided via:
 * 1. X-API-Key header
 * 2. Authorization: Bearer <key> header
 * 3. api_key query parameter
 *
 * If no API_KEY is configured in env, authentication is skipped.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  // If no API key is configured, skip authentication
  if (!config.apiKey) {
    next();
    return;
  }

  // Check X-API-Key header
  const xApiKey = req.get('X-API-Key');
  if (xApiKey === config.apiKey) {
    next();
    return;
  }

  // Check Authorization: Bearer header
  const authHeader = req.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    if (token === config.apiKey) {
      next();
      return;
    }
  }

  // Check query parameter
  const queryKey = req.query.api_key;
  if (typeof queryKey === 'string' && queryKey === config.apiKey) {
    next();
    return;
  }

  res.status(401).json({
    success: false,
    error: 'Unauthorized. Provide a valid API key via X-API-Key header, Authorization: Bearer header, or api_key query parameter.',
  });
}

/**
 * Optional API key authentication - logs warning if key provided but invalid.
 * Useful for endpoints that work without auth but benefit from it.
 */
export function optionalApiKey(req: Request, res: Response, next: NextFunction): void {
  // If no API key is configured, skip
  if (!config.apiKey) {
    next();
    return;
  }

  // Check if any auth was provided
  const xApiKey = req.get('X-API-Key');
  const authHeader = req.get('Authorization');
  const queryKey = req.query.api_key;

  // If no auth provided, continue (it's optional)
  if (!xApiKey && !authHeader && !queryKey) {
    next();
    return;
  }

  // Auth was provided, validate it
  if (xApiKey === config.apiKey) {
    next();
    return;
  }

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    if (token === config.apiKey) {
      next();
      return;
    }
  }

  if (typeof queryKey === 'string' && queryKey === config.apiKey) {
    next();
    return;
  }

  // Auth was provided but invalid
  res.status(401).json({
    success: false,
    error: 'Invalid API key provided.',
  });
}
