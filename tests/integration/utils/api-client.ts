import axios, { AxiosInstance, AxiosResponse } from 'axios';
import FormData from 'form-data';
import { Readable } from 'stream';

export interface UploadPhotoResponse {
  message: string;
  photoId: string;
  userId: string;
  filename: string;
  status: string;
}

export interface PhotoMetadata {
  id: string;
  userId: string;
  filename: string;
  filepath: string;
  mimeType: string;
  size: number;
  uploadTimestamp: string;
  processingStatus: 'pending' | 'in_progress' | 'completed' | 'failed';
  url?: string;
}

export interface PhotoStatusResponse {
  photoId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface PhotoListResponse {
  photos: PhotoMetadata[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'unavailable';
  timestamp: string;
  details?: {
    storage?: any;
    eventBus?: any;
    jobQueue?: any;
  };
}

/**
 * API Client for testing photo management endpoints
 */
export class APIClient {
  private client: AxiosInstance;
  private baseURL: string;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
    this.client = axios.create({
      baseURL,
      timeout: 30000,
      validateStatus: () => true, // Don't throw on any status
    });
  }

  /**
   * Upload a photo
   */
  async uploadPhoto(
    photoBuffer: Buffer,
    userId: string,
    filename: string,
    mimeType: string = 'image/jpeg'
  ): Promise<{ response: AxiosResponse; data: UploadPhotoResponse }> {
    const formData = new FormData();
    
    // Convert buffer to stream for FormData
    const stream = Readable.from(photoBuffer);
    formData.append('photo', stream, {
      filename,
      contentType: mimeType,
    });

    const response = await this.client.post('/photos/upload', formData, {
      headers: {
        ...formData.getHeaders(),
        'x-user-id': userId,
      },
    });

    return {
      response,
      data: response.data,
    };
  }

  /**
   * Get photo by ID
   */
  async getPhoto(photoId: string): Promise<{ response: AxiosResponse; data: PhotoMetadata }> {
    const response = await this.client.get(`/photos/${photoId}`);
    return {
      response,
      data: response.data,
    };
  }

  /**
   * Get photo status
   */
  async getPhotoStatus(photoId: string): Promise<{ response: AxiosResponse; data: PhotoStatusResponse }> {
    const response = await this.client.get(`/photos/${photoId}/status`);
    return {
      response,
      data: response.data,
    };
  }

  /**
   * List photos for a user
   */
  async getUserPhotos(
    userId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<{ response: AxiosResponse; data: PhotoListResponse }> {
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.offset) params.append('offset', options.offset.toString());

    const response = await this.client.get(`/photos?${params.toString()}`, {
      headers: { 'x-user-id': userId },
    });

    return {
      response,
      data: response.data,
    };
  }

  /**
   * Delete a photo
   */
  async deletePhoto(photoId: string, userId: string): Promise<AxiosResponse> {
    return await this.client.delete(`/photos/${photoId}`, {
      headers: { 'x-user-id': userId },
    });
  }

  /**
   * Check service health
   */
  async checkHealth(): Promise<{ response: AxiosResponse; data: HealthResponse }> {
    const response = await this.client.get('/health');
    return {
      response,
      data: response.data,
    };
  }

  /**
   * Wait for a photo to reach a specific status
   */
  async waitForPhotoStatus(
    photoId: string,
    expectedStatus: 'pending' | 'in_progress' | 'completed' | 'failed',
    timeoutMs: number = 60000,
    pollIntervalMs: number = 1000
  ): Promise<PhotoStatusResponse> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const { data } = await this.getPhotoStatus(photoId);
      
      if (data.status === expectedStatus) {
        return data;
      }

      // If failed when expecting completed, throw error
      if (expectedStatus === 'completed' && data.status === 'failed') {
        throw new Error(`Photo processing failed for ${photoId}`);
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(
      `Timeout waiting for photo ${photoId} to reach status ${expectedStatus}`
    );
  }

  /**
   * Wait for photo processing to complete
   */
  async waitForProcessingComplete(
    photoId: string,
    timeoutMs: number = 60000
  ): Promise<PhotoMetadata> {
    await this.waitForPhotoStatus(photoId, 'completed', timeoutMs);
    const { data } = await this.getPhoto(photoId);
    return data;
  }

  /**
   * Get base URL
   */
  getBaseURL(): string {
    return this.baseURL;
  }
}
