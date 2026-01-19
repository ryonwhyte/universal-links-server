import { getDb, generateId } from '../db/client.js';

// Event types
export type EventType = 'install' | 'link_opened';
export type Platform = 'ios' | 'android' | 'web' | 'unknown';
export type Source = 'deferred' | 'universal_link' | 'direct';

export interface AnalyticsEvent {
  id: string;
  app_id: string;
  event_type: EventType;
  deep_link: string | null;
  route_id: string | null;
  platform: Platform | null;
  source: Source | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface AnalyticsSettings {
  enabled: boolean;
  use_umami: boolean;
  umami_url: string | null;
  umami_site_id: string | null;
  umami_api_key: string | null;
}

interface EventRow {
  id: string;
  app_id: string;
  event_type: string;
  deep_link: string | null;
  route_id: string | null;
  platform: string | null;
  source: string | null;
  metadata: string | null;
  created_at: string;
}

// Settings management
export function getAnalyticsSettings(): AnalyticsSettings {
  const db = getDb();
  const defaults: AnalyticsSettings = {
    enabled: true,
    use_umami: false,
    umami_url: null,
    umami_site_id: null,
    umami_api_key: null,
  };

  const rows = db.prepare(`SELECT key, value FROM settings WHERE key LIKE 'analytics_%'`).all() as { key: string; value: string }[];

  for (const row of rows) {
    const key = row.key.replace('analytics_', '') as keyof AnalyticsSettings;
    if (key in defaults) {
      if (key === 'enabled' || key === 'use_umami') {
        (defaults[key] as boolean) = row.value === 'true';
      } else {
        (defaults[key] as string | null) = row.value || null;
      }
    }
  }

  return defaults;
}

export function updateAnalyticsSettings(settings: Partial<AnalyticsSettings>): void {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(settings)) {
      if (value !== undefined) {
        upsert.run(`analytics_${key}`, String(value));
      }
    }
  });

  transaction();
}

// Event logging
export async function logEvent(event: {
  app_id: string;
  event_type: EventType;
  deep_link?: string;
  route_id?: string;
  platform?: Platform;
  source?: Source;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const settings = getAnalyticsSettings();

  if (!settings.enabled) {
    return;
  }

  if (settings.use_umami && settings.umami_url && settings.umami_site_id) {
    await logToUmami(event, settings);
  } else {
    logToDatabase(event);
  }
}

function logToDatabase(event: {
  app_id: string;
  event_type: EventType;
  deep_link?: string;
  route_id?: string;
  platform?: Platform;
  source?: Source;
  metadata?: Record<string, unknown>;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO events (id, app_id, event_type, deep_link, route_id, platform, source, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    generateId(),
    event.app_id,
    event.event_type,
    event.deep_link || null,
    event.route_id || null,
    event.platform || null,
    event.source || null,
    event.metadata ? JSON.stringify(event.metadata) : null
  );
}

async function logToUmami(
  event: {
    app_id: string;
    event_type: EventType;
    deep_link?: string;
    route_id?: string;
    platform?: Platform;
    source?: Source;
    metadata?: Record<string, unknown>;
  },
  settings: AnalyticsSettings
): Promise<void> {
  try {
    const payload = {
      website: settings.umami_site_id,
      name: event.event_type,
      data: {
        app_id: event.app_id,
        deep_link: event.deep_link,
        route_id: event.route_id,
        platform: event.platform,
        source: event.source,
        ...event.metadata,
      },
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (settings.umami_api_key) {
      headers['Authorization'] = `Bearer ${settings.umami_api_key}`;
    }

    await fetch(`${settings.umami_url}/api/send`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'event', payload }),
    });
  } catch (error) {
    console.error('Failed to log to Umami:', error);
    // Fall back to database logging
    logToDatabase(event);
  }
}

// Query events for dashboard
export interface EventStats {
  total_events: number;
  installs: number;
  link_opens: number;
  by_platform: { platform: string; count: number }[];
  by_source: { source: string; count: number }[];
  by_path: { path: string; installs: number; link_opens: number; total: number }[];
  by_day: { date: string; installs: number; link_opens: number }[];
  recent_events: AnalyticsEvent[];
}

export function getEventStats(appId?: string, days: number = 30): EventStats {
  const db = getDb();
  const whereClause = appId ? "WHERE app_id = ? AND created_at >= datetime('now', ?)" : "WHERE created_at >= datetime('now', ?)";
  const params = appId ? [appId, `-${days} days`] : [`-${days} days`];

  // Total counts
  const totals = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN event_type = 'install' THEN 1 ELSE 0 END) as installs,
      SUM(CASE WHEN event_type = 'link_opened' THEN 1 ELSE 0 END) as link_opens
    FROM events
    ${whereClause}
  `).get(...params) as { total: number; installs: number; link_opens: number };

  // By platform
  const byPlatform = db.prepare(`
    SELECT platform, COUNT(*) as count
    FROM events
    ${whereClause}
    GROUP BY platform
    ORDER BY count DESC
  `).all(...params) as { platform: string; count: number }[];

  // By source
  const bySource = db.prepare(`
    SELECT source, COUNT(*) as count
    FROM events
    ${whereClause}
    GROUP BY source
    ORDER BY count DESC
  `).all(...params) as { source: string; count: number }[];

  // By path (for campaign tracking)
  const byPath = db.prepare(`
    SELECT
      deep_link as path,
      SUM(CASE WHEN event_type = 'install' THEN 1 ELSE 0 END) as installs,
      SUM(CASE WHEN event_type = 'link_opened' THEN 1 ELSE 0 END) as link_opens,
      COUNT(*) as total
    FROM events
    ${whereClause}
    AND deep_link IS NOT NULL
    GROUP BY deep_link
    ORDER BY total DESC
    LIMIT 50
  `).all(...params) as { path: string; installs: number; link_opens: number; total: number }[];

  // By day
  const byDay = db.prepare(`
    SELECT
      date(created_at) as date,
      SUM(CASE WHEN event_type = 'install' THEN 1 ELSE 0 END) as installs,
      SUM(CASE WHEN event_type = 'link_opened' THEN 1 ELSE 0 END) as link_opens
    FROM events
    ${whereClause}
    GROUP BY date(created_at)
    ORDER BY date DESC
    LIMIT 30
  `).all(...params) as { date: string; installs: number; link_opens: number }[];

  // Recent events
  const recentRows = db.prepare(`
    SELECT * FROM events
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT 50
  `).all(...params) as EventRow[];

  const recentEvents: AnalyticsEvent[] = recentRows.map(row => ({
    ...row,
    event_type: row.event_type as EventType,
    platform: row.platform as Platform | null,
    source: row.source as Source | null,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  }));

  return {
    total_events: totals.total || 0,
    installs: totals.installs || 0,
    link_opens: totals.link_opens || 0,
    by_platform: byPlatform,
    by_source: bySource,
    by_path: byPath,
    by_day: byDay.reverse(),
    recent_events: recentEvents,
  };
}

// Get events for a specific app
export function getAppEvents(appId: string, limit: number = 100): AnalyticsEvent[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM events
    WHERE app_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(appId, limit) as EventRow[];

  return rows.map(row => ({
    ...row,
    event_type: row.event_type as EventType,
    platform: row.platform as Platform | null,
    source: row.source as Source | null,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  }));
}
