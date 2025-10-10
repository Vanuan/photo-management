import React, { useState } from "react";
import { Upload, CheckCircle } from "lucide-react";
import { uploadManager } from "../services/UploadManager";
import type { UploadTask } from "../services/UploadManager";

interface QueueButtonProps {
  onOpen: () => void;
}

const QueueButton: React.FC<QueueButtonProps> = ({ onOpen }) => {
  const [queue, setQueue] = useState<UploadTask[]>([]);

  // Subscribe to queue changes
  React.useEffect(() => {
    const unsubscribe = uploadManager.subscribeToQueueChanges(
      (updatedQueue) => {
        setQueue(updatedQueue);
      },
    );

    return () => {
      unsubscribe();
    };
  }, []);

  // Get the first item in the queue for status display
  const firstItem = queue.length > 0 ? queue[0] : null;

  return (
    <div className="fixed bottom-4 right-4 z-40">
      <button
        onClick={onOpen}
        className="relative p-1 bg-gray-800/90 backdrop-blur-sm rounded-2xl shadow-xl hover:scale-105 active:scale-95 transition-transform border-2 border-gray-600"
        aria-label="Open upload queue"
      >
        <div className="relative w-14 h-14 rounded-xl overflow-hidden bg-gray-700">
          <div className="w-full h-full flex items-center justify-center">
            <Upload className="w-6 h-6 text-gray-400" />
          </div>

          {/* Status Badge */}
          {queue.length > 0 && (
            <>
              <div className="absolute top-1 right-1 bg-gray-900/90 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center shadow-lg">
                {queue.length}
              </div>

              {firstItem?.status === "uploading" &&
                firstItem.progress != null && (
                  <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-800">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${firstItem.progress}%` }}
                    />
                  </div>
                )}

              {firstItem?.status === "failed" && (
                <div className="absolute inset-0 border-2 border-red-500 rounded-xl pointer-events-none animate-pulse" />
              )}

              {firstItem?.status === "uploaded" && (
                <div className="absolute top-1 left-1 bg-green-500 rounded-full p-0.5 shadow-lg">
                  <CheckCircle className="w-3 h-3 text-white" />
                </div>
              )}
            </>
          )}
        </div>
      </button>
    </div>
  );
};

export default QueueButton;
