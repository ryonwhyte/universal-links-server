import { Router, Request, Response } from 'express';

const router = Router();

// Smart app store redirect based on device
router.get('/', (req: Request, res: Response) => {
  const app = req.app_config;

  if (!app) {
    res.status(404).render('public/error', {
      title: 'Not Found',
      message: 'App not found.',
      app: null,
    });
    return;
  }

  const userAgent = req.get('user-agent') || '';

  // Detect iOS devices
  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    if (app.ios_app_store_url) {
      res.redirect(302, app.ios_app_store_url);
      return;
    }
  }

  // Detect Android devices
  if (/Android/i.test(userAgent)) {
    if (app.android_play_store_url) {
      res.redirect(302, app.android_play_store_url);
      return;
    }
  }

  // Desktop or no store URL configured - redirect to fallback or render message
  if (app.web_fallback_url) {
    res.redirect(302, app.web_fallback_url);
    return;
  }

  // No fallback configured, show a page with both store links
  res.render('public/install', {
    title: `Install ${app.name}`,
    app,
  });
});

export { router as installRoutes };
