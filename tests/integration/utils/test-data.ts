import sharp from 'sharp';
import { randomBytes } from 'crypto';

export interface TestImageOptions {
  width?: number;
  height?: number;
  format?: 'jpeg' | 'png' | 'webp';
  quality?: number;
  text?: string;
}

/**
 * Generate a test image with specified dimensions
 */
export async function generateTestImage(
  width: number = 800,
  height: number = 600,
  options: TestImageOptions = {}
): Promise<Buffer> {
  const format = options.format || 'jpeg';
  const quality = options.quality || 80;

  // Create a colorful gradient image
  const svg = `
    <svg width="${width}" height="${height}">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:rgb(${randomInt(100, 255)},${randomInt(100, 255)},${randomInt(100, 255)});stop-opacity:1" />
          <stop offset="100%" style="stop-color:rgb(${randomInt(100, 255)},${randomInt(100, 255)},${randomInt(100, 255)});stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#grad)" />
      ${options.text ? `<text x="50%" y="50%" text-anchor="middle" font-size="48" fill="white">${options.text}</text>` : ''}
    </svg>
  `;

  let image = sharp(Buffer.from(svg));

  if (format === 'jpeg') {
    image = image.jpeg({ quality });
  } else if (format === 'png') {
    image = image.png({ quality });
  } else if (format === 'webp') {
    image = image.webp({ quality });
  }

  return await image.toBuffer();
}

/**
 * Generate multiple test images
 */
export async function generateTestImages(
  count: number,
  width: number = 800,
  height: number = 600
): Promise<Buffer[]> {
  const promises = Array.from({ length: count }, (_, i) =>
    generateTestImage(width, height, { text: `Image ${i + 1}` })
  );
  return await Promise.all(promises);
}

/**
 * Generate a large test image
 */
export async function generateLargeTestImage(
  targetSizeMB: number = 10
): Promise<Buffer> {
  // Start with a high-resolution image
  const width = 4000;
  const height = 3000;
  
  let quality = 100;
  let buffer = await generateTestImage(width, height, { quality });

  // If we need a larger file, add more detail or reduce compression
  while (buffer.length < targetSizeMB * 1024 * 1024 && quality > 50) {
    quality -= 10;
    buffer = await generateTestImage(width, height, { quality, format: 'png' });
  }

  return buffer;
}

/**
 * Generate a corrupt image (invalid data)
 */
export function generateCorruptImage(): Buffer {
  return Buffer.from('This is not a valid image file!');
}

/**
 * Generate an image with invalid extension
 */
export async function generateImageWithWrongExtension(): Promise<{
  buffer: Buffer;
  filename: string;
  actualType: string;
}> {
  const buffer = await generateTestImage(800, 600, { format: 'jpeg' });
  return {
    buffer,
    filename: 'photo.png', // Wrong extension
    actualType: 'image/jpeg',
  };
}

/**
 * Generate test user IDs
 */
export function generateTestUserId(prefix: string = 'test-user'): string {
  return `${prefix}-${randomBytes(8).toString('hex')}`;
}

/**
 * Generate test photo metadata
 */
export interface TestPhotoMetadata {
  userId: string;
  filename: string;
  buffer: Buffer;
  mimeType: string;
  size: number;
}

export async function generateTestPhotoData(
  userId?: string,
  filename?: string
): Promise<TestPhotoMetadata> {
  const buffer = await generateTestImage();
  
  return {
    userId: userId || generateTestUserId(),
    filename: filename || `test-photo-${Date.now()}.jpg`,
    buffer,
    mimeType: 'image/jpeg',
    size: buffer.length,
  };
}

/**
 * Generate multiple test photos
 */
export async function generateTestPhotos(
  count: number,
  userId?: string
): Promise<TestPhotoMetadata[]> {
  const promises = Array.from({ length: count }, (_, i) =>
    generateTestPhotoData(userId, `test-photo-${i + 1}-${Date.now()}.jpg`)
  );
  return await Promise.all(promises);
}

/**
 * Utility: Random integer between min and max
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Create a test photo blob (for simulating frontend uploads)
 */
export async function createTestPhotoBlob(
  width: number = 800,
  height: number = 600
): Promise<{ blob: Blob; filename: string }> {
  const buffer = await generateTestImage(width, height);
  const blob = new Blob([buffer], { type: 'image/jpeg' });
  const filename = `photo-${Date.now()}.jpg`;
  
  return { blob, filename };
}

/**
 * Get image dimensions
 */
export async function getImageDimensions(
  buffer: Buffer
): Promise<{ width: number; height: number }> {
  const metadata = await sharp(buffer).metadata();
  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
  };
}

/**
 * Validate image format
 */
export async function validateImageFormat(buffer: Buffer): Promise<boolean> {
  try {
    await sharp(buffer).metadata();
    return true;
  } catch (error) {
    return false;
  }
}
