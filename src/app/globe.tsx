"use client";

import { useEffect, useRef } from "react";
import createGlobe from "cobe";

type Vec = { x: number; y: number; z: number };

const toVec = ([lat, lng]: [number, number]): Vec => {
  const a = (lat * Math.PI) / 180;
  const o = (lng * Math.PI) / 180;
  return { x: Math.cos(a) * Math.sin(o), y: Math.sin(a), z: Math.cos(a) * Math.cos(o) };
};
const toLatLng = (v: Vec): [number, number] => [
  (Math.asin(v.y) * 180) / Math.PI,
  (Math.atan2(v.x, v.z) * 180) / Math.PI,
];
const slerp = (a: Vec, b: Vec, t: number): Vec => {
  let d = a.x * b.x + a.y * b.y + a.z * b.z;
  d = Math.max(-1, Math.min(1, d));
  const o = Math.acos(d);
  const so = Math.sin(o);
  if (so < 1e-6) return a;
  const k0 = Math.sin((1 - t) * o) / so;
  const k1 = Math.sin(t * o) / so;
  return { x: a.x * k0 + b.x * k1, y: a.y * k0 + b.y * k1, z: a.z * k0 + b.z * k1 };
};

const INDIA: [number, number] = [19, 73];
const DESTS: [number, number][] = [
  [53.5, 10], // Hamburg
  [51.9, 4.5], // Rotterdam
  [40.7, -74], // New York
  [1.3, 103.8], // Singapore
  [25, 55], // Dubai
  [31, 121], // Shanghai
];

// Pre-computed great circles from India to each destination + a phase so the
// pulses travel out of sync.
const ROUTES = DESTS.map((d, i) => ({
  va: toVec(INDIA),
  vb: toVec(d),
  speed: 0.0034 + i * 0.0005,
  offset: i / DESTS.length,
}));

// Proper dotted-continent globe (cobe). Brand-blue continents, glowing port
// markers, static route arcs from India, and glowing pulses that flow along each
// route. Pauses for reduced-motion.
export function Globe() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = canvas.clientWidth || 700;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let phi = 0;
    let tick = 0;
    let raf = 0;

    const portMarkers = [
      { location: INDIA, size: 0.1 },
      ...DESTS.map((location) => ({ location, size: 0.05 })),
    ];

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
      markers: portMarkers,
      arcs: DESTS.map((to) => ({ from: INDIA, to })),
      arcColor: [0.5, 0.66, 1],
      arcWidth: 0.5,
      arcHeight: 0.4,
    });

    const frame = () => {
      if (!reduce) {
        phi += 0.004;
        tick += 1;
      }
      // A glowing dot travelling along each route.
      const pulses = ROUTES.map((r) => {
        const t = (tick * r.speed + r.offset) % 1;
        return {
          location: toLatLng(slerp(r.va, r.vb, t)),
          size: 0.045,
          color: [0.92, 0.96, 1] as [number, number, number],
        };
      });
      globe.update({ phi, markers: [...portMarkers, ...pulses] });
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
