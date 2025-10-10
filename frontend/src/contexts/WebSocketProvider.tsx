import React, { useState, useEffect } from "react";
import { webSocketClient } from "../services/WebSocketClient";
import { WebSocketContext } from "./WebSocketContext";

export const WebSocketProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
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
    if (!webSocketClient.getStatus()) {
      webSocketClient.connect();
    }

    return () => {
      unsubscribeConnected();
      unsubscribeDisconnected();
      unsubscribeError();
    };
  }, []);

  const connect = () => {
    webSocketClient.connect();
  };

  const disconnect = () => {
    webSocketClient.disconnect();
  };

  return (
    <WebSocketContext.Provider value={{ isConnected, connect, disconnect }}>
      {children}
    </WebSocketContext.Provider>
  );
};
