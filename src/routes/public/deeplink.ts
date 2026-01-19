import { Router, Request, Response } from 'express';
import { getRouteByPrefix } from '../../middleware/resolveApp.js';
import { generateFingerprint } from '../../services/fingerprint.js';
import { storeDeferredLink, buildPlayStoreUrl } from '../../services/deferred.js';
import { cache, API_CACHE_TTL } from '../../services/cache.js';
import { renderTemplate } from '../../services/templates.js';

const router = Router();

// Timeout for API requests (10 seconds)
const API_TIMEOUT = 10000;

/**
 * Validate API endpoint URL to prevent SSRF attacks.
 * Returns true if the URL is safe to fetch.
 */
function isValidApiUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);

    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      return false;
    }

    // Block localhost and common internal hostnames
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return false;
    }

    // Block internal IP ranges (simplified check)
    // 10.x.x.x, 172.16-31.x.x, 192.168.x.x, 169.254.x.x (link-local)
    const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipMatch) {
      const [, a, b] = ipMatch.map(Number);
      if (a === 10) return false; // 10.0.0.0/8
      if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
      if (a === 192 && b === 168) return false; // 192.168.0.0/16
      if (a === 169 && b === 254) return false; // 169.254.0.0/16 (link-local)
      if (a === 127) return false; // 127.0.0.0/8 (loopback)
    }

    return true;
  } catch {
    return false;
  }
}

// Handle deep link routes: /:prefix/:token
router.get('/:prefix/:token', async (req: Request, res: Response) => {
  const { prefix, token } = req.params;
  const app = req.app_config;
  const routes = req.routes || [];

  if (!app) {
    res.status(404).render('public/error', {
      title: 'Not Found',
      message: 'App not found.',
      app: null,
    });
    return;
  }

  // Find route by prefix
  const route = getRouteByPrefix(routes, prefix);

  if (!route) {
    res.status(404).render('public/error', {
      title: 'Not Found',
      message: 'Invalid link.',
      app,
    });
    return;
  }

  // Generate fingerprint and store deferred link
  const fingerprint = generateFingerprint(req);
  const deepLinkPath = `/${prefix}/${token}`;
  const { referrerToken } = storeDeferredLink(app.id, fingerprint, deepLinkPath);

  // Fetch data from API if configured (with caching)
  let apiData = null;
  if (route.api_endpoint) {
    const apiUrl = route.api_endpoint.replace('{token}', encodeURIComponent(token));

    // Validate URL to prevent SSRF attacks
    if (!isValidApiUrl(apiUrl)) {
      console.error('Invalid API URL (SSRF blocked):', apiUrl);
    } else {
      const cacheKey = `api:${apiUrl}`;

      // Check cache first
      apiData = cache.get(cacheKey);

      if (!apiData) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

          const response = await fetch(apiUrl, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'UniversalLinksServer/1.0',
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          apiData = await response.json();
          // Cache successful responses
          cache.set(cacheKey, apiData, API_CACHE_TTL);
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          console.error('API fetch timeout:', apiUrl);
        } else {
          console.error('API fetch error:', error);
        }
        // Continue without API data
      }
    }
    }
  }

  // Build store URLs with referrer token for deferred linking
  let playStoreUrl = app.android_play_store_url;
  if (playStoreUrl) {
    playStoreUrl = buildPlayStoreUrl(playStoreUrl, referrerToken);
  }

  // Render the template (hybrid: DB templates first, then code templates)
  const templateName = route.template || 'generic';
  const context = {
    title: route.name,
    app,
    route,
    token,
    data: apiData,
    deepLink: `${app.slug}://${prefix}/${token}`, // Custom scheme deep link
    playStoreUrl,
    referrerToken,
  };

  try {
    const html = renderTemplate(templateName, context);
    res.send(html);
  } catch (error) {
    // Fallback to Express render for code templates (in case of EJS compile errors)
    console.error(`Template render error for ${templateName}:`, error);
    try {
      res.render('public/templates/generic', context);
    } catch (fallbackError) {
      console.error('Generic template also failed:', fallbackError);
      res.status(500).render('public/error', {
        title: 'Error',
        message: 'Failed to render landing page.',
        app,
      });
    }
  }
});

export { router as deeplinkRoutes };
