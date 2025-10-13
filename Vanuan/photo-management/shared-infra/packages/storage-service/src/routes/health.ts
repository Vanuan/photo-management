import { Router, Request, Response, NextFunction } from 'express';
import { StorageCoordinator, Logger } from '@shared-infra/storage-core';

export class HealthRoutes {
  public router: Router;

  constructor(
    private storage: StorageCoordinator,
    private logger: Logger,
    private startTime: Date
  ) {
    this.router = Router();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.router.get('/', this.getHealth.bind(this));
    this.router.get('/detailed', this.getDetailedHealth.bind(this));
    this.router.get('/ready', this.getReadiness.bind(this));
    this.router.get('/live', this.getLiveness.bind(this));
  }

  async getHealth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const health = await this.storage.getHealthStatus();
      const uptime = Date.now() - this.startTime.getTime();

      const status = {
        service: health.overall ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: uptime,
        version: '1.0.0',
        components: {
          database: health.database ? 'connected' : 'disconnected',
          storage: health.storage ? 'connected' : 'disconnected',
        },
      };

      const httpStatus = health.overall ? 200 : 503;

      res.status(httpStatus).json({
        success: health.overall,
        data: status,
        meta: {
          requestId: req.id,
          timestamp: new Date().toISOString(),
        },
      });

      if (!health.overall) {
        this.logger.warn('Health check failed', {
          database: health.database,
          storage: health.storage,
          requestId: req.id,
        });
      }
    } catch (error) {
      this.logger.error('Health check error', {
        error: (error as Error).message,
        requestId: req.id,
      });

      res.status(503).json({
        success: false,
        error: 'Health check failed',
        data: {
          service: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: (error as Error).message,
        },
        meta: {
          requestId: req.id,
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  async getDetailedHealth(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const health = await this.storage.getHealthStatus();
      const uptime = Date.now() - this.startTime.getTime();

      // Get system information
      const memoryUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();

      const detailedStatus = {
        service: health.overall ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: uptime,
        uptimeHuman: this.formatUptime(uptime),
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        components: {
          database: {
            status: health.database ? 'connected' : 'disconnected',
            type: 'sqlite',
          },
          storage: {
            status: health.storage ? 'connected' : 'disconnected',
            type: 'minio',
          },
        },
        system: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          pid: process.pid,
          memory: {
            rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB',
            heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB',
            heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
            external: Math.round(memoryUsage.external / 1024 / 1024) + ' MB',
          },
          cpu: {
            user: cpuUsage.user,
            system: cpuUsage.system,
          },
        },
        timestamps: {
          started: this.startTime.toISOString(),
          current: new Date().toISOString(),
        },
      };

      const httpStatus = health.overall ? 200 : 503;

      res.status(httpStatus).json({
        success: health.overall,
        data: detailedStatus,
        meta: {
          requestId: req.id,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      this.logger.error('Detailed health check error', {
        error: (error as Error).message,
        requestId: req.id,
      });

      res.status(503).json({
        success: false,
        error: 'Detailed health check failed',
        data: {
          service: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: (error as Error).message,
        },
        meta: {
          requestId: req.id,
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  async getReadiness(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const health = await this.storage.getHealthStatus();

      if (health.overall) {
        res.status(200).json({
          status: 'ready',
          timestamp: new Date().toISOString(),
          checks: {
            database: 'ok',
            storage: 'ok',
          },
        });
      } else {
        res.status(503).json({
          status: 'not ready',
          timestamp: new Date().toISOString(),
          checks: {
            database: health.database ? 'ok' : 'failed',
            storage: health.storage ? 'ok' : 'failed',
          },
        });
      }
    } catch (error) {
      this.logger.error('Readiness check error', {
        error: (error as Error).message,
        requestId: req.id,
      });

      res.status(503).json({
        status: 'not ready',
        timestamp: new Date().toISOString(),
        error: (error as Error).message,
      });
    }
  }

  async getLiveness(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Simple liveness check - just verify the service is responding
      res.status(200).json({
        status: 'alive',
        timestamp: new Date().toISOString(),
        uptime: Date.now() - this.startTime.getTime(),
      });
    } catch (error) {
      this.logger.error('Liveness check error', {
        error: (error as Error).message,
        requestId: req.id,
      });

      res.status(503).json({
        status: 'not alive',
        timestamp: new Date().toISOString(),
        error: (error as Error).message,
      });
    }
  }

  private formatUptime(uptimeMs: number): string {
    const seconds = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}
