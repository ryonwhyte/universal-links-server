import { Router, Request, Response } from 'express';
import { getDb, generateId } from '../../db/client.js';
import { requireAuth, addUserToLocals } from '../../middleware/requireAuth.js';
import type { App, Route } from '../../middleware/resolveApp.js';
import { getAllTemplates } from '../../services/templates.js';

const router = Router();

// Protect all routes
router.use(requireAuth);
router.use(addUserToLocals);

// Get available template names (from both code and DB)
function getAvailableTemplates(): string[] {
  return getAllTemplates().map(t => t.name);
}

// List routes for an app
router.get('/apps/:id/routes', (req: Request, res: Response) => {
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

  const routes = db.prepare('SELECT * FROM routes WHERE app_id = ? ORDER BY prefix').all(id) as Route[];
  const templates = getAvailableTemplates();

  res.render('admin/routes-list', {
    title: `Routes - ${app.name}`,
    app,
    routes,
    templates,
    error: null,
  });
});

// New route form
router.get('/apps/:id/routes/new', (req: Request, res: Response) => {
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

  const templates = getAvailableTemplates();

  res.render('admin/route-form', {
    title: `New Route - ${app.name}`,
    app,
    route: null,
    templates,
    error: null,
  });
});

// Create route
router.post('/apps/:id/routes/new', (req: Request, res: Response) => {
  const { id } = req.params;
  const { prefix, name, template, api_endpoint, universal_link_enabled, web_fallback_url, og_title, og_description, og_image, og_fetch_from_fallback } = req.body;

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

  // Validate required fields
  if (!prefix || !name) {
    const templates = getAvailableTemplates();
    res.render('admin/route-form', {
      title: `New Route - ${app.name}`,
      app,
      route: req.body,
      templates,
      error: 'Prefix and name are required.',
    });
    return;
  }

  // Validate prefix format (single letter or short alphanumeric)
  const cleanPrefix = prefix.trim().toLowerCase().replace(/^\//, '');
  if (!/^[a-z0-9-]+$/.test(cleanPrefix) || cleanPrefix.length > 50) {
    const templates = getAvailableTemplates();
    res.render('admin/route-form', {
      title: `New Route - ${app.name}`,
      app,
      route: req.body,
      templates,
      error: 'Prefix must contain only lowercase letters, numbers, and hyphens (max 50 characters).',
    });
    return;
  }

  try {
    // Check if prefix is unique for this app
    const existing = db.prepare('SELECT id FROM routes WHERE app_id = ? AND prefix = ?').get(id, cleanPrefix);
    if (existing) {
      const templates = getAvailableTemplates();
      res.render('admin/route-form', {
        title: `New Route - ${app.name}`,
        app,
        route: req.body,
        templates,
        error: 'A route with this prefix already exists for this app.',
      });
      return;
    }

    // Insert route
    const routeId = generateId();
    db.prepare(`
      INSERT INTO routes (id, app_id, prefix, name, template, api_endpoint, universal_link_enabled, web_fallback_url, og_title, og_description, og_image, og_fetch_from_fallback)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      routeId,
      id,
      cleanPrefix,
      name.trim(),
      template?.trim() || 'generic',
      api_endpoint?.trim() || null,
      universal_link_enabled === 'on' || universal_link_enabled === '1' ? 1 : 0,
      web_fallback_url?.trim() || null,
      og_title?.trim() || null,
      og_description?.trim() || null,
      og_image?.trim() || null,
      og_fetch_from_fallback === 'on' || og_fetch_from_fallback === '1' ? 1 : 0,
    );

    res.redirect(`/admin/apps/${id}/routes`);
  } catch (error) {
    console.error('Create route error:', error);
    const templates = getAvailableTemplates();
    res.render('admin/route-form', {
      title: `New Route - ${app.name}`,
      app,
      route: req.body,
      templates,
      error: 'An error occurred. Please try again.',
    });
  }
});

// Edit route form
router.get('/apps/:appId/routes/:routeId', (req: Request, res: Response) => {
  const { appId, routeId } = req.params;

  const db = getDb();
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId) as App | undefined;
  const route = db.prepare('SELECT * FROM routes WHERE id = ? AND app_id = ?').get(routeId, appId) as Route | undefined;

  if (!app || !route) {
    res.status(404).render('public/error', {
      title: 'Not Found',
      message: 'App or route not found.',
      app: null,
    });
    return;
  }

  const templates = getAvailableTemplates();

  res.render('admin/route-form', {
    title: `Edit Route - ${app.name}`,
    app,
    route,
    templates,
    error: null,
  });
});

// Update route
router.post('/apps/:appId/routes/:routeId', (req: Request, res: Response) => {
  const { appId, routeId } = req.params;
  const { prefix, name, template, api_endpoint, universal_link_enabled, web_fallback_url, og_title, og_description, og_image, og_fetch_from_fallback } = req.body;

  const db = getDb();
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId) as App | undefined;

  if (!app) {
    res.status(404).render('public/error', {
      title: 'Not Found',
      message: 'App not found.',
      app: null,
    });
    return;
  }

  // Validate required fields
  if (!prefix || !name) {
    const templates = getAvailableTemplates();
    res.render('admin/route-form', {
      title: `Edit Route - ${app.name}`,
      app,
      route: { id: routeId, ...req.body },
      templates,
      error: 'Prefix and name are required.',
    });
    return;
  }

  const cleanPrefix = prefix.trim().toLowerCase().replace(/^\//, '');
  if (!/^[a-z0-9-]+$/.test(cleanPrefix) || cleanPrefix.length > 50) {
    const templates = getAvailableTemplates();
    res.render('admin/route-form', {
      title: `Edit Route - ${app.name}`,
      app,
      route: { id: routeId, ...req.body },
      templates,
      error: 'Prefix must contain only lowercase letters, numbers, and hyphens (max 50 characters).',
    });
    return;
  }

  try {
    // Check if prefix is unique (excluding current route)
    const existing = db.prepare('SELECT id FROM routes WHERE app_id = ? AND prefix = ? AND id != ?').get(appId, cleanPrefix, routeId);
    if (existing) {
      const templates = getAvailableTemplates();
      res.render('admin/route-form', {
        title: `Edit Route - ${app.name}`,
        app,
        route: { id: routeId, ...req.body },
        templates,
        error: 'A route with this prefix already exists for this app.',
      });
      return;
    }

    // Update route
    db.prepare(`
      UPDATE routes SET
        prefix = ?, name = ?, template = ?, api_endpoint = ?, universal_link_enabled = ?, web_fallback_url = ?,
        og_title = ?, og_description = ?, og_image = ?, og_fetch_from_fallback = ?
      WHERE id = ? AND app_id = ?
    `).run(
      cleanPrefix,
      name.trim(),
      template?.trim() || 'generic',
      api_endpoint?.trim() || null,
      universal_link_enabled === 'on' || universal_link_enabled === '1' ? 1 : 0,
      web_fallback_url?.trim() || null,
      og_title?.trim() || null,
      og_description?.trim() || null,
      og_image?.trim() || null,
      og_fetch_from_fallback === 'on' || og_fetch_from_fallback === '1' ? 1 : 0,
      routeId,
      appId,
    );

    res.redirect(`/admin/apps/${appId}/routes`);
  } catch (error) {
    console.error('Update route error:', error);
    const templates = getAvailableTemplates();
    res.render('admin/route-form', {
      title: `Edit Route - ${app.name}`,
      app,
      route: { id: routeId, ...req.body },
      templates,
      error: 'An error occurred. Please try again.',
    });
  }
});

// Delete route
router.post('/apps/:appId/routes/:routeId/delete', (req: Request, res: Response) => {
  const { appId, routeId } = req.params;

  try {
    const db = getDb();
    db.prepare('DELETE FROM routes WHERE id = ? AND app_id = ?').run(routeId, appId);
    res.redirect(`/admin/apps/${appId}/routes`);
  } catch (error) {
    console.error('Delete route error:', error);
    res.redirect(`/admin/apps/${appId}/routes`);
  }
});

export { router as adminRoutesRoutes };
