import { Router, Request, Response } from 'express';
import { requireAuth, addUserToLocals } from '../../middleware/requireAuth.js';
import {
  getAllTemplates,
  getTemplateById,
  saveCustomTemplate,
  updateCustomTemplate,
  deleteCustomTemplate,
  exportTemplates,
  importTemplatesFromJson,
} from '../../services/templates.js';

const router = Router();

// Protect all routes
router.use(requireAuth);
router.use(addUserToLocals);

// List all templates
router.get('/', (_req: Request, res: Response) => {
  const templates = getAllTemplates();

  // Separate by source
  const customTemplates = templates.filter(t => t.source === 'custom');
  const builtinTemplates = templates.filter(t => t.source === 'builtin');

  res.render('admin/templates-list', {
    title: 'Templates',
    customTemplates,
    builtinTemplates,
  });
});

// New template form
router.get('/new', (_req: Request, res: Response) => {
  res.render('admin/template-form', {
    title: 'New Template',
    template: null,
    error: null,
  });
});

// Create template (saves to custom-templates folder)
router.post('/new', (req: Request, res: Response) => {
  const { name, content } = req.body;

  // Validate input
  if (!name || !content) {
    res.render('admin/template-form', {
      title: 'New Template',
      template: { name, content },
      error: 'Name and content are required.',
    });
    return;
  }

  // Validate name format (slug-like)
  if (!/^[a-z0-9-]+$/.test(name)) {
    res.render('admin/template-form', {
      title: 'New Template',
      template: { name, content },
      error: 'Name must contain only lowercase letters, numbers, and hyphens.',
    });
    return;
  }

  try {
    saveCustomTemplate(name, content);
    res.redirect('/admin/templates');
  } catch (error) {
    res.render('admin/template-form', {
      title: 'New Template',
      template: { name, content },
      error: error instanceof Error ? error.message : 'Failed to create template.',
    });
  }
});

// Edit template form
router.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const template = getTemplateById(id);

  if (!template) {
    res.status(404).render('public/error', {
      title: 'Not Found',
      message: 'Template not found.',
      app: null,
    });
    return;
  }

  // Built-in templates are read-only
  if (template.source === 'builtin') {
    res.render('admin/template-view', {
      title: template.name,
      template,
    });
    return;
  }

  res.render('admin/template-form', {
    title: 'Edit Template',
    template,
    error: null,
  });
});

// Update template
router.post('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { content } = req.body;

  const template = getTemplateById(id);
  if (!template) {
    res.status(404).render('public/error', {
      title: 'Not Found',
      message: 'Template not found.',
      app: null,
    });
    return;
  }

  if (template.source === 'builtin') {
    res.status(403).render('public/error', {
      title: 'Forbidden',
      message: 'Built-in templates cannot be modified.',
      app: null,
    });
    return;
  }

  // Validate input
  if (!content) {
    res.render('admin/template-form', {
      title: 'Edit Template',
      template: { ...template, content },
      error: 'Content is required.',
    });
    return;
  }

  try {
    updateCustomTemplate(template.name, content);
    res.redirect('/admin/templates');
  } catch (error) {
    res.render('admin/template-form', {
      title: 'Edit Template',
      template: { ...template, content },
      error: error instanceof Error ? error.message : 'Failed to update template.',
    });
  }
});

// Delete template
router.post('/:id/delete', (req: Request, res: Response) => {
  const { id } = req.params;

  const template = getTemplateById(id);
  if (!template) {
    res.status(404).render('public/error', {
      title: 'Not Found',
      message: 'Template not found.',
      app: null,
    });
    return;
  }

  if (template.source === 'builtin') {
    res.status(403).render('public/error', {
      title: 'Forbidden',
      message: 'Built-in templates cannot be deleted.',
      app: null,
    });
    return;
  }

  deleteCustomTemplate(template.name);
  res.redirect('/admin/templates');
});

// Export templates as JSON download
router.get('/actions/export', (_req: Request, res: Response) => {
  const data = exportTemplates();
  const filename = `templates-${new Date().toISOString().split('T')[0]}.json`;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(data, null, 2));
});

// Import templates form
router.get('/actions/import', (_req: Request, res: Response) => {
  res.render('admin/templates-import', {
    title: 'Import Templates',
    error: null,
    success: null,
  });
});

// Import templates handler
router.post('/actions/import', (req: Request, res: Response) => {
  const { json_content } = req.body;

  if (!json_content) {
    res.render('admin/templates-import', {
      title: 'Import Templates',
      error: 'Please paste the JSON content to import.',
      success: null,
    });
    return;
  }

  try {
    const data = JSON.parse(json_content);
    const result = importTemplatesFromJson(data);

    if (result.errors.length > 0) {
      res.render('admin/templates-import', {
        title: 'Import Templates',
        error: result.errors.join('; '),
        success: result.imported > 0 ? `Imported ${result.imported} template(s).` : null,
      });
      return;
    }

    res.render('admin/templates-import', {
      title: 'Import Templates',
      error: null,
      success: `Successfully imported ${result.imported} template(s) to custom-templates folder.`,
    });
  } catch (error) {
    res.render('admin/templates-import', {
      title: 'Import Templates',
      error: 'Invalid JSON format.',
      success: null,
    });
  }
});

export { router as adminTemplatesRoutes };
