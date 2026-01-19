import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// Extend session to include CSRF token
declare module 'express-session' {
  interface SessionData {
    csrfToken?: string;
  }
}

/**
 * Generate a CSRF token and store it in the session.
 */
export function generateCsrfToken(req: Request): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}

/**
 * Middleware to add CSRF token to res.locals for use in templates.
 */
export function csrfToken(req: Request, res: Response, next: NextFunction): void {
  res.locals.csrfToken = generateCsrfToken(req);
  next();
}

/**
 * Middleware to validate CSRF token on POST/PUT/DELETE requests.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Only check on state-changing methods
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const tokenFromBody = req.body?._csrf;
    const tokenFromHeader = req.get('x-csrf-token');
    const submittedToken = tokenFromBody || tokenFromHeader;

    if (!submittedToken || submittedToken !== req.session.csrfToken) {
      res.status(403).render('public/error', {
        title: 'Forbidden',
        message: 'Invalid or missing CSRF token. Please refresh and try again.',
        app: null,
      });
      return;
    }
  }

  next();
}
