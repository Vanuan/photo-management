import React, { useState } from "react";
import CameraView from "./components/CameraView";
import UploadQueue from "./components/UploadQueue";
import MainLayout from "./components/MainLayout";
import usePhotoCapture from "./hooks/usePhotoCapture";
import { useWebSocket } from "./contexts/useWebSocket";
import ConnectionStatusSidebar from "./components/ConnectionStatusSidebar";
import "./App.css"; // Ensure Tailwind directives are imported

const App: React.FC = () => {
  const { isConnected: wsConnected } = useWebSocket();

  const {
    uploadQueue,
    lastThumbnail,
    sidebarOpen,
    pendingUploads,
    setLastThumbnail,
    setSidebarOpen,
    simulateUpload,
    retryUpload,
    removeFromQueue,
  } = usePhotoCapture();

  const [networkPanelOpen, setNetworkPanelOpen] = useState(false);

  return (
    <MainLayout>
      {/* Main Content Area: Camera View */}
      <main className="flex-1 flex items-center justify-center">
        <CameraView
          wsConnected={wsConnected}
          onOpenQueue={() => setSidebarOpen(true)}
          onOpenNetworkPanel={() => setNetworkPanelOpen(true)}
          lastThumbnail={lastThumbnail}
          setLastThumbnail={setLastThumbnail}
          uploadQueue={uploadQueue}
          simulateUpload={simulateUpload}
          pendingUploads={pendingUploads}
        />
      </main>

      {/* Upload Queue Display */}
      <UploadQueue
        sidebarOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        uploadQueue={uploadQueue}
        retryUpload={retryUpload}
        removeFromQueue={removeFromQueue}
      />

      {/* Connection Status Panel */}
      <ConnectionStatusSidebar
        isOpen={networkPanelOpen}
        onClose={() => setNetworkPanelOpen(false)}
        wsConnected={wsConnected}
        pendingUploads={pendingUploads}
        uploadQueueLength={uploadQueue.length}
      />
    </MainLayout>
  );
};

export default App;
