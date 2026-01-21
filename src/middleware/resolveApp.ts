import { Request, Response, NextFunction } from 'express';
import { getDb } from '../db/client.js';

export interface App {
  id: string;
  name: string;
  slug: string;
  domains: string;
  apple_team_id: string | null;
  apple_bundle_id: string | null;
  ios_app_store_url: string | null;
  android_package_name: string | null;
  android_sha256_fingerprints: string | null;
  android_play_store_url: string | null;
  logo_url: string | null;
  primary_color: string;
  web_fallback_url: string | null;
  referral_enabled: number;
  referral_expiration_days: number;
  referral_max_per_user: number | null;
  referral_reward_milestone: string;
  created_at: string;
  updated_at: string;
}

export interface Route {
  id: string;
  app_id: string;
  prefix: string;
  name: string;
  template: string;
  api_endpoint: string | null;
  universal_link_enabled: number;
  web_fallback_url: string | null;
  created_at: string;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      app_config?: App;
      routes?: Route[];
    }
  }
}

export function resolveApp(req: Request, res: Response, next: NextFunction): void {
  const hostname = req.hostname;

  const db = getDb();

  // Find app by domain
  // Domains are stored comma-separated, so we need to check if the hostname is in the list
  const apps = db.prepare(`
    SELECT * FROM apps
  `).all() as App[];

  const app = apps.find(a => {
    const domains = a.domains.split(',').map(d => d.trim().toLowerCase());
    return domains.includes(hostname.toLowerCase());
  });

  if (!app) {
    // No app found for this domain - render error
    res.status(404).render('public/error', {
      title: 'Not Found',
      message: 'No app configured for this domain.',
      app: null,
    });
    return;
  }

  // Get routes for this app
  const routes = db.prepare(`
    SELECT * FROM routes WHERE app_id = ?
  `).all(app.id) as Route[];

  // Attach to request
  req.app_config = app;
  req.routes = routes;

  next();
}

// Helper to get a specific route by prefix
export function getRouteByPrefix(routes: Route[], prefix: string): Route | undefined {
  return routes.find(r => r.prefix === prefix);
}
