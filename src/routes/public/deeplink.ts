import { Router, Request, Response } from 'express';
import { UAParser } from 'ua-parser-js';
import { getRouteByPrefix } from '../../middleware/resolveApp.js';
import { generateFingerprint, getIp } from '../../services/fingerprint.js';
import { storeDeferredLink, buildPlayStoreUrl } from '../../services/deferred.js';
import { cache, API_CACHE_TTL } from '../../services/cache.js';
import { renderTemplate, getTemplateByName } from '../../services/templates.js';
import { getReferralByCode } from '../../services/referrals.js';
import { fetchOgTags } from '../../services/ogFetcher.js';

const router = Router();

/**
 * Parse user agent and return device info.
 */
function parseUserAgent(userAgent: string) {
  const parser = new UAParser(userAgent);
  const result = parser.getResult();

  const osName = result.os.name?.toLowerCase() || '';
  const isIOS = osName === 'ios';
  const isAndroid = osName === 'android';
  const isMobile = result.device.type === 'mobile' || result.device.type === 'tablet' || isIOS || isAndroid;

  return {
    isIOS,
    isAndroid,
    isMobile,
    browser: result.browser.name,
    browserVersion: result.browser.version,
    os: result.os.name,
    osVersion: result.os.version,
    device: result.device.model,
    deviceType: result.device.type || 'desktop',
    deviceVendor: result.device.vendor,
  };
}

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

// Handle referral links: /ref/:code
router.get('/ref/:code', async (req: Request, res: Response) => {
  const { code } = req.params;
  const app = req.app_config;

  if (!app) {
    res.status(404).render('public/error', {
      title: 'Not Found',
      message: 'App not found.',
      app: null,
    });
    return;
  }

  // Look up the referral
  const referral = getReferralByCode(code);

  if (!referral || referral.app_id !== app.id) {
    res.status(404).render('public/error', {
      title: 'Invalid Referral',
      message: 'This referral link is invalid or has expired.',
      app,
    });
    return;
  }

  // Device detection
  const userAgent = req.get('user-agent') || '';
  const deviceInfo = parseUserAgent(userAgent);
  const { isIOS, isAndroid, isMobile } = deviceInfo;

  // Store deferred link with referral code
  const fingerprint = generateFingerprint(req);
  const ip = getIp(req);
  const deepLinkPath = `/referral/${code}`;
  const { referrerToken } = storeDeferredLink(app.id, fingerprint, deepLinkPath, ip);

  // Build store URLs with referrer token
  let playStoreUrl = app.android_play_store_url;
  if (playStoreUrl) {
    // Include referral code in Play Store referrer
    playStoreUrl = buildPlayStoreUrl(playStoreUrl, `${referrerToken}&ref=${code}`);
  }

  // Calculate OG meta values (app-level only for referrals)
  const ogTitle = app.og_title || `Join ${app.name}`;
  const ogDescription = app.og_description || `You've been invited to join ${app.name}!`;
  const ogImage = app.og_image || app.logo_url || '';

  // Render referral landing page
  const context = {
    title: `Join ${app.name}`,
    app,
    referral,
    referralCode: code,
    isIOS,
    isAndroid,
    isMobile,
    playStoreUrl,
    referrerToken,
    ogTitle,
    ogDescription,
    ogImage,
  };

  // Try to render referral template, fall back to generic if not found
  try {
    const template = getTemplateByName('referral');
    if (template && template.content) {
      const ejs = await import('ejs');
      const html = ejs.render(template.content, context);
      res.send(html);
    } else {
      // Fallback to rendering a basic referral page
      res.render('public/templates/referral', context);
    }
  } catch (error) {
    console.error('Referral template error:', error);
    res.render('public/templates/referral', context);
  }
});

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

  // Device detection using ua-parser-js
  const userAgent = req.get('user-agent') || '';
  const deviceInfo = parseUserAgent(userAgent);
  const { isIOS, isAndroid, isMobile } = deviceInfo;

  // Get web fallback URL (route-level overrides app-level)
  const webFallbackUrl = route.web_fallback_url || app.web_fallback_url;

  // Desktop users with web fallback → redirect immediately (no landing page)
  if (!isMobile && webFallbackUrl) {
    const redirectUrl = webFallbackUrl.replace('{token}', encodeURIComponent(token));
    res.redirect(302, redirectUrl);
    return;
  }

  // Generate fingerprint and store deferred link
  const fingerprint = generateFingerprint(req);
  const ip = getIp(req);
  const deepLinkPath = `/${prefix}/${token}`;
  const { referrerToken } = storeDeferredLink(app.id, fingerprint, deepLinkPath, ip);

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

  // Mobile users with template "none" → skip landing page, redirect to store
  if (isMobile && route.template === 'none') {
    if (isIOS && app.ios_app_store_url) {
      res.redirect(302, app.ios_app_store_url);
      return;
    }
    if (isAndroid && playStoreUrl) {
      res.redirect(302, playStoreUrl);
      return;
    }
    // No store URL configured - fall back to web fallback if available
    if (webFallbackUrl) {
      const redirectUrl = webFallbackUrl.replace('{token}', encodeURIComponent(token));
      res.redirect(302, redirectUrl);
      return;
    }
    // No fallback either - show error
    res.status(404).render('public/error', {
      title: 'Not Configured',
      message: 'No app store or web fallback configured for this route.',
      app,
    });
    return;
  }

  // Calculate OG meta values (route-level overrides app-level)
  let ogTitle = route.og_title || app.og_title || route.name;
  let ogDescription = route.og_description || app.og_description || '';
  let ogImage = route.og_image || app.og_image || app.logo_url || '';

  // Fetch OG tags from web fallback URL if enabled
  if (route.og_fetch_from_fallback && webFallbackUrl) {
    const resolvedUrl = webFallbackUrl.replace('{token}', encodeURIComponent(token));
    if (isValidApiUrl(resolvedUrl)) {
      const fetchedOg = await fetchOgTags(resolvedUrl);
      if (fetchedOg.title) ogTitle = fetchedOg.title;
      if (fetchedOg.description) ogDescription = fetchedOg.description;
      if (fetchedOg.image) ogImage = fetchedOg.image;
    }
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
    ogTitle,
    ogDescription,
    ogImage,
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
