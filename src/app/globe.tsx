"use client";

import { useEffect, useRef } from "react";

type Vec = { x: number; y: number; z: number };

const latLng = (latDeg: number, lngDeg: number): Vec => {
  const lat = (latDeg * Math.PI) / 180;
  const lng = (lngDeg * Math.PI) / 180;
  return { x: Math.cos(lat) * Math.sin(lng), y: Math.sin(lat), z: Math.cos(lat) * Math.cos(lng) };
};

// Spherical interpolation between two unit vectors, bulged outward toward the
// middle so a route arcs off the surface like a flight path.
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

// India → its export destinations. Decorative, not to-scale, but on-theme.
const INDIA = latLng(19, 73);
const DESTS = [
  latLng(53.5, 10), // Hamburg
  latLng(51.9, 4.5), // Rotterdam
  latLng(40.7, -74), // New York
  latLng(1.3, 103.8), // Singapore
  latLng(25, 55), // Dubai
  latLng(31, 121), // Shanghai
];

// A rotating dot-globe with glowing trade-route arcs from India. Hand-rolled on a
// 2D canvas — no dependency, stays smooth. Rotation pauses for reduced-motion.
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

    // Even points on a sphere (Fibonacci lattice).
    const N = 900;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const dots: Vec[] = Array.from({ length: N }, (_, i) => {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const t = golden * i;
      return { x: Math.cos(t) * r, y, z: Math.sin(t) * r };
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

      // Surface dots.
      for (const p of dots) {
        const { sx, sy, depth } = project(p);
        ctx.beginPath();
        ctx.arc(sx, sy, (0.5 + depth * 1.7) * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(150,176,255,${0.1 + depth * 0.72})`;
        ctx.fill();
      }

      // Route arcs.
      ctx.lineWidth = 1.3 * dpr;
      for (const route of routes) {
        for (let i = 0; i < route.pts.length - 1; i++) {
          const a = project(route.pts[i]);
          const b = project(route.pts[i + 1]);
          const depth = (a.depth + b.depth) / 2;
          if (depth < 0.34) continue; // hide the back half
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.strokeStyle = `rgba(130,160,255,${(depth - 0.3) * 0.6})`;
          ctx.stroke();
        }
      }

      // Travelling pulses along each route.
      ctx.shadowColor = "rgba(150,180,255,0.9)";
      for (const route of routes) {
        const t = ((tick * route.speed + route.offset) % 1) * SEGS;
        const p = project(route.pts[Math.floor(t)]);
        if (p.depth < 0.4) continue;
        ctx.beginPath();
        ctx.shadowBlur = 8 * dpr;
        ctx.arc(p.sx, p.sy, 2.1 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(214,226,255,${p.depth})`;
        ctx.fill();
      }

      // Hub nodes.
      for (const h of hubs) {
        const p = project(h);
        if (p.depth < 0.4) continue;
        ctx.beginPath();
        ctx.shadowBlur = 10 * dpr;
        ctx.arc(p.sx, p.sy, 2.6 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180,200,255,${0.55 + p.depth * 0.45})`;
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
