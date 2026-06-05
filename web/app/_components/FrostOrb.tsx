"use client";

// The frosted-glass snowflake centerpiece, with mouse-tracked 3D tilt + float.
// Shared by the landing hero and the architecture page. Pass a className to
// override sizing (e.g. a smaller variant in the lifecycle column).

import { useEffect, useRef } from "react";
import { FROST_PETALS } from "./SnowflakeMark";

export default function FrostOrb({
  className = "",
  parallax = true,
}: {
  className?: string;
  parallax?: boolean;
}) {
  const orbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!parallax) return;
    const orb = orbRef.current;
    if (!orb) return;
    let tRx = 0, tRy = 0, rRx = 0, rRy = 0;
    let raf: number | null = null;
    const MAX_RY = 28, MAX_RX = 20;
    function tick() {
      rRx += (tRx - rRx) * 0.1;
      rRy += (tRy - rRy) * 0.1;
      orb!.style.transform = `perspective(1400px) rotateX(${rRx.toFixed(2)}deg) rotateY(${rRy.toFixed(2)}deg)`;
      if (Math.abs(tRx - rRx) > 0.05 || Math.abs(tRy - rRy) > 0.05) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = null;
      }
    }
    function onMove(e: MouseEvent) {
      const w = window.innerWidth, h = window.innerHeight;
      const r = orb!.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / (w * 0.5)));
      const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / (h * 0.5)));
      tRy = dx * MAX_RY;
      tRx = -dy * MAX_RX;
      if (!raf) raf = requestAnimationFrame(tick);
    }
    function onLeave() {
      tRx = 0; tRy = 0;
      if (!raf) raf = requestAnimationFrame(tick);
    }
    window.addEventListener("mousemove", onMove, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [parallax]);

  return (
    <div className={`frost-orb ${className}`} ref={orbRef} aria-label="Frost emblem">
      <div className="halo" aria-hidden="true" />
      <div className="float">
        <svg className="frost-svg" viewBox="0 0 1581 1808" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <defs>
            <g id="frostPetals">
              {FROST_PETALS.map((d, i) => <path key={i} d={d} />)}
            </g>
            <clipPath id="frostClip">
              {FROST_PETALS.map((d, i) => <path key={i} d={d} />)}
            </clipPath>
            <linearGradient id="glassFill" x1="0.15" y1="0.1" x2="0.85" y2="0.95">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
              <stop offset="38%" stopColor="#e4eef7" stopOpacity="0.55" />
              <stop offset="72%" stopColor="#9bb8d2" stopOpacity="0.50" />
              <stop offset="100%" stopColor="#6f8fb0" stopOpacity="0.55" />
            </linearGradient>
            <linearGradient id="specSweep" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
              <stop offset="22%" stopColor="#ffffff" stopOpacity="0.0" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="rimLight" x1="0.5" y1="0" x2="0.5" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
              <stop offset="45%" stopColor="#ffffff" stopOpacity="0.18" />
              <stop offset="55%" stopColor="#ffffff" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#cfe1f2" stopOpacity="0.95" />
            </linearGradient>
            <radialGradient id="centerBloom" cx="0.5" cy="0.5" r="0.35">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.75" />
              <stop offset="55%" stopColor="#dfeaf6" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* (0) real backdrop-filter blur of the page behind, clipped to the silhouette */}
          <foreignObject x="0" y="0" width="1581" height="1808" clipPath="url(#frostClip)">
            <div className="frost-glass-blur" />
          </foreignObject>

          {/* (1) glass body fill */}
          <g clipPath="url(#frostClip)">
            <rect x="0" y="0" width="1581" height="1808" fill="url(#glassFill)" />
            <circle cx="790" cy="904" r="640" fill="url(#centerBloom)" />
            <rect x="0" y="0" width="1581" height="1808" fill="url(#specSweep)" />

            {/* (2) snowflake facet lines: a hexagram through the hub */}
            <g stroke="#ffffff" strokeLinecap="round" fill="none">
              <line x1="790" y1="40" x2="790" y2="1768" strokeWidth="2.5" strokeOpacity="0.45" />
              <line x1="60" y1="460" x2="1520" y2="1348" strokeWidth="2.5" strokeOpacity="0.45" />
              <line x1="1520" y1="460" x2="60" y2="1348" strokeWidth="2.5" strokeOpacity="0.45" />
              <g strokeWidth="1.5" strokeOpacity="0.32">
                <line x1="790" y1="260" x2="720" y2="190" />
                <line x1="790" y1="260" x2="860" y2="190" />
                <line x1="790" y1="1548" x2="720" y2="1618" />
                <line x1="790" y1="1548" x2="860" y2="1618" />
                <line x1="260" y1="604" x2="180" y2="540" />
                <line x1="260" y1="604" x2="260" y2="720" />
                <line x1="1320" y1="604" x2="1400" y2="540" />
                <line x1="1320" y1="604" x2="1320" y2="720" />
                <line x1="260" y1="1204" x2="180" y2="1268" />
                <line x1="260" y1="1204" x2="260" y2="1088" />
                <line x1="1320" y1="1204" x2="1400" y2="1268" />
                <line x1="1320" y1="1204" x2="1320" y2="1088" />
              </g>
            </g>
          </g>

          {/* (3) rim highlight stroke + crisp outer hairline */}
          <g fill="none" stroke="url(#rimLight)" strokeWidth="3.5" strokeLinejoin="round">
            <use href="#frostPetals" />
          </g>
          <g fill="none" stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1.2">
            <use href="#frostPetals" />
          </g>
        </svg>
      </div>
    </div>
  );
}
