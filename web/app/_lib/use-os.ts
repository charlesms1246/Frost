"use client";

import { useEffect, useState } from "react";

export type OS = "mac" | "windows" | "linux" | "other";

function detect(): OS {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent.toLowerCase();
  const plat = (navigator.platform || "").toLowerCase();
  if (/mac|iphone|ipad|ipod/.test(ua) || /mac/.test(plat)) return "mac";
  if (/win/.test(ua) || /win/.test(plat)) return "windows";
  if (/linux|x11|cros/.test(ua) || /linux/.test(plat)) return "linux";
  return "other";
}

// Detect the visitor's OS so the download UI can recommend the right build.
// Returns "other" on the server and until the first client paint (avoids a
// hydration mismatch); callers should treat "other" as "no recommendation yet".
export function useOS(): OS {
  const [os, setOS] = useState<OS>("other");
  useEffect(() => {
    // Defer out of the effect body (react-hooks/set-state-in-effect); client-only
    // so SSR and the first client render both start from "other".
    queueMicrotask(() => setOS(detect()));
  }, []);
  return os;
}
