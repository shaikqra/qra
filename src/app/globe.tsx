"use client";

import { useEffect, useRef } from "react";

// A lightweight rotating dot-globe for the hero — the global-trade motif, hand-
// rolled on a 2D canvas so it adds NO dependency and stays smooth (unlike heavier
// WebGL globes). ~800 points on a Fibonacci sphere, depth-shaded in the brand
// blue. Rotation pauses for users who prefer reduced motion.
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

    // Even point distribution on a sphere (Fibonacci lattice).
    const N = 800;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const pts = Array.from({ length: N }, (_, i) => {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const t = golden * i;
      return { x: Math.cos(t) * r, y, z: Math.sin(t) * r };
    });

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tilt = -0.4;
    const st = Math.sin(tilt);
    const ct = Math.cos(tilt);
    let angle = 0;
    let raf = 0;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const R = (w / 2) * 0.9;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      ctx.clearRect(0, 0, w, h);
      for (const p of pts) {
        // Spin around the vertical axis, then tilt forward.
        const x1 = p.x * cos - p.z * sin;
        const z1 = p.x * sin + p.z * cos;
        const y2 = p.y * ct - z1 * st;
        const z2 = p.y * st + z1 * ct;
        const depth = (z2 + 1) / 2; // 0 = far side, 1 = near side
        const sx = cx + x1 * R;
        const sy = cy + y2 * R;
        const rad = (0.5 + depth * 1.5) * dpr;
        ctx.beginPath();
        ctx.arc(sx, sy, rad, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(125,152,240,${0.12 + depth * 0.55})`;
        ctx.fill();
      }
      if (!reduce) angle += 0.0015;
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
