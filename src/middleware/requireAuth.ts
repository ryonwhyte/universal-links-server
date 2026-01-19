import { Request, Response, NextFunction } from 'express';

// Extend session data type
declare module 'express-session' {
  interface SessionData {
    userId?: string;
    userEmail?: string;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.userId) {
    // Store the original URL to redirect back after login
    req.session.returnTo = req.originalUrl;
    res.redirect('/admin/login');
    return;
  }
  next();
}

// Middleware to add user info to all views
export function addUserToLocals(req: Request, res: Response, next: NextFunction): void {
  res.locals.user = req.session.userId ? {
    id: req.session.userId,
    email: req.session.userEmail,
  } : null;
  next();
}

// Extend session for returnTo
declare module 'express-session' {
  interface SessionData {
    returnTo?: string;
  }
}
