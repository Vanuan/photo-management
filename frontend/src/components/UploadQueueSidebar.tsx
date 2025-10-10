import React from "react";
import {
  Upload,
  CheckCircle,
  XCircle,
  Clock,
  Trash2,
  RefreshCw,
  ChevronRight,
} from "lucide-react";

interface UploadItem {
  id: string;
  filename: string;
  status: "uploading" | "uploaded" | "failed" | "cached";
  error?: string;
  retries: number;
  progress: number;
  timestamp: number;
}

interface UploadQueueSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  uploadQueue: UploadItem[];
  retryUpload: (id: string) => void;
  removeFromQueue: (id: string) => void;
}

const UploadQueueSidebar: React.FC<UploadQueueSidebarProps> = ({
  isOpen,
  onClose,
  uploadQueue,
  retryUpload,
  removeFromQueue,
}) => {
  const getStatusIcon = (status: UploadItem["status"]) => {
    switch (status) {
      case "uploading":
        return <Upload className="w-4 h-4 animate-pulse" />;
      case "uploaded":
        return <CheckCircle className="w-4 h-4" />;
      case "failed":
        return <XCircle className="w-4 h-4" />;
      case "cached":
        return <Clock className="w-4 h-4" />;
      default:
        return <Upload className="w-4 h-4" />;
    }
  };

  const getStatusColor = (status: UploadItem["status"]) => {
    switch (status) {
      case "uploading":
        return "bg-blue-500";
      case "uploaded":
        return "bg-green-500";
      case "failed":
        return "bg-red-500";
      case "cached":
        return "bg-yellow-500";
      default:
        return "bg-gray-500";
    }
  };

  return (
    <>
      {/* Sidebar Overlay - Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 animate-fadeIn"
          onClick={onClose}
        />
      )}

      {/* Upload Queue Sidebar */}
      <div
        className={`fixed top-0 right-0 h-full w-80 bg-gray-900 shadow-2xl z-50 transform transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Sidebar Header */}
          <div className="bg-gray-800 p-4 border-b border-gray-700">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center space-x-2">
                <Upload className="w-5 h-5" />
                <span>Upload Queue</span>
              </h2>
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-700 rounded-md transition-colors text-white"
                aria-label="Close sidebar"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
            {uploadQueue.length > 0 && (
              <p className="text-xs text-gray-400 mt-2">
                {uploadQueue.length}{" "}
                {uploadQueue.length === 1 ? "item" : "items"} in queue
              </p>
            )}
          </div>

          {/* Queue Items */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {uploadQueue.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <Upload className="w-12 h-12 mb-3 opacity-50" />
                <p className="text-sm">No uploads in queue</p>
                <p className="text-xs mt-1">Photos will appear here</p>
              </div>
            ) : (
              uploadQueue.map((item) => (
                <div
                  key={item.id}
                  className="bg-gray-800 rounded-lg p-3 border border-gray-700 hover:border-gray-600 transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2 flex-1 min-w-0">
                      <div
                        className={`p-1.5 rounded-full ${getStatusColor(item.status)} text-white flex-shrink-0`}
                      >
                        {getStatusIcon(item.status)}
                      </div>
                      <span className="text-sm font-medium truncate text-white">
                        {item.filename}
                      </span>
                    </div>
                  </div>

                  {item.status === "uploading" && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
                        <span>Uploading...</span>
                        <span>{item.progress}%</span>
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-blue-500 h-full transition-all duration-300 ease-out"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {item.status === "failed" && item.error && (
                    <>
                      <p className="text-xs text-red-400 mt-2 flex items-start space-x-1">
                        <XCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                        <span>
                          {item.error} (Attempt {item.retries}/5)
                        </span>
                      </p>
                      <div className="flex items-center space-x-2 mt-3">
                        <button
                          onClick={() => retryUpload(item.id)}
                          className="flex-1 px-3 py-1.5 bg-yellow-600 hover:bg-yellow-700 rounded-md transition-colors text-white text-xs font-medium flex items-center justify-center space-x-1"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Retry</span>
                        </button>
                        <button
                          onClick={() => removeFromQueue(item.id)}
                          className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded-md transition-colors text-white"
                          aria-label="Remove from queue"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}

                  {item.status === "uploaded" && (
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-green-400 flex items-center space-x-1">
                        <CheckCircle className="w-3 h-3" />
                        <span>Upload complete</span>
                      </p>
                      <button
                        onClick={() => removeFromQueue(item.id)}
                        className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                        aria-label="Remove from queue"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {item.status === "cached" && (
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-xs text-yellow-400 flex items-center space-x-1">
                        <Clock className="w-3 h-3" />
                        <span>Waiting for connection</span>
                      </p>
                      <button
                        onClick={() => removeFromQueue(item.id)}
                        className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                        aria-label="Remove from queue"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }

        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }

        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgb(31, 41, 55);
          border-radius: 3px;
        }

        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgb(75, 85, 99);
          border-radius: 3px;
        }

        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgb(107, 114, 128);
        }
      `}</style>
    </>
  );
};

export default UploadQueueSidebar;
