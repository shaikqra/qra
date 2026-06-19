"use client";

import { useEffect, useRef } from "react";

type Vec = { x: number; y: number; z: number };

const latLng = (latDeg: number, lngDeg: number): Vec => {
  const lat = (latDeg * Math.PI) / 180;
  const lng = (lngDeg * Math.PI) / 180;
  return { x: Math.cos(lat) * Math.sin(lng), y: Math.sin(lat), z: Math.cos(lat) * Math.cos(lng) };
};

// Coarse land map as overlapping ellipses (centre lat/lng + radii in degrees).
// Approximate — enough to read as continents on a small rotating globe without
// shipping a map image. Antarctica is handled as a latitude band below.
const LAND = [
  { lat: 52, lng: -100, rLat: 20, rLng: 33 }, // N. America (Canada/US)
  { lat: 34, lng: -98, rLat: 12, rLng: 17 }, //   southern US / Mexico
  { lat: 70, lng: -95, rLat: 9, rLng: 38 }, //    Canadian north
  { lat: 72, lng: -42, rLat: 9, rLng: 13 }, //    Greenland
  { lat: -8, lng: -60, rLat: 23, rLng: 13 }, //   S. America
  { lat: -34, lng: -64, rLat: 12, rLng: 8 }, //   southern cone
  { lat: 52, lng: 14, rLat: 12, rLng: 22 }, //    Europe
  { lat: 6, lng: 19, rLat: 20, rLng: 19 }, //     N./central Africa
  { lat: -18, lng: 26, rLat: 17, rLng: 13 }, //   southern Africa
  { lat: 52, lng: 92, rLat: 22, rLng: 55 }, //    N. Asia
  { lat: 26, lng: 78, rLat: 15, rLng: 20 }, //    India / S. Asia
  { lat: 14, lng: 106, rLat: 12, rLng: 15 }, //   SE Asia
  { lat: -25, lng: 134, rLat: 12, rLng: 16 }, //  Australia
];

const isLand = (lat: number, lng: number): boolean => {
  if (lat < -66) return true; // Antarctica
  for (const c of LAND) {
    const dLng = ((lng - c.lng + 540) % 360) - 180;
    const a = dLng / c.rLng;
    const b = (lat - c.lat) / c.rLat;
    if (a * a + b * b <= 1) return true;
  }
  return false;
};

const arcPoints = (a: Vec, b: Vec, segs: number): Vec[] => {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z;
  dot = Math.max(-1, Math.min(1, dot));
  const omega = Math.acos(dot);
  const so = Math.sin(omega);
  const out: Vec[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    let v: Vec;
    if (so < 1e-6) v = { ...a };
    else {
      const k0 = Math.sin((1 - t) * omega) / so;
      const k1 = Math.sin(t * omega) / so;
      v = { x: a.x * k0 + b.x * k1, y: a.y * k0 + b.y * k1, z: a.z * k0 + b.z * k1 };
    }
    const lift = 1 + 0.14 * Math.sin(Math.PI * t);
    out.push({ x: v.x * lift, y: v.y * lift, z: v.z * lift });
  }
  return out;
};

const INDIA = latLng(19, 73);
const DESTS = [
  latLng(53.5, 10), // Hamburg
  latLng(51.9, 4.5), // Rotterdam
  latLng(40.7, -74), // New York
  latLng(1.3, 103.8), // Singapore
  latLng(25, 55), // Dubai
  latLng(31, 121), // Shanghai
];

// A rotating globe whose dots form the continents, with glowing trade-route arcs
// from India. Hand-rolled 2D canvas — no dependency, stays smooth, pauses for
// reduced-motion.
export function Globe() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const w = canvas.clientWidth || 700;
      canvas.width = w * dpr;
      canvas.height = w * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    // Dense Fibonacci sphere; each point tagged land/ocean from the map above.
    const N = 3000;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const dots = Array.from({ length: N }, (_, i) => {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const t = golden * i;
      const v = { x: Math.cos(t) * r, y, z: Math.sin(t) * r };
      const lat = (Math.asin(v.y) * 180) / Math.PI;
      const lng = (Math.atan2(v.x, v.z) * 180) / Math.PI;
      return { ...v, land: isLand(lat, lng) };
    });

    const SEGS = 50;
    const routes = DESTS.map((d, i) => ({
      pts: arcPoints(INDIA, d, SEGS),
      speed: 0.0035 + i * 0.0006,
      offset: i / DESTS.length,
    }));
    const hubs = [INDIA, ...DESTS];

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tilt = -0.38;
    const st = Math.sin(tilt);
    const ct = Math.cos(tilt);
    let angle = 0;
    let tick = 0;
    let raf = 0;

    const draw = () => {
      const w = canvas.width;
      const cx = w / 2;
      const cy = w / 2;
      const R = (w / 2) * 0.82;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);

      const project = (v: Vec) => {
        const x1 = v.x * cos - v.z * sin;
        const z1 = v.x * sin + v.z * cos;
        const y2 = v.y * ct - z1 * st;
        const z2 = v.y * st + z1 * ct;
        return { sx: cx + x1 * R, sy: cy + y2 * R, depth: (z2 + 1) / 2 };
      };

      ctx.clearRect(0, 0, w, w);

      // Continent dots (bright) over a very faint ocean (sphere form).
      for (const p of dots) {
        const { sx, sy, depth } = project(p);
        if (p.land) {
          const s = (0.9 + depth * 1.7) * dpr;
          ctx.fillStyle = `rgba(155,180,255,${0.16 + depth * 0.74})`;
          ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
        } else {
          const s = 0.8 * dpr;
          ctx.fillStyle = `rgba(120,150,235,${0.04 + depth * 0.08})`;
          ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
        }
      }

      // Route arcs (front half only).
      ctx.lineWidth = 1.3 * dpr;
      for (const route of routes) {
        for (let i = 0; i < route.pts.length - 1; i++) {
          const a = project(route.pts[i]);
          const b = project(route.pts[i + 1]);
          const depth = (a.depth + b.depth) / 2;
          if (depth < 0.34) continue;
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.strokeStyle = `rgba(140,170,255,${(depth - 0.3) * 0.6})`;
          ctx.stroke();
        }
      }

      // Travelling pulses.
      ctx.shadowColor = "rgba(160,190,255,0.9)";
      for (const route of routes) {
        const t = ((tick * route.speed + route.offset) % 1) * SEGS;
        const p = project(route.pts[Math.floor(t)]);
        if (p.depth < 0.4) continue;
        ctx.beginPath();
        ctx.shadowBlur = 8 * dpr;
        ctx.arc(p.sx, p.sy, 2.1 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(220,230,255,${p.depth})`;
        ctx.fill();
      }

      // Hub nodes.
      for (const h of hubs) {
        const p = project(h);
        if (p.depth < 0.4) continue;
        ctx.beginPath();
        ctx.shadowBlur = 10 * dpr;
        ctx.arc(p.sx, p.sy, 2.6 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(190,208,255,${0.55 + p.depth * 0.45})`;
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      if (!reduce) {
        angle += 0.0016;
        tick += 1;
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="h-full w-full" aria-hidden="true" />;
}
