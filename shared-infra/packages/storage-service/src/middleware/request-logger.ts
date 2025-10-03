import { Request, Response, NextFunction } from 'express';
import { Logger } from '@shared-infra/storage-core';

export function requestLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    // Log request start
    logger.info('Request started', {
      method: req.method,
      path: req.path,
      url: req.originalUrl,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      requestId: req.id,
      contentLength: req.get('Content-Length'),
      contentType: req.get('Content-Type'),
      timestamp: new Date().toISOString(),
    });

    // Capture original send function
    const originalSend = res.send;

    // Override response send to log completion
    res.send = function (body) {
      const duration = Date.now() - startTime;
      const responseSize = body ? Buffer.byteLength(body, 'utf8') : 0;

      // Log request completion
      logger.info('Request completed', {
        method: req.method,
        path: req.path,
        url: req.originalUrl,
        status: res.statusCode,
        duration,
        responseSize,
        requestId: req.id,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });

      // Call original send
      return originalSend.call(this, body);
    };

    // Log response on finish event (backup in case send isn't called)
    res.on('finish', () => {
      const duration = Date.now() - startTime;

      if (!res.headersSent) {
        logger.info('Request finished', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration,
          requestId: req.id,
          timestamp: new Date().toISOString(),
        });
      }
    });

    // Log errors on response error
    res.on('error', error => {
      const duration = Date.now() - startTime;

      logger.error('Response error', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        error: error.message,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
    });

    next();
  };
}

export function requestMetrics(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = process.hrtime.bigint();

    res.on('finish', () => {
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds

      // Log performance metrics
      if (duration > 1000) {
        // Log slow requests (>1s)
        logger.warn('Slow request detected', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration,
          requestId: req.id,
          timestamp: new Date().toISOString(),
        });
      }

      // Log high-level metrics
      logger.info('Request metrics', {
        method: req.method,
        endpoint: req.route?.path || req.path,
        status: res.statusCode,
        duration,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
    });

    next();
  };
}

export function securityLogger(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Log potential security events
    const suspiciousPatterns = [
      /\.\./, // Path traversal
      /<script/i, // XSS attempts
      /union.*select/i, // SQL injection
      /javascript:/i, // JavaScript protocol
      /(exec|eval|system)/i, // Code execution
    ];

    const url = req.originalUrl.toLowerCase();
    const body = typeof req.body === 'string' ? req.body.toLowerCase() : '';

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(url) || pattern.test(body)) {
        logger.warn('Suspicious request detected', {
          method: req.method,
          path: req.path,
          url: req.originalUrl,
          pattern: pattern.source,
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          requestId: req.id,
          timestamp: new Date().toISOString(),
        });
        break;
      }
    }

    // Log requests with unusual characteristics
    if (req.get('Content-Length') && parseInt(req.get('Content-Length')!) > 50 * 1024 * 1024) {
      logger.warn('Large request detected', {
        method: req.method,
        path: req.path,
        contentLength: req.get('Content-Length'),
        ip: req.ip,
        requestId: req.id,
        timestamp: new Date().toISOString(),
      });
    }

    next();
  };
}
