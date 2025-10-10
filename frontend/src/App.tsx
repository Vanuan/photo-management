import React from "react";
import CameraView from "./components/CameraView";
import UploadQueue from "./components/UploadQueue";
import StatusIndicator from "./components/StatusIndicator";
import MainLayout from "./components/MainLayout";
import usePhotoCapture from "./hooks/usePhotoCapture";
import "./App.css"; // Ensure Tailwind directives are imported

const App: React.FC = () => {
  const {
    wsConnected,
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

  return (
    <MainLayout>
      {/* Status Indicator (WebSocket & Upload Summary) */}
      <StatusIndicator pendingUploads={pendingUploads} />

      {/* Main Content Area: Camera View */}
      <main className="flex-1 flex items-center justify-center">
        <CameraView
          wsConnected={wsConnected}
          onOpenQueue={() => setSidebarOpen(true)}
          lastThumbnail={lastThumbnail}
          setLastThumbnail={setLastThumbnail}
          uploadQueue={uploadQueue}
          simulateUpload={simulateUpload}
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
    </MainLayout>
  );
};

export default App;
