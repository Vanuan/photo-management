import React, { useState, useEffect, useRef } from "react";
import { WebSocketClient } from "../services/WebSocketClient";
import { WebSocketContext } from "./WebSocketContext";
import { uploadManager } from "../services/UploadManager";

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const webSocketClientRef = useRef<WebSocketClient | null>(null);

  // Ensure we only create one instance of WebSocketClient
  if (!webSocketClientRef.current) {
    webSocketClientRef.current = new WebSocketClient(
      import.meta.env.VITE_WEBSOCKET_URL || "ws://localhost:3000",
    );
  }

  const webSocketClient = webSocketClientRef.current;
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const handleConnected = () => {
      setIsConnected(true);
    };

    const handleDisconnected = () => {
      setIsConnected(false);
    };

    const handleError = () => {
      setIsConnected(false);
    };

    // Set initial state
    setIsConnected(webSocketClient.getStatus());

    // Subscribe to WebSocket events
    const unsubscribeConnected = webSocketClient.on(
      "connected",
      handleConnected,
    );
    const unsubscribeDisconnected = webSocketClient.on(
      "disconnected",
      handleDisconnected,
    );
    const unsubscribeError = webSocketClient.on(
      "connection_error",
      handleError,
    );

    // Connect if not already connected
    // We use a ref to ensure we only attempt connection once
    if (!webSocketClient.getStatus()) {
      webSocketClient.connect();
    }

    return () => {
      unsubscribeConnected();
      unsubscribeDisconnected();
      unsubscribeError();
      // Disconnect the WebSocket when the component unmounts
      webSocketClient.disconnect();
    };
  }, [webSocketClient]);

  const connect = () => {
    webSocketClient.connect();
  };

  const disconnect = () => {
    webSocketClient.disconnect();
  };

  // Set up UploadManager WebSocket listeners
  useEffect(() => {
    uploadManager.setupWebSocketListeners(webSocketClient);
  }, [webSocketClient]);

  return (
    <WebSocketContext.Provider
      value={{ isConnected, connect, disconnect, webSocketClient }}
    >
      {children}
    </WebSocketContext.Provider>
  );
};
