import React from "react";
import CameraView from "./components/CameraView";
import UploadQueue from "./components/UploadQueue";
import StatusIndicator from "./components/StatusIndicator";
import "./index.css"; // Ensure Tailwind directives are imported

const App: React.FC = () => {
  return (
    <div className="relative w-screen h-screen overflow-hidden flex flex-col bg-gray-900 font-sans">
      {/* Status Indicator (WebSocket & Upload Summary) */}
      <StatusIndicator />

      {/* Main Content Area: Camera View */}
      <main className="flex-1 flex items-center justify-center">
        <CameraView />
      </main>

      {/* Upload Queue Display */}
      <UploadQueue />
    </div>
  );
};

export default App;
