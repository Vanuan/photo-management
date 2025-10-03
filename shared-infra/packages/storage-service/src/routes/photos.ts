import { Router, Request, Response, NextFunction } from 'express';
import {
  StorageCoordinator,
  Logger,
  ValidationError,
  PhotoNotFoundError,
} from '@shared-infra/storage-core';

export class PhotoRoutes {
  public router: Router;

  constructor(
    private storage: StorageCoordinator,
    private logger: Logger
  ) {
    this.router = Router();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.router.post('/', this.storePhoto.bind(this));
    this.router.get('/:id', this.getPhoto.bind(this));
    this.router.get('/:id/url', this.getPhotoUrl.bind(this));
    this.router.put('/:id/metadata', this.updatePhotoMetadata.bind(this));
    this.router.delete('/:id', this.deletePhoto.bind(this));
    this.router.post('/search', this.searchPhotos.bind(this));
    this.router.get('/user/:userId', this.getUserPhotos.bind(this));
  }

  async storePhoto(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = Date.now();

    try {
      const { data, options } = req.body;

      if (!data || !options) {
        throw new ValidationError('Missing data or options in request body');
      }

      if (typeof data !== 'string') {
        throw new ValidationError('Data must be a base64 encoded string');
      }

      // Validate required options
      if (!options.originalName) {
        throw new ValidationError('originalName is required');
      }

      if (!options.clientId) {
        throw new ValidationError('clientId is required');
      }

      // Decode base64 data
      let buffer: Buffer;
      try {
        buffer = Buffer.from(data, 'base64');
      } catch (error) {
        throw new ValidationError('Invalid base64 data');
      }

      if (buffer.length === 0) {
        throw new ValidationError('Empty file data');
      }

      // Store photo using storage coordinator
      const result = await this.storage.storePhoto(buffer, {
        originalName: options.originalName,
        contentType: options.contentType,
        clientId: options.clientId,
        sessionId: options.sessionId,
        userId: options.userId,
        metadata: options.metadata,
      });

      res.status(201).json({
        success: true,
        data: result,
        meta: {
          requestId: req.id,
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
        },
      });

      this.logger.info('Photo stored via API', {
        photoId: result.id,
        size: buffer.length,
        duration: Date.now() - startTime,
        requestId: req.id,
        clientId: options.clientId,
      });
    } catch (error) {
      this.logger.error('Failed to store photo via API', {
        error: (error as Error).message,
        duration: Date.now() - startTime,
        requestId: req.id,
      });
      next(error);
    }
  }

  async getPhoto(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Photo ID is required');
      }

      const photo = await this.storage.getPhoto(id);

      if (!photo) {
        throw new PhotoNotFoundError(`Photo not found: ${id}`);
      }

      res.json({
        success: true,
        data: photo,
        meta: {
          requestId: req.id,
          timestamp: new Date().toISOString(),
        },
      });

      this.logger.info('Photo retrieved via API', {
        photoId: id,
        requestId: req.id,
      });
    } catch (error) {
      this.logger.error('Failed to get photo via API', {
        photoId: req.params.id,
        error: (error as Error).message,
        requestId: req.id,
      });
      next(error);
    }
  }

  async getPhotoUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const expiry = parseInt(req.query.expiry as string) || 3600;

      if (!id) {
        throw new ValidationError('Photo ID is required');
      }

      if (expiry > 86400) {
        // Max 24 hours
        throw new ValidationError('Expiry cannot exceed 86400 seconds (24 hours)');
      }

      const url = await this.storage.getPhotoUrl(id, expiry);

      res.json({
        success: true,
        data: {
          url,
          expiry,
          photoId: id,
        },
        meta: {
          requestId: req.id,
          timestamp: new Date().toISOString(),
        },
      });

      this.logger.info('Photo URL generated via API', {
        photoId: id,
        expiry,
        requestId: req.id,
      });
    } catch (error) {
      this.logger.error('Failed to get photo URL via API', {
        photoId: req.params.id,
        error: (error as Error).message,
        requestId: req.id,
      });
      next(error);
    }
  }

  async updatePhotoMetadata(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const metadata = req.body;

      if (!id) {
        throw new ValidationError('Photo ID is required');
      }

      if (!metadata || Object.keys(metadata).length === 0) {
        throw new ValidationError('Metadata is required');
      }

      await this.storage.updatePhotoMetadata(id, metadata);

      res.json({
        success: true,
        data: {
          photoId: id,
          updatedFields: Object.keys(metadata),
        },
        meta: {
          requestId: req.id,
          timestamp: new Date().toISOString(),
        },
      });

      this.logger.info('Photo metadata updated via API', {
        photoId: id,
        updatedFields: Object.keys(metadata),
        requestId: req.id,
      });
    } catch (error) {
      this.logger.error('Failed to update photo metadata via API', {
        photoId: req.params.id,
        error: (error as Error).message,
        requestId: req.id,
      });
      next(error);
    }
  }

  async deletePhoto(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Photo ID is required');
      }

      await this.storage.deletePhoto(id);

      res.json({
        success: true,
        data: {
          photoId: id,
          deleted: true,
        },
        meta: {
          requestId: req.id,
          timestamp: new Date().toISOString(),
        },
      });

      this.logger.info('Photo deleted via API', {
        photoId: id,
        requestId: req.id,
      });
    } catch (error) {
      this.logger.error('Failed to delete photo via API', {
        photoId: req.params.id,
        error: (error as Error).message,
        requestId: req.id,
      });
      next(error);
    }
  }

  async searchPhotos(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = req.body;

      // Set reasonable defaults and limits
      const searchQuery = {
        ...query,
        limit: Math.min(query.limit || 50, 100),
        offset: Math.max(query.offset || 0, 0),
      };

      const result = await this.storage.searchPhotos(searchQuery);

      res.json({
        success: true,
        data: result,
        meta: {
          requestId: req.id,
          timestamp: new Date().toISOString(),
        },
      });

      this.logger.info('Photo search performed via API', {
        query: query.query,
        filters: Object.keys(query.filters || {}),
        results: result.photos.length,
        total: result.total,
        searchTime: result.searchTime,
        requestId: req.id,
      });
    } catch (error) {
      this.logger.error('Failed to search photos via API', {
        error: (error as Error).message,
        requestId: req.id,
      });
      next(error);
    }
  }

  async getUserPhotos(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

      if (!userId) {
        throw new ValidationError('User ID is required');
      }

      const result = await this.storage.getUserPhotos(userId, { limit, offset });

      res.json({
        success: true,
        data: result,
        meta: {
          requestId: req.id,
          timestamp: new Date().toISOString(),
        },
      });

      this.logger.info('User photos retrieved via API', {
        userId,
        count: result.photos.length,
        total: result.pagination.total,
        limit,
        offset,
        requestId: req.id,
      });
    } catch (error) {
      this.logger.error('Failed to get user photos via API', {
        userId: req.params.userId,
        error: (error as Error).message,
        requestId: req.id,
      });
      next(error);
    }
  }
}
