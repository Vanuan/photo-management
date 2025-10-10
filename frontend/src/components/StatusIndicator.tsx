import React from "react";
import { Wifi, WifiOff, Upload } from "lucide-react";

interface StatusIndicatorProps {
  pendingUploads: number;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  pendingUploads,
}) => {
  // For now, we'll simulate the WebSocket connection status
  // In a real app, this would come from a WebSocket service
  const isWebSocketConnected = false; // This will be updated by the WebSocket service

  return (
    <>
      {/* Minimal Status Indicators - Top corners only for critical info */}
      {pendingUploads > 0 && (
        <div className="fixed top-4 right-4 z-50">
          <div className="flex items-center space-x-2 px-3 py-1.5 rounded-full text-white text-xs font-medium bg-blue-500/90 backdrop-blur-sm">
            <Upload className="w-3 h-3 animate-pulse" />
            <span>{pendingUploads} uploading</span>
          </div>
        </div>
      )}

      {/* Connection Status Indicator */}
      <div className="fixed top-4 left-4 z-50">
        <button
          className={`p-3.5 rounded-full shadow-xl transition-all backdrop-blur-sm ${
            isWebSocketConnected
              ? "bg-green-500/90 hover:scale-105 active:scale-95"
              : "bg-red-500/90"
          }`}
          aria-label={isWebSocketConnected ? "Connected" : "Disconnected"}
        >
          {isWebSocketConnected ? (
            <Wifi className="w-6 h-6 text-white" />
          ) : (
            <WifiOff className="w-6 h-6 text-white" />
          )}
        </button>
      </div>
    </>
  );
};

export default StatusIndicator;
