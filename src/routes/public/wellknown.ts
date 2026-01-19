import { Router, Request, Response } from 'express';

const router = Router();

// iOS Apple App Site Association
router.get('/apple-app-site-association', (req: Request, res: Response) => {
  const app = req.app_config;
  const routes = req.routes || [];

  if (!app) {
    res.status(404).json({ error: 'App not found' });
    return;
  }

  // Build paths from routes with universal links enabled
  const paths = routes
    .filter(r => r.universal_link_enabled)
    .map(r => `/${r.prefix}/*`);

  // Build the AASA response
  const aasa: Record<string, unknown> = {
    applinks: {
      apps: [],
      details: [] as Array<{ appID: string; paths: string[] }>,
    },
  };

  // Only add details if we have iOS config
  if (app.apple_team_id && app.apple_bundle_id) {
    (aasa.applinks as { apps: string[]; details: Array<{ appID: string; paths: string[] }> }).details.push({
      appID: `${app.apple_team_id}.${app.apple_bundle_id}`,
      paths: paths.length > 0 ? paths : ['NOT /*'], // If no paths, don't match anything
    });
  }

  // Must be served without .json extension
  res.setHeader('Content-Type', 'application/json');
  res.json(aasa);
});

// Android Asset Links
router.get('/assetlinks.json', (req: Request, res: Response) => {
  const app = req.app_config;

  if (!app) {
    res.status(404).json({ error: 'App not found' });
    return;
  }

  const assetlinks: Array<{
    relation: string[];
    target: {
      namespace: string;
      package_name: string;
      sha256_cert_fingerprints: string[];
    };
  }> = [];

  // Only add if we have Android config
  if (app.android_package_name && app.android_sha256_fingerprints) {
    // Fingerprints can be comma-separated for multiple signing keys
    const fingerprints = app.android_sha256_fingerprints
      .split(',')
      .map(fp => fp.trim())
      .filter(fp => fp.length > 0);

    assetlinks.push({
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: app.android_package_name,
        sha256_cert_fingerprints: fingerprints,
      },
    });
  }

  res.setHeader('Content-Type', 'application/json');
  res.json(assetlinks);
});

export { router as wellknownRoutes };
