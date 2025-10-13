/**
 * Processes an image Blob for compression and resizing.
 * @param imageBlob The original image Blob.
 * @param maxWidth The maximum width for the output image. Defaults to 1920.
 * @param maxHeight The maximum height for the output image. Defaults to 1080.
 * @param quality The JPEG compression quality (0 to 1). Defaults to 0.8.
 * @returns A Promise that resolves with the compressed and potentially resized image Blob.
 */
export const compressImage = (
  imageBlob: Blob,
  maxWidth: number = 1920,
  maxHeight: number = 1080,
  quality: number = 0.8, // JPEG quality (0 to 1)
  fileType: string = 'image/jpeg'
): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(imageBlob);

    img.onload = () => {
      URL.revokeObjectURL(img.src); // Clean up the object URL

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        return reject(new Error('Could not get 2D rendering context for canvas.'));
      }

      let width = img.width;
      let height = img.height;

      // Calculate new dimensions to fit within maxWidth/maxHeight while maintaining aspect ratio
      if (width > height) {
        if (width > maxWidth) {
          height *= maxWidth / width;
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width *= maxHeight / height;
          height = maxHeight;
        }
      }

      // Ensure that if the image is smaller than the max dimensions, we don't scale it up unnecessarily.
      // However, the requirement is "minimum 1920x1080" for capture.
      // For compression, we ensure it *fits* within max, but if it's already smaller, we use its original size.
      // If the goal is strictly to *reduce* size for already high-res images,
      // we might want to ensure it's not scaled up if it's smaller than max dimensions.
      // Let's ensure it doesn't get scaled up beyond its original dimensions.

      let targetWidth = width;
      let targetHeight = height;

      if (img.width < maxWidth && img.height < maxHeight) {
        // If original image is smaller than target max, use original dimensions
        targetWidth = img.width;
        targetHeight = img.height;
      }


      canvas.width = targetWidth;
      canvas.height = targetHeight;

      // Draw image on canvas
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      // Get compressed blob
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to compress image to blob.'));
          }
        },
        fileType,
        quality
      );
    };

    img.onerror = (error) => {
      URL.revokeObjectURL(img.src); // Clean up the object URL
      reject(new Error(`Failed to load image for compression: ${error}`));
    };
  });
};
