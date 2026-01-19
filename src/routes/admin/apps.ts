import { Router, Request, Response } from 'express';
import { getDb, generateId } from '../../db/client.js';
import { requireAuth, addUserToLocals } from '../../middleware/requireAuth.js';
import type { App, Route } from '../../middleware/resolveApp.js';

const router = Router();

// Protect all admin routes
router.use(requireAuth);
router.use(addUserToLocals);

// Dashboard - list all apps
router.get('/', (_req: Request, res: Response) => {
  const db = getDb();

  const apps = db.prepare('SELECT * FROM apps ORDER BY name').all() as App[];

  // Get routes for each app
  const appsWithRoutes = apps.map(app => {
    const routes = db.prepare('SELECT * FROM routes WHERE app_id = ?').all(app.id) as Route[];
    return { ...app, routes };
  });

  res.render('admin/dashboard', {
    title: 'Dashboard',
    apps: appsWithRoutes,
  });
});

// New app form
router.get('/apps/new', (_req: Request, res: Response) => {
  res.render('admin/app-form', {
    title: 'New App',
    app: null,
    error: null,
  });
});

// Create app
router.post('/apps/new', (req: Request, res: Response) => {
  const {
    name,
    slug,
    domains,
    apple_team_id,
    apple_bundle_id,
    ios_app_store_url,
    android_package_name,
    android_sha256_fingerprints,
    android_play_store_url,
    logo_url,
    primary_color,
    web_fallback_url,
  } = req.body;

  // Validate required fields
  if (!name || !slug || !domains) {
    res.render('admin/app-form', {
      title: 'New App',
      app: req.body,
      error: 'Name, slug, and domains are required.',
    });
    return;
  }

  // Validate field lengths
  if (name.length > 100) {
    res.render('admin/app-form', {
      title: 'New App',
      app: req.body,
      error: 'App name must be 100 characters or less.',
    });
    return;
  }

  // Validate slug format (alphanumeric and hyphens only, max 50 chars)
  if (!/^[a-z0-9-]+$/.test(slug) || slug.length > 50) {
    res.render('admin/app-form', {
      title: 'New App',
      app: req.body,
      error: 'Slug must contain only lowercase letters, numbers, and hyphens (max 50 characters).',
    });
    return;
  }

  try {
    const db = getDb();

    // Check if slug is unique
    const existing = db.prepare('SELECT id FROM apps WHERE slug = ?').get(slug);
    if (existing) {
      res.render('admin/app-form', {
        title: 'New App',
        app: req.body,
        error: 'An app with this slug already exists.',
      });
      return;
    }

    // Insert app
    const id = generateId();
    db.prepare(`
      INSERT INTO apps (
        id, name, slug, domains, apple_team_id, apple_bundle_id, ios_app_store_url,
        android_package_name, android_sha256_fingerprints, android_play_store_url,
        logo_url, primary_color, web_fallback_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name.trim(),
      slug.trim().toLowerCase(),
      domains.trim(),
      apple_team_id?.trim() || null,
      apple_bundle_id?.trim() || null,
      ios_app_store_url?.trim() || null,
      android_package_name?.trim() || null,
      android_sha256_fingerprints?.trim() || null,
      android_play_store_url?.trim() || null,
      logo_url?.trim() || null,
      primary_color?.trim() || '#667eea',
      web_fallback_url?.trim() || null,
    );

    res.redirect('/admin');
  } catch (error) {
    console.error('Create app error:', error);
    res.render('admin/app-form', {
      title: 'New App',
      app: req.body,
      error: 'An error occurred. Please try again.',
    });
  }
});

// Edit app form
router.get('/apps/:id', (req: Request, res: Response) => {
  const { id } = req.params;

  const db = getDb();
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(id) as App | undefined;

  if (!app) {
    res.status(404).render('public/error', {
      title: 'Not Found',
      message: 'App not found.',
      app: null,
    });
    return;
  }

  res.render('admin/app-form', {
    title: `Edit ${app.name}`,
    app,
    error: null,
  });
});

// Update app
router.post('/apps/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    name,
    slug,
    domains,
    apple_team_id,
    apple_bundle_id,
    ios_app_store_url,
    android_package_name,
    android_sha256_fingerprints,
    android_play_store_url,
    logo_url,
    primary_color,
    web_fallback_url,
  } = req.body;

  // Validate required fields
  if (!name || !slug || !domains) {
    res.render('admin/app-form', {
      title: 'Edit App',
      app: { id, ...req.body },
      error: 'Name, slug, and domains are required.',
    });
    return;
  }

  // Validate field lengths
  if (name.length > 100) {
    res.render('admin/app-form', {
      title: 'Edit App',
      app: { id, ...req.body },
      error: 'App name must be 100 characters or less.',
    });
    return;
  }

  // Validate slug format (max 50 chars)
  if (!/^[a-z0-9-]+$/.test(slug) || slug.length > 50) {
    res.render('admin/app-form', {
      title: 'Edit App',
      app: { id, ...req.body },
      error: 'Slug must contain only lowercase letters, numbers, and hyphens (max 50 characters).',
    });
    return;
  }

  try {
    const db = getDb();

    // Check if slug is unique (excluding current app)
    const existing = db.prepare('SELECT id FROM apps WHERE slug = ? AND id != ?').get(slug, id);
    if (existing) {
      res.render('admin/app-form', {
        title: 'Edit App',
        app: { id, ...req.body },
        error: 'An app with this slug already exists.',
      });
      return;
    }

    // Update app
    db.prepare(`
      UPDATE apps SET
        name = ?, slug = ?, domains = ?, apple_team_id = ?, apple_bundle_id = ?,
        ios_app_store_url = ?, android_package_name = ?, android_sha256_fingerprints = ?,
        android_play_store_url = ?, logo_url = ?, primary_color = ?, web_fallback_url = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      name.trim(),
      slug.trim().toLowerCase(),
      domains.trim(),
      apple_team_id?.trim() || null,
      apple_bundle_id?.trim() || null,
      ios_app_store_url?.trim() || null,
      android_package_name?.trim() || null,
      android_sha256_fingerprints?.trim() || null,
      android_play_store_url?.trim() || null,
      logo_url?.trim() || null,
      primary_color?.trim() || '#667eea',
      web_fallback_url?.trim() || null,
      id,
    );

    res.redirect('/admin');
  } catch (error) {
    console.error('Update app error:', error);
    res.render('admin/app-form', {
      title: 'Edit App',
      app: { id, ...req.body },
      error: 'An error occurred. Please try again.',
    });
  }
});

// Delete app
router.post('/apps/:id/delete', (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const db = getDb();
    db.prepare('DELETE FROM apps WHERE id = ?').run(id);
    res.redirect('/admin');
  } catch (error) {
    console.error('Delete app error:', error);
    res.redirect('/admin');
  }
});

export { router as adminAppsRoutes };
