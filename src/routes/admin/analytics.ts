import { Router, Request, Response } from 'express';
import { requireAuth, addUserToLocals } from '../../middleware/requireAuth.js';
import { getEventStats, getAnalyticsSettings } from '../../services/analytics.js';
import { getDb } from '../../db/client.js';

const router = Router();

// Protect all routes
router.use(requireAuth);
router.use(addUserToLocals);

interface App {
  id: string;
  name: string;
  slug: string;
}

// Analytics dashboard
router.get('/', (req: Request, res: Response) => {
  const settings = getAnalyticsSettings();

  // If using Umami, redirect to settings (they should use Umami dashboard)
  if (settings.use_umami) {
    res.redirect('/admin/settings');
    return;
  }

  const { app_id, days } = req.query;
  const daysNum = parseInt(days as string) || 30;

  // Get all apps for filter dropdown
  const db = getDb();
  const apps = db.prepare('SELECT id, name, slug FROM apps ORDER BY name').all() as App[];

  // Get stats (optionally filtered by app)
  const stats = getEventStats(app_id as string | undefined, daysNum);

  res.render('admin/analytics', {
    title: 'Analytics',
    stats,
    apps,
    selectedAppId: app_id || '',
    selectedDays: daysNum,
  });
});

export { router as adminAnalyticsRoutes };
