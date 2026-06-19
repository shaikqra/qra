"use client";

import { useEffect, useRef } from "react";
import createGlobe from "cobe";

// India and its main export destinations (lat, lng).
const INDIA: [number, number] = [19, 73];
const DESTS: [number, number][] = [
  [53.5, 10], // Hamburg
  [51.9, 4.5], // Rotterdam
  [40.7, -74], // New York
  [1.3, 103.8], // Singapore
  [25, 55], // Dubai
  [31, 121], // Shanghai
];

// Proper dotted-continent globe via cobe (tiny WebGL lib). Brand-blue dots on a
// dark sphere, glowing markers at India's export ports, glowing route arcs from
// India to each, slow auto-spin. Pauses for reduced-motion.
export function Globe() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = canvas.clientWidth || 700;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let phi = 0;
    let raf = 0;

    const globe = createGlobe(canvas, {
      devicePixelRatio: dpr,
      width: size * dpr,
      height: size * dpr,
      phi: 0,
      theta: 0.28,
      dark: 1,
      diffuse: 1.2,
      mapSamples: 18000,
      mapBrightness: 6,
      baseColor: [0.38, 0.49, 0.95],
      markerColor: [0.74, 0.84, 1],
      glowColor: [0.16, 0.26, 0.6],
      markers: [
        { location: INDIA, size: 0.1 },
        ...DESTS.map((location) => ({ location, size: 0.05 })),
      ],
      arcs: DESTS.map((to) => ({ from: INDIA, to })),
      arcColor: [0.6, 0.74, 1],
      arcWidth: 0.5,
      arcHeight: 0.5,
    });

    const frame = () => {
      if (!reduce) phi += 0.004;
      globe.update({ phi });
      raf = requestAnimationFrame(frame);
    };
    frame();

    return () => {
      cancelAnimationFrame(raf);
      globe.destroy();
    };
  }, []);

  return <canvas ref={ref} className="h-full w-full" aria-hidden="true" />;
}
