import { cache, API_CACHE_TTL } from './cache.js';

export interface OgTags {
  title: string | null;
  description: string | null;
  image: string | null;
}

const FETCH_TIMEOUT = 5000; // 5 seconds

/**
 * Extract OG meta tags from HTML content.
 */
function parseOgTags(html: string): OgTags {
  const result: OgTags = {
    title: null,
    description: null,
    image: null,
  };

  // Match og:title
  const titleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["'][^>]*>/i);
  if (titleMatch) {
    result.title = decodeHtmlEntities(titleMatch[1]);
  }

  // Match og:description
  const descMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["'][^>]*>/i);
  if (descMatch) {
    result.description = decodeHtmlEntities(descMatch[1]);
  }

  // Match og:image
  const imageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i);
  if (imageMatch) {
    result.image = decodeHtmlEntities(imageMatch[1]);
  }

  // Fallbacks if no OG tags found
  if (!result.title) {
    const titleTagMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleTagMatch) {
      result.title = decodeHtmlEntities(titleTagMatch[1]);
    }
  }

  if (!result.description) {
    const metaDescMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i);
    if (metaDescMatch) {
      result.description = decodeHtmlEntities(metaDescMatch[1]);
    }
  }

  return result;
}

/**
 * Decode common HTML entities.
 */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&apos;/g, "'");
}

/**
 * Fetch OG tags from a URL.
 * Follows redirects and caches results.
 */
export async function fetchOgTags(url: string): Promise<OgTags> {
  const cacheKey = `og:${url}`;

  // Check cache first
  const cached = cache.get<OgTags>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const response = await fetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'User-Agent': 'Mozilla/5.0 (compatible; UniversalLinksBot/1.0; +https://example.com)',
      },
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`OG fetch failed for ${url}: ${response.status}`);
      return { title: null, description: null, image: null };
    }

    const html = await response.text();
    const ogTags = parseOgTags(html);

    // Cache successful results
    cache.set(cacheKey, ogTags, API_CACHE_TTL);

    return ogTags;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`OG fetch timeout for ${url}`);
    } else {
      console.error(`OG fetch error for ${url}:`, error);
    }
    return { title: null, description: null, image: null };
  }
}
