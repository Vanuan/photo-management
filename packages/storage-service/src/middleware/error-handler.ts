import { Request, Response, NextFunction } from 'express';
import {
  ValidationError,
  PhotoNotFoundError,
  DatabaseError,
  StorageConnectionError,
  StorageError,
  Logger,
} from '@shared-infra/storage-core';

export function errorHandler(logger: Logger) {
  return (error: Error, req: Request, res: Response, next: NextFunction) => {
    const requestId = req.id;
    const timestamp = new Date().toISOString();

    // Log the error
    logger.error('Request error', {
      error: error.message,
      stack: error.stack,
      requestId,
      method: req.method,
      path: req.path,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
    });

    // Handle different error types
    if (error instanceof ValidationError) {
      return res.status(400).json({
        success: false,
        error: {
          type: 'ValidationError',
          message: error.message,
          code: error.code || 'VALIDATION_ERROR',
        },
        meta: {
          requestId,
          timestamp,
        },
      });
    }

    if (error instanceof PhotoNotFoundError) {
      return res.status(404).json({
        success: false,
        error: {
          type: 'PhotoNotFoundError',
          message: error.message,
          code: error.code || 'PHOTO_NOT_FOUND',
        },
        meta: {
          requestId,
          timestamp,
        },
      });
    }

    if (error instanceof DatabaseError) {
      return res.status(500).json({
        success: false,
        error: {
          type: 'DatabaseError',
          message: 'Database operation failed',
          code: error.code || 'DATABASE_ERROR',
        },
        meta: {
          requestId,
          timestamp,
        },
      });
    }

    if (error instanceof StorageConnectionError) {
      return res.status(503).json({
        success: false,
        error: {
          type: 'StorageConnectionError',
          message: 'Storage service unavailable',
          code: error.code || 'STORAGE_CONNECTION_ERROR',
        },
        meta: {
          requestId,
          timestamp,
        },
      });
    }

    if (error instanceof StorageError) {
      return res.status(500).json({
        success: false,
        error: {
          type: 'StorageError',
          message: error.message,
          code: error.code || 'STORAGE_ERROR',
        },
        meta: {
          requestId,
          timestamp,
        },
      });
    }

    // Handle specific HTTP errors
    if (error.name === 'SyntaxError' && 'body' in error) {
      return res.status(400).json({
        success: false,
        error: {
          type: 'SyntaxError',
          message: 'Invalid JSON in request body',
          code: 'INVALID_JSON',
        },
        meta: {
          requestId,
          timestamp,
        },
      });
    }

    // Handle payload too large error
    if (error.message && error.message.includes('request entity too large')) {
      return res.status(413).json({
        success: false,
        error: {
          type: 'PayloadTooLargeError',
          message: 'Request payload too large',
          code: 'PAYLOAD_TOO_LARGE',
        },
        meta: {
          requestId,
          timestamp,
        },
      });
    }

    // Handle timeout errors
    if (error.message && error.message.includes('timeout')) {
      return res.status(408).json({
        success: false,
        error: {
          type: 'TimeoutError',
          message: 'Request timeout',
          code: 'REQUEST_TIMEOUT',
        },
        meta: {
          requestId,
          timestamp,
        },
      });
    }

    // Generic server error
    return res.status(500).json({
      success: false,
      error: {
        type: 'InternalServerError',
        message: 'An internal server error occurred',
        code: 'INTERNAL_SERVER_ERROR',
      },
      meta: {
        requestId,
        timestamp,
      },
    });
  };
}

export function asyncHandler(fn: Function) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function notFoundHandler() {
  return (req: Request, res: Response) => {
    const timestamp = new Date().toISOString();

    res.status(404).json({
      success: false,
      error: {
        type: 'NotFoundError',
        message: `Route ${req.method} ${req.originalUrl} not found`,
        code: 'ROUTE_NOT_FOUND',
      },
      meta: {
        requestId: req.id,
        timestamp,
      },
    });
  };
}
