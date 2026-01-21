import { Router, Request, Response } from 'express';
import { getDb } from '../../db/client.js';
import { requireAuth, addUserToLocals } from '../../middleware/requireAuth.js';
import { getReferralStats, getReferrals, type Referral } from '../../services/referrals.js';
import type { App } from '../../middleware/resolveApp.js';

const router = Router();

// Protect all routes
router.use(requireAuth);
router.use(addUserToLocals);

// Referrals dashboard
router.get('/', (req: Request, res: Response) => {
  const { app_id, days } = req.query;
  const selectedAppId = typeof app_id === 'string' ? app_id : undefined;
  const selectedDays = typeof days === 'string' ? parseInt(days, 10) : 30;

  const db = getDb();
  const apps = db.prepare('SELECT * FROM apps ORDER BY name').all() as App[];

  // Get referral stats
  const stats = getReferralStats(selectedAppId, selectedDays);

  // Get app name mapping for display
  const appMap = new Map<string, string>();
  for (const app of apps) {
    appMap.set(app.id, app.name);
  }

  // Enrich referrals with app names
  const enrichedReferrals = stats.recent_referrals.map(r => ({
    ...r,
    app_name: appMap.get(r.app_id) || 'Unknown',
  }));

  res.render('admin/referrals', {
    title: 'Referrals',
    apps,
    stats: {
      ...stats,
      recent_referrals: enrichedReferrals,
    },
    selectedAppId,
    selectedDays,
  });
});

export { router as adminReferralsRoutes };
