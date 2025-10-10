import React from "react";
import UploadQueueSidebar from "./UploadQueueSidebar";

interface UploadItem {
  id: string;
  filename: string;
  status: "uploading" | "uploaded" | "failed" | "cached";
  error?: string;
  retries: number;
  progress: number;
  timestamp: number;
}

interface UploadQueueProps {
  sidebarOpen: boolean;
  onClose: () => void;
  uploadQueue: UploadItem[];
  retryUpload: (id: string) => void;
  removeFromQueue: (id: string) => void;
}

const UploadQueue: React.FC<UploadQueueProps> = ({
  sidebarOpen,
  onClose,
  uploadQueue,
  retryUpload,
  removeFromQueue,
}) => {
  return (
    <UploadQueueSidebar
      isOpen={sidebarOpen}
      onClose={onClose}
      uploadQueue={uploadQueue}
      retryUpload={retryUpload}
      removeFromQueue={removeFromQueue}
    />
  );
};

export default UploadQueue;
