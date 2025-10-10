import React from "react";
import { Camera, Wifi, WifiOff, Upload, CheckCircle } from "lucide-react";

interface UploadItem {
  id: string;
  filename: string;
  status: "uploading" | "uploaded" | "failed" | "cached";
  error?: string;
  retries: number;
  progress: number;
  timestamp: number;
}

interface CameraControlsProps {
  wsConnected: boolean;
  onCapture: () => void;
  onOpenQueue: () => void;
  cameraActive: boolean;
  showPreview: boolean;
  lastThumbnail: string | null;
  uploadQueue: UploadItem[];
}

const CameraControls: React.FC<CameraControlsProps> = ({
  wsConnected,
  onCapture,
  onOpenQueue,
  cameraActive,
  showPreview,
  lastThumbnail,
  uploadQueue,
}) => {
  // Get the first item in the queue for status display
  const firstItem = uploadQueue.length > 0 ? uploadQueue[0] : null;

  return (
    <div className="absolute bottom-0 left-0 right-0 pb-8 pt-4 bg-gradient-to-t from-black/80 to-transparent">
      <div className="flex items-end px-6">
        {/* Left side - Connection Status */}
        <div className="flex-1 flex justify-center items-end">
          <button
            className={`p-3.5 rounded-full shadow-xl transition-all backdrop-blur-sm ${
              wsConnected
                ? "bg-green-500/90 hover:scale-105 active:scale-95"
                : "bg-red-500/90"
            }`}
            aria-label={wsConnected ? "Connected" : "Disconnected"}
          >
            {wsConnected ? (
              <Wifi className="w-6 h-6 text-white" />
            ) : (
              <WifiOff className="w-6 h-6 text-white" />
            )}
          </button>
        </div>

        {/* Center - Capture Button */}
        <button
          onClick={onCapture}
          disabled={!cameraActive || showPreview}
          className="relative w-20 h-20 bg-white rounded-full border-4 border-gray-300 flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 disabled:opacity-50 transition-transform group flex-shrink-0"
          aria-label="Capture photo"
        >
          <div className="w-16 h-16 bg-white rounded-full border-2 border-gray-900 group-active:bg-gray-200 transition-colors" />
          <Camera className="absolute w-8 h-8 text-gray-400 pointer-events-none" />
        </button>

        {/* Right side - Queue Button */}
        <div className="flex-1 flex justify-center items-end">
          <button
            onClick={onOpenQueue}
            className="relative p-1 bg-gray-800/90 backdrop-blur-sm rounded-2xl shadow-xl hover:scale-105 active:scale-95 transition-transform border-2 border-gray-600"
            aria-label="Open upload queue"
          >
            <div className="relative w-14 h-14 rounded-xl overflow-hidden bg-gray-700">
              {lastThumbnail ? (
                <img
                  src={lastThumbnail}
                  alt="Last captured"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Upload className="w-6 h-6 text-gray-400" />
                </div>
              )}
              {/* Status Badge */}
              {uploadQueue.length > 0 && (
                <>
                  <div className="absolute top-1 right-1 bg-gray-900/90 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center shadow-lg">
                    {uploadQueue.length}
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
      </div>
    </div>
  );
};

export default CameraControls;
