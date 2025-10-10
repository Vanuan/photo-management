import { useState, useCallback } from 'react';

export interface UploadItem {
  id: string;
  filename: string;
  status: 'uploading' | 'uploaded' | 'failed' | 'cached';
  error?: string;
  retries: number;
  progress: number;
  timestamp: number;
}

const useUploadQueue = () => {
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([
    {
      id: 'fb3760e8-9b11-4660-86a9-886537923096',
      filename: 'photo_001.jpeg',
      status: 'failed',
      error: 'HTTP error: 404',
      retries: 5,
      progress: 0,
      timestamp: Date.now()
    }
  ]);
  const [lastThumbnail, setLastThumbnail] = useState<string | null>(null);

  const addToQueue = useCallback((item: UploadItem) => {
    setUploadQueue(prev => [item, ...prev]);
  }, []);

  const updateProgress = useCallback((id: string, progress: number) => {
    setUploadQueue(prev =>
      prev.map(item =>
        item.id === id ? { ...item, progress } : item
      )
    );
  }, []);

  const markAsUploaded = useCallback((id: string) => {
    setUploadQueue(prev =>
      prev.map(item =>
        item.id === id ? { ...item, status: 'uploaded', progress: 100 } : item
      )
    );
  }, []);

  const retryUpload = useCallback((id: string) => {
    setUploadQueue(prev =>
      prev.map(item =>
        item.id === id ? { ...item, status: 'uploading', progress: 0, retries: 0 } : item
      )
    );
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setUploadQueue(prev => prev.filter(item => item.id !== id));
  }, []);

  const setThumbnail = useCallback((thumbnail: string) => {
    setLastThumbnail(thumbnail);
  }, []);

  const pendingUploads = uploadQueue.filter(item =>
    item.status === 'uploading' || item.status === 'cached'
  ).length;

  return {
    uploadQueue,
    lastThumbnail,
    pendingUploads,
    addToQueue,
    updateProgress,
    markAsUploaded,
    retryUpload,
    removeFromQueue,
    setThumbnail
  };
};

export default useUploadQueue;
