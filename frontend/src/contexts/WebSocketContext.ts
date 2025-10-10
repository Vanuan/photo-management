import { createContext } from "react";

interface WebSocketContextType {
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
}

export const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);
