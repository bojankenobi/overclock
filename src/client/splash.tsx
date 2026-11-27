import React, { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { requestExpandedMode } from '@devvit/web/client';
import {
  CheckCircle2,
  CircuitBoard,
  Cpu,
  Flame,
  HardDrive,
  MemoryStick,
  MonitorPlay,
  Play,
  Trophy,
} from 'lucide-react';
import { getDayNumber, getTodayDateISO } from '../shared/levelGenerator';
import type { InitResponse } from '../shared/types';
import { trackAppReady, trackJourneyStart } from './analytics';
import { GridlockLogo } from './GridlockLogo';
import './index.css';

function SplashCanvasBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let rafId = 0;

    const render = (now: number) => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const w = Math.max(300, Math.floor(rect.width));
      const h = Math.max(200, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const t = now * 0.001;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      // Anchor 2.5D silicon die on the right side on wider cards, centered-right on mobile
      const cx = w > 520 ? w * 0.72 : w * 0.64;
      const cy = h * 0.56;
      const n = 5;
      const tw = Math.min(w, h) * 0.095;
      const th = tw * 0.52;
      const depth = tw * 0.42;
      const half = (n - 1) / 2;

      // Ambient cyan/crimson conflict glow (Entropy vs Quantum Core)
      const glow = ctx.createRadialGradient(cx, cy, tw * 0.4, cx, cy, tw * 5.2);
      glow.addColorStop(0, 'rgba(0, 240, 255, 0.24)');
      glow.addColorStop(0.45, 'rgba(255, 59, 92, 0.10)');
      glow.addColorStop(1, 'rgba(6, 9, 15, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      // Radiating motherboard bus traces with traveling data pulses
      for (let i = -2; i <= 2; i++) {
        const off = i * 0.9;
        const pulse = (t * (0.45 + Math.abs(i) * 0.08) + (i + 2) * 0.19) % 1;
        const dirs: Array<[number, number, number, number]> = [
          [2.7, off, 8.5, off],
          [-2.7, off, -8.5, off],
          [off, 2.7, off, 8.5],
          [off, -2.7, off, -8.5],
        ];
        dirs.forEach(([u0, v0, u1, v1], di) => {
          const x0 = cx + (u0 - v0) * tw;
          const y0 = cy + (u0 + v0) * th;
          const x1 = cx + (u1 - v1) * tw;
          const y1 = cy + (u1 + v1) * th;
          ctx.strokeStyle = 'rgba(0, 240, 255, 0.14)';
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();

          const pt = (pulse + di * 0.25) % 1;
          ctx.fillStyle = di % 2 === 0 ? '#00F0FF' : '#FFB800';
          ctx.beginPath();
          ctx.arc(x0 + (x1 - x0) * pt, y0 + (y1 - y0) * pt, 1.8, 0, Math.PI * 2);
          ctx.fill();
        });
      }

      // 2.5D Isometric Mini-Board (Fracturing Entropy vs Quantum Restoration)
      const activeWave = Math.floor(t * 2.6) % (n * n);
      const glitchWave = Math.floor(t * 3.7 + 7) % (n * n);
      for (let sum = 0; sum <= 2 * (n - 1); sum++) {
        for (let r = 0; r < n; r++) {
          const c = sum - r;
          if (c < 0 || c >= n) continue;
          const idx = r * n + c;
          const isLit = idx === activeWave || (r === 2 && c === 2) || (r === 0 && c === 4);
          const isGlitch = !isLit && (idx === glitchWave || (r === 4 && c === 1));
          const isGold = !isLit && !isGlitch && ((r === 1 && c === 3) || (r === 3 && c === 1));
          const elev = isLit
            ? depth * (0.62 + Math.sin(t * 4 + idx) * 0.16)
            : isGlitch
              ? -depth * 0.16
              : isGold
                ? depth * 0.35
                : Math.sin(t * 2 + (r + c) * 0.6) * depth * 0.08;

          const u = c - half;
          const v = r - half;
          const sx = cx + (u - v) * tw;
          const sy = cy + (u + v) * th - elev;
          const hw = tw * 0.88;
          const hh = th * 0.88;

          ctx.beginPath();
          ctx.moveTo(sx, sy - hh);
          ctx.lineTo(sx + hw, sy);
          ctx.lineTo(sx, sy + hh);
          ctx.lineTo(sx - hw, sy);
          ctx.closePath();
          ctx.fillStyle = isLit
            ? '#0A4E6E'
            : isGlitch
              ? '#4A0B18'
              : isGold
                ? '#3D2807'
                : '#0E1726';
          ctx.fill();
          ctx.strokeStyle = isLit
            ? '#00F0FF'
            : isGlitch
              ? '#FF3B5C'
              : isGold
                ? '#FFB800'
                : '#1E2D45';
          ctx.lineWidth = isLit || isGold || isGlitch ? 1.4 : 0.9;
          ctx.stroke();

          // Left & right extruded faces
          ctx.beginPath();
          ctx.moveTo(sx - hw, sy);
          ctx.lineTo(sx, sy + hh);
          ctx.lineTo(sx, sy + hh + depth);
          ctx.lineTo(sx - hw, sy + depth);
          ctx.closePath();
          ctx.fillStyle = isLit ? '#07354C' : isGlitch ? '#2E0710' : '#080E18';
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(sx, sy + hh);
          ctx.lineTo(sx + hw, sy);
          ctx.lineTo(sx + hw, sy + depth);
          ctx.lineTo(sx, sy + hh + depth);
          ctx.closePath();
          ctx.fillStyle = isLit ? '#052536' : isGlitch ? '#1E040A' : '#050911';
          ctx.fill();
          ctx.stroke();
        }
      }

      // Floating 3D Quantum Orb hovering above center die
      const orbY = cy - depth * 1.45 + Math.sin(t * 3.2) * 5;
      const orbR = Math.max(8, tw * 0.38);
      const orbGrad = ctx.createRadialGradient(
        cx - orbR * 0.3,
        orbY - orbR * 0.3,
        orbR * 0.1,
        cx,
        orbY,
        orbR
      );
      orbGrad.addColorStop(0, '#FFFFFF');
      orbGrad.addColorStop(0.35, '#00F0FF');
      orbGrad.addColorStop(1, '#082F49');
      ctx.fillStyle = orbGrad;
      ctx.beginPath();
      ctx.arc(cx, orbY, orbR, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(0, 240, 255, 0.75)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(cx, orbY, orbR * 1.5, orbR * 0.45, Math.sin(t * 1.5) * 0.25, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 w-full h-full opacity-90"
    />
  );
}

function SplashApp() {
  const [initData, setInitData] = useState<InitResponse | null>(null);
  const [bootIndex, setBootIndex] = useState<number>(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBootIndex((prev) => (prev + 1) % 5);
    }, 900);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void trackAppReady();
    let cancelled = false;
    fetch('/api/init')
      .then((res) => (res.ok ? (res.json() as Promise<InitResponse>) : null))
      .then((data) => {
        if (!cancelled && data) setInitData(data);
      })
      .catch(() => {
        // Fallback to local date if offline
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const seedDate = initData?.seedDate ?? getTodayDateISO();
  const dayNumber = getDayNumber(seedDate);
  const customPuzzle = initData?.customPuzzle;

  const solvedTurns = initData?.streakData.completedDates[seedDate];
  const hasSolvedToday = solvedTurns !== undefined;
  const currentStreak = initData?.streakData.currentStreak ?? 0;
  const topArchitect = initData?.overallLeaderboard?.[0];

  const handlePlay = (e: React.MouseEvent<HTMLButtonElement>) => {
    void trackJourneyStart();
    requestExpandedMode(e.nativeEvent, 'game', {
      title: 'OVERCLOCK',
    });
  };

  const components = [
    { label: 'MOBO', Icon: CircuitBoard, color: 'text-[#FFB800] border-[#FFB800]/50 bg-[#2B220A]/80' },
    { label: 'RAM', Icon: MemoryStick, color: 'text-[#00FF88] border-[#00FF88]/50 bg-[#08241C]/80' },
    { label: 'SSD', Icon: HardDrive, color: 'text-[#00F0FF] border-[#00F0FF]/50 bg-[#102033]/80' },
    { label: 'GPU', Icon: MonitorPlay, color: 'text-[#C084FC] border-[#C084FC]/50 bg-[#241338]/80' },
    { label: 'CPU', Icon: Cpu, color: 'text-[#00F0FF] border-[#00F0FF]/50 bg-[#182235]/80' },
  ] as const;

  return (
    <div className="relative h-full w-full bg-[#060911] text-slate-100 flex flex-col justify-between p-4 sm:p-6 select-none overflow-hidden border-t border-[#00F0FF]/35">
      {/* Live Animated 2.5D Quantum Die Backdrop */}
      <SplashCanvasBackdrop />

      {/* Readability Vignette */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#060911]/95 via-[#060911]/75 to-[#060911]/35"
      />

      {/* Top Row: Minimal Context + Streak / #1 */}
      <div className="relative z-10 flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-semibold tracking-wider text-[#00FF88] uppercase">
          {customPuzzle ? `Custom by u/${customPuzzle.creator}` : `Daily Edition · ${seedDate}`}
        </span>

        <div className="flex items-center gap-1.5 shrink-0">
          {currentStreak > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#1C1410]/90 border border-[#FFB800]/40 font-mono text-xs text-[#FFB800] font-semibold tabular-nums">
              <Flame className="w-3.5 h-3.5" />
              {currentStreak}
            </span>
          )}
          {topArchitect && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#0D1626]/90 border border-[#00F0FF]/35 font-mono text-[11px] text-[#00F0FF]">
              <Trophy className="w-3 h-3 text-[#FFB800]" />
              #1 u/{topArchitect.username}
            </span>
          )}
        </div>
      </div>

      {/* Center: Big Hero Logo + Clear Game Pitch */}
      <div className="relative z-10 flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-8 my-auto">
        <div className="relative shrink-0 self-start sm:self-center">
          <GridlockLogo
            label="OVERCLOCK"
            className="w-60 sm:w-80 h-auto"
            glow={true}
          />
        </div>

        <div className="flex flex-col gap-2 max-w-sm">
          <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-white leading-tight">
            5 Hardware Trials. <span className="text-[#00F0FF]">1 Mainframe.</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 leading-snug">
            Story Campaign · Daily Puzzle · Blitz · 1v1 Arena
          </p>

          <div className="flex items-center gap-1.5 flex-wrap font-mono text-[10px] pt-0.5">
            {components.map(({ label, Icon, color }, idx) => {
              const active = idx === bootIndex;
              return (
                <span
                  key={label}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border transition-all duration-300 ${
                    active
                      ? `${color} scale-105 shadow-[0_0_12px_rgba(0,240,255,0.25)] font-bold`
                      : 'bg-[#0B111C]/80 border-slate-800 text-slate-400'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{label}</span>
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom: Status + Single Commanding CTA */}
      <div className="relative z-10 flex items-center justify-between gap-3">
        <div className="font-mono text-[11px] text-slate-400">
          {hasSolvedToday ? (
            <span className="inline-flex items-center gap-1.5 text-[#00FF88] font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Cleared today ({solvedTurns} turns)
            </span>
          ) : (
            <span>2.5D Circuit &amp; Hardware Arcade</span>
          )}
        </div>

        <button
          type="button"
          onClick={handlePlay}
          className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-gradient-to-r from-[#00F0FF] to-[#00FF88] text-[#050B14] hover:brightness-110 active:scale-[0.98] font-bold text-xs sm:text-sm tracking-wide uppercase transition-all cursor-pointer shadow-[0_0_26px_rgba(0,240,255,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF] shrink-0"
        >
          <Play className="w-4 h-4 fill-current" />
          <span>Play Now</span>
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SplashApp />
  </StrictMode>
);
