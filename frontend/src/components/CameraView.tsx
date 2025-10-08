import React, { useRef, useState, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { opfsStorage } from "../services/OPFSStorage";
import { uploadManager } from "../services/UploadManager";

type CameraStatus = "idle" | "requesting" | "granted" | "denied" | "error";

const CameraView: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mountedRef = useRef<boolean>(true);

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [capturedImageBlob, setCapturedImageBlob] = useState<Blob | null>(null);
  const [capturedImageUrl, setCapturedImageUrl] = useState<string | null>(null);
  const [tempCapturedFileName, setTempCapturedFileName] = useState<
    string | null
  >(null);
  const [isCapturing, setIsCapturing] = useState(false);

  // Callback ref: ensures we attach the stream to the video as soon as the element mounts.
  const setVideoElement = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    if (el && mediaStreamRef.current) {
      try {
        el.srcObject = mediaStreamRef.current;
        // Playback may be blocked until user interacts; attempt it anyway.
        el.play().catch((err) => {
          console.warn("[Camera] video.play() blocked or failed:", err);
        });
      } catch (err) {
        console.warn("[Camera] failed to attach stream to video element:", err);
      }
    }
  }, []);

  // Start camera: request stream, attach if video exists, store stream in ref.
  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus("error");
      setErrorMessage("Camera API not supported in this browser.");
      return;
    }

    setCameraStatus("requesting");
    setErrorMessage(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });

      // If the component unmounted while waiting, stop the stream and exit.
      if (!mountedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      mediaStreamRef.current = stream;

      if (videoRef.current) {
        try {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch((err) => {
            // Non-fatal: playback might require user interaction on some browsers.
            console.warn("[Camera] play() failed:", err);
          });
        } catch (err) {
          console.warn("[Camera] attach/play failed:", err);
        }
      } else {
        // Video element not mounted yet; callback ref will attach it when mounted.
        console.log("[Camera] stream ready — will attach when <video> mounts");
      }

      setCameraStatus("granted");
    } catch (err: any) {
      console.error("[Camera] getUserMedia error:", err);
      // Ensure any partially-opened tracks are stopped
      try {
        mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {}
      mediaStreamRef.current = null;

      setCameraStatus("denied");
      if (err?.name === "NotAllowedError") {
        setErrorMessage(
          "Camera access denied. Please enable camera permissions.",
        );
      } else if (err?.name === "NotFoundError") {
        setErrorMessage("No camera found on this device.");
      } else {
        setErrorMessage(err?.message || "Unknown error accessing camera.");
      }
    }
  }, []);

  // Full cleanup of camera resources
  const stopCamera = useCallback(() => {
    try {
      mediaStreamRef.current?.getTracks().forEach((t) => {
        try {
          t.stop();
          // disabling is best-effort; some browsers may throw
          // keep in try/catch
          // eslint-disable-next-line no-empty
        } catch {}
        try {
          (t as any).enabled = false;
        } catch {}
      });
    } catch (err) {
      console.warn("[Camera] error stopping tracks:", err);
    } finally {
      mediaStreamRef.current = null;
    }

    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
        // force reset; helps avoid leaks in some browsers (Safari)
        videoRef.current.load();
      } catch (err) {
        console.warn("[Camera] error resetting video element:", err);
      }
    }

    setCameraStatus("idle");
  }, []);

  // Initialize: kick off opfsStorage init (non-blocking) and start camera immediately.
  useEffect(() => {
    mountedRef.current = true;

    // start storage initialization but don't await it (non-blocking)
    opfsStorage
      .initialize()
      .catch((e) => console.warn("[Camera] opfsStorage init failed:", e));

    // Small delay (optional) can help in rare timing environments, but we call immediately:
    startCamera().catch((e) =>
      console.warn("[Camera] startCamera rejected:", e),
    );

    return () => {
      mountedRef.current = false;
      stopCamera();
    };
    // startCamera/stopCamera are stable (empty deps) so including them is fine for lint rules.
  }, [startCamera, stopCamera]);

  // Create and revoke object URL for captured blob safely
  useEffect(() => {
    let url: string | null = null;
    if (capturedImageBlob) {
      url = URL.createObjectURL(capturedImageBlob);
      setCapturedImageUrl(url);
    } else {
      setCapturedImageUrl(null);
    }

    return () => {
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      }
    };
  }, [capturedImageBlob]);

  // Capture photo — async, waits for video data, prevents concurrent captures
  const capturePhoto = useCallback(async () => {
    if (
      !videoRef.current ||
      !canvasRef.current ||
      cameraStatus !== "granted" ||
      isCapturing
    ) {
      return;
    }

    setIsCapturing(true);
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      if (video.readyState < video.HAVE_ENOUGH_DATA) {
        await new Promise<void>((resolve) => {
          const handler = () => resolve();
          video.addEventListener("loadeddata", handler, { once: true });
        });
      }

      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;

      canvas.width = width;
      canvas.height = height;
      ctx?.drawImage(video, 0, 0, width, height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.95),
      );

      if (!blob) throw new Error("Failed to create image blob from canvas");

      setCapturedImageBlob(blob);
      setTempCapturedFileName(`${uuidv4()}.jpeg`);
    } catch (err) {
      console.error("[Camera] capture failed:", err);
      setErrorMessage("Failed to capture photo");
    } finally {
      // allow future captures
      setIsCapturing(false);
    }
  }, [cameraStatus, isCapturing]);

  const handleRetake = useCallback(() => {
    // revoke handled by effect cleanup; clear blob and metadata
    setCapturedImageBlob(null);
    setTempCapturedFileName(null);
    setErrorMessage(null);
    setIsCapturing(false);
  }, []);

  // Save to OPFS and queue for upload (safe to unmount)
  const handleContinue = useCallback(async () => {
    if (!capturedImageBlob || !tempCapturedFileName) return;

    try {
      // capture current mounted state
      if (!mountedRef.current) return;

      const photoId = await opfsStorage.put(
        capturedImageBlob,
        tempCapturedFileName,
      );
      if (mountedRef.current) {
        uploadManager.addToQueue(photoId, tempCapturedFileName);
      }
    } catch (err) {
      console.error("[Camera] save/upload error:", err);
      setErrorMessage("Failed to save photo");
    } finally {
      if (mountedRef.current) {
        setCapturedImageBlob(null);
        setTempCapturedFileName(null);
        setIsCapturing(false);
      }
    }
  }, [capturedImageBlob, tempCapturedFileName]);

  // Render states
  if (cameraStatus === "denied" || cameraStatus === "error") {
    return (
      <div className="flex flex-col items-center justify-center h-full text-red-500 text-center p-4">
        <p className="font-semibold text-lg">Camera Access Denied</p>
        <p className="mt-2">{errorMessage}</p>
      </div>
    );
  }

  if (cameraStatus === "requesting" || cameraStatus === "idle") {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-center">
        <p>Requesting camera access...</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black flex items-center justify-center">
      {capturedImageUrl ? (
        <div className="relative w-full h-full flex flex-col items-center justify-center">
          <img
            src={capturedImageUrl}
            alt="Captured Preview"
            className="max-w-full max-h-full object-contain"
            onError={(e) => {
              console.error("[Camera] captured image failed to load", e);
              setErrorMessage("Failed to load captured image");
              handleRetake();
            }}
          />
          {!isCapturing && (
            <div className="absolute bottom-10 flex space-x-8">
              <button
                onClick={handleRetake}
                className="px-8 py-4 bg-red-600 text-white rounded-full text-xl font-semibold shadow-lg hover:bg-red-700 transition-colors"
              >
                Retake
              </button>
              <button
                onClick={handleContinue}
                className="px-8 py-4 bg-green-600 text-white rounded-full text-xl font-semibold shadow-lg hover:bg-green-700 transition-colors"
              >
                Continue
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <video
            ref={setVideoElement}
            playsInline
            muted
            autoPlay
            className="w-full h-full object-cover bg-black"
          />
          <canvas ref={canvasRef} className="hidden" />
          <div className="absolute bottom-10 w-full flex justify-center">
            <button
              onClick={capturePhoto}
              disabled={isCapturing}
              className="w-20 h-20 bg-white rounded-full border-4 border-gray-400 flex items-center justify-center shadow-lg hover:scale-110 active:scale-95 disabled:opacity-50 transition-transform"
              aria-label="Capture"
            >
              <div className="w-16 h-16 bg-white rounded-full border-2 border-black" />
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default CameraView;
