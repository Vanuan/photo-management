import React from "react";
import { Wifi, WifiOff, Upload } from "lucide-react";

interface StatusIndicatorProps {
  pendingUploads: number;
  wsConnected?: boolean;
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  pendingUploads,
  wsConnected,
}) => {
  // Use the wsConnected prop if provided, otherwise default to false
  const isWebSocketConnected = wsConnected !== undefined ? wsConnected : false;

  return (
    <div className="relative">
      {isWebSocketConnected ? (
        <Wifi className="w-6 h-6 text-white" />
      ) : (
        <WifiOff className="w-6 h-6 text-white" />
      )}
      {/* Status Indicator Badge */}
      {pendingUploads > 0 && (
        <div className="absolute -top-2 -right-2 flex items-center space-x-1 px-2 py-1 rounded-full text-white text-xs font-medium bg-blue-500/90 backdrop-blur-sm">
          <Upload className="w-3 h-3 animate-pulse" />
          <span>{pendingUploads}</span>
        </div>
      )}
    </div>
  );
};

export default StatusIndicator;
