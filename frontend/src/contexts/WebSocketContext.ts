import { createContext } from "react";
import type { WebSocketClient } from "../services/WebSocketClient";

interface WebSocketContextType {
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
  webSocketClient: WebSocketClient;
}

export const WebSocketContext = createContext<WebSocketContextType | undefined>(
  undefined,
);
