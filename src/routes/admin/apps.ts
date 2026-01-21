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
    referral_enabled,
    referral_expiration_days,
    referral_max_per_user,
    referral_reward_milestone,
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
        logo_url, primary_color, web_fallback_url,
        referral_enabled, referral_expiration_days, referral_max_per_user, referral_reward_milestone
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      referral_enabled ? 1 : 0,
      parseInt(referral_expiration_days, 10) || 30,
      referral_max_per_user ? parseInt(referral_max_per_user, 10) : null,
      referral_reward_milestone?.trim() || 'completed',
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
    referral_enabled,
    referral_expiration_days,
    referral_max_per_user,
    referral_reward_milestone,
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
        referral_enabled = ?, referral_expiration_days = ?, referral_max_per_user = ?, referral_reward_milestone = ?,
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
      referral_enabled ? 1 : 0,
      parseInt(referral_expiration_days, 10) || 30,
      referral_max_per_user ? parseInt(referral_max_per_user, 10) : null,
      referral_reward_milestone?.trim() || 'completed',
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

// Export app as JSON
router.get('/apps/:id/export', (req: Request, res: Response) => {
  const { id } = req.params;

  const db = getDb();
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(id) as App | undefined;

  if (!app) {
    res.status(404).json({ error: 'App not found' });
    return;
  }

  const routes = db.prepare('SELECT * FROM routes WHERE app_id = ?').all(app.id) as Route[];

  // Remove internal IDs for clean export
  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    app: {
      name: app.name,
      slug: app.slug,
      domains: app.domains,
      apple_team_id: app.apple_team_id,
      apple_bundle_id: app.apple_bundle_id,
      ios_app_store_url: app.ios_app_store_url,
      android_package_name: app.android_package_name,
      android_sha256_fingerprints: app.android_sha256_fingerprints,
      android_play_store_url: app.android_play_store_url,
      logo_url: app.logo_url,
      primary_color: app.primary_color,
      web_fallback_url: app.web_fallback_url,
      referral_enabled: app.referral_enabled,
      referral_expiration_days: app.referral_expiration_days,
      referral_max_per_user: app.referral_max_per_user,
      referral_reward_milestone: app.referral_reward_milestone,
    },
    routes: routes.map(r => ({
      prefix: r.prefix,
      name: r.name,
      template: r.template,
      api_endpoint: r.api_endpoint,
      universal_link_enabled: r.universal_link_enabled,
      web_fallback_url: r.web_fallback_url,
    })),
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${app.slug}-export.json"`);
  res.json(exportData);
});

// Import app form
router.get('/apps/import', (_req: Request, res: Response) => {
  res.render('admin/import', {
    title: 'Import App',
    error: null,
  });
});

// Import app from JSON
router.post('/apps/import', (req: Request, res: Response) => {
  const { json_data } = req.body;

  try {
    const data = JSON.parse(json_data);

    if (!data.app || !data.app.name || !data.app.slug || !data.app.domains) {
      res.render('admin/import', {
        title: 'Import App',
        error: 'Invalid export file. Missing required app fields.',
      });
      return;
    }

    const db = getDb();

    // Check if slug already exists
    const existing = db.prepare('SELECT id FROM apps WHERE slug = ?').get(data.app.slug);
    if (existing) {
      res.render('admin/import', {
        title: 'Import App',
        error: `An app with slug "${data.app.slug}" already exists. Change the slug in the JSON or delete the existing app.`,
      });
      return;
    }

    // Create app
    const appId = generateId();
    db.prepare(`
      INSERT INTO apps (
        id, name, slug, domains, apple_team_id, apple_bundle_id, ios_app_store_url,
        android_package_name, android_sha256_fingerprints, android_play_store_url,
        logo_url, primary_color, web_fallback_url,
        referral_enabled, referral_expiration_days, referral_max_per_user, referral_reward_milestone
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      appId,
      data.app.name,
      data.app.slug,
      data.app.domains,
      data.app.apple_team_id || null,
      data.app.apple_bundle_id || null,
      data.app.ios_app_store_url || null,
      data.app.android_package_name || null,
      data.app.android_sha256_fingerprints || null,
      data.app.android_play_store_url || null,
      data.app.logo_url || null,
      data.app.primary_color || '#667eea',
      data.app.web_fallback_url || null,
      data.app.referral_enabled ? 1 : 0,
      data.app.referral_expiration_days || 30,
      data.app.referral_max_per_user || null,
      data.app.referral_reward_milestone || 'completed',
    );

    // Create routes
    if (data.routes && Array.isArray(data.routes)) {
      const insertRoute = db.prepare(`
        INSERT INTO routes (id, app_id, prefix, name, template, api_endpoint, universal_link_enabled, web_fallback_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const route of data.routes) {
        if (route.prefix && route.name) {
          insertRoute.run(
            generateId(),
            appId,
            route.prefix,
            route.name,
            route.template || 'generic',
            route.api_endpoint || null,
            route.universal_link_enabled !== undefined ? (route.universal_link_enabled ? 1 : 0) : 1,
            route.web_fallback_url || null,
          );
        }
      }
    }

    res.redirect('/admin');
  } catch (error) {
    console.error('Import error:', error);
    res.render('admin/import', {
      title: 'Import App',
      error: 'Invalid JSON format. Please check your export file.',
    });
  }
});

export { router as adminAppsRoutes };
