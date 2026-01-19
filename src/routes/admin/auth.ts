import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { getDb } from '../../db/client.js';
import { addUserToLocals, requireAuth } from '../../middleware/requireAuth.js';
import { getAnalyticsSettings, updateAnalyticsSettings } from '../../services/analytics.js';

const SALT_ROUNDS = 12;

const router = Router();

// Add user info to all admin views
router.use(addUserToLocals);

interface User {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
}

// Login page
router.get('/login', (req: Request, res: Response) => {
  // If already logged in, redirect to dashboard
  if (req.session.userId) {
    res.redirect('/admin');
    return;
  }

  res.render('admin/login', {
    title: 'Login',
    error: null,
  });
});

// Login handler
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;

  // Validate input
  if (!email || !password) {
    res.render('admin/login', {
      title: 'Login',
      error: 'Email and password are required.',
    });
    return;
  }

  // Sanitize email
  const sanitizedEmail = email.trim().toLowerCase();

  try {
    const db = getDb();

    // Find user by email
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(sanitizedEmail) as User | undefined;

    if (!user) {
      // Use same error message to prevent email enumeration
      res.render('admin/login', {
        title: 'Login',
        error: 'Invalid email or password.',
      });
      return;
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      res.render('admin/login', {
        title: 'Login',
        error: 'Invalid email or password.',
      });
      return;
    }

    // Regenerate session to prevent session fixation
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration error:', err);
        res.render('admin/login', {
          title: 'Login',
          error: 'An error occurred. Please try again.',
        });
        return;
      }

      // Set session data
      req.session.userId = user.id;
      req.session.userEmail = user.email;

      // Redirect to original URL or dashboard
      let returnTo = req.session.returnTo || '/admin';
      delete req.session.returnTo;

      // Prevent open redirect - must be relative path starting with single /
      if (!returnTo.startsWith('/') || returnTo.startsWith('//') || returnTo.includes('://')) {
        returnTo = '/admin';
      }

      res.redirect(returnTo);
    });
  } catch (error) {
    console.error('Login error:', error);
    res.render('admin/login', {
      title: 'Login',
      error: 'An error occurred. Please try again.',
    });
  }
});

// Logout handler
router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/admin/login');
  });
});

// Logout via GET (for convenience)
router.get('/logout', (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/admin/login');
  });
});

// Settings page
router.get('/settings', requireAuth, (_req: Request, res: Response) => {
  const analytics = getAnalyticsSettings();
  res.render('admin/settings', {
    title: 'Settings',
    analytics,
    error: null,
    success: null,
  });
});

// Save analytics settings
router.post('/settings/analytics', requireAuth, (req: Request, res: Response) => {
  const { enabled, use_umami, umami_url, umami_site_id, umami_api_key } = req.body;

  try {
    updateAnalyticsSettings({
      enabled: enabled === 'true',
      use_umami: use_umami === 'true',
      umami_url: umami_url || null,
      umami_site_id: umami_site_id || null,
      umami_api_key: umami_api_key || null,
    });

    const analytics = getAnalyticsSettings();
    res.render('admin/settings', {
      title: 'Settings',
      analytics,
      error: null,
      success: 'Analytics settings saved.',
    });
  } catch (error) {
    console.error('Failed to save analytics settings:', error);
    const analytics = getAnalyticsSettings();
    res.render('admin/settings', {
      title: 'Settings',
      analytics,
      error: 'Failed to save settings.',
      success: null,
    });
  }
});

// Change password page
router.get('/change-password', requireAuth, (_req: Request, res: Response) => {
  res.render('admin/change-password', {
    title: 'Change Password',
    error: null,
    success: null,
  });
});

// Change password handler
router.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  const { current_password, new_password, confirm_password } = req.body;

  // Validate input
  if (!current_password || !new_password || !confirm_password) {
    res.render('admin/change-password', {
      title: 'Change Password',
      error: 'All fields are required.',
      success: null,
    });
    return;
  }

  if (new_password !== confirm_password) {
    res.render('admin/change-password', {
      title: 'Change Password',
      error: 'New passwords do not match.',
      success: null,
    });
    return;
  }

  // Password complexity requirements
  const passwordErrors: string[] = [];
  if (new_password.length < 12) {
    passwordErrors.push('at least 12 characters');
  }
  if (!/[A-Z]/.test(new_password)) {
    passwordErrors.push('an uppercase letter');
  }
  if (!/[a-z]/.test(new_password)) {
    passwordErrors.push('a lowercase letter');
  }
  if (!/[0-9]/.test(new_password)) {
    passwordErrors.push('a number');
  }

  if (passwordErrors.length > 0) {
    res.render('admin/change-password', {
      title: 'Change Password',
      error: `Password must contain ${passwordErrors.join(', ')}.`,
      success: null,
    });
    return;
  }

  try {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId) as User | undefined;

    if (!user) {
      res.render('admin/change-password', {
        title: 'Change Password',
        error: 'User not found.',
        success: null,
      });
      return;
    }

    // Verify current password
    const validPassword = await bcrypt.compare(current_password, user.password_hash);

    if (!validPassword) {
      res.render('admin/change-password', {
        title: 'Change Password',
        error: 'Current password is incorrect.',
        success: null,
      });
      return;
    }

    // Hash new password and update
    const newPasswordHash = await bcrypt.hash(new_password, SALT_ROUNDS);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newPasswordHash, user.id);

    res.render('admin/change-password', {
      title: 'Change Password',
      error: null,
      success: 'Password changed successfully.',
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.render('admin/change-password', {
      title: 'Change Password',
      error: 'An error occurred. Please try again.',
      success: null,
    });
  }
});

export { router as adminAuthRoutes };
