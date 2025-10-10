import React from "react";
import { Wifi, WifiOff, Clock, ChevronLeft } from "lucide-react";

interface ConnectionStatusSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  wsConnected: boolean;
  pendingUploads: number;
  uploadQueueLength: number;
}

const ConnectionStatusSidebar: React.FC<ConnectionStatusSidebarProps> = ({
  isOpen,
  onClose,
  wsConnected,
  pendingUploads,
  uploadQueueLength,
}) => {
  return (
    <>
      {/* Sidebar Overlay - Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 animate-fadeIn"
          onClick={onClose}
        />
      )}

      {/* Network Status Panel */}
      <div
        className={`fixed top-0 left-0 h-full w-80 bg-gray-900 shadow-2xl z-50 transform transition-transform duration-300 ease-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Panel Header */}
          <div className="bg-gray-800 p-4 border-b border-gray-700">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white flex items-center space-x-2">
                {wsConnected ? (
                  <Wifi className="w-5 h-5 text-green-400" />
                ) : (
                  <WifiOff className="w-5 h-5 text-red-400" />
                )}
                <span>Network Status</span>
              </h2>
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-700 rounded-md transition-colors text-white"
                aria-label="Close panel"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Network Info */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            {/* Connection Status Card */}
            <div
              className={`rounded-lg p-4 border-2 ${
                wsConnected
                  ? "bg-green-500/10 border-green-500/50"
                  : "bg-red-500/10 border-red-500/50"
              }`}
            >
              <div className="flex items-center space-x-3 mb-3">
                {wsConnected ? (
                  <div className="p-2 bg-green-500/20 rounded-lg">
                    <Wifi className="w-6 h-6 text-green-400" />
                  </div>
                ) : (
                  <div className="p-2 bg-red-500/20 rounded-lg">
                    <WifiOff className="w-6 h-6 text-red-400" />
                  </div>
                )}
                <div>
                  <h3 className="text-white font-semibold">
                    {wsConnected ? "Connected" : "Disconnected"}
                  </h3>
                  <p className="text-xs text-gray-400">
                    {wsConnected ? "Real-time sync active" : "Working offline"}
                  </p>
                </div>
              </div>
              <p className="text-sm text-gray-300">
                {wsConnected
                  ? "Your device is connected to the upload server. Photos will be synced automatically."
                  : "No connection detected. Photos are being saved locally and will upload when connection is restored."}
              </p>
            </div>

            {/* AI Explanation */}
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <h3 className="text-white font-semibold mb-2 flex items-center space-x-2">
                <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></div>
                <span>How It Works</span>
              </h3>
              <div className="space-y-3 text-sm text-gray-300">
                <div className="flex space-x-2">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-xs font-bold">
                    1
                  </div>
                  <div>
                    <p className="font-medium text-white">Capture</p>
                    <p className="text-xs text-gray-400">
                      Photos are immediately saved to your device's local
                      storage for instant backup.
                    </p>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-xs font-bold">
                    2
                  </div>
                  <div>
                    <p className="font-medium text-white">Queue</p>
                    <p className="text-xs text-gray-400">
                      Each photo enters an upload queue with automatic retry
                      logic and progress tracking.
                    </p>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-xs font-bold">
                    3
                  </div>
                  <div>
                    <p className="font-medium text-white">Upload</p>
                    <p className="text-xs text-gray-400">
                      When connected, up to 3 photos upload simultaneously with
                      exponential backoff on failures.
                    </p>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 text-xs font-bold">
                    4
                  </div>
                  <div>
                    <p className="font-medium text-white">Sync</p>
                    <p className="text-xs text-gray-400">
                      WebSocket connection provides real-time status updates and
                      confirms successful storage.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Network Stats */}
            <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
              <h3 className="text-white font-semibold mb-3">Current Session</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Pending Uploads</span>
                  <span className="text-white font-medium">
                    {pendingUploads}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Queue Length</span>
                  <span className="text-white font-medium">
                    {uploadQueueLength}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Connection Type</span>
                  <span className="text-white font-medium">WebSocket</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Max Concurrent</span>
                  <span className="text-white font-medium">3 uploads</span>
                </div>
              </div>
            </div>

            {/* Offline Mode Info */}
            {!wsConnected && (
              <div className="bg-yellow-500/10 border border-yellow-500/50 rounded-lg p-4">
                <h3 className="text-yellow-400 font-semibold mb-2 flex items-center space-x-2">
                  <Clock className="w-4 h-4" />
                  <span>Offline Mode Active</span>
                </h3>
                <p className="text-sm text-gray-300">
                  Don't worry! Your photos are safe in local storage. They'll
                  automatically upload when you're back online. You can continue
                  capturing without interruption.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out;
        }

        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }

        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgb(31, 41, 55);
          border-radius: 3px;
        }

        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgb(75, 85, 99);
          border-radius: 3px;
        }

        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgb(107, 114, 128);
        }
      `}</style>
    </>
  );
};

export default ConnectionStatusSidebar;
