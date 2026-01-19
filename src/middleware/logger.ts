import { Request, Response, NextFunction } from 'express';

/**
 * Simple request logging middleware.
 * Logs method, path, status code, and response time.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const { method, originalUrl } = req;

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;

    // Color code based on status
    let statusColor = '\x1b[32m'; // Green for 2xx
    if (statusCode >= 400 && statusCode < 500) {
      statusColor = '\x1b[33m'; // Yellow for 4xx
    } else if (statusCode >= 500) {
      statusColor = '\x1b[31m'; // Red for 5xx
    } else if (statusCode >= 300 && statusCode < 400) {
      statusColor = '\x1b[36m'; // Cyan for 3xx
    }
    const resetColor = '\x1b[0m';

    // Format: [timestamp] METHOD /path STATUS duration
    const timestamp = new Date().toISOString();
    console.log(
      `[${timestamp}] ${method} ${originalUrl} ${statusColor}${statusCode}${resetColor} ${duration}ms`
    );
  });

  next();
}

/**
 * Skip logging for specific paths (e.g., health checks, static files).
 */
export function requestLoggerWithFilter(skipPaths: string[] = []) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip logging for specified paths
    if (skipPaths.some(path => req.originalUrl.startsWith(path))) {
      next();
      return;
    }

    requestLogger(req, res, next);
  };
}
