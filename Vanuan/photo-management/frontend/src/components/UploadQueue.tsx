import React, { useState, useEffect } from "react";
import { uploadManager } from "../services/UploadManager";
import type { UploadStatus, UploadTask } from "../services/UploadManager";

const UploadQueue: React.FC = () => {
  const [queue, setQueue] = useState<UploadTask[]>([]);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Subscribe to changes in the upload queue
    const unsubscribe = uploadManager.subscribeToQueueChanges(
      (updatedQueue) => {
        setQueue(updatedQueue);
        // Automatically show the queue if there are active tasks, or hide if none
        const activeTasks = updatedQueue.filter(
          (task) => task.status !== "completed",
        );
        setIsVisible(activeTasks.length > 0);
      },
    );

    // Cleanup subscription on component unmount
    return () => {
      unsubscribe();
    };
  }, []);

  if (!isVisible || queue.length === 0) {
    return null; // Don't render if there are no tasks or if not visible
  }

  const getStatusColor = (status: UploadStatus) => {
    switch (status) {
      case "cached":
        return "bg-gray-500";
      case "uploading":
      case "processing":
        return "bg-blue-500";
      case "uploaded":
        return "bg-green-500";
      case "completed":
        return "bg-purple-500"; // Specific color for fully completed processing
      case "error":
        return "bg-yellow-500";
      case "failed":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  const getStatusText = (status: UploadStatus) => {
    switch (status) {
      case "cached":
        return "Waiting to upload";
      case "uploading":
        return "Uploading...";
      case "processing":
        return "Processing...";
      case "uploaded":
        return "Uploaded";
      case "completed":
        return "Complete";
      case "error":
        return "Retrying...";
      case "failed":
        return "Failed";
      default:
        return "Unknown";
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 p-4 bg-gray-800 bg-opacity-90 text-white shadow-lg z-50 backdrop-blur-sm">
      <h2 className="text-lg font-semibold mb-2">Upload Queue</h2>
      <div className="max-h-60 overflow-y-auto">
        {queue.map((task) => (
          <div
            key={task.id}
            className="mb-2 p-2 border border-gray-700 rounded-md"
          >
            <div className="flex justify-between items-center text-sm">
              <span className="font-medium truncate mr-2">{task.fileName}</span>
              <span
                className={`px-2 py-1 rounded-full text-xs font-bold ${getStatusColor(task.status)}`}
              >
                {getStatusText(task.status)}
              </span>
            </div>
            {(task.status === "uploading" || task.status === "processing") &&
              task.progress != null && (
                <div className="w-full bg-gray-700 rounded-full h-2.5 mt-2">
                  <div
                    className={`${getStatusColor(task.status)} h-2.5 rounded-full transition-all duration-300`}
                    style={{ width: `${task.progress || 0}%` }}
                  ></div>
                </div>
              )}
            {task.error && (
              <p className="text-red-400 text-xs mt-1">Error: {task.error}</p>
            )}
            {(task.status === "error" || task.status === "failed") && (
              <button
                onClick={() => uploadManager.retryUpload(task.id)}
                className="mt-2 px-3 py-1 bg-yellow-600 text-white rounded-md text-xs hover:bg-yellow-700"
              >
                Retry Upload
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default UploadQueue;
