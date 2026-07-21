"use client";

import { useRef, useState } from "react";

/**
 * BarcodeScanner — opens the device camera and decodes a barcode into a value
 * via `onDetected`. Uses `@zxing/browser`, dynamically imported only when the
 * user taps "Scan" so nothing camera-related runs on load or during SSR.
 *
 * Graceful degradation: if there is no camera / permission is denied / the lib
 * fails, it shows a short message and stops — the surrounding form's manual
 * barcode text input still works. The scanner never blocks manual entry.
 */
export function BarcodeScanner({ onDetected }: { onDetected: (value: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [active, setActive] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function stop() {
    try {
      controlsRef.current?.stop();
    } catch {
      /* ignore */
    }
    controlsRef.current = null;
    setActive(false);
  }

  async function start() {
    setMsg(null);
    setActive(true);
    try {
      // Dynamic import: keep camera code out of the initial/SSR bundle.
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      if (!videoRef.current) throw new Error("no video element");
      controlsRef.current = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (result) => {
          if (result) {
            onDetected(result.getText());
            stop();
          }
        },
      );
    } catch {
      // No camera, denied permission, or unsupported environment.
      setMsg("Camera unavailable — enter the barcode manually below.");
      setActive(false);
    }
  }

  return (
    <div className="rounded border border-gray-200 p-3" data-testid="barcode-scanner">
      {!active ? (
        <button
          type="button"
          onClick={start}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          data-testid="scan-btn"
        >
          Scan barcode with camera
        </button>
      ) : (
        <div className="space-y-2">
          <video ref={videoRef} className="w-full max-w-xs rounded bg-black" muted playsInline />
          <button
            type="button"
            onClick={stop}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Stop scanning
          </button>
        </div>
      )}
      {msg && (
        <p className="mt-2 text-sm text-amber-700" data-testid="scan-msg">
          {msg}
        </p>
      )}
    </div>
  );
}
