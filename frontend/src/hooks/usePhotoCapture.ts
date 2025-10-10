import { useState } from "react";

export interface UploadItem {
  id: string;
  filename: string;
  status: "uploading" | "uploaded" | "failed" | "cached";
  error?: string;
  retries: number;
  progress: number;
  timestamp: number;
}

const usePhotoCapture = () => {
  // WebSocket connection status is now managed by WebSocketContext
  // const [wsConnected, setWsConnected] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([
    {
      id: "fb3760e8-9b11-4660-86a9-886537923096",
      filename: "photo_001.jpeg",
      status: "failed",
      error: "HTTP error: 404",
      retries: 5,
      progress: 0,
      timestamp: Date.now(),
    },
  ]);
  const [lastThumbnail, setLastThumbnail] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // We'll now get the WebSocket connection status from context
  // The wsConnected state will be updated by the parent component

  const simulateUpload = (id: string) => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;
      setUploadQueue((prev) =>
        prev.map((item) => (item.id === id ? { ...item, progress } : item)),
      );

      if (progress >= 100) {
        clearInterval(interval);
        setUploadQueue((prev) =>
          prev.map((item) =>
            item.id === id
              ? { ...item, status: "uploaded", progress: 100 }
              : item,
          ),
        );

        // Remove from queue after 3 seconds
        setTimeout(() => {
          setUploadQueue((prev) => prev.filter((item) => item.id !== id));
        }, 3000);
      }
    }, 300);
  };

  const retryUpload = (id: string) => {
    setUploadQueue((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, status: "uploading", progress: 0, retries: 0 }
          : item,
      ),
    );
    simulateUpload(id);
  };

  const removeFromQueue = (id: string) => {
    setUploadQueue((prev) => prev.filter((item) => item.id !== id));
  };

  const pendingUploads = uploadQueue.filter(
    (item) => item.status === "uploading" || item.status === "cached",
  ).length;

  return {
    uploadQueue,
    lastThumbnail,
    sidebarOpen,
    pendingUploads,
    setLastThumbnail,
    setSidebarOpen,
    simulateUpload,
    retryUpload,
    removeFromQueue,
  };
};

export default usePhotoCapture;
