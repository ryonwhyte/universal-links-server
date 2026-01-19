import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ejs from 'ejs';
import { getDb, generateId } from '../db/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Template directories
const CUSTOM_TEMPLATES_DIR = path.join(__dirname, '..', '..', 'custom-templates');
const BUILTIN_TEMPLATES_DIR = path.join(__dirname, '..', 'views', 'public', 'templates');

export interface Template {
  id: string;
  name: string;
  description: string | null;
  content?: string;
  source: 'custom' | 'builtin' | 'db';
  created_at?: string;
  updated_at?: string;
}

interface DbTemplate {
  id: string;
  name: string;
  description: string | null;
  content: string;
  created_at: string;
  updated_at: string;
}

/**
 * Ensure custom templates directory exists.
 */
function ensureCustomTemplatesDir(): void {
  if (!fs.existsSync(CUSTOM_TEMPLATES_DIR)) {
    fs.mkdirSync(CUSTOM_TEMPLATES_DIR, { recursive: true });
  }
}

/**
 * Get list of custom templates from custom-templates folder.
 */
function getCustomTemplates(): Template[] {
  ensureCustomTemplatesDir();
  try {
    const files = fs.readdirSync(CUSTOM_TEMPLATES_DIR);
    return files
      .filter(f => f.endsWith('.ejs'))
      .map(f => {
        const name = f.replace('.ejs', '');
        const filePath = path.join(CUSTOM_TEMPLATES_DIR, f);
        const stats = fs.statSync(filePath);
        return {
          id: `custom:${name}`,
          name,
          description: 'Custom template',
          source: 'custom' as const,
          created_at: stats.birthtime.toISOString(),
          updated_at: stats.mtime.toISOString(),
        };
      });
  } catch {
    return [];
  }
}

/**
 * Get list of built-in templates from src/views/public/templates.
 */
function getBuiltinTemplates(): Template[] {
  try {
    const files = fs.readdirSync(BUILTIN_TEMPLATES_DIR);
    return files
      .filter(f => f.endsWith('.ejs'))
      .map(f => ({
        id: `builtin:${f.replace('.ejs', '')}`,
        name: f.replace('.ejs', ''),
        description: 'Built-in template',
        source: 'builtin' as const,
      }));
  } catch {
    return [];
  }
}

/**
 * Get list of database-stored templates.
 */
function getDbTemplates(): Template[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM templates ORDER BY name').all() as DbTemplate[];
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    description: row.description,
    content: row.content,
    source: 'db' as const,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

/**
 * Get all available templates.
 * Priority: custom > builtin > db
 */
export function getAllTemplates(): Template[] {
  const customTemplates = getCustomTemplates();
  const builtinTemplates = getBuiltinTemplates();
  const dbTemplates = getDbTemplates();

  // Create a map to handle overrides (custom > builtin > db)
  const templateMap = new Map<string, Template>();

  // Add DB templates first (lowest priority)
  for (const t of dbTemplates) {
    templateMap.set(t.name, t);
  }

  // Built-in templates override DB
  for (const t of builtinTemplates) {
    templateMap.set(t.name, t);
  }

  // Custom templates have highest priority
  for (const t of customTemplates) {
    templateMap.set(t.name, t);
  }

  return Array.from(templateMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get a single template by name.
 * Priority: custom > builtin > db
 */
export function getTemplateByName(name: string): Template | null {
  ensureCustomTemplatesDir();

  // Check custom templates first
  const customPath = path.join(CUSTOM_TEMPLATES_DIR, `${name}.ejs`);
  if (fs.existsSync(customPath)) {
    const stats = fs.statSync(customPath);
    return {
      id: `custom:${name}`,
      name,
      description: 'Custom template',
      content: fs.readFileSync(customPath, 'utf-8'),
      source: 'custom',
      created_at: stats.birthtime.toISOString(),
      updated_at: stats.mtime.toISOString(),
    };
  }

  // Check built-in templates
  const builtinPath = path.join(BUILTIN_TEMPLATES_DIR, `${name}.ejs`);
  if (fs.existsSync(builtinPath)) {
    return {
      id: `builtin:${name}`,
      name,
      description: 'Built-in template',
      content: fs.readFileSync(builtinPath, 'utf-8'),
      source: 'builtin',
    };
  }

  // Check DB templates
  const db = getDb();
  const dbTemplate = db.prepare('SELECT * FROM templates WHERE name = ?').get(name) as DbTemplate | undefined;
  if (dbTemplate) {
    return {
      id: dbTemplate.id,
      name: dbTemplate.name,
      description: dbTemplate.description,
      content: dbTemplate.content,
      source: 'db',
      created_at: dbTemplate.created_at,
      updated_at: dbTemplate.updated_at,
    };
  }

  return null;
}

/**
 * Get a template by ID (for editing).
 */
export function getTemplateById(id: string): Template | null {
  if (id.startsWith('custom:')) {
    const name = id.replace('custom:', '');
    // Validate name to prevent path traversal
    if (!/^[a-z0-9-]+$/.test(name)) {
      return null;
    }
    return getTemplateByName(name);
  }

  if (id.startsWith('builtin:')) {
    const name = id.replace('builtin:', '');
    // Validate name to prevent path traversal
    if (!/^[a-z0-9-]+$/.test(name)) {
      return null;
    }
    return getTemplateByName(name);
  }

  // DB template
  const db = getDb();
  const dbTemplate = db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as DbTemplate | undefined;
  if (dbTemplate) {
    return {
      id: dbTemplate.id,
      name: dbTemplate.name,
      description: dbTemplate.description,
      content: dbTemplate.content,
      source: 'db',
      created_at: dbTemplate.created_at,
      updated_at: dbTemplate.updated_at,
    };
  }

  return null;
}

/**
 * Render a template with the given context.
 */
export function renderTemplate(name: string, context: object): string {
  const template = getTemplateByName(name);

  if (!template) {
    // Fall back to generic
    const generic = getTemplateByName('generic');
    if (!generic || !generic.content) {
      throw new Error('No template found and generic fallback unavailable');
    }
    return ejs.render(generic.content, context);
  }

  if (!template.content) {
    throw new Error(`Template "${name}" has no content`);
  }

  return ejs.render(template.content, context);
}

/**
 * Save an uploaded .ejs file to custom-templates folder.
 */
export function saveCustomTemplate(name: string, content: string): Template {
  ensureCustomTemplatesDir();

  // Validate name format (slug-like)
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error('Name must contain only lowercase letters, numbers, and hyphens.');
  }

  const filePath = path.join(CUSTOM_TEMPLATES_DIR, `${name}.ejs`);
  fs.writeFileSync(filePath, content, 'utf-8');

  const stats = fs.statSync(filePath);
  return {
    id: `custom:${name}`,
    name,
    description: 'Custom template',
    content,
    source: 'custom',
    created_at: stats.birthtime.toISOString(),
    updated_at: stats.mtime.toISOString(),
  };
}

/**
 * Update a custom template file.
 */
export function updateCustomTemplate(name: string, content: string): Template {
  ensureCustomTemplatesDir();

  const filePath = path.join(CUSTOM_TEMPLATES_DIR, `${name}.ejs`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Custom template "${name}" not found.`);
  }

  fs.writeFileSync(filePath, content, 'utf-8');

  const stats = fs.statSync(filePath);
  return {
    id: `custom:${name}`,
    name,
    description: 'Custom template',
    content,
    source: 'custom',
    created_at: stats.birthtime.toISOString(),
    updated_at: stats.mtime.toISOString(),
  };
}

/**
 * Delete a custom template file.
 */
export function deleteCustomTemplate(name: string): boolean {
  const filePath = path.join(CUSTOM_TEMPLATES_DIR, `${name}.ejs`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Create a new database template (for quick edits without file access).
 */
export function createDbTemplate(name: string, description: string | null, content: string): Template {
  const db = getDb();
  const id = generateId();

  db.prepare(`
    INSERT INTO templates (id, name, description, content)
    VALUES (?, ?, ?, ?)
  `).run(id, name, description, content);

  return {
    id,
    name,
    description,
    content,
    source: 'db',
  };
}

/**
 * Update an existing database template.
 */
export function updateDbTemplate(id: string, name: string, description: string | null, content: string): Template {
  const db = getDb();

  db.prepare(`
    UPDATE templates
    SET name = ?, description = ?, content = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(name, description, content, id);

  return {
    id,
    name,
    description,
    content,
    source: 'db',
  };
}

/**
 * Delete a database template.
 */
export function deleteDbTemplate(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM templates WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Export all custom templates as JSON.
 */
export function exportTemplates(): { version: number; exportedAt: string; templates: Array<{ name: string; content: string }> } {
  const customTemplates = getCustomTemplates();

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    templates: customTemplates.map(t => {
      const filePath = path.join(CUSTOM_TEMPLATES_DIR, `${t.name}.ejs`);
      return {
        name: t.name,
        content: fs.readFileSync(filePath, 'utf-8'),
      };
    }),
  };
}

/**
 * Import templates from JSON (saves to custom-templates folder).
 */
export function importTemplatesFromJson(data: { templates?: Array<{ name: string; content: string }> }): { imported: number; skipped: number; errors: string[] } {
  const errors: string[] = [];
  let imported = 0;
  let skipped = 0;

  if (!data.templates || !Array.isArray(data.templates)) {
    return { imported: 0, skipped: 0, errors: ['Invalid import format: missing templates array'] };
  }

  for (const template of data.templates) {
    if (!template.name || !template.content) {
      errors.push(`Skipped template: missing name or content`);
      skipped++;
      continue;
    }

    // Validate template name format to prevent path traversal
    if (!/^[a-z0-9-]+$/.test(template.name)) {
      errors.push(`Skipped template "${template.name}": invalid name format (must be lowercase letters, numbers, hyphens only)`);
      skipped++;
      continue;
    }

    // Validate name length
    if (template.name.length > 50) {
      errors.push(`Skipped template "${template.name}": name too long (max 50 characters)`);
      skipped++;
      continue;
    }

    try {
      saveCustomTemplate(template.name, template.content);
      imported++;
    } catch (error) {
      errors.push(`Failed to import "${template.name}": ${error instanceof Error ? error.message : 'Unknown error'}`);
      skipped++;
    }
  }

  return { imported, skipped, errors };
}
