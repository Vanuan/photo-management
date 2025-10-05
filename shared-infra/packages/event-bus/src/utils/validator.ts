/**
 * Event Validator Utility
 *
 * Validates events before publishing to ensure data integrity
 */

import { Event, EventMetadata } from '../types';

export class EventValidator {
  private maxEventSize: number;
  private maxDataSize: number;

  constructor(maxEventSize: number = 1024 * 1024, maxDataSize: number = 512 * 1024) {
    this.maxEventSize = maxEventSize;
    this.maxDataSize = maxDataSize;
  }

  /**
   * Validate an event
   */
  validateEvent(event: Event): void {
    // Check required fields
    if (!event.id) {
      throw new ValidationError('Event ID is required');
    }

    if (!event.type) {
      throw new ValidationError('Event type is required');
    }

    if (event.data === undefined || event.data === null) {
      throw new ValidationError('Event data is required');
    }

    if (!event.metadata) {
      throw new ValidationError('Event metadata is required');
    }

    // Validate event type
    this.validateEventType(event.type);

    // Validate metadata
    this.validateMetadata(event.metadata);

    // Validate event size
    this.validateEventSize(event);

    // Validate data size
    this.validateDataSize(event.data);
  }

  /**
   * Validate event type
   */
  validateEventType(eventType: string): void {
    if (typeof eventType !== 'string') {
      throw new ValidationError('Event type must be a string');
    }

    if (eventType.length === 0) {
      throw new ValidationError('Event type cannot be empty');
    }

    if (eventType.length > 255) {
      throw new ValidationError('Event type is too long (max 255 characters)');
    }

    // Check for valid characters (alphanumeric, dots, hyphens, underscores)
    if (!/^[a-zA-Z0-9._-]+$/.test(eventType)) {
      throw new ValidationError(
        'Event type can only contain alphanumeric characters, dots, hyphens, and underscores'
      );
    }
  }

  /**
   * Validate event metadata
   */
  validateMetadata(metadata: EventMetadata): void {
    // Check required fields
    if (!metadata.source) {
      throw new ValidationError('Metadata source is required');
    }

    if (!metadata.timestamp) {
      throw new ValidationError('Metadata timestamp is required');
    }

    // Validate source
    if (typeof metadata.source !== 'string' || metadata.source.length === 0) {
      throw new ValidationError('Metadata source must be a non-empty string');
    }

    // Validate timestamp
    this.validateTimestamp(metadata.timestamp);

    // Validate optional fields
    if (metadata.traceId !== undefined) {
      this.validateId(metadata.traceId, 'traceId');
    }

    if (metadata.userId !== undefined) {
      this.validateId(metadata.userId, 'userId');
    }

    if (metadata.correlationId !== undefined) {
      this.validateId(metadata.correlationId, 'correlationId');
    }

    if (metadata.version !== undefined && typeof metadata.version !== 'string') {
      throw new ValidationError('Metadata version must be a string');
    }
  }

  /**
   * Validate timestamp
   */
  validateTimestamp(timestamp: string): void {
    if (typeof timestamp !== 'string') {
      throw new ValidationError('Timestamp must be a string');
    }

    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      throw new ValidationError('Invalid timestamp format');
    }

    // Check if timestamp is not too far in the future (max 1 hour)
    const now = Date.now();
    const timestampMs = date.getTime();
    const maxFuture = now + 60 * 60 * 1000; // 1 hour

    if (timestampMs > maxFuture) {
      throw new ValidationError('Timestamp is too far in the future');
    }

    // Check if timestamp is not too far in the past (max 24 hours)
    const maxPast = now - 24 * 60 * 60 * 1000; // 24 hours

    if (timestampMs < maxPast) {
      throw new ValidationError('Timestamp is too far in the past');
    }
  }

  /**
   * Validate ID field
   */
  validateId(id: string, fieldName: string): void {
    if (typeof id !== 'string') {
      throw new ValidationError(`${fieldName} must be a string`);
    }

    if (id.length === 0) {
      throw new ValidationError(`${fieldName} cannot be empty`);
    }

    if (id.length > 255) {
      throw new ValidationError(`${fieldName} is too long (max 255 characters)`);
    }
  }

  /**
   * Validate event size
   */
  validateEventSize(event: Event): void {
    const eventJson = JSON.stringify(event);
    const eventSize = Buffer.byteLength(eventJson, 'utf8');

    if (eventSize > this.maxEventSize) {
      throw new ValidationError(
        `Event size (${eventSize} bytes) exceeds maximum allowed size (${this.maxEventSize} bytes)`
      );
    }
  }

  /**
   * Validate data size
   */
  validateDataSize(data: any): void {
    const dataJson = JSON.stringify(data);
    const dataSize = Buffer.byteLength(dataJson, 'utf8');

    if (dataSize > this.maxDataSize) {
      throw new ValidationError(
        `Event data size (${dataSize} bytes) exceeds maximum allowed size (${this.maxDataSize} bytes)`
      );
    }
  }

  /**
   * Validate event data for specific event types
   */
  validateEventData(eventType: string, data: any): void {
    switch (eventType) {
      case 'photo.uploaded':
        this.validatePhotoUploadedData(data);
        break;
      case 'photo.processing.started':
        this.validatePhotoProcessingStartedData(data);
        break;
      case 'photo.processing.progress':
        this.validatePhotoProcessingProgressData(data);
        break;
      case 'photo.processing.completed':
        this.validatePhotoProcessingCompletedData(data);
        break;
      case 'photo.processing.failed':
        this.validatePhotoProcessingFailedData(data);
        break;
      default:
        // No specific validation for unknown event types
        break;
    }
  }

  /**
   * Validate photo uploaded event data
   */
  private validatePhotoUploadedData(data: any): void {
    this.requireField(data, 'photoId', 'string');
    this.requireField(data, 'userId', 'string');
    this.requireField(data, 'filename', 'string');
    this.requireField(data, 'size', 'number');
    this.requireField(data, 'mimeType', 'string');
    this.requireField(data, 'uploadedAt', 'string');
  }

  /**
   * Validate photo processing started event data
   */
  private validatePhotoProcessingStartedData(data: any): void {
    this.requireField(data, 'photoId', 'string');
    this.requireField(data, 'userId', 'string');
    this.requireField(data, 'jobId', 'string');
    this.requireField(data, 'startedAt', 'string');
  }

  /**
   * Validate photo processing progress event data
   */
  private validatePhotoProcessingProgressData(data: any): void {
    this.requireField(data, 'photoId', 'string');
    this.requireField(data, 'userId', 'string');
    this.requireField(data, 'jobId', 'string');
    this.requireField(data, 'progress', 'number');
    this.requireField(data, 'stage', 'string');

    // Validate progress is between 0 and 100
    if (data.progress < 0 || data.progress > 100) {
      throw new ValidationError('Progress must be between 0 and 100');
    }
  }

  /**
   * Validate photo processing completed event data
   */
  private validatePhotoProcessingCompletedData(data: any): void {
    this.requireField(data, 'photoId', 'string');
    this.requireField(data, 'userId', 'string');
    this.requireField(data, 'jobId', 'string');
    this.requireField(data, 'completedAt', 'string');
    this.requireField(data, 'duration', 'number');
    this.requireField(data, 'thumbnails', 'object');
    this.requireField(data, 'metadata', 'object');
  }

  /**
   * Validate photo processing failed event data
   */
  private validatePhotoProcessingFailedData(data: any): void {
    this.requireField(data, 'photoId', 'string');
    this.requireField(data, 'userId', 'string');
    this.requireField(data, 'jobId', 'string');
    this.requireField(data, 'failedAt', 'string');
    this.requireField(data, 'error', 'object');
    this.requireField(data, 'retryable', 'boolean');
  }

  /**
   * Require field with type check
   */
  private requireField(data: any, fieldName: string, expectedType: string): void {
    if (!(fieldName in data)) {
      throw new ValidationError(`Field '${fieldName}' is required`);
    }

    const actualType = Array.isArray(data[fieldName]) ? 'array' : typeof data[fieldName];

    if (actualType !== expectedType) {
      throw new ValidationError(
        `Field '${fieldName}' must be of type '${expectedType}', got '${actualType}'`
      );
    }
  }

  /**
   * Set max event size
   */
  setMaxEventSize(maxEventSize: number): void {
    this.maxEventSize = maxEventSize;
  }

  /**
   * Set max data size
   */
  setMaxDataSize(maxDataSize: number): void {
    this.maxDataSize = maxDataSize;
  }
}

/**
 * Validation error class
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}
