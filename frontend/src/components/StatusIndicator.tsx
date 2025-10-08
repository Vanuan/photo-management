import React, { useState, useEffect } from "react";
import { webSocketClient } from "../services/WebSocketClient";
import { uploadManager } from "../services/UploadManager";
import type { UploadTask } from "../services/UploadManager";
const StatusIndicator: React.FC = () => {
  const [isWebSocketConnected, setIsWebSocketConnected] = useState(
    webSocketClient.getStatus(),
  );
  const [uploadStats, setUploadStats] = useState(uploadManager.getStats());

  useEffect(() => {
    // Subscribe to WebSocket connection status changes
    const unsubscribeWsConnected = webSocketClient.on("connected", () => {
      setIsWebSocketConnected(true);
    });
    const unsubscribeWsDisconnected = webSocketClient.on("disconnected", () => {
      setIsWebSocketConnected(false);
    });
    const unsubscribeWsError = webSocketClient.on("connection_error", () => {
      setIsWebSocketConnected(false);
    });

    // Subscribe to UploadManager queue changes
    const unsubscribeQueue = uploadManager.subscribeToQueueChanges(
      (queue: UploadTask[]) => {
        setUploadStats(uploadManager.getStats());
      },
    );

    // Cleanup subscriptions on component unmount
    return () => {
      unsubscribeWsConnected();
      unsubscribeWsDisconnected();
      unsubscribeWsError();
      unsubscribeQueue();
    };
  }, []);

  const getWsStatusColor = () => {
    return isWebSocketConnected ? "bg-green-500" : "bg-red-500";
  };

  const getWsStatusText = () => {
    return isWebSocketConnected ? "Connected" : "Disconnected";
  };

  const hasPendingUploads =
    uploadStats.cached > 0 ||
    uploadStats.uploading > 0 ||
    uploadStats.error > 0;
  const pendingUploadsText = hasPendingUploads
    ? `${uploadStats.cached + uploadStats.uploading + uploadStats.error} pending`
    : "No pending uploads";
  const pendingUploadsColor = hasPendingUploads
    ? "bg-orange-500"
    : "bg-gray-500";

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col space-y-2">
      <div
        className={`flex items-center space-x-2 p-2 rounded-full text-white text-sm ${getWsStatusColor()}`}
      >
        <span className="h-2 w-2 rounded-full bg-white block"></span>
        <span>WebSocket: {getWsStatusText()}</span>
      </div>
      <div
        className={`flex items-center space-x-2 p-2 rounded-full text-white text-sm ${pendingUploadsColor}`}
      >
        <span className="h-2 w-2 rounded-full bg-white block"></span>
        <span>Uploads: {pendingUploadsText}</span>
      </div>
    </div>
  );
};

export default StatusIndicator;
