import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, validateConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { initializeDatabase, cleanupExpiredLinks } from './db/client.js';
import { resolveApp } from './middleware/resolveApp.js';
import { wellknownRoutes } from './routes/public/wellknown.js';
import { deeplinkRoutes } from './routes/public/deeplink.js';
import { installRoutes } from './routes/public/install.js';
import { apiRoutes } from './routes/public/api.js';
import { adminAuthRoutes } from './routes/admin/auth.js';
import { adminAppsRoutes } from './routes/admin/apps.js';
import { adminRoutesRoutes } from './routes/admin/routes.js';
import { adminTemplatesRoutes } from './routes/admin/templates.js';
import { adminAnalyticsRoutes } from './routes/admin/analytics.js';
import { csrfToken, csrfProtection } from './middleware/csrf.js';
import { requestLoggerWithFilter } from './middleware/logger.js';

// Validate config before starting
validateConfig();

const app = express();

// Trust proxy if behind reverse proxy (nginx, etc.)
if (config.trustProxy) {
  app.set('trust proxy', 1);
}

// Request logging (skip static files and health checks in production)
app.use(requestLoggerWithFilter(['/health']));

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// Rate limiting - general
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, please try again later.',
});
app.use(generalLimiter);

// Rate limiting - stricter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 login attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts, please try again later.',
  skipSuccessfulRequests: true,
});

// Rate limiting - for public API endpoints
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Body parsing with size limits
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));

// Session configuration
app.use(session({
  secret: config.sessionSecret,
  name: 'ul.sid', // Custom session name
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.isProduction, // HTTPS only in production
    httpOnly: true, // Prevent XSS access to cookie
    sameSite: 'lax', // CSRF protection
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check (no app resolution needed)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root redirect to admin
app.get('/', (_req, res) => {
  res.redirect('/admin');
});

// Admin routes (no app resolution needed)
app.use('/admin', csrfToken); // Add CSRF token to all admin pages
app.use('/admin/login', authLimiter); // Rate limit login
app.use('/admin', adminAuthRoutes);
app.use('/admin', csrfProtection); // Validate CSRF on POST/PUT/DELETE
app.use('/admin', adminAppsRoutes);
app.use('/admin', adminRoutesRoutes);
app.use('/admin/templates', adminTemplatesRoutes);
app.use('/admin/analytics', adminAnalyticsRoutes);

// Public routes (need app resolution based on hostname)
app.use('/.well-known', resolveApp, wellknownRoutes);
app.use('/api', apiLimiter, resolveApp, apiRoutes);
app.use('/install', resolveApp, installRoutes);
app.use('/', resolveApp, deeplinkRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).render('public/error', {
    title: 'Not Found',
    message: 'The page you are looking for does not exist.',
    app: null,
  });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Server error:', err);
  res.status(500).render('public/error', {
    title: 'Server Error',
    message: config.isProduction ? 'Something went wrong.' : err.message,
    app: null,
  });
});

// Cleanup expired deferred links every hour
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

function startCleanupJob() {
  setInterval(() => {
    try {
      const deleted = cleanupExpiredLinks();
      if (deleted > 0) {
        console.log(`Cleanup: removed ${deleted} expired deferred links`);
      }
    } catch (error) {
      console.error('Cleanup error:', error);
    }
  }, CLEANUP_INTERVAL);

  // Run initial cleanup on startup
  try {
    const deleted = cleanupExpiredLinks();
    if (deleted > 0) {
      console.log(`Initial cleanup: removed ${deleted} expired deferred links`);
    }
  } catch (error) {
    console.error('Initial cleanup error:', error);
  }
}

// Initialize database and start server
async function start() {
  try {
    initializeDatabase();
    console.log('Database initialized');

    // Start cleanup job
    startCleanupJob();

    app.listen(config.port, () => {
      console.log(`Server running on http://localhost:${config.port}`);
      console.log(`Admin UI: http://localhost:${config.port}/admin`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
