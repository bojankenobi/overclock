import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownUp,
  Binary,
  CircuitBoard,
  Cpu,
  Flame,
  Gauge,
  Grid3X3,
  HardDrive,
  ListOrdered,
  Lock,
  MemoryStick,
  MonitorPlay,
  RefreshCw,
  ShieldAlert,
  Zap,
} from 'lucide-react';
import { sound } from './soundEngine';

export interface ComponentResult {
  attempts: number;
  missteps: number;
  timeMs: number;
  gridSize?: number;
  memoryMode?: MemoryMode;
  ssdMode?: SsdMode;
  gpuMode?: GpuMode;
  moboMode?: MoboMode;
}

export type MemoryMode = 'matrix' | 'sequence' | 'glitch' | 'overclock';
export type SsdMode = 'sequential' | 'countdown' | 'parity' | 'overclock';
export type GpuMode = 'circuit' | 'overdrive' | 'gauntlet' | 'overclock';
export type MoboMode = 'power' | 'locked' | 'loop' | 'overclock';

// Shared 2.5D Isometric Board Helpers (used by RAM & SSD dies)
function getIsoBoardMetrics(width: number, height: number, n: number) {
  const tw = Math.min(width / (n * 2.15), height / (n * 1.38));
  const th = tw * 0.52;
  const depth = tw * 0.42;
  const cx = width / 2;
  const cy = height * 0.49;
  return { tw, th, depth, cx, cy };
}

function pickIsoCellFromPointer(
  canvas: HTMLCanvasElement | null,
  clientX: number,
  clientY: number,
  n: number
): number | null {
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  const { tw, th, cx, cy } = getIsoBoardMetrics(rect.width, rect.height, n);
  const dx = px - cx;
  const dy = py - cy;
  const u = (dx / tw + dy / th) / 2;
  const v = (dy / th - dx / tw) / 2;
  const half = (n - 1) / 2;
  const c = Math.round(u + half);
  const r = Math.round(v + half);
  if (r < 0 || r >= n || c < 0 || c >= n) return null;
  const dist = Math.abs(u - (c - half)) + Math.abs(v - (r - half));
  if (dist > 0.96) return null;
  return r * n + c;
}

function drawIsoMotherboardAndPlinth(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  n: number,
  sunlightMode: boolean,
  accentHex = '#00F0FF'
) {
  const { tw, th, depth, cx, cy } = getIsoBoardMetrics(w, h, n);
  const nowSec = performance.now() * 0.001;

  // 1. Ambient radial silicon glow
  const bgGrad = ctx.createRadialGradient(cx, cy, tw * 0.5, cx, cy, tw * n * 1.25);
  if (sunlightMode) {
    bgGrad.addColorStop(0, 'rgba(2, 132, 199, 0.16)');
    bgGrad.addColorStop(1, 'rgba(226, 232, 240, 0)');
  } else {
    bgGrad.addColorStop(0, 'rgba(0, 240, 255, 0.15)');
    bgGrad.addColorStop(0.55, 'rgba(0, 255, 136, 0.05)');
    bgGrad.addColorStop(1, 'rgba(6, 9, 15, 0)');
  }
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // 2. Full-bleed Isometric Motherboard Grid
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = sunlightMode
    ? 'rgba(15, 23, 42, 0.07)'
    : 'rgba(0, 240, 255, 0.055)';
  const bgSpan = Math.max(n + 10, Math.ceil(Math.max(w / tw, h / th)) + 6);
  for (let k = -bgSpan; k <= bgSpan; k++) {
    ctx.beginPath();
    ctx.moveTo(cx + (k + bgSpan) * tw, cy + (k - bgSpan) * th);
    ctx.lineTo(cx + (k - bgSpan) * tw, cy + (k + bgSpan) * th);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx + (-bgSpan - k) * tw, cy + (-bgSpan + k) * th);
    ctx.lineTo(cx + (bgSpan - k) * tw, cy + (bgSpan + k) * th);
    ctx.stroke();
  }
  ctx.restore();

  // 3. Animated Bus Traces & Traveling Data Pulses
  const boardHalfSpan = n * 0.52;
  const traceExtent = Math.max(8, Math.ceil(Math.max(w / tw, h / th) * 0.55));
  const busOffsets = [-0.65, -0.25, 0.25, 0.65];
  busOffsets.forEach((frac, bi) => {
    const offset = frac * (n - 1) * 0.5;
    const pulseT = (nowSec * (0.42 + bi * 0.1) + bi * 0.27) % 1;
    const traceColor =
      bi % 3 === 0 ? accentHex : bi % 3 === 1 ? '#00FF88' : '#FFB800';

    const dirs: Array<[number, number, number, number]> = [
      [boardHalfSpan, offset, boardHalfSpan + traceExtent, offset],
      [-boardHalfSpan, offset, -boardHalfSpan - traceExtent, offset],
      [offset, boardHalfSpan, offset, boardHalfSpan + traceExtent],
      [offset, -boardHalfSpan, offset, -boardHalfSpan - traceExtent],
    ];
    dirs.forEach(([u0, v0, u1, v1], di) => {
      const sx0 = cx + (u0 - v0) * tw;
      const sy0 = cy + (u0 + v0) * th;
      const sx1 = cx + (u1 - v1) * tw;
      const sy1 = cy + (u1 + v1) * th;

      ctx.strokeStyle = sunlightMode
        ? 'rgba(15, 23, 42, 0.16)'
        : 'rgba(56, 189, 248, 0.16)';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(sx0, sy0);
      ctx.lineTo(sx1, sy1);
      ctx.stroke();

      const t = (pulseT + di * 0.25) % 1;
      ctx.fillStyle = traceColor;
      ctx.beginPath();
      ctx.arc(sx0 + (sx1 - sx0) * t, sy0 + (sy1 - sy0) * t, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  // 4. 2.5D Beveled Silicon Substrate Plinth + Gold Contact Pins
  const pSpan = n * 0.535;
  const pDepth = depth * 1.15;
  const pTop = { x: cx, y: cy - pSpan * 2 * th + depth * 0.45 };
  const pRight = { x: cx + pSpan * 2 * tw, y: cy + depth * 0.45 };
  const pBot = { x: cx, y: cy + pSpan * 2 * th + depth * 0.45 };
  const pLeft = { x: cx - pSpan * 2 * tw, y: cy + depth * 0.45 };

  ctx.beginPath();
  ctx.moveTo(pTop.x, pTop.y);
  ctx.lineTo(pRight.x, pRight.y);
  ctx.lineTo(pBot.x, pBot.y);
  ctx.lineTo(pLeft.x, pLeft.y);
  ctx.closePath();
  ctx.fillStyle = sunlightMode ? '#CBD5E1' : '#09101C';
  ctx.fill();
  ctx.strokeStyle = sunlightMode ? '#64748B' : 'rgba(0, 240, 255, 0.35)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(pLeft.x, pLeft.y);
  ctx.lineTo(pBot.x, pBot.y);
  ctx.lineTo(pBot.x, pBot.y + pDepth);
  ctx.lineTo(pLeft.x, pLeft.y + pDepth);
  ctx.closePath();
  ctx.fillStyle = sunlightMode ? '#94A3B8' : '#060B14';
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(pBot.x, pBot.y);
  ctx.lineTo(pRight.x, pRight.y);
  ctx.lineTo(pRight.x, pRight.y + pDepth);
  ctx.lineTo(pBot.x, pBot.y + pDepth);
  ctx.closePath();
  ctx.fillStyle = sunlightMode ? '#64748B' : '#04080F';
  ctx.fill();
  ctx.stroke();

  const pinCount = Math.min(10, n + 2);
  ctx.fillStyle = '#FFB800';
  for (let pi = 1; pi < pinCount; pi++) {
    const f = pi / pinCount;
    const lx = pLeft.x + (pBot.x - pLeft.x) * f;
    const ly = pLeft.y + (pBot.y - pLeft.y) * f + pDepth * 0.35;
    ctx.fillRect(lx - 1.5, ly, 3, pDepth * 0.45);
    const rx = pBot.x + (pRight.x - pBot.x) * f;
    const ry = pBot.y + (pRight.y - pBot.y) * f + pDepth * 0.35;
    ctx.fillRect(rx - 1.5, ry, 3, pDepth * 0.45);
  }
}

// ============================================================================
// 1. RAM MODULE — 2.5D Isometric Silicon Memory Die (5x5 -> 10x10, 3 Modes)
// ============================================================================

export function RamMemoryGame({
  runSeed,
  onComplete,
  variant = 'story',
  storyDifficulty = 'normal',
  initialGridSize = 5,
  initialMode = 'matrix',
  sunlightMode = false,
}: {
  runSeed: number;
  onComplete: (res: ComponentResult) => void;
  variant?: 'story' | 'daily' | 'challenge' | 'overclock' | 'blitz';
  storyDifficulty?: 'easy' | 'normal' | 'hard';
  initialGridSize?: number;
  initialMode?: MemoryMode;
  sunlightMode?: boolean;
}) {
  const TOTAL_ROUNDS =
    variant === 'story' ? 3 : variant === 'challenge' ? 4 : variant === 'blitz' ? 3 : 1;
  const [round, setRound] = useState<number>(0);
  const [selectedGridSize, setSelectedGridSize] = useState<number>(() =>
    Math.max(5, Math.min(10, initialGridSize))
  );
  const [selectedMode, setSelectedMode] = useState<MemoryMode>(initialMode);
  const [phase, setPhase] = useState<'memorize' | 'input' | 'error'>('memorize');
  const [targets, setTargets] = useState<number[]>([]);
  const [decoys, setDecoys] = useState<number[]>([]);
  const [found, setFound] = useState<number[]>([]);
  const [seqRevealIdx, setSeqRevealIdx] = useState<number>(-1);
  const [wrongCell, setWrongCell] = useState<number | null>(null);
  const [hoveredCell, setHoveredCell] = useState<number | null>(null);
  const [attempts, setAttempts] = useState<number>(1);
  const [missteps, setMissteps] = useState<number>(0);
  const [integrity, setIntegrity] = useState<number>(3);
  const [wipedReason, setWipedReason] = useState<string | null>(null);
  const [timeLeftMs, setTimeLeftMs] = useState<number>(14000);
  const [memorizePct, setMemorizePct] = useState<number>(100);
  const startTimeRef = useRef<number>(performance.now());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const elevRef = useRef<Float32Array>(new Float32Array(100));

  // Story: 5->6->7 | Challenge: all 4 modes (computer-assigned) | Blitz: 3x5x5 sprint | Overclock: 6x6 high-speed
  const activeGridSize =
    variant === 'story'
      ? 5 + round
      : variant === 'challenge'
        ? round < 2
          ? 5
          : 6
        : variant === 'blitz'
          ? 5
          : variant === 'overclock'
            ? 6
            : selectedGridSize;
  const activeMode: MemoryMode =
    variant === 'story'
      ? round === 0
        ? 'matrix'
        : round === 1
          ? 'sequence'
          : 'glitch'
      : variant === 'challenge'
        ? ((['matrix', 'sequence', 'glitch', 'overclock'] as const)[round] ?? 'overclock')
        : variant === 'blitz'
          ? ((['matrix', 'sequence', 'overclock'] as const)[round] ?? 'overclock')
          : variant === 'overclock'
            ? 'overclock'
            : selectedMode;

  const generateRound = useCallback(
    (rIdx: number, gSize: number, mode: MemoryMode) => {
      const cells = gSize * gSize;
      const baseCount =
        mode === 'sequence'
          ? Math.min(9, Math.max(4, gSize - (variant === 'challenge' ? 0 : 1)))
          : Math.min(18, gSize + (variant === 'challenge' ? 3 : 1) + rIdx);
      const decoyCount =
        mode === 'glitch'
          ? Math.min(12, Math.max(3, Math.floor(gSize * 0.85)))
          : 0;

      const pool = Array.from({ length: cells }, (_, i) => i);
      const modeOffset = mode === 'matrix' ? 11 : mode === 'sequence' ? 29 : 53;
      const randomSalt = Math.floor(Math.random() * 0x7fffffff);
      let s = ((runSeed + rIdx * 997 + gSize * 131 + modeOffset * 37) ^ randomSalt) >>> 0;
      for (let i = pool.length - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const j = s % (i + 1);
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      setTargets(pool.slice(0, baseCount));
      setDecoys(pool.slice(baseCount, baseCount + decoyCount));
      setFound([]);
      setWrongCell(null);
      setSeqRevealIdx(mode === 'sequence' ? 0 : -1);
      setMemorizePct(100);
      setPhase('memorize');
      const roundTimeMs =
        variant === 'story' && storyDifficulty === 'easy'
          ? -1
          : variant === 'story' && storyDifficulty === 'normal'
            ? 28000
            : mode === 'overclock' || variant === 'challenge' || variant === 'blitz'
              ? 10000
              : 14000;
      setTimeLeftMs(roundTimeMs);
    },
    [runSeed, variant, storyDifficulty]
  );

  const retryRam = useCallback(() => {
    setIntegrity(3);
    setWipedReason(null);
    setMissteps(0);
    setAttempts((a) => a + 1);
    setRound(0);
    generateRound(0, activeGridSize, activeMode);
  }, [generateRound, activeGridSize, activeMode]);

  useEffect(() => {
    if (phase !== 'input' || wipedReason || timeLeftMs < 0) return;
    const id = window.setInterval(() => {
      setTimeLeftMs((prev) => {
        if (prev < 0) return prev;
        if (prev <= 100) {
          window.clearInterval(id);
          sound.outOfMoves();
          setWipedReason('BUFFER EXPIRED // TIME OUT');
          return 0;
        }
        return prev - 100;
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [phase, wipedReason, timeLeftMs]);

  useEffect(() => {
    generateRound(round, activeGridSize, activeMode);
  }, [round, activeGridSize, activeMode, generateRound]);

  // Memorize timer / Sequence step-by-step playback
  useEffect(() => {
    if (phase !== 'memorize' || targets.length === 0) return;

    if (activeMode === 'sequence') {
      const stepMs = variant === 'challenge' ? 380 : 480;
      let cur = 0;
      setSeqRevealIdx(0);
      sound.collectNode(1);

      const interval = window.setInterval(() => {
        cur += 1;
        if (cur < targets.length) {
          setSeqRevealIdx(cur);
          setMemorizePct(
            Math.max(5, Math.round(((targets.length - cur) / targets.length) * 100))
          );
          sound.collectNode(cur + 1);
        } else {
          window.clearInterval(interval);
          setSeqRevealIdx(-1);
          setMemorizePct(0);
          setPhase('input');
        }
      }, stepMs);

      return () => window.clearInterval(interval);
    }

    const totalMs =
      (activeMode === 'overclock' ? 950 : variant === 'challenge' ? 1350 : 1850) +
      Math.max(0, activeGridSize - 5) * 140;
    const started = performance.now();
    const rafTick = window.setInterval(() => {
      const elapsed = performance.now() - started;
      const pct = Math.max(0, 100 - (elapsed / totalMs) * 100);
      setMemorizePct(pct);
      if (elapsed >= totalMs) {
        window.clearInterval(rafTick);
        setPhase('input');
      }
    }, 35);

    return () => window.clearInterval(rafTick);
  }, [phase, targets, activeMode, activeGridSize, variant]);

  const handleCellClick = useCallback(
    (idx: number) => {
      if (phase !== 'input') return;
      if (found.includes(idx)) return;

      const isExpected =
        activeMode === 'sequence'
          ? targets[found.length] === idx
          : targets.includes(idx);

      if (isExpected) {
        const nextFound = [...found, idx];
        setFound(nextFound);
        sound.collectNode(nextFound.length);

        if (nextFound.length === targets.length) {
          if (round + 1 >= TOTAL_ROUNDS) {
            sound.win();
            onComplete({
              attempts,
              missteps,
              timeMs: Math.max(200, Math.round(performance.now() - startTimeRef.current)),
              gridSize: activeGridSize,
              memoryMode: activeMode,
            });
          } else {
            window.setTimeout(() => {
              setRound((r) => r + 1);
            }, 420);
          }
        }
      } else {
        sound.outOfMoves();
        setWrongCell(idx);
        setMissteps((m) => m + 1);
        setAttempts((a) => a + 1);
        setPhase('error');
        const nextIntegrity = integrity - 1;
        setIntegrity(nextIntegrity);
        if (nextIntegrity <= 0) {
          window.setTimeout(() => {
            setWrongCell(null);
            setWipedReason('MEMORY CORRUPTION // 0/3 INTEGRITY');
          }, 360);
        } else {
          window.setTimeout(() => {
            setWrongCell(null);
            setFound([]);
            setPhase('memorize');
          }, 680);
        }
      }
    },
    [
      phase,
      found,
      activeMode,
      targets,
      round,
      TOTAL_ROUNDS,
      onComplete,
      attempts,
      missteps,
      activeGridSize,
      integrity,
    ]
  );

  // Isometric geometry helper
  const getIsoMetrics = useCallback(
    (width: number, height: number, n: number) => {
      const tw = Math.min(width / (n * 2.15), height / (n * 1.38));
      const th = tw * 0.52;
      const depth = tw * 0.42;
      const cx = width / 2;
      const cy = height * 0.49;
      return { tw, th, depth, cx, cy };
    },
    []
  );

  const pickCellFromPointer = useCallback(
    (clientX: number, clientY: number): number | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const { tw, th, cx, cy } = getIsoMetrics(rect.width, rect.height, activeGridSize);
      const dx = px - cx;
      const dy = py - cy;
      const u = (dx / tw + dy / th) / 2;
      const v = (dy / th - dx / tw) / 2;
      const half = (activeGridSize - 1) / 2;
      const c = Math.round(u + half);
      const r = Math.round(v + half);
      if (r < 0 || r >= activeGridSize || c < 0 || c >= activeGridSize) return null;
      const dist = Math.abs(u - (c - half)) + Math.abs(v - (r - half));
      if (dist > 0.96) return null;
      return r * activeGridSize + c;
    },
    [activeGridSize, getIsoMetrics]
  );

  // 2.5D Isometric Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let rafId = 0;

    const render = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(260, Math.floor(rect.width));
      const h = Math.max(220, Math.floor(rect.height));
      const maxDpr = typeof navigator !== 'undefined' && navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4 ? 1.5 : 2;
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);

      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const n = activeGridSize;
      const { tw, th, depth, cx, cy } = getIsoMetrics(w, h, n);
      const half = (n - 1) / 2;
      const elevArr = elevRef.current;

      const nowSec = performance.now() * 0.001;

      // 1. Subtle under-board silicon glow
      const bgGrad = ctx.createRadialGradient(cx, cy, tw * 0.5, cx, cy, tw * n * 1.25);
      if (sunlightMode) {
        bgGrad.addColorStop(0, 'rgba(2, 132, 199, 0.16)');
        bgGrad.addColorStop(1, 'rgba(226, 232, 240, 0)');
      } else {
        bgGrad.addColorStop(0, 'rgba(0, 240, 255, 0.16)');
        bgGrad.addColorStop(0.55, 'rgba(0, 255, 136, 0.05)');
        bgGrad.addColorStop(1, 'rgba(6, 9, 15, 0)');
      }
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      // 2. Isometric Motherboard Background Grid (full-bleed to viewport edges)
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = sunlightMode
        ? 'rgba(15, 23, 42, 0.07)'
        : 'rgba(0, 240, 255, 0.055)';
      const bgSpan = Math.max(n + 10, Math.ceil(Math.max(w / tw, h / th)) + 6);
      for (let k = -bgSpan; k <= bgSpan; k++) {
        // u-axis lines
        const x1 = cx + (k - -bgSpan) * tw;
        const y1 = cy + (k + -bgSpan) * th;
        const x2 = cx + (k - bgSpan) * tw;
        const y2 = cy + (k + bgSpan) * th;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // v-axis lines
        const x3 = cx + (-bgSpan - k) * tw;
        const y3 = cy + (-bgSpan + k) * th;
        const x4 = cx + (bgSpan - k) * tw;
        const y4 = cy + (bgSpan + k) * th;
        ctx.beginPath();
        ctx.moveTo(x3, y3);
        ctx.lineTo(x4, y4);
        ctx.stroke();
      }
      ctx.restore();

      // 3. Live Animated Bus Traces & Traveling Data Pulses radiating from the RAM Die
      const boardHalfSpan = n * 0.52;
      const traceExtent = Math.max(8, Math.ceil(Math.max(w / tw, h / th) * 0.55));
      const busOffsets = [-0.65, -0.25, 0.25, 0.65];
      busOffsets.forEach((frac, bi) => {
        const offset = frac * (n - 1) * 0.5;
        const pulseT = (nowSec * (0.42 + bi * 0.1) + bi * 0.27) % 1;
        const traceColor =
          bi % 3 === 0 ? '#00F0FF' : bi % 3 === 1 ? '#00FF88' : '#FFB800';

        // 4 directions: (+u, -u, +v, -v)
        const dirs: Array<[number, number, number, number]> = [
          [boardHalfSpan, offset, boardHalfSpan + traceExtent, offset],
          [-boardHalfSpan, offset, -boardHalfSpan - traceExtent, offset],
          [offset, boardHalfSpan, offset, boardHalfSpan + traceExtent],
          [offset, -boardHalfSpan, offset, -boardHalfSpan - traceExtent],
        ];
        dirs.forEach(([u0, v0, u1, v1], di) => {
          const sx0 = cx + (u0 - v0) * tw;
          const sy0 = cy + (u0 + v0) * th;
          const sx1 = cx + (u1 - v1) * tw;
          const sy1 = cy + (u1 + v1) * th;

          ctx.strokeStyle = sunlightMode
            ? 'rgba(15, 23, 42, 0.16)'
            : 'rgba(56, 189, 248, 0.16)';
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.moveTo(sx0, sy0);
          ctx.lineTo(sx1, sy1);
          ctx.stroke();

          // Moving data packet along bus trace
          const t = (pulseT + di * 0.25) % 1;
          const px = sx0 + (sx1 - sx0) * t;
          const py = sy0 + (sy1 - sy0) * t;
          ctx.fillStyle = traceColor;
          ctx.beginPath();
          ctx.arc(px, py, 2.2, 0, Math.PI * 2);
          ctx.fill();
        });
      });

      // 4. 2.5D Beveled DIMM Substrate Plinth under the RAM Die
      const pSpan = n * 0.535;
      const pDepth = depth * 1.15;
      const pTop = { x: cx, y: cy - pSpan * 2 * th + depth * 0.45 };
      const pRight = { x: cx + pSpan * 2 * tw, y: cy + depth * 0.45 };
      const pBot = { x: cx, y: cy + pSpan * 2 * th + depth * 0.45 };
      const pLeft = { x: cx - pSpan * 2 * tw, y: cy + depth * 0.45 };

      ctx.beginPath();
      ctx.moveTo(pTop.x, pTop.y);
      ctx.lineTo(pRight.x, pRight.y);
      ctx.lineTo(pBot.x, pBot.y);
      ctx.lineTo(pLeft.x, pLeft.y);
      ctx.closePath();
      ctx.fillStyle = sunlightMode ? '#CBD5E1' : '#09101C';
      ctx.fill();
      ctx.strokeStyle = sunlightMode ? '#64748B' : 'rgba(0, 240, 255, 0.35)';
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Plinth front-left & front-right edges + gold DIMM pins
      ctx.beginPath();
      ctx.moveTo(pLeft.x, pLeft.y);
      ctx.lineTo(pBot.x, pBot.y);
      ctx.lineTo(pBot.x, pBot.y + pDepth);
      ctx.lineTo(pLeft.x, pLeft.y + pDepth);
      ctx.closePath();
      ctx.fillStyle = sunlightMode ? '#94A3B8' : '#060B14';
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(pBot.x, pBot.y);
      ctx.lineTo(pRight.x, pRight.y);
      ctx.lineTo(pRight.x, pRight.y + pDepth);
      ctx.lineTo(pBot.x, pBot.y + pDepth);
      ctx.closePath();
      ctx.fillStyle = sunlightMode ? '#64748B' : '#04080F';
      ctx.fill();
      ctx.stroke();

      // Gold DIMM contact pins along front-left & front-right substrate faces
      const pinCount = Math.min(10, n + 2);
      ctx.fillStyle = '#FFB800';
      for (let pi = 1; pi < pinCount; pi++) {
        const f = pi / pinCount;
        const lx = pLeft.x + (pBot.x - pLeft.x) * f;
        const ly = pLeft.y + (pBot.y - pLeft.y) * f + pDepth * 0.35;
        ctx.fillRect(lx - 1.5, ly, 3, pDepth * 0.45);
        const rx = pBot.x + (pRight.x - pBot.x) * f;
        const ry = pBot.y + (pRight.y - pBot.y) * f + pDepth * 0.35;
        ctx.fillRect(rx - 1.5, ry, 3, pDepth * 0.45);
      }

      // Painter's order: back-to-front by (r + c)
      for (let sum = 0; sum <= 2 * (n - 1); sum++) {
        for (let r = 0; r < n; r++) {
          const c = sum - r;
          if (c < 0 || c >= n) continue;
          const idx = r * n + c;

          const targetOrderIdx = targets.indexOf(idx);
          const isTarget = targetOrderIdx !== -1;
          const isDecoy = decoys.includes(idx);
          const isFound = found.includes(idx);
          const isWrong = wrongCell === idx;
          const isHovered = hoveredCell === idx && phase === 'input' && !isFound;

          const showSeqPulse =
            phase === 'memorize' && activeMode === 'sequence' && seqRevealIdx === targetOrderIdx;
          const showMatrixLit = phase === 'memorize' && activeMode !== 'sequence' && isTarget;
          const showDecoyLit = phase === 'memorize' && activeMode === 'glitch' && isDecoy;
          const showLit = showSeqPulse || showMatrixLit || isFound;

          const targetElev = isWrong
            ? -depth * 0.18
            : showLit || showDecoyLit
              ? depth * 0.58
              : isHovered
                ? depth * 0.24
                : 0;
          elevArr[idx] = elevArr[idx] + (targetElev - elevArr[idx]) * 0.24;
          const z = elevArr[idx];

          const u = c - half;
          const v = r - half;
          const sx = cx + (u - v) * tw;
          const sy = cy + (u + v) * th - z;

          const gap = 0.9;
          const hw = tw * gap;
          const hh = th * gap;

          // Colors by state
          let topFill = sunlightMode ? '#F8FAFC' : '#131D30';
          let leftFill = sunlightMode ? '#CBD5E1' : '#0B1220';
          let rightFill = sunlightMode ? '#94A3B8' : '#080E1A';
          let strokeColor = sunlightMode ? '#64748B' : '#263856';

          if (isWrong) {
            topFill = '#7F1D1D';
            leftFill = '#5C1111';
            rightFill = '#450A0A';
            strokeColor = '#FF4460';
          } else if (showDecoyLit) {
            topFill = '#6E1426';
            leftFill = '#4A0B18';
            rightFill = '#350610';
            strokeColor = '#FF3B5C';
          } else if (isFound) {
            topFill = sunlightMode ? '#059669' : '#0B4635';
            leftFill = sunlightMode ? '#047857' : '#073125';
            rightFill = sunlightMode ? '#065F46' : '#052219';
            strokeColor = '#00FF88';
          } else if (showLit) {
            topFill = sunlightMode ? '#0284C7' : '#0A4E6E';
            leftFill = sunlightMode ? '#0369A1' : '#07354C';
            rightFill = sunlightMode ? '#075985' : '#052536';
            strokeColor = '#00F0FF';
          } else if (isHovered) {
            topFill = sunlightMode ? '#E0F2FE' : '#1B2B45';
            strokeColor = '#00F0FF';
          }

          // Top face diamond
          ctx.beginPath();
          ctx.moveTo(sx, sy - hh);
          ctx.lineTo(sx + hw, sy);
          ctx.lineTo(sx, sy + hh);
          ctx.lineTo(sx - hw, sy);
          ctx.closePath();
          ctx.fillStyle = topFill;
          ctx.fill();
          ctx.lineWidth = showLit || isFound || showDecoyLit || isWrong ? 1.7 : 1;
          ctx.strokeStyle = strokeColor;
          ctx.stroke();

          // Left extruded face
          ctx.beginPath();
          ctx.moveTo(sx - hw, sy);
          ctx.lineTo(sx, sy + hh);
          ctx.lineTo(sx, sy + hh + depth);
          ctx.lineTo(sx - hw, sy + depth);
          ctx.closePath();
          ctx.fillStyle = leftFill;
          ctx.fill();
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = 0.8;
          ctx.stroke();

          // Right extruded face
          ctx.beginPath();
          ctx.moveTo(sx, sy + hh);
          ctx.lineTo(sx + hw, sy);
          ctx.lineTo(sx + hw, sy + depth);
          ctx.lineTo(sx, sy + hh + depth);
          ctx.closePath();
          ctx.fillStyle = rightFill;
          ctx.fill();
          ctx.strokeStyle = strokeColor;
          ctx.lineWidth = 0.8;
          ctx.stroke();

          // Isometric Engraved Markings on Top Face (flush with cube plane!)
          ctx.save();
          ctx.translate(sx, sy);
          ctx.transform(hw / 20, hh / 20, -hw / 20, hh / 20, 0, 0);

          if (showSeqPulse || (isFound && activeMode === 'sequence')) {
            // Engraved recessed bevel + glowing step number
            ctx.font = '800 18px ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
            ctx.fillText(String(targetOrderIdx + 1), -1, -1);
            ctx.fillStyle = isFound ? '#00FF88' : '#FFFFFF';
            ctx.fillText(String(targetOrderIdx + 1), 0, 0);
          } else if (isFound) {
            // Engraved 8-pin DRAM IC package flush on cube top face
            ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.fillRect(-10, -10, 18, 18);
            ctx.fillStyle = '#062E22';
            ctx.strokeStyle = '#00FF88';
            ctx.lineWidth = 1.6;
            ctx.fillRect(-9, -9, 18, 18);
            ctx.strokeRect(-9, -9, 18, 18);
            // Gold contact pins on all 4 edges of the IC
            ctx.fillStyle = '#FFB800';
            for (const p of [-5, 0, 5]) {
              ctx.fillRect(p - 1, -12, 2, 3);
              ctx.fillRect(p - 1, 9, 2, 3);
              ctx.fillRect(-12, p - 1, 3, 2);
              ctx.fillRect(9, p - 1, 3, 2);
            }
            ctx.fillStyle = '#00FF88';
            ctx.fillRect(-3.5, -3.5, 7, 7);
          } else if (showMatrixLit) {
            // Recessed cyan silicon register socket
            ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            ctx.fillRect(-9, -9, 17, 17);
            ctx.fillStyle = '#00F0FF';
            ctx.fillRect(-7, -7, 14, 14);
            ctx.fillStyle = '#062636';
            ctx.fillRect(-3, -3, 6, 6);
          } else if (showDecoyLit || isWrong) {
            ctx.font = '800 18px ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillText(showDecoyLit ? '!' : '✕', -1, -1);
            ctx.fillStyle = '#FF5C77';
            ctx.fillText(showDecoyLit ? '!' : '✕', 0, 0);
          } else {
            // Subtle engraved micro-register outline on idle cubes
            ctx.strokeStyle = sunlightMode
              ? 'rgba(100, 116, 139, 0.25)'
              : 'rgba(148, 163, 184, 0.12)';
            ctx.lineWidth = 1.2;
            ctx.strokeRect(-8, -8, 16, 16);
          }

          ctx.restore();
        }
      }

      ctx.restore();
      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(rafId);
  }, [
    activeGridSize,
    activeMode,
    decoys,
    found,
    getIsoMetrics,
    hoveredCell,
    phase,
    seqRevealIdx,
    sunlightMode,
    targets,
    wrongCell,
  ]);

  const modeLabel =
    activeMode === 'matrix'
      ? 'MATRIX IMPRINT'
      : activeMode === 'sequence'
        ? 'SEQUENCE ECHO'
        : 'GLITCH FILTER';

  return (
    <div className="w-full h-full flex flex-col items-center justify-between py-2.5 sm:py-4 gap-2 select-none relative">
      {/* Standalone Mode + Grid Size Controls (Daily only; Challenge/Overclock/Blitz are computer-assigned) */}
      {variant === 'daily' && (
        <div className="relative z-10 flex flex-wrap items-center justify-center gap-2 max-w-full px-2.5 shrink-0">
          <div
            role="group"
            aria-label="Memory mode"
            className="inline-flex items-center rounded-lg bg-[#0A111D] border border-slate-800 p-0.5 font-mono text-[10px]"
          >
            {(
              [
                { id: 'matrix', label: 'Matrix', Icon: Grid3X3 },
                { id: 'sequence', label: 'Sequence', Icon: ListOrdered },
                { id: 'glitch', label: 'Glitch', Icon: ShieldAlert },
                { id: 'overclock', label: 'Overclock', Icon: Zap },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setSelectedMode(id);
                  setRound(0);
                }}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors cursor-pointer ${
                  selectedMode === id
                    ? 'bg-[#102438] text-[#00F0FF] border border-[#00F0FF]/45 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3 h-3" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div
            role="group"
            aria-label="Memory grid size"
            className="inline-flex items-center rounded-lg bg-[#0A111D] border border-slate-800 p-0.5 font-mono text-[10px]"
          >
            {[5, 6, 7, 8, 9, 10].map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => {
                  setSelectedGridSize(sz);
                  setRound(0);
                }}
                className={`px-1.5 py-1 rounded-md transition-colors cursor-pointer ${
                  selectedGridSize === sz
                    ? 'bg-[#08241C] text-[#00FF88] border border-[#00FF88]/45 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {sz}×{sz}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Industrial Telemetry Header */}
      <div className="relative z-10 flex flex-col items-center gap-1.5 shrink-0 w-full max-w-md px-2.5">
        <div className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded bg-[#070B12]/95 border border-slate-800 font-mono text-[11px] tabular-nums">
          <div className="flex items-center gap-1.5 text-slate-200 font-bold">
            <MemoryStick className="w-3.5 h-3.5 text-[#00F0FF]" />
            <span>
              {TOTAL_ROUNDS > 1 ? `R${round + 1}/${TOTAL_ROUNDS} · ` : ''}
              {activeGridSize}×{activeGridSize} · {activeMode.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1" title="Memory Integrity">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`w-2.5 h-2 rounded-xs ${
                    i < integrity
                      ? integrity === 1
                        ? 'bg-[#FF4460]'
                        : 'bg-[#00FF88]'
                      : 'bg-slate-800 border border-slate-700'
                  }`}
                />
              ))}
            </span>
            <span
              className={`font-bold ${
                timeLeftMs < 0
                  ? 'text-[#00FF88]'
                  : timeLeftMs <= 4000
                    ? 'text-[#FF4460] animate-pulse'
                    : 'text-[#00F0FF]'
              }`}
            >
              {timeLeftMs < 0 ? '∞' : `${(timeLeftMs / 1000).toFixed(1)}s`}
            </span>
          </div>
        </div>
        <div className="w-full h-1 rounded-xs bg-slate-900 overflow-hidden">
          <div
            className={`h-full transition-all duration-75 ${
              phase === 'memorize'
                ? 'bg-[#00F0FF]'
                : phase === 'error'
                  ? 'bg-[#FF4460] w-full'
                  : 'bg-transparent w-0'
            }`}
            style={phase === 'memorize' ? { width: `${memorizePct}%` } : undefined}
          />
        </div>
      </div>

      {/* 2.5D Isometric Silicon Die Canvas (full width/fullscreen) */}
      <div ref={containerRef} className="w-full flex-1 min-h-[240px] relative">
        <canvas
          ref={canvasRef}
          onPointerMove={(e) => setHoveredCell(pickCellFromPointer(e.clientX, e.clientY))}
          onPointerLeave={() => setHoveredCell(null)}
          onPointerDown={(e) => {
            if (wipedReason) return;
            const cell = pickCellFromPointer(e.clientX, e.clientY);
            if (cell !== null) handleCellClick(cell);
          }}
          className={`block w-full h-full touch-none ${
            hoveredCell !== null && phase === 'input' ? 'cursor-pointer' : 'cursor-default'
          }`}
        />

        {wipedReason && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#060911]/90 backdrop-blur-xs p-4 text-center gap-3 font-mono">
            <div className="text-xs font-bold tracking-widest text-[#FF4460]">{wipedReason}</div>
            <button
              type="button"
              onClick={retryRam}
              className="px-5 py-2 rounded bg-[#00F0FF] text-[#050B14] font-bold text-xs uppercase tracking-wider cursor-pointer hover:brightness-110"
            >
              Reboot RAM
            </button>
          </div>
        )}
      </div>

      {/* Footer Metrics */}
      <div className="flex items-center gap-4 font-mono text-xs text-slate-400 shrink-0 pb-1">
        <span>
          ATTEMPTS:{' '}
          <strong className={sunlightMode ? 'text-slate-900' : 'text-white'}>{attempts}</strong>
        </span>
        <span>
          MISSTEPS:{' '}
          <strong className={missteps === 0 ? 'text-[#00FF88]' : 'text-[#FFB800]'}>
            {missteps}
          </strong>
        </span>
        <span>
          PINS: <strong className="text-[#00F0FF]">{found.length}/{targets.length}</strong>
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// 2. SSD DRIVE — 2.5D Isometric NVMe Packet Defrag (5x5 -> 10x10, 3 Modes)
// ============================================================================

export function SsdSequencerGame({
  runSeed,
  onComplete,
  variant = 'story',
  storyDifficulty = 'normal',
  initialGridSize = 5,
  initialMode = 'sequential',
  sunlightMode = false,
}: {
  runSeed: number;
  onComplete: (res: ComponentResult) => void;
  variant?: 'story' | 'daily' | 'challenge' | 'overclock' | 'blitz';
  storyDifficulty?: 'easy' | 'normal' | 'hard';
  initialGridSize?: number;
  initialMode?: SsdMode;
  sunlightMode?: boolean;
}) {
  const TOTAL_PASSES =
    variant === 'story' ? 3 : variant === 'challenge' ? 4 : variant === 'blitz' ? 3 : 1;
  const [pass, setPass] = useState<number>(0);
  const [selectedGridSize, setSelectedGridSize] = useState<number>(() =>
    Math.max(5, Math.min(10, initialGridSize))
  );
  const [selectedMode, setSelectedMode] = useState<SsdMode>(initialMode);
  const [packetMap, setPacketMap] = useState<Map<number, number>>(new Map()); // cellIdx -> labelNum
  const [expectedOrder, setExpectedOrder] = useState<number[]>([]); // ordered cellIdx sequence
  const [linkedCells, setLinkedCells] = useState<number[]>([]);
  const [glitchCells, setGlitchCells] = useState<Set<number>>(new Set());
  const [wrongCell, setWrongCell] = useState<number | null>(null);
  const [hoveredCell, setHoveredCell] = useState<number | null>(null);
  const [attempts, setAttempts] = useState<number>(1);
  const [missteps, setMissteps] = useState<number>(0);
  const [integrity, setIntegrity] = useState<number>(3);
  const [timeLeftMs, setTimeLeftMs] = useState<number>(22000);
  const [wipedReason, setWipedReason] = useState<string | null>(null);
  const startTimeRef = useRef<number>(performance.now());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const elevRef = useRef<Float32Array>(new Float32Array(100));

  // Story: 5->6->7 | Challenge: all 4 modes | Blitz: 3x5x5 sprint | Overclock: 6x6 high-speed
  const activeGridSize =
    variant === 'story'
      ? 5 + pass
      : variant === 'challenge'
        ? pass < 2
          ? 5
          : 6
        : variant === 'blitz'
          ? 5
          : variant === 'overclock'
            ? 6
            : selectedGridSize;
  const activeMode: SsdMode =
    variant === 'story'
      ? pass === 0
        ? 'sequential'
        : pass === 1
          ? 'parity'
          : 'countdown'
      : variant === 'challenge'
        ? ((['sequential', 'countdown', 'parity', 'overclock'] as const)[pass] ?? 'overclock')
        : variant === 'blitz'
          ? ((['sequential', 'countdown', 'overclock'] as const)[pass] ?? 'overclock')
          : variant === 'overclock'
            ? 'overclock'
            : selectedMode;

  const setupPass = useCallback(
    (pIdx: number, gSize: number, mode: SsdMode) => {
      const cellsCount = gSize * gSize;
      const packetCount = Math.min(
        cellsCount - 4,
        Math.max(8, gSize + (variant === 'challenge' ? 6 : 4) + pIdx * 2)
      );
      const glitchCount = Math.min(
        cellsCount - packetCount - 1,
        Math.max(3, Math.floor(gSize * (variant === 'challenge' ? 1.25 : 0.9)))
      );

      const cells = Array.from({ length: cellsCount }, (_, i) => i);
      const modeOffset = mode === 'sequential' ? 17 : mode === 'countdown' ? 41 : 73;
      const randomSalt = Math.floor(Math.random() * 0x7fffffff);
      let s = ((runSeed + pIdx * 1337 + gSize * 193 + modeOffset * 59) ^ randomSalt) >>> 0;
      for (let i = cells.length - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const j = s % (i + 1);
        [cells[i], cells[j]] = [cells[j], cells[i]];
      }

      const map = new Map<number, number>();
      const numToCell = new Map<number, number>();
      for (let k = 0; k < packetCount; k++) {
        const num = k + 1;
        map.set(cells[k], num);
        numToCell.set(num, cells[k]);
      }

      const order: number[] = [];
      if (mode === 'sequential') {
        for (let k = 1; k <= packetCount; k++) order.push(numToCell.get(k)!);
      } else if (mode === 'countdown') {
        for (let k = packetCount; k >= 1; k--) order.push(numToCell.get(k)!);
      } else {
        // Parity: Odd ascending (1,3,5...) then Even ascending (2,4,6...)
        for (let k = 1; k <= packetCount; k += 2) order.push(numToCell.get(k)!);
        for (let k = 2; k <= packetCount; k += 2) order.push(numToCell.get(k)!);
      }

      const glitches = new Set<number>();
      for (let g = packetCount; g < packetCount + glitchCount; g++) {
        glitches.add(cells[g]);
      }

      setPacketMap(map);
      setExpectedOrder(order);
      setLinkedCells([]);
      setGlitchCells(glitches);
      setWrongCell(null);
      const passTimeMs =
        variant === 'story' && storyDifficulty === 'easy'
          ? -1
          : variant === 'story' && storyDifficulty === 'normal'
            ? 45000
            : mode === 'overclock' || mode === 'countdown' || variant === 'challenge' || variant === 'blitz'
              ? 15000
              : 22000;
      setTimeLeftMs(passTimeMs);
    },
    [runSeed, variant, storyDifficulty]
  );

  const retrySsd = useCallback(() => {
    setIntegrity(3);
    setWipedReason(null);
    setMissteps(0);
    setAttempts((a) => a + 1);
    setPass(0);
    setupPass(0, activeGridSize, activeMode);
  }, [setupPass, activeGridSize, activeMode]);

  useEffect(() => {
    if (wipedReason || timeLeftMs < 0) return;
    const id = window.setInterval(() => {
      setTimeLeftMs((prev) => {
        if (prev < 0) return prev;
        if (prev <= 100) {
          window.clearInterval(id);
          sound.outOfMoves();
          setWipedReason('DEFRAG TIMEOUT // SECTOR WIPE');
          return 0;
        }
        return prev - 100;
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [wipedReason, pass, activeMode, timeLeftMs]);

  useEffect(() => {
    setupPass(pass, activeGridSize, activeMode);
  }, [pass, activeGridSize, activeMode, setupPass]);

  const handleCellTap = useCallback(
    (cellIdx: number) => {
      if (wipedReason) return;
      if (glitchCells.has(cellIdx)) {
        sound.outOfMoves();
        setWrongCell(cellIdx);
        setMissteps((m) => m + 1);
        setAttempts((a) => a + 1);
        const nextInt = integrity - 1;
        setIntegrity(nextInt);
        if (nextInt <= 0) {
          setWipedReason('SECTOR CORRUPTION // 0/3 INTEGRITY');
        }
        window.setTimeout(() => setWrongCell(null), 320);
        return;
      }

      if (!packetMap.has(cellIdx)) return;
      if (linkedCells.includes(cellIdx)) return;

      const targetCell = expectedOrder[linkedCells.length];
      if (cellIdx === targetCell) {
        const nextLinked = [...linkedCells, cellIdx];
        setLinkedCells(nextLinked);
        sound.collectNode(nextLinked.length);

        if (nextLinked.length === expectedOrder.length) {
          if (pass + 1 >= TOTAL_PASSES) {
            sound.win();
            onComplete({
              attempts,
              missteps,
              timeMs: Math.max(200, Math.round(performance.now() - startTimeRef.current)),
              gridSize: activeGridSize,
              ssdMode: activeMode,
            });
          } else {
            window.setTimeout(() => {
              setPass((p) => p + 1);
            }, 380);
          }
        }
      } else {
        sound.outOfMoves();
        setWrongCell(cellIdx);
        setMissteps((m) => m + 1);
        setAttempts((a) => a + 1);
        const nextInt = integrity - 1;
        setIntegrity(nextInt);
        if (nextInt <= 0) {
          setWipedReason('SECTOR CORRUPTION // 0/3 INTEGRITY');
        }
        window.setTimeout(() => setWrongCell(null), 350);
      }
    },
    [
      wipedReason,
      glitchCells,
      packetMap,
      linkedCells,
      expectedOrder,
      pass,
      TOTAL_PASSES,
      onComplete,
      attempts,
      missteps,
      activeGridSize,
      activeMode,
      integrity,
    ]
  );

  // 2.5D Isometric Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let rafId = 0;

    const render = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(260, Math.floor(rect.width));
      const h = Math.max(220, Math.floor(rect.height));
      const maxDpr = typeof navigator !== 'undefined' && navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4 ? 1.5 : 2;
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);

      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const n = activeGridSize;
      drawIsoMotherboardAndPlinth(ctx, w, h, n, sunlightMode, '#00FF88');

      const { tw, th, depth, cx, cy } = getIsoBoardMetrics(w, h, n);
      const half = (n - 1) / 2;
      const elevArr = elevRef.current;
      const linkedCenters: Array<{ x: number; y: number }> = [];

      // Painter's order: back-to-front by (r + c)
      for (let sum = 0; sum <= 2 * (n - 1); sum++) {
        for (let r = 0; r < n; r++) {
          const c = sum - r;
          if (c < 0 || c >= n) continue;
          const idx = r * n + c;

          const pkt = packetMap.get(idx);
          const isGlitch = glitchCells.has(idx);
          const isDone = linkedCells.includes(idx);
          const isWrong = wrongCell === idx;
          const isHovered = hoveredCell === idx && pkt !== undefined && !isDone;

          const targetElev = isWrong
            ? -depth * 0.2
            : isDone
              ? depth * 0.42
              : isHovered
                ? depth * 0.26
                : pkt !== undefined
                  ? depth * 0.14
                  : 0;
          elevArr[idx] = elevArr[idx] + (targetElev - elevArr[idx]) * 0.24;
          const z = elevArr[idx];

          const u = c - half;
          const v = r - half;
          const sx = cx + (u - v) * tw;
          const sy = cy + (u + v) * th - z;

          const gap = 0.9;
          const hw = tw * gap;
          const hh = th * gap;

          let topFill = sunlightMode ? '#F8FAFC' : '#101827';
          let leftFill = sunlightMode ? '#CBD5E1' : '#090F1A';
          let rightFill = sunlightMode ? '#94A3B8' : '#060B14';
          let strokeColor = sunlightMode ? '#64748B' : '#1E2D45';

          if (isWrong) {
            topFill = '#7F1D1D';
            leftFill = '#5C1111';
            rightFill = '#450A0A';
            strokeColor = '#FF4460';
          } else if (isGlitch) {
            topFill = sunlightMode ? '#FEE2E2' : '#2C0E18';
            leftFill = sunlightMode ? '#FECACA' : '#1D0810';
            rightFill = sunlightMode ? '#FCA5A5' : '#14050B';
            strokeColor = '#FF3B5C';
          } else if (isDone) {
            topFill = sunlightMode ? '#059669' : '#0B4635';
            leftFill = sunlightMode ? '#047857' : '#073125';
            rightFill = sunlightMode ? '#065F46' : '#052219';
            strokeColor = '#00FF88';
          } else if (pkt !== undefined) {
            topFill = isHovered
              ? sunlightMode
                ? '#BAE6FD'
                : '#143A52'
              : sunlightMode
                ? '#E0F2FE'
                : '#12263C';
            leftFill = sunlightMode ? '#93C5FD' : '#0B1A2B';
            rightFill = sunlightMode ? '#60A5FA' : '#081320';
            strokeColor = isHovered ? '#00F0FF' : '#0284C7';
          }

          // Top face diamond
          ctx.beginPath();
          ctx.moveTo(sx, sy - hh);
          ctx.lineTo(sx + hw, sy);
          ctx.lineTo(sx, sy + hh);
          ctx.lineTo(sx - hw, sy);
          ctx.closePath();
          ctx.fillStyle = topFill;
          ctx.fill();
          ctx.lineWidth = isDone || isGlitch || isWrong || isHovered ? 1.6 : 1;
          ctx.strokeStyle = strokeColor;
          ctx.stroke();

          // Left & right extruded faces
          ctx.beginPath();
          ctx.moveTo(sx - hw, sy);
          ctx.lineTo(sx, sy + hh);
          ctx.lineTo(sx, sy + hh + depth);
          ctx.lineTo(sx - hw, sy + depth);
          ctx.closePath();
          ctx.fillStyle = leftFill;
          ctx.fill();
          ctx.lineWidth = 0.8;
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(sx, sy + hh);
          ctx.lineTo(sx + hw, sy);
          ctx.lineTo(sx + hw, sy + depth);
          ctx.lineTo(sx, sy + hh + depth);
          ctx.closePath();
          ctx.fillStyle = rightFill;
          ctx.fill();
          ctx.stroke();

          // Isometric Engraved Packet Number / Bad-Sector Glyph
          ctx.save();
          ctx.translate(sx, sy);
          ctx.transform(hw / 20, hh / 20, -hw / 20, hh / 20, 0, 0);

          if (isGlitch) {
            ctx.font = '800 13px ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillText('ERR', -1, -1);
            ctx.fillStyle = '#FF5C77';
            ctx.fillText('ERR', 0, 0);
          } else if (pkt !== undefined) {
            const label = String(pkt).padStart(2, '0');
            ctx.font = '800 15px ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillText(label, -1, -1);
            ctx.fillStyle = isDone
              ? '#00FF88'
              : sunlightMode
                ? '#0F172A'
                : '#E2E8F0';
            ctx.fillText(label, 0, 0);
          }

          ctx.restore();
        }
      }

      // Draw Glowing NVMe Energy Bus connecting linked sectors in exact order
      if (linkedCells.length >= 2) {
        linkedCells.forEach((cellIdx) => {
          const r = Math.floor(cellIdx / n);
          const c = cellIdx % n;
          const u = c - half;
          const v = r - half;
          const z = elevArr[cellIdx];
          linkedCenters.push({
            x: cx + (u - v) * tw,
            y: cy + (u + v) * th - z,
          });
        });

        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0, 255, 136, 0.35)';
        ctx.lineWidth = Math.max(4, tw * 0.22);
        ctx.beginPath();
        linkedCenters.forEach((pt, i) => {
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();

        ctx.strokeStyle = '#00FF88';
        ctx.lineWidth = Math.max(1.8, tw * 0.08);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(rafId);
  }, [
    activeGridSize,
    glitchCells,
    hoveredCell,
    linkedCells,
    packetMap,
    sunlightMode,
    wrongCell,
  ]);

  const nextTargetCell = expectedOrder[linkedCells.length];
  const nextPacketNum = nextTargetCell !== undefined ? packetMap.get(nextTargetCell) : undefined;
  const modeLabel =
    activeMode === 'sequential'
      ? 'DEFRAG 01→N'
      : activeMode === 'countdown'
        ? 'PURGE N→01'
        : 'PARITY ODD→EVEN';

  return (
    <div className="w-full h-full flex flex-col items-center justify-between py-2.5 sm:py-4 gap-2 select-none relative">
      {/* Standalone Mode + Grid Size Controls (Daily only; Challenge/Overclock/Blitz are computer-assigned) */}
      {variant === 'daily' && (
        <div className="relative z-10 flex flex-wrap items-center justify-center gap-2 max-w-full px-2.5 shrink-0">
          <div
            role="group"
            aria-label="SSD mode"
            className="inline-flex items-center rounded-lg bg-[#0A111D] border border-slate-800 p-0.5 font-mono text-[10px]"
          >
            {(
              [
                { id: 'sequential', label: 'Defrag', Icon: ListOrdered },
                { id: 'countdown', label: 'Purge', Icon: ArrowDownUp },
                { id: 'parity', label: 'Parity', Icon: Binary },
                { id: 'overclock', label: 'Overclock', Icon: Zap },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setSelectedMode(id);
                  setPass(0);
                }}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors cursor-pointer ${
                  selectedMode === id
                    ? 'bg-[#102438] text-[#00F0FF] border border-[#00F0FF]/45 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3 h-3" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div
            role="group"
            aria-label="SSD grid size"
            className="inline-flex items-center rounded-lg bg-[#0A111D] border border-slate-800 p-0.5 font-mono text-[10px]"
          >
            {[5, 6, 7, 8, 9, 10].map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => {
                  setSelectedGridSize(sz);
                  setPass(0);
                }}
                className={`px-1.5 py-1 rounded-md transition-colors cursor-pointer ${
                  selectedGridSize === sz
                    ? 'bg-[#08241C] text-[#00FF88] border border-[#00FF88]/45 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {sz}×{sz}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Industrial Telemetry Header */}
      <div className="relative z-10 flex flex-col items-center shrink-0 w-full max-w-md px-2.5">
        <div className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded bg-[#070B12]/95 border border-slate-800 font-mono text-[11px] tabular-nums">
          <div className="flex items-center gap-1.5 text-slate-200 font-bold">
            <HardDrive className="w-3.5 h-3.5 text-[#00F0FF]" />
            <span>
              {TOTAL_PASSES > 1 ? `P${pass + 1}/${TOTAL_PASSES} · ` : ''}
              {activeGridSize}×{activeGridSize} · NEXT{' '}
              <strong className="text-[#00FF88]">
                #{nextPacketNum !== undefined ? String(nextPacketNum).padStart(2, '0') : '--'}
              </strong>
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1" title="Sector Integrity">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`w-2.5 h-2 rounded-xs ${
                    i < integrity
                      ? integrity === 1
                        ? 'bg-[#FF4460]'
                        : 'bg-[#00FF88]'
                      : 'bg-slate-800 border border-slate-700'
                  }`}
                />
              ))}
            </span>
            <span
              className={`font-bold ${
                timeLeftMs < 0
                  ? 'text-[#00FF88]'
                  : timeLeftMs <= 5000
                    ? 'text-[#FF4460] animate-pulse'
                    : 'text-[#00F0FF]'
              }`}
            >
              {timeLeftMs < 0 ? '∞' : `${(timeLeftMs / 1000).toFixed(1)}s`}
            </span>
          </div>
        </div>
      </div>

      {/* 2.5D Isometric NVMe Silicon Die Canvas (full width/fullscreen) */}
      <div ref={containerRef} className="w-full flex-1 min-h-[240px] relative">
        <canvas
          ref={canvasRef}
          onPointerMove={(e) =>
            setHoveredCell(pickIsoCellFromPointer(canvasRef.current, e.clientX, e.clientY, activeGridSize))
          }
          onPointerLeave={() => setHoveredCell(null)}
          onPointerDown={(e) => {
            if (wipedReason) return;
            const cell = pickIsoCellFromPointer(
              canvasRef.current,
              e.clientX,
              e.clientY,
              activeGridSize
            );
            if (cell !== null) handleCellTap(cell);
          }}
          className={`block w-full h-full touch-none ${
            hoveredCell !== null && packetMap.has(hoveredCell) && !linkedCells.includes(hoveredCell)
              ? 'cursor-pointer'
              : 'cursor-default'
          }`}
        />

        {wipedReason && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#060911]/90 backdrop-blur-xs p-4 text-center gap-3 font-mono">
            <div className="text-xs font-bold tracking-widest text-[#FF4460]">{wipedReason}</div>
            <button
              type="button"
              onClick={retrySsd}
              className="px-5 py-2 rounded bg-[#00F0FF] text-[#050B14] font-bold text-xs uppercase tracking-wider cursor-pointer hover:brightness-110"
            >
              Reboot SSD
            </button>
          </div>
        )}
      </div>

      {/* Footer Metrics */}
      <div className="relative z-10 flex items-center gap-4 font-mono text-xs text-slate-400 shrink-0 pb-1">
        <span>
          ATTEMPTS:{' '}
          <strong className={sunlightMode ? 'text-slate-900' : 'text-white'}>{attempts}</strong>
        </span>
        <span>
          MISSTEPS:{' '}
          <strong className={missteps === 0 ? 'text-[#00FF88]' : 'text-[#FFB800]'}>
            {missteps}
          </strong>
        </span>
        <span>
          SECTORS:{' '}
          <strong className="text-[#00FF88]">
            {linkedCells.length}/{expectedOrder.length}
          </strong>
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// 3. GPU CORE — 2.5D Perspective Photon Highway (3 Modes, Dynamic Obstacles)
// ============================================================================

type RaceEntityKind = 'shader' | 'firewall' | 'sweeper' | 'boost' | 'hole' | 'gate' | 'tunnel';

interface RaceEntity {
  lane: number;
  visualLane: number;
  span?: number; // 1..4 lanes wide (5 for overhead tunnel)
  phaseOffset?: number; // for rhythmic Time/Phase Gates
  nearMissed?: boolean;
  z: number; // 0 (horizon) .. 1.08 (past camera)
  kind: RaceEntityKind;
  shiftDir?: -1 | 1;
  shifted?: boolean;
}

export function GpuPhotonRaceGame({
  onComplete,
  variant = 'story',
  storyDifficulty = 'normal',
  initialMode = 'circuit',
  sunlightMode = false,
}: {
  onComplete: (res: ComponentResult) => void;
  variant?: 'story' | 'daily' | 'challenge' | 'overclock' | 'blitz';
  storyDifficulty?: 'easy' | 'normal' | 'hard';
  initialMode?: GpuMode;
  sunlightMode?: boolean;
}) {
  const TOTAL_LEGS = variant === 'challenge' ? 4 : variant === 'blitz' ? 3 : 1;
  const legModes: readonly GpuMode[] =
    variant === 'challenge'
      ? (['circuit', 'overdrive', 'gauntlet', 'overclock'] as const)
      : variant === 'blitz'
        ? (['circuit', 'overdrive', 'overclock'] as const)
        : variant === 'overclock'
          ? (['overclock'] as const)
          : variant === 'story'
            ? (['circuit'] as const)
            : ([initialMode] as const);

  const [legIdx, setLegIdx] = useState<number>(0);
  const [selectedMode, setSelectedMode] = useState<GpuMode>(initialMode);
  const activeMode: GpuMode =
    variant === 'daily'
      ? selectedMode
      : (legModes[legIdx] ?? legModes[0] ?? 'circuit');
  const laneCount = 5;
  const targetShaders =
    variant === 'story'
      ? storyDifficulty === 'easy'
        ? 12
        : storyDifficulty === 'normal'
          ? 16
          : 24
      : variant === 'challenge'
        ? 12
        : variant === 'blitz'
          ? 10
          : activeMode === 'overclock'
            ? 28
            : activeMode === 'circuit'
              ? 24
              : activeMode === 'overdrive'
                ? 30
                : 36;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const swipeRef = useRef<{ x: number; moved: boolean } | null>(null);
  const [collected, setCollected] = useState<number>(0);
  const [energy, setEnergy] = useState<number>(3);
  const [flowMult, setFlowMult] = useState<number>(1);
  const [phaseBanner, setPhaseBanner] = useState<string | null>(null);
  const [crashedOverlay, setCrashedOverlay] = useState<boolean>(false);
  const [attempts, setAttempts] = useState<number>(1);
  const [missteps, setMissteps] = useState<number>(0);
  const [shieldActive, setShieldActive] = useState<boolean>(false);
  const [hitFlash, setHitFlash] = useState<boolean>(false);

  const stateRef = useRef({
    lane: 2,
    visualX: 2,
    vx: 0,
    entities: [] as RaceEntity[],
    particles: [] as { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string; size: number }[],
    popups: [] as { x: number; y: number; text: string; color: string; life: number; maxLife: number }[],
    lastSpawnMs: 0,
    invulnUntil: 0,
    shieldUntil: 0,
    shakeUntil: 0,
    energy: 3,
    flowStreak: 0,
    flowMult: 1,
    phase: 1 as 1 | 2 | 3,
    crashed: false,
    collected: 0,
    attempts: 1,
    missteps: 0,
    done: false,
    startMs: performance.now(),
    laneCount: 5,
    targetShaders: 24,
    mode: 'circuit' as GpuMode,
    legIdx: 0,
    totalLegs: 1,
    legModes: ['circuit'] as readonly GpuMode[],
  });

  const retryRace = useCallback(() => {
    const s = stateRef.current;
    s.lane = Math.floor(s.laneCount / 2);
    s.visualX = s.lane;
    s.vx = 0;
    s.entities = [];
    s.particles = [];
    s.popups = [];
    s.lastSpawnMs = 0;
    s.invulnUntil = 0;
    s.shieldUntil = 0;
    s.shakeUntil = 0;
    s.energy = 3;
    s.flowStreak = 0;
    s.flowMult = 1;
    s.phase = 1;
    s.legIdx = 0;
    s.mode = s.legModes[0] ?? 'circuit';
    s.crashed = false;
    s.collected = 0;
    s.attempts += 1;
    s.done = false;
    s.startMs = performance.now();
    setLegIdx(0);
    setEnergy(3);
    setFlowMult(1);
    setPhaseBanner(null);
    setCrashedOverlay(false);
    setCollected(0);
    setAttempts(s.attempts);
    setShieldActive(false);
    setHitFlash(false);
  }, []);

  // Reset race cleanly when variant or manual mode changes (not on legIdx transitions!)
  useEffect(() => {
    const s = stateRef.current;
    const initialModes: readonly GpuMode[] =
      variant === 'challenge'
        ? (['circuit', 'overdrive', 'gauntlet', 'overclock'] as const)
        : variant === 'blitz'
          ? (['circuit', 'overdrive', 'overclock'] as const)
          : variant === 'overclock'
            ? (['overclock'] as const)
            : variant === 'story'
              ? (['circuit'] as const)
              : ([selectedMode] as const);
    s.legModes = initialModes;
    s.totalLegs = initialModes.length;
    s.legIdx = 0;
    s.laneCount = laneCount;
    s.targetShaders = targetShaders;
    s.mode = initialModes[0] ?? 'circuit';
    s.lane = Math.floor(laneCount / 2);
    s.visualX = s.lane;
    s.vx = 0;
    s.entities = [];
    s.particles = [];
    s.popups = [];
    s.lastSpawnMs = 0;
    s.invulnUntil = 0;
    s.shieldUntil = 0;
    s.shakeUntil = 0;
    s.energy = 3;
    s.flowStreak = 0;
    s.flowMult = 1;
    s.phase = 1;
    s.crashed = false;
    s.collected = 0;
    s.attempts = 1;
    s.missteps = 0;
    s.done = false;
    s.startMs = performance.now();
    setLegIdx(0);
    setEnergy(3);
    setFlowMult(1);
    setPhaseBanner(null);
    setCrashedOverlay(false);
    setCollected(0);
    setAttempts(1);
    setMissteps(0);
    setShieldActive(false);
  }, [variant, selectedMode, laneCount, targetShaders]);

  const moveLane = useCallback((delta: -1 | 1) => {
    const s = stateRef.current;
    if (s.done || s.crashed) return;
    const next = Math.max(0, Math.min(s.laneCount - 1, s.lane + delta));
    if (next !== s.lane) {
      s.lane = next;
      sound.step(true, 0);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (stateRef.current.crashed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        retryRace();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        moveLane(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        moveLane(1);
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [moveLane, retryRace]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let lastTime = performance.now();

    const loop = (now: number) => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(280, Math.floor(rect.width));
      const h = Math.max(240, Math.floor(rect.height));
      const maxDpr = typeof navigator !== 'undefined' && navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4 ? 1.5 : 2;
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }

      const dt = Math.min(50, Math.max(0, now - lastTime)) / 1000;
      lastTime = now;

      const s = stateRef.current;
      const lanes = s.laneCount;
      const playerZ = 0.86;
      const hasShield = now < s.shieldUntil;
      setShieldActive((prev) => (prev !== hasShield ? hasShield : prev));

      if (!s.done && !s.crashed) {
        // Snappy critically-damped steering (no spring oscillation)
        const prevVisualX = s.visualX;
        const steerAlpha = 1 - Math.exp(-16 * dt);
        s.visualX += (s.lane - s.visualX) * steerAlpha;
        const instantVx = dt > 0 ? (s.visualX - prevVisualX) / dt : 0;
        s.vx += (instantVx - s.vx) * Math.min(1, dt * 18);

        const spawnInterval =
          s.mode === 'gauntlet' ? 390 : s.mode === 'overdrive' ? 430 : 480;

        if (now - s.lastSpawnMs > spawnInterval) {
          s.lastSpawnMs = now;
          const roll = Math.random();

          // Occasional full-width architectural PCB Tunnel overhead
          if (Math.random() < 0.14) {
            s.entities.push({ lane: 0, visualLane: 0, span: lanes, z: 0.02, kind: 'tunnel' });
          }

          if (roll < 0.36) {
            // CPU-style Golden Spike (+1)
            const l1 = Math.floor(Math.random() * lanes);
            s.entities.push({ lane: l1, visualLane: l1, span: 1, z: 0.02, kind: 'shader' });
          } else if (roll < 0.45) {
            // Energy / Shield Cube (+1 HP + 2x Shield)
            const l1 = Math.floor(Math.random() * lanes);
            s.entities.push({ lane: l1, visualLane: l1, span: 1, z: 0.02, kind: 'boost' });
          } else if (roll < 0.68) {
            // Multi-lane Firewall Wall of length 2, 3, or 4 (always leaves >= 1 safe lane!)
            const wallSpan =
              s.mode === 'gauntlet'
                ? ([2, 3, 4][Math.floor(Math.random() * 3)] ?? 3)
                : s.mode === 'overdrive'
                  ? ([2, 3, 4][Math.floor(Math.random() * 3)] ?? 2)
                  : ([2, 3][Math.floor(Math.random() * 2)] ?? 2);
            const startLane = Math.floor(Math.random() * (lanes - wallSpan + 1));
            s.entities.push({
              lane: startLane,
              visualLane: startLane,
              span: wallSpan,
              z: 0.02,
              kind: 'firewall',
            });
            // Place a spike in one of the open lanes beside the wall for risk/reward!
            if (Math.random() < 0.65) {
              const openLanes: number[] = [];
              for (let k = 0; k < lanes; k++) {
                if (k < startLane || k >= startLane + wallSpan) openLanes.push(k);
              }
              if (openLanes.length > 0) {
                const safeL = openLanes[Math.floor(Math.random() * openLanes.length)]!;
                s.entities.push({ lane: safeL, visualLane: safeL, span: 1, z: 0.02, kind: 'shader' });
              }
            }
          } else if (roll < 0.82) {
            // Track Void Hole (1 or 2 lanes wide)
            const holeSpan = Math.random() < 0.45 ? 2 : 1;
            const startLane = Math.floor(Math.random() * (lanes - holeSpan + 1));
            s.entities.push({
              lane: startLane,
              visualLane: startLane,
              span: holeSpan,
              z: 0.02,
              kind: 'hole',
            });
          } else if (roll < 0.92) {
            // Time / Phase Gate (2 or 3 lanes wide, rhythmic OPEN/LOCKED)
            const gateSpan = Math.random() < 0.5 ? 3 : 2;
            const startLane = Math.floor(Math.random() * (lanes - gateSpan + 1));
            s.entities.push({
              lane: startLane,
              visualLane: startLane,
              span: gateSpan,
              phaseOffset: Math.random() * Math.PI * 2,
              z: 0.02,
              kind: 'gate',
            });
          } else {
            // Shifting Sweeper Drone
            const l1 = Math.floor(Math.random() * lanes);
            const dir: -1 | 1 = l1 === 0 ? 1 : l1 === lanes - 1 ? -1 : Math.random() < 0.5 ? -1 : 1;
            s.entities.push({
              lane: l1,
              visualLane: l1,
              span: 1,
              z: 0.02,
              kind: 'sweeper',
              shiftDir: dir,
              shifted: false,
            });
          }
        }

        const progressRatio = s.collected / s.targetShaders;
        const nextPhase: 1 | 2 | 3 = progressRatio >= 0.75 ? 3 : progressRatio >= 0.33 ? 2 : 1;
        if (nextPhase !== s.phase) {
          s.phase = nextPhase;
          setPhaseBanner(
            nextPhase === 2 ? 'PHASE 2 // HYPER-DRIVE' : 'PHASE 3 // OVERCLOCK SPRINT'
          );
          sound.collectNode(6);
          window.setTimeout(() => setPhaseBanner(null), 1600);
        }

        const baseSpeed =
          s.mode === 'gauntlet' ? 0.56 : s.mode === 'overdrive' ? 0.52 : 0.46;
        const phaseBoost = s.phase === 3 ? 0.2 : s.phase === 2 ? 0.1 : 0;
        const flowBoost = (s.flowMult - 1) * 0.035;
        const speed =
          baseSpeed + progressRatio * 0.16 + phaseBoost + flowBoost + (hasShield ? 0.06 : 0);

        const remaining: RaceEntity[] = [];
        for (const ent of s.entities) {
          ent.z += speed * dt;
          if (ent.z > 1.06) continue;

          // Shifting sweeper drone changes lane halfway down the highway!
          if (ent.kind === 'sweeper' && !ent.shifted && ent.z > 0.38 && ent.shiftDir) {
            ent.shifted = true;
            ent.lane = Math.max(0, Math.min(lanes - 1, ent.lane + ent.shiftDir));
          }
          ent.visualLane += (ent.lane - ent.visualLane) * Math.min(1, dt * 12);

          const entSpan = ent.span ?? 1;
          const hitsSpan =
            s.visualX >= ent.visualLane - 0.42 && s.visualX <= ent.visualLane + entSpan - 1 + 0.42;

          // Near-Miss Detection: passing a hazard in an adjacent lane without hitting it!
          if (
            !ent.nearMissed &&
            (ent.kind === 'firewall' || ent.kind === 'hole' || ent.kind === 'sweeper' || ent.kind === 'gate') &&
            ent.z > playerZ + 0.045 &&
            !hitsSpan
          ) {
            const leftAdj = Math.abs(s.visualX - (ent.visualLane - 1));
            const rightAdj = Math.abs(s.visualX - (ent.visualLane + entSpan));
            if (Math.min(leftAdj, rightAdj) < 0.85) {
              ent.nearMissed = true;
              s.flowStreak += 1;
              const nextMult = s.flowStreak >= 10 ? 4 : s.flowStreak >= 6 ? 3 : s.flowStreak >= 3 ? 2 : 1;
              if (nextMult !== s.flowMult) {
                s.flowMult = nextMult;
                setFlowMult(nextMult);
              }
              const px = w / 2 - (Math.min(w * 0.86, 660) * 0.82) / 2 + ((s.visualX + 0.5) / lanes) * (Math.min(w * 0.86, 660) * 0.82);
              s.popups.push({
                x: px,
                y: h * 0.76,
                text: nextMult > 1 ? `NEAR MISS! ×${nextMult}` : 'NEAR MISS!',
                color: nextMult >= 3 ? '#00FF88' : '#00F0FF',
                life: 0,
                maxLife: 0.75,
              });
            }
          }

          if (ent.kind !== 'tunnel' && Math.abs(ent.z - playerZ) < 0.056 && hitsSpan) {
            if (ent.kind === 'gate') {
              const gateOpen = Math.sin(now * 0.0036 + (ent.phaseOffset ?? 0)) > 0;
              if (gateOpen) {
                remaining.push(ent);
                continue;
              }
            }
            if (ent.kind === 'shader') {
              const gain = s.flowMult + (hasShield ? 1 : 0);
              s.collected += gain;
              s.collected = Math.min(s.targetShaders, s.collected);
              s.flowStreak += 1;
              const nextMult = s.flowStreak >= 10 ? 4 : s.flowStreak >= 6 ? 3 : s.flowStreak >= 3 ? 2 : 1;
              if (nextMult !== s.flowMult) {
                s.flowMult = nextMult;
                setFlowMult(nextMult);
              }
              setCollected(s.collected);
              sound.collectNode(Math.min(6, s.collected));
              if (gain > 1) {
                const px = w / 2 - (Math.min(w * 0.86, 660) * 0.82) / 2 + ((s.visualX + 0.5) / lanes) * (Math.min(w * 0.86, 660) * 0.82);
                s.popups.push({
                  x: px,
                  y: h * 0.75,
                  text: `+${gain}`,
                  color: '#FFD147',
                  life: 0,
                  maxLife: 0.6,
                });
              }
              if (s.collected >= s.targetShaders) {
                if (s.legIdx + 1 < s.totalLegs) {
                  s.legIdx += 1;
                  const nextLegMode = s.legModes[s.legIdx] ?? 'overclock';
                  s.mode = nextLegMode;
                  s.collected = 0;
                  s.phase = 1;
                  s.invulnUntil = now + 900;
                  setLegIdx(s.legIdx);
                  setCollected(0);
                  setPhaseBanner(`LEG ${s.legIdx + 1}/${s.totalLegs} // ${nextLegMode.toUpperCase()}`);
                  window.setTimeout(() => setPhaseBanner(null), 1600);
                  sound.collectNode(6);
                  break;
                }
                s.done = true;
                sound.win();
                onComplete({
                  attempts: s.attempts,
                  missteps: s.missteps,
                  timeMs: Math.max(500, Math.round(now - s.startMs)),
                  gpuMode: s.mode,
                });
                break;
              }
              continue;
            } else if (ent.kind === 'boost') {
              s.shieldUntil = now + 4000;
              if (s.energy < 3) {
                s.energy = Math.min(3, s.energy + 1);
                setEnergy(s.energy);
              }
              sound.collectNode(6);
              continue;
            } else if (now > s.invulnUntil) {
              if (hasShield) {
                // Shield absorbs hit!
                s.shieldUntil = 0;
                s.invulnUntil = now + 500;
                s.shakeUntil = now + 180;
                sound.step(false, 0);
                continue;
              }
              s.invulnUntil = now + 900;
              s.shakeUntil = now + 260;
              s.flowStreak = 0;
              s.flowMult = 1;
              setFlowMult(1);
              s.missteps += 1;
              s.energy = Math.max(0, s.energy - 1);
              setMissteps(s.missteps);
              setEnergy(s.energy);
              setHitFlash(true);
              sound.outOfMoves();
              window.setTimeout(() => setHitFlash(false), 300);

              // Spawn impact spark burst at bike position
              const hitX = w / 2 - (Math.min(w * 0.86, 660) * 0.82) / 2 + ((s.visualX + 0.5) / lanes) * (Math.min(w * 0.86, 660) * 0.82);
              const hitY = h * 0.84;
              const burstCount = s.energy <= 0 ? 36 : 12;
              for (let k = 0; k < burstCount; k++) {
                const ang = (Math.PI * 2 * k) / burstCount + Math.random() * 0.4;
                const spd = (s.energy <= 0 ? 110 : 70) + Math.random() * 210;
                s.particles.push({
                  x: hitX,
                  y: hitY,
                  vx: Math.cos(ang) * spd,
                  vy: Math.sin(ang) * spd - (s.energy <= 0 ? 40 : 0),
                  life: 0,
                  maxLife: s.energy <= 0 ? 0.75 : 0.38,
                  color: k % 3 === 0 ? '#00F0FF' : k % 3 === 1 ? '#FF4460' : '#FFB800',
                  size: s.energy <= 0 ? 3 + Math.random() * 4 : 2 + Math.random() * 2,
                });
              }

              if (s.energy <= 0) {
                s.crashed = true;
                s.shakeUntil = now + 450;
                window.setTimeout(() => setCrashedOverlay(true), 620);
              }
              continue;
            }
          }
          remaining.push(ent);
        }
        s.entities = remaining;
      }

      // ================================================================
      // 2.5D VANISHING-POINT MOTHERBOARD HIGHWAY RENDERING (Full-bleed)
      // ================================================================
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);
      if (now < s.shakeUntil) {
        const mag = s.crashed ? 8 : 5;
        ctx.translate((Math.random() - 0.5) * mag * 2, (Math.random() - 0.5) * mag * 2);
      }

      const fovKick = (s.flowMult - 1) * 0.04 + (s.phase === 3 ? 0.05 : 0);
      const horizonY = h * 0.19;
      const bottomY = h * 0.98;
      const topRoadW = Math.min(w * (0.22 - fovKick * 0.4), 175);
      const botRoadW = Math.min(w * (0.86 + fovKick * 0.5), 690);
      const cx = w / 2;

      // True 3D projection: both ground (elev=0) and raised (elev>0) converge to the horizon
      const project3D = (laneFloat: number, z: number, elevPx = 0) => {
        const clampedZ = Math.max(0.01, z);
        const p = Math.pow(clampedZ, 1.55);
        const yGround = horizonY + (bottomY - horizonY) * p;
        const roadW = topRoadW + (botRoadW - topRoadW) * p;
        const laneW = roadW / lanes;
        const x = cx - roadW / 2 + (laneFloat + 0.5) * laneW;
        const scale = 0.2 + 0.8 * p;
        const y = yGround - elevPx * scale;
        return { x, y, yGround, roadW, laneW, scale };
      };

      // 1. Deep Silicon Backdrop & Horizon Glow
      const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
      if (sunlightMode) {
        skyGrad.addColorStop(0, '#E2E8F0');
        skyGrad.addColorStop(0.25, '#CBD5E1');
        skyGrad.addColorStop(1, '#94A3B8');
      } else {
        skyGrad.addColorStop(0, '#04070F');
        skyGrad.addColorStop(0.22, '#0B1628');
        skyGrad.addColorStop(1, '#060A13');
      }
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, w, h);

      // Horizon core radial glow
      const hGlow = ctx.createRadialGradient(cx, horizonY, 10, cx, horizonY, Math.max(w * 0.45, 280));
      hGlow.addColorStop(
        0,
        s.mode === 'gauntlet'
          ? 'rgba(255, 68, 96, 0.22)'
          : s.mode === 'overdrive'
            ? 'rgba(0, 255, 136, 0.2)'
            : 'rgba(0, 240, 255, 0.22)'
      );
      hGlow.addColorStop(1, 'rgba(6, 10, 19, 0)');
      ctx.fillStyle = hGlow;
      ctx.fillRect(0, 0, w, h);

      // 2. Cohesive Motherboard Circuit Surroundings (perspective traces + scrolling 3D pillars)
      const scrollPhase = (now * 0.0024) % 1;
      ctx.lineWidth = 1;
      for (const side of [-1, 1]) {
        for (let i = 1; i <= 5; i++) {
          const xTop = cx + side * (topRoadW / 2 + i * 24);
          const xBot = cx + side * (botRoadW / 2 + i * 135);
          ctx.strokeStyle = sunlightMode
            ? 'rgba(15, 23, 42, 0.09)'
            : 'rgba(0, 240, 255, 0.08)';
          ctx.beginPath();
          ctx.moveTo(xTop, horizonY);
          ctx.lineTo(xBot, bottomY);
          ctx.stroke();

          // Traveling data pulse along outer motherboard traces
          const pt = (now * 0.00075 * (1 + i * 0.12) + i * 0.21) % 1;
          const pCurve = Math.pow(pt, 1.55);
          const pxPulse = xTop + (xBot - xTop) * pCurve;
          const pyPulse = horizonY + (bottomY - horizonY) * pCurve;
          ctx.fillStyle = i % 2 === 0 ? '#00F0FF' : '#00FF88';
          ctx.beginPath();
          ctx.arc(pxPulse, pyPulse, 1.4 + pCurve * 1.8, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 3. 2.5D PCIe Bus Highway Surface
      ctx.beginPath();
      ctx.moveTo(cx - topRoadW / 2, horizonY);
      ctx.lineTo(cx + topRoadW / 2, horizonY);
      ctx.lineTo(cx + botRoadW / 2, bottomY);
      ctx.lineTo(cx - botRoadW / 2, bottomY);
      ctx.closePath();
      ctx.fillStyle = sunlightMode ? '#F8FAFC' : '#070E1A';
      ctx.fill();

      // Scrolling horizontal perspective grid ribs
      ctx.strokeStyle = sunlightMode ? 'rgba(2, 132, 199, 0.18)' : 'rgba(0, 240, 255, 0.13)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 14; i++) {
        const z = (i / 14 + scrollPhase / 14) % 1;
        const p = Math.pow(z, 1.55);
        const y = horizonY + (bottomY - horizonY) * p;
        const rw = topRoadW + (botRoadW - topRoadW) * p;
        ctx.beginPath();
        ctx.moveTo(cx - rw / 2, y);
        ctx.lineTo(cx + rw / 2, y);
        ctx.stroke();
      }

      // Lane dividers
      ctx.strokeStyle = sunlightMode ? 'rgba(15, 23, 42, 0.22)' : 'rgba(0, 240, 255, 0.26)';
      ctx.lineWidth = 1.3;
      for (let l = 1; l < lanes; l++) {
        const frac = l / lanes - 0.5;
        ctx.beginPath();
        ctx.moveTo(cx + frac * topRoadW, horizonY);
        ctx.lineTo(cx + frac * botRoadW, bottomY);
        ctx.stroke();
      }

      // Outer glowing highway rails
      const railColor =
        s.mode === 'gauntlet' ? '#FF4460' : s.mode === 'overdrive' ? '#00FF88' : '#00F0FF';
      ctx.strokeStyle = railColor;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx - topRoadW / 2, horizonY);
      ctx.lineTo(cx - botRoadW / 2, bottomY);
      ctx.moveTo(cx + topRoadW / 2, horizonY);
      ctx.lineTo(cx + botRoadW / 2, bottomY);
      ctx.stroke();

      // Scrolling 3D Silicon Capacitors flanking the highway rails
      for (let i = 0; i < 6; i++) {
        const z = (i / 6 + scrollPhase / 6) % 1;
        if (z < 0.06) continue;
        for (const side of [-1, 1]) {
          const base = project3D(side === -1 ? -0.92 : lanes - 0.08, z, 0);
          const top = project3D(side === -1 ? -0.92 : lanes - 0.08, z, 28);
          const pw = Math.max(4, base.laneW * 0.24);
          ctx.fillStyle = sunlightMode ? '#64748B' : '#0F1C30';
          ctx.strokeStyle = sunlightMode ? '#475569' : 'rgba(0, 240, 255, 0.28)';
          ctx.lineWidth = 1;
          ctx.fillRect(top.x - pw / 2, top.y, pw, base.y - top.y);
          ctx.strokeRect(top.x - pw / 2, top.y, pw, base.y - top.y);
          ctx.fillStyle = railColor;
          ctx.fillRect(top.x - pw * 0.3, top.y + 2, pw * 0.6, 2.5);
        }
      }

      // 4. Draw 3D Entities back-to-front (sorted by z ascending)
      const sorted = [...s.entities].sort((a, b) => a.z - b.z);
      for (const ent of sorted) {
        const entSpan = ent.span ?? 1;
        const leftEdgeLane = ent.visualLane - 0.42;
        const rightEdgeLane = ent.visualLane + entSpan - 1 + 0.42;

        if (ent.kind === 'shader') {
          // CPU-Matched Golden Crystal Diamond Node (exact match to isoRenderer.ts)
          const g = project3D(ent.visualLane, ent.z, 0);
          const lift = 18 + Math.sin(now * 0.006 + ent.z * 7) * 5;
          const pos = project3D(ent.visualLane, ent.z, lift);
          const r = Math.max(5.5, g.laneW * 0.22);

          // Ground radial glow (matching CPU node aura)
          const grad = ctx.createRadialGradient(g.x, g.y, 1, g.x, g.y, r * 1.45);
          grad.addColorStop(0, 'rgba(255, 184, 0, 0.55)');
          grad.addColorStop(1, 'rgba(255, 184, 0, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(g.x, g.y, r * 1.35, r * 0.55, 0, 0, Math.PI * 2);
          ctx.fill();

          // Left crystal facet (#FFD147)
          ctx.beginPath();
          ctx.moveTo(pos.x, pos.y - r * 1.25);
          ctx.lineTo(pos.x - r * 0.78, pos.y);
          ctx.lineTo(pos.x, pos.y + r * 1.05);
          ctx.closePath();
          ctx.fillStyle = '#FFD147';
          ctx.fill();

          // Right crystal facet (#E59400)
          ctx.beginPath();
          ctx.moveTo(pos.x, pos.y - r * 1.25);
          ctx.lineTo(pos.x + r * 0.78, pos.y);
          ctx.lineTo(pos.x, pos.y + r * 1.05);
          ctx.closePath();
          ctx.fillStyle = '#E59400';
          ctx.fill();

          // Specular core highlight
          ctx.beginPath();
          ctx.moveTo(pos.x, pos.y - r * 0.85);
          ctx.lineTo(pos.x - r * 0.32, pos.y);
          ctx.lineTo(pos.x, pos.y + r * 0.45);
          ctx.lineTo(pos.x + r * 0.2, pos.y);
          ctx.closePath();
          ctx.fillStyle = '#FFFBEB';
          ctx.fill();
        } else if (ent.kind === 'boost') {
          // 3D Energy/Shield Cube Pad with Two Glowing Arrows Embedded Inside
          const dz = 0.028;
          const zBack = Math.max(0.01, ent.z - dz);
          const zFront = Math.min(1.06, ent.z + dz);
          const hCube = 14;

          const fBL = project3D(ent.visualLane - 0.38, zFront, 0);
          const fBR = project3D(ent.visualLane + 0.38, zFront, 0);
          const fTL = project3D(ent.visualLane - 0.38, zFront, hCube);
          const fTR = project3D(ent.visualLane + 0.38, zFront, hCube);
          const bTL = project3D(ent.visualLane - 0.38, zBack, hCube);
          const bTR = project3D(ent.visualLane + 0.38, zBack, hCube);

          // Front face of Energy Cube
          ctx.fillStyle = '#064E3B';
          ctx.beginPath();
          ctx.moveTo(fTL.x, fTL.y);
          ctx.lineTo(fTR.x, fTR.y);
          ctx.lineTo(fBR.x, fBR.y);
          ctx.lineTo(fBL.x, fBL.y);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#00FF88';
          ctx.lineWidth = 1.2;
          ctx.stroke();

          // Top face of Energy Cube
          ctx.fillStyle = '#062C24';
          ctx.beginPath();
          ctx.moveTo(bTL.x, bTL.y);
          ctx.lineTo(bTR.x, bTR.y);
          ctx.lineTo(fTR.x, fTR.y);
          ctx.lineTo(fTL.x, fTL.y);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#00FF88';
          ctx.lineWidth = 1.3;
          ctx.stroke();

          // Two glowing chevrons/arrows embedded inside the top cube face
          for (const zOff of [-0.008, 0.01]) {
            const pTip = project3D(ent.visualLane, ent.z + zOff - 0.011, hCube + 0.5);
            const pLeft = project3D(ent.visualLane - 0.22, ent.z + zOff + 0.007, hCube + 0.5);
            const pRight = project3D(ent.visualLane + 0.22, ent.z + zOff + 0.007, hCube + 0.5);
            ctx.strokeStyle = zOff < 0 ? '#00FF88' : '#67E8F9';
            ctx.lineWidth = Math.max(1.5, fTR.laneW * 0.045);
            ctx.beginPath();
            ctx.moveTo(pLeft.x, pLeft.y);
            ctx.lineTo(pTip.x, pTip.y);
            ctx.lineTo(pRight.x, pRight.y);
            ctx.stroke();
          }
        } else if (ent.kind === 'hole') {
          // Track Void Hole (Broken Sector Chasm with Glowing Crimson Rim)
          const dz = 0.032;
          const zBack = Math.max(0.01, ent.z - dz);
          const zFront = Math.min(1.06, ent.z + dz);

          const bL = project3D(leftEdgeLane, zBack, 0);
          const bR = project3D(rightEdgeLane, zBack, 0);
          const fR = project3D(rightEdgeLane, zFront, 0);
          const fL = project3D(leftEdgeLane, zFront, 0);

          // Deep void cutout
          ctx.fillStyle = '#020307';
          ctx.beginPath();
          ctx.moveTo(bL.x, bL.y);
          ctx.lineTo(bR.x, bR.y);
          ctx.lineTo(fR.x, fR.y);
          ctx.lineTo(fL.x, fL.y);
          ctx.closePath();
          ctx.fill();

          // Exposed inner wall depth at back of hole
          const innerDrop = Math.max(6, fL.scale * 16);
          ctx.fillStyle = '#1E0810';
          ctx.beginPath();
          ctx.moveTo(bL.x, bL.y);
          ctx.lineTo(bR.x, bR.y);
          ctx.lineTo(bR.x, Math.min(fR.y, bR.y + innerDrop));
          ctx.lineTo(bL.x, Math.min(fL.y, bL.y + innerDrop));
          ctx.closePath();
          ctx.fill();

          // Jagged glowing crimson perimeter
          ctx.strokeStyle = '#FF4460';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(bL.x, bL.y);
          ctx.lineTo(bR.x, bR.y);
          ctx.lineTo(fR.x, fR.y);
          ctx.lineTo(fL.x, fL.y);
          ctx.closePath();
          ctx.stroke();
        } else if (ent.kind === 'gate') {
          // Rhythmic Time / Phase Gate (OPEN cyan/emerald vs LOCKED crimson lasers)
          const gateOpen = Math.sin(now * 0.0036 + (ent.phaseOffset ?? 0)) > 0;
          const hGate = 54;
          const gL = project3D(leftEdgeLane, ent.z, 0);
          const gR = project3D(rightEdgeLane, ent.z, 0);
          const tL = project3D(leftEdgeLane, ent.z, hGate);
          const tR = project3D(rightEdgeLane, ent.z, hGate);
          const gateCol = gateOpen ? '#00FF88' : '#FF4460';
          const pW = Math.max(4, gL.laneW * 0.16);

          // Left & Right Gate Pylons
          ctx.fillStyle = '#0F172A';
          ctx.strokeStyle = gateCol;
          ctx.lineWidth = 1.4;
          ctx.fillRect(tL.x - pW / 2, tL.y, pW, gL.y - tL.y);
          ctx.strokeRect(tL.x - pW / 2, tL.y, pW, gL.y - tL.y);
          ctx.fillRect(tR.x - pW / 2, tR.y, pW, gR.y - tR.y);
          ctx.strokeRect(tR.x - pW / 2, tR.y, pW, gR.y - tR.y);

          // Overhead Arch Bar
          ctx.fillStyle = gateOpen ? '#064E3B' : '#7F1D1D';
          ctx.fillRect(tL.x - pW / 2, tL.y - 6, tR.x - tL.x + pW, 7);
          ctx.strokeRect(tL.x - pW / 2, tL.y - 6, tR.x - tL.x + pW, 7);

          // Laser Curtain when LOCKED, faint pass-through frame when OPEN
          if (!gateOpen) {
            ctx.fillStyle = 'rgba(255, 68, 96, 0.24)';
            ctx.fillRect(tL.x, tL.y, tR.x - tL.x, gL.y - tL.y);
            ctx.strokeStyle = '#FF5C77';
            ctx.lineWidth = 2.2;
            for (const frac of [0.28, 0.54, 0.78]) {
              const ly = tL.y + (gL.y - tL.y) * frac;
              ctx.beginPath();
              ctx.moveTo(tL.x, ly);
              ctx.lineTo(tR.x, ly);
              ctx.stroke();
            }
          } else {
            ctx.fillStyle = 'rgba(0, 255, 136, 0.08)';
            ctx.fillRect(tL.x, tL.y, tR.x - tL.x, gL.y - tL.y);
          }
        } else if (ent.kind === 'tunnel') {
          // Architectural Cyber Overpass Tunnel (spans entire 5-lane highway)
          const dz = 0.04;
          const zBack = Math.max(0.01, ent.z - dz);
          const zFront = Math.min(1.06, ent.z + dz);
          const hArch = 78;

          const fL = project3D(-0.52, zFront, 0);
          const fR = project3D(lanes - 0.48, zFront, 0);
          const fTL = project3D(-0.52, zFront, hArch);
          const fTR = project3D(lanes - 0.48, zFront, hArch);

          const bL = project3D(-0.52, zBack, 0);
          const bR = project3D(lanes - 0.48, zBack, 0);
          const bTL = project3D(-0.52, zBack, hArch);
          const bTR = project3D(lanes - 0.48, zBack, hArch);

          // Tunnel roof & side structural ribs
          ctx.fillStyle = sunlightMode ? 'rgba(30, 41, 59, 0.25)' : 'rgba(11, 22, 42, 0.72)';
          ctx.beginPath();
          ctx.moveTo(bTL.x, bTL.y);
          ctx.lineTo(bTR.x, bTR.y);
          ctx.lineTo(fTR.x, fTR.y);
          ctx.lineTo(fTL.x, fTL.y);
          ctx.closePath();
          ctx.fill();

          ctx.strokeStyle = 'rgba(0, 240, 255, 0.42)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(fL.x, fL.y);
          ctx.lineTo(fTL.x, fTL.y);
          ctx.lineTo(fTR.x, fTR.y);
          ctx.lineTo(fR.x, fR.y);
          ctx.moveTo(bL.x, bL.y);
          ctx.lineTo(bTL.x, bTL.y);
          ctx.lineTo(bTR.x, bTR.y);
          ctx.lineTo(bR.x, bR.y);
          ctx.stroke();
        } else {
          // Multi-Lane 3D Firewall Wall (2, 3, 4 lanes wide) or Sweeper Drone
          const isSweeper = ent.kind === 'sweeper';
          const dz = 0.024;
          const zBack = Math.max(0.01, ent.z - dz);
          const zFront = Math.min(1.06, ent.z + dz);
          const boxHeightPx = isSweeper ? 36 : 42;

          const fBL = project3D(leftEdgeLane, zFront, 0);
          const fBR = project3D(rightEdgeLane, zFront, 0);
          const fTL = project3D(leftEdgeLane, zFront, boxHeightPx);
          const fTR = project3D(rightEdgeLane, zFront, boxHeightPx);

          const bBL = project3D(leftEdgeLane, zBack, 0);
          const bBR = project3D(rightEdgeLane, zBack, 0);
          const bTL = project3D(leftEdgeLane, zBack, boxHeightPx);
          const bTR = project3D(rightEdgeLane, zBack, boxHeightPx);

          const topCol = isSweeper ? '#F97316' : '#EF4444';
          const frontCol = isSweeper ? '#9A3412' : '#991B1B';
          const sideCol = isSweeper ? '#7C2D12' : '#7F1D1D';
          const edgeCol = isSweeper ? '#FDBA74' : '#FCA5A5';

          // Ground shadow
          ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
          ctx.beginPath();
          ctx.moveTo(bBL.x, bBL.y);
          ctx.lineTo(bBR.x, bBR.y);
          ctx.lineTo(fBR.x, fBR.y + 3);
          ctx.lineTo(fBL.x, fBL.y + 3);
          ctx.closePath();
          ctx.fill();

          // Visible inner side face
          const midLane = ent.visualLane + (entSpan - 1) / 2;
          const laneOffsetFromCenter = midLane - (lanes - 1) / 2;
          if (laneOffsetFromCenter > 0.05) {
            ctx.fillStyle = sideCol;
            ctx.beginPath();
            ctx.moveTo(bBL.x, bBL.y);
            ctx.lineTo(fBL.x, fBL.y);
            ctx.lineTo(fTL.x, fTL.y);
            ctx.lineTo(bTL.x, bTL.y);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = edgeCol;
            ctx.lineWidth = 0.9;
            ctx.stroke();
          } else if (laneOffsetFromCenter < -0.05) {
            ctx.fillStyle = sideCol;
            ctx.beginPath();
            ctx.moveTo(fBR.x, fBR.y);
            ctx.lineTo(bBR.x, bBR.y);
            ctx.lineTo(bTR.x, bTR.y);
            ctx.lineTo(fTR.x, fTR.y);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = edgeCol;
            ctx.lineWidth = 0.9;
            ctx.stroke();
          }

          // Top face
          ctx.fillStyle = topCol;
          ctx.beginPath();
          ctx.moveTo(bTL.x, bTL.y);
          ctx.lineTo(bTR.x, bTR.y);
          ctx.lineTo(fTR.x, fTR.y);
          ctx.lineTo(fTL.x, fTL.y);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = edgeCol;
          ctx.lineWidth = 1;
          ctx.stroke();

          // Front face + glowing energy core bar
          ctx.fillStyle = frontCol;
          ctx.beginPath();
          ctx.moveTo(fTL.x, fTL.y);
          ctx.lineTo(fTR.x, fTR.y);
          ctx.lineTo(fBR.x, fBR.y);
          ctx.lineTo(fBL.x, fBL.y);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = edgeCol;
          ctx.lineWidth = 1.2;
          ctx.stroke();

          // Glowing hazard core strip across full wall width
          const midYTop = fTL.y + (fBL.y - fTL.y) * 0.34;
          const midYBot = fTL.y + (fBL.y - fTL.y) * 0.62;
          ctx.fillStyle = isSweeper ? '#FDE047' : '#FF5C77';
          ctx.fillRect(
            fTL.x + (fTR.x - fTL.x) * 0.06,
            midYTop,
            (fTR.x - fTL.x) * 0.88,
            Math.max(2, midYBot - midYTop)
          );
        }
      }

      // 5. Player Top-Down Aerodynamic Light Cycle (Perspective-Aligned + Banking Physics)
      const hoverBob = Math.sin(now * 0.01) * 1.2;
      const pGround = project3D(s.visualX, playerZ, 0);
      const pAhead = project3D(s.visualX, playerZ - 0.08, 0);
      const pBike = project3D(s.visualX, playerZ, 6 + hoverBob);
      const isInvuln = now < s.invulnUntil;
      const bikeScale = Math.max(0.7, Math.min(1.3, pGround.laneW / 78));
      const laneAngle = Math.atan2(pAhead.x - pGround.x, pGround.y - pAhead.y);
      const bankAngle = Math.max(-0.34, Math.min(0.34, s.vx * 0.065));
      const neonCol = hasShield ? '#00FF88' : s.energy === 1 ? '#FF5C77' : '#00F0FF';

      if (!s.crashed && (!isInvuln || Math.floor(now / 80) % 2 === 0)) {
        // Ground shadow directly beneath light cycle
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.beginPath();
        ctx.ellipse(pGround.x, pGround.y + 4, 16 * bikeScale, 30 * bikeScale, laneAngle + bankAngle * 0.35, 0, Math.PI * 2);
        ctx.fill();

        // Tron Light Ribbon Trail aligned with the perspective lane behind rear tire
        const trailEnd = project3D(s.visualX, 1.05, 0);
        const trailGrad = ctx.createLinearGradient(pBike.x, pBike.y + 20 * bikeScale, trailEnd.x, bottomY);
        trailGrad.addColorStop(0, hasShield ? 'rgba(0, 255, 136, 0.95)' : s.energy === 1 ? 'rgba(255, 92, 119, 0.9)' : 'rgba(0, 240, 255, 0.95)');
        trailGrad.addColorStop(1, 'rgba(0, 240, 255, 0)');
        ctx.strokeStyle = trailGrad;
        ctx.lineWidth = 5 * bikeScale;
        ctx.beginPath();
        ctx.moveTo(pBike.x, pBike.y + 20 * bikeScale);
        ctx.lineTo(trailEnd.x, bottomY);
        ctx.stroke();

        // Draw Top-Down Light Cycle aligned to lane perspective + steering bank
        ctx.save();
        ctx.translate(pBike.x, pBike.y);
        ctx.rotate(laneAngle + bankAngle * 0.55);
        ctx.scale(bikeScale, bikeScale);

        // 5a. Rear Wide Tire (extending out the back, per blueprint)
        ctx.fillStyle = '#1E293B';
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.roundRect(-7, 13, 14, 18, 4);
        ctx.fill();
        ctx.stroke();

        // Glowing Neon Center Stripe on Rear Tire
        ctx.fillStyle = neonCol;
        ctx.fillRect(-1.8, 14, 3.6, 17);

        // 5b. Dark Rear Swingarm & Twin Thruster Pods
        ctx.fillStyle = '#0F172A';
        ctx.beginPath();
        ctx.moveTo(-12, 16);
        ctx.lineTo(-10, 4);
        ctx.lineTo(10, 4);
        ctx.lineTo(12, 16);
        ctx.lineTo(7, 19);
        ctx.lineTo(-7, 19);
        ctx.closePath();
        ctx.fill();

        // 5c. Front Hubless Wheel Shroud / Wide Nose Fairing
        ctx.fillStyle = '#CBD5E1';
        ctx.strokeStyle = '#64748B';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(-14, -27, 28, 16, 6);
        ctx.fill();
        ctx.stroke();

        // 5d. Main Sculpted Aerodynamic Teardrop Body (White/Silver Metallic)
        const bodyGrad = ctx.createLinearGradient(-15, 0, 15, 0);
        bodyGrad.addColorStop(0, '#94A3B8');
        bodyGrad.addColorStop(0.28, '#F8FAFC');
        bodyGrad.addColorStop(0.55, '#FFFFFF');
        bodyGrad.addColorStop(1, '#CBD5E1');
        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.moveTo(0, -25);
        ctx.bezierCurveTo(14, -23, 16, -6, 13, 6);
        ctx.bezierCurveTo(11, 13, 7, 16, 0, 16);
        ctx.bezierCurveTo(-7, 16, -11, 13, -13, 6);
        ctx.bezierCurveTo(-16, -6, -14, -23, 0, -25);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = neonCol;
        ctx.lineWidth = 1.4;
        ctx.stroke();

        // 5e. Dark Tinted Aerodynamic Canopy (Cockpit Visor)
        const visorGrad = ctx.createLinearGradient(0, -18, 0, 6);
        visorGrad.addColorStop(0, '#020617');
        visorGrad.addColorStop(0.5, '#0F172A');
        visorGrad.addColorStop(1, '#1E293B');
        ctx.fillStyle = visorGrad;
        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.bezierCurveTo(9, -17, 10, -5, 7, 5);
        ctx.lineTo(-7, 5);
        ctx.bezierCurveTo(-10, -5, -9, -17, 0, -18);
        ctx.closePath();
        ctx.fill();

        // Canopy neon cyan rim & specular reflection
        ctx.strokeStyle = neonCol;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-4, -14);
        ctx.quadraticCurveTo(0, -16, 4, -14);
        ctx.stroke();

        // 5f. Side Cyan Intake Triangles (Blueprint detail)
        ctx.fillStyle = neonCol;
        ctx.beginPath();
        ctx.moveTo(-12, 3);
        ctx.lineTo(-9, 8);
        ctx.lineTo(-13, 10);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(12, 3);
        ctx.lineTo(9, 8);
        ctx.lineTo(13, 10);
        ctx.closePath();
        ctx.fill();

        // Shield aura ring when Energy Boost is active
        if (hasShield) {
          ctx.strokeStyle = 'rgba(0, 255, 136, 0.75)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(0, -2, 22, 34, 0, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.restore();
      }

      // 6. Update & Render Sparks / Explosion Shards + Hyper-Speedlines + Popups
      if (s.particles.length > 0) {
        const aliveParticles: typeof s.particles = [];
        for (const pt of s.particles) {
          pt.life += dt;
          if (pt.life >= pt.maxLife) continue;
          pt.x += pt.vx * dt;
          pt.y += pt.vy * dt;
          pt.vx *= Math.exp(-3.5 * dt);
          pt.vy *= Math.exp(-3.5 * dt);
          const alpha = Math.max(0, 1 - pt.life / pt.maxLife);
          ctx.globalAlpha = alpha;
          ctx.fillStyle = pt.color;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
          ctx.fill();
          aliveParticles.push(pt);
        }
        ctx.globalAlpha = 1;
        s.particles = aliveParticles;
      }

      if (!s.crashed && (s.flowMult >= 2 || s.phase === 3)) {
        const lineCount = s.phase === 3 ? 14 : 8;
        ctx.strokeStyle = s.phase === 3 ? 'rgba(0, 255, 136, 0.32)' : 'rgba(0, 240, 255, 0.24)';
        ctx.lineWidth = 1.4;
        for (let i = 0; i < lineCount; i++) {
          const side = i % 2 === 0 ? -1 : 1;
          const phase = ((now * 0.0045 + i * 0.37) % 1);
          const ang = (0.35 + (i % 4) * 0.14) * side;
          const r1 = 90 + phase * (w * 0.45);
          const r2 = r1 + 38 + s.flowMult * 12;
          ctx.beginPath();
          ctx.moveTo(cx + Math.sin(ang) * r1, horizonY + Math.cos(ang) * r1 * 0.65);
          ctx.lineTo(cx + Math.sin(ang) * r2, horizonY + Math.cos(ang) * r2 * 0.65);
          ctx.stroke();
        }
      }

      if (s.popups.length > 0) {
        const alivePopups: typeof s.popups = [];
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        for (const pop of s.popups) {
          pop.life += dt;
          if (pop.life >= pop.maxLife) continue;
          pop.y -= 36 * dt;
          ctx.globalAlpha = Math.max(0, 1 - pop.life / pop.maxLife);
          ctx.fillStyle = pop.color;
          ctx.fillText(pop.text, pop.x, pop.y);
          alivePopups.push(pop);
        }
        ctx.globalAlpha = 1;
        s.popups = alivePopups;
      }

      ctx.restore();
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [onComplete, sunlightMode]);

  const modeLabel =
    activeMode === 'overclock'
      ? `${TOTAL_LEGS > 1 ? `LEG ${legIdx + 1}/${TOTAL_LEGS} · ` : ''}OVERCLOCK SPRINT`
      : activeMode === 'circuit'
        ? `${TOTAL_LEGS > 1 ? `LEG ${legIdx + 1}/${TOTAL_LEGS} · ` : ''}SHADER SPRINT`
        : activeMode === 'overdrive'
          ? `${TOTAL_LEGS > 1 ? `LEG ${legIdx + 1}/${TOTAL_LEGS} · ` : ''}TURBO OVERDRIVE`
          : `${TOTAL_LEGS > 1 ? `LEG ${legIdx + 1}/${TOTAL_LEGS} · ` : ''}FIREWALL GAUNTLET`;

  return (
    <div className="w-full h-full flex flex-col items-center justify-between py-2.5 sm:py-4 gap-2 select-none relative">
      {/* Standalone Mode Selector (Daily only; Challenge/Overclock/Blitz are computer-assigned) */}
      {variant === 'daily' && (
        <div className="relative z-10 flex flex-wrap items-center justify-center gap-2 px-2.5 shrink-0">
          <div
            role="group"
            aria-label="GPU race mode"
            className="inline-flex items-center rounded-lg bg-[#0A111D] border border-slate-800 p-0.5 font-mono text-[10px]"
          >
            {(
              [
                { id: 'circuit', label: 'Circuit', Icon: Gauge },
                { id: 'overdrive', label: 'Overdrive', Icon: Zap },
                { id: 'gauntlet', label: 'Gauntlet', Icon: Flame },
                { id: 'overclock', label: 'Overclock', Icon: Cpu },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSelectedMode(id)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                  selectedMode === id
                    ? 'bg-[#241338] text-[#C084FC] border border-[#C084FC]/45 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3 h-3" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Industrial Telemetry Header */}
      <div className="relative z-10 flex flex-col items-center shrink-0 w-full max-w-md px-2.5">
        <div
          className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded border font-mono text-[11px] tabular-nums transition-colors ${
            hitFlash
              ? 'bg-[#2C131C] border-[#FF4460] text-[#FF8FA3]'
              : 'bg-[#070B12]/95 border-slate-800 text-slate-200'
          }`}
        >
          <div className="flex items-center gap-1.5 font-bold truncate">
            <MonitorPlay className="w-3.5 h-3.5 text-[#00F0FF] shrink-0" />
            <span className="truncate">
              {modeLabel} · <strong className="text-[#FFB800]">{collected}/{targetShaders}</strong>
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {flowMult > 1 && (
              <span className="text-[#00F0FF] font-bold">×{flowMult}</span>
            )}
            {shieldActive && (
              <span className="text-[#00FF88] font-bold">SHIELD</span>
            )}
            <span className="inline-flex items-center gap-1 pl-1.5 border-l border-slate-700/80" title="Cycle Energy">
              {[0, 1, 2].map((idx) => (
                <span
                  key={idx}
                  className={`w-2.5 h-2 rounded-xs transition-colors ${
                    idx < energy
                      ? energy === 1
                        ? 'bg-[#FF4460]'
                        : 'bg-[#00FF88]'
                      : 'bg-slate-800 border border-slate-700'
                  }`}
                />
              ))}
            </span>
          </div>
        </div>
      </div>

      {/* Full-bleed 2.5D Perspective Highway Canvas */}
      <div ref={containerRef} className="w-full flex-1 min-h-[240px] relative">
        <canvas
          ref={canvasRef}
          onPointerDown={(e) => {
            if (stateRef.current.crashed) return;
            swipeRef.current = { x: e.clientX, moved: false };
          }}
          onPointerMove={(e) => {
            if (!swipeRef.current || stateRef.current.crashed) return;
            const dx = e.clientX - swipeRef.current.x;
            if (Math.abs(dx) > 24) {
              moveLane(dx < 0 ? -1 : 1);
              swipeRef.current = { x: e.clientX, moved: true };
            }
          }}
          onPointerUp={(e) => {
            if (stateRef.current.crashed) {
              swipeRef.current = null;
              return;
            }
            if (swipeRef.current && !swipeRef.current.moved) {
              const rect = e.currentTarget.getBoundingClientRect();
              const relX = e.clientX - rect.left;
              if (relX < rect.width * 0.5) moveLane(-1);
              else moveLane(1);
            }
            swipeRef.current = null;
          }}
          onPointerCancel={() => {
            swipeRef.current = null;
          }}
          className="block w-full h-full touch-none cursor-pointer"
        />

        {/* Phase Transition Banner */}
        {phaseBanner && !crashedOverlay && (
          <div className="pointer-events-none absolute top-4 inset-x-0 z-10 flex justify-center">
            <div className="px-4 py-1.5 rounded-full bg-[#060911]/90 border border-[#00F0FF]/60 font-mono text-xs font-bold tracking-widest text-[#00F0FF] shadow-[0_0_20px_rgba(0,240,255,0.45)] animate-pulse">
              {phaseBanner}
            </div>
          </div>
        )}

        {/* Crash / Explosion Overlay */}
        {crashedOverlay && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#060911]/85 backdrop-blur-xs p-4 text-center gap-3">
            <div className="font-mono text-xs font-bold tracking-widest text-[#FF4460] uppercase">
              CYCLE DESTROYED · 0/3 ENERGY
            </div>
            <p className="text-xs text-slate-300 max-w-xs">
              Firewall impacts overloaded your Light Cycle. Reboot and collect {targetShaders} spikes to clear the sector.
            </p>
            <button
              type="button"
              onClick={retryRace}
              className="px-5 py-2 rounded-lg bg-gradient-to-r from-[#00F0FF] to-[#00FF88] text-[#050B14] font-bold text-xs uppercase tracking-wide cursor-pointer shadow-[0_0_20px_rgba(0,240,255,0.4)] hover:brightness-110"
            >
              Retry Race
            </button>
          </div>
        )}
      </div>

      {/* Footer Metrics */}
      <div className="relative z-10 flex items-center gap-4 font-mono text-xs text-slate-400 shrink-0 pb-1">
        <span>
          ATTEMPTS:{' '}
          <strong className={sunlightMode ? 'text-slate-900' : 'text-white'}>{attempts}</strong>
        </span>
        <span>
          HITS:{' '}
          <strong className={missteps === 0 ? 'text-[#00FF88]' : 'text-[#FF4460]'}>
            {missteps}
          </strong>
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// 4. MOTHERBOARD (MOBO) — 2.5D Isometric PCB Trace Router (5x5 -> 10x10, 3 Modes)
// ============================================================================

// 4-bit port mask: N=1 (r-1), E=2 (c+1), S=4 (r+1), W=8 (c-1)
const PORT_N = 1;
const PORT_E = 2;
const PORT_S = 4;
const PORT_W = 8;

function rotatePortMaskCW(mask: number, steps = 1): number {
  let m = mask & 15;
  for (let i = 0; i < (steps & 3); i++) {
    let next = 0;
    if (m & PORT_N) next |= PORT_E;
    if (m & PORT_E) next |= PORT_S;
    if (m & PORT_S) next |= PORT_W;
    if (m & PORT_W) next |= PORT_N;
    m = next;
  }
  return m;
}

interface MoboTile {
  mask: number; // current 4-bit port mask
  kind: 'empty' | 'trace' | 'psu' | 'socket';
  socketLabel?: 'RAM' | 'SSD' | 'GPU' | 'CPU';
  locked: boolean;
}

export function MoboRouterGame({
  runSeed,
  onComplete,
  variant = 'story',
  storyDifficulty = 'normal',
  initialGridSize = 5,
  initialMode = 'power',
  sunlightMode = false,
}: {
  runSeed: number;
  onComplete: (res: ComponentResult) => void;
  variant?: 'story' | 'daily' | 'challenge' | 'overclock' | 'blitz';
  storyDifficulty?: 'easy' | 'normal' | 'hard';
  initialGridSize?: number;
  initialMode?: MoboMode;
  sunlightMode?: boolean;
}) {
  const TOTAL_BOARDS =
    variant === 'story' ? 2 : variant === 'challenge' ? 4 : variant === 'blitz' ? 3 : 1;
  const [boardIdx, setBoardIdx] = useState<number>(0);
  const [selectedGridSize, setSelectedGridSize] = useState<number>(() =>
    Math.max(5, Math.min(10, initialGridSize))
  );
  const [selectedMode, setSelectedMode] = useState<MoboMode>(initialMode);
  const [tiles, setTiles] = useState<MoboTile[]>([]);
  const [poweredSet, setPoweredSet] = useState<Set<number>>(new Set());
  const [psuCell, setPsuCell] = useState<number>(0);
  const [socketCells, setSocketCells] = useState<number[]>([]);
  const [hoveredCell, setHoveredCell] = useState<number | null>(null);
  const [rotations, setRotations] = useState<number>(0);
  const [missteps, setMissteps] = useState<number>(0);
  const [solvedFlash, setSolvedFlash] = useState<boolean>(false);
  const [timeLeftMs, setTimeLeftMs] = useState<number>(34000);
  const [wipedReason, setWipedReason] = useState<string | null>(null);

  const startTimeRef = useRef<number>(performance.now());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const elevRef = useRef<Float32Array>(new Float32Array(100));

  const activeGridSize =
    variant === 'story'
      ? 5 + boardIdx
      : variant === 'challenge'
        ? boardIdx < 2
          ? 5
          : 6
        : variant === 'blitz'
          ? 5
          : variant === 'overclock'
            ? 6
            : selectedGridSize;
  const activeMode: MoboMode =
    variant === 'story'
      ? boardIdx === 0
        ? 'power'
        : 'locked'
      : variant === 'challenge'
        ? ((['power', 'locked', 'loop', 'overclock'] as const)[boardIdx] ?? 'overclock')
        : variant === 'blitz'
          ? ((['power', 'locked', 'overclock'] as const)[boardIdx] ?? 'overclock')
          : variant === 'overclock'
            ? 'overclock'
            : selectedMode;

  useEffect(() => {
    const moboLimit =
      variant === 'story' && storyDifficulty === 'easy'
        ? -1
        : variant === 'story' && storyDifficulty === 'normal'
          ? 75000
          : activeMode === 'overclock' || variant === 'challenge' || variant === 'blitz'
            ? 24000
            : 34000;
    setTimeLeftMs(moboLimit);
    setWipedReason(null);
  }, [boardIdx, activeGridSize, activeMode, variant, storyDifficulty]);

  useEffect(() => {
    if (wipedReason || solvedFlash || timeLeftMs < 0) return;
    const id = window.setInterval(() => {
      setTimeLeftMs((prev) => {
        if (prev < 0) return prev;
        if (prev <= 100) {
          window.clearInterval(id);
          sound.outOfMoves();
          setWipedReason('BUS SHORT-CIRCUIT // TIME OUT');
          return 0;
        }
        return prev - 100;
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [wipedReason, solvedFlash, boardIdx, activeMode, timeLeftMs]);

  const computePowerFlow = useCallback(
    (grid: MoboTile[], n: number, psuIdx: number): Set<number> => {
      const visited = new Set<number>();
      if (grid.length === 0) return visited;
      const queue: number[] = [psuIdx];
      visited.add(psuIdx);

      while (queue.length > 0) {
        const cur = queue.shift()!;
        const r = Math.floor(cur / n);
        const c = cur % n;
        const m = grid[cur].mask;

        const neighbors: Array<{ nr: number; nc: number; outBit: number; inBit: number }> = [
          { nr: r - 1, nc: c, outBit: PORT_N, inBit: PORT_S },
          { nr: r, nc: c + 1, outBit: PORT_E, inBit: PORT_W },
          { nr: r + 1, nc: c, outBit: PORT_S, inBit: PORT_N },
          { nr: r, nc: c - 1, outBit: PORT_W, inBit: PORT_E },
        ];

        for (const nb of neighbors) {
          if (nb.nr < 0 || nb.nr >= n || nb.nc < 0 || nb.nc >= n) continue;
          const nIdx = nb.nr * n + nb.nc;
          if (visited.has(nIdx)) continue;
          if ((m & nb.outBit) !== 0 && (grid[nIdx].mask & nb.inBit) !== 0) {
            visited.add(nIdx);
            queue.push(nIdx);
          }
        }
      }
      return visited;
    },
    []
  );

  const generateBoard = useCallback(
    (bIdx: number, n: number, mode: MoboMode) => {
      const cells = n * n;
      const modeOffset = mode === 'power' ? 19 : mode === 'locked' ? 47 : 83;
      const randomSalt = Math.floor(Math.random() * 0x7fffffff);
      let s = ((runSeed + bIdx * 1103 + n * 179 + modeOffset * 43) ^ randomSalt) >>> 0;
      const nextRand = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      };

      const centerR = Math.floor(n / 2);
      const centerC = Math.floor(n / 2);
      const psu = centerR * n + centerC;

      const sockets: Array<{ idx: number; label: 'RAM' | 'SSD' | 'GPU' | 'CPU' }> = [
        { idx: 0, label: 'RAM' },
        { idx: n - 1, label: 'SSD' },
        { idx: (n - 1) * n, label: 'GPU' },
        { idx: (n - 1) * n + (n - 1), label: 'CPU' },
      ];
      const socketSet = new Set(sockets.map((x) => x.idx));

      // Build a guaranteed-solvable spanning tree from PSU using randomized DFS
      const solvedMasks = new Int32Array(cells);
      const visited = new Uint8Array(cells);
      const stack: number[] = [psu];
      visited[psu] = 1;

      while (stack.length > 0) {
        const cur = stack[stack.length - 1];
        const r = Math.floor(cur / n);
        const c = cur % n;
        const candidates: Array<{ nIdx: number; outBit: number; inBit: number }> = [];
        if (r > 0 && !visited[(r - 1) * n + c]) {
          candidates.push({ nIdx: (r - 1) * n + c, outBit: PORT_N, inBit: PORT_S });
        }
        if (c < n - 1 && !visited[r * n + (c + 1)]) {
          candidates.push({ nIdx: r * n + (c + 1), outBit: PORT_E, inBit: PORT_W });
        }
        if (r < n - 1 && !visited[(r + 1) * n + c]) {
          candidates.push({ nIdx: (r + 1) * n + c, outBit: PORT_S, inBit: PORT_N });
        }
        if (c > 0 && !visited[r * n + (c - 1)]) {
          candidates.push({ nIdx: r * n + (c - 1), outBit: PORT_W, inBit: PORT_E });
        }

        if (candidates.length === 0) {
          stack.pop();
          continue;
        }
        const pick = candidates[Math.floor(nextRand() * candidates.length)];
        solvedMasks[cur] |= pick.outBit;
        solvedMasks[pick.nIdx] |= pick.inBit;
        visited[pick.nIdx] = 1;
        stack.push(pick.nIdx);
      }

      // In Closed Loop mode, add extra bridges near center so circuits form loops
      if (mode === 'loop') {
        for (let r = 0; r < n - 1; r++) {
          for (let c = 0; c < n - 1; c++) {
            if (nextRand() < 0.24) {
              const a = r * n + c;
              const b = r * n + c + 1;
              solvedMasks[a] |= PORT_E;
              solvedMasks[b] |= PORT_W;
            }
          }
        }
      }

      // Prune non-socket dead-end leaf branches in 'power' / 'locked' so board stays crisp
      if (mode !== 'loop') {
        let changed = true;
        while (changed) {
          changed = false;
          for (let i = 0; i < cells; i++) {
            if (i === psu || socketSet.has(i)) continue;
            const m = solvedMasks[i];
            const deg =
              ((m & PORT_N) ? 1 : 0) +
              ((m & PORT_E) ? 1 : 0) +
              ((m & PORT_S) ? 1 : 0) +
              ((m & PORT_W) ? 1 : 0);
            if (deg === 1) {
              const r = Math.floor(i / n);
              const c = i % n;
              if (m & PORT_N) solvedMasks[(r - 1) * n + c] &= ~PORT_S;
              if (m & PORT_E) solvedMasks[r * n + c + 1] &= ~PORT_W;
              if (m & PORT_S) solvedMasks[(r + 1) * n + c] &= ~PORT_N;
              if (m & PORT_W) solvedMasks[r * n + c - 1] &= ~PORT_E;
              solvedMasks[i] = 0;
              changed = true;
            }
          }
        }
      }

      // Pick locked heatsink anchor tiles in 'locked' mode (kept at solved orientation!)
      const lockedSet = new Set<number>();
      if (mode === 'locked') {
        const lockCandidates = Array.from({ length: cells }, (_, i) => i).filter(
          (i) => i !== psu && !socketSet.has(i) && solvedMasks[i] !== 0
        );
        const lockTarget = Math.min(4, Math.max(2, Math.floor(n * 0.5)));
        for (let k = 0; k < lockTarget && lockCandidates.length > 0; k++) {
          const pickIdx = Math.floor(nextRand() * lockCandidates.length);
          lockedSet.add(lockCandidates[pickIdx]);
          lockCandidates.splice(pickIdx, 1);
        }
      }

      // Scramble rotatable trace tiles so puzzle requires real routing
      const built: MoboTile[] = Array.from({ length: cells }, (_, i) => {
        const sock = sockets.find((x) => x.idx === i);
        if (i === psu) {
          return { mask: solvedMasks[i], kind: 'psu', locked: true };
        }
        if (sock) {
          return {
            mask: solvedMasks[i],
            kind: 'socket',
            socketLabel: sock.label,
            locked: true,
          };
        }
        if (solvedMasks[i] === 0) {
          return { mask: 0, kind: 'empty', locked: true };
        }
        const isLocked = lockedSet.has(i);
        const rotSteps = isLocked ? 0 : 1 + Math.floor(nextRand() * 3);
        return {
          mask: rotatePortMaskCW(solvedMasks[i], rotSteps),
          kind: 'trace',
          locked: isLocked,
        };
      });

      const initialPower = computePowerFlow(built, n, psu);
      setPsuCell(psu);
      setSocketCells(sockets.map((x) => x.idx));
      setTiles(built);
      setPoweredSet(initialPower);
      setSolvedFlash(false);
    },
    [computePowerFlow, runSeed]
  );

  useEffect(() => {
    generateBoard(boardIdx, activeGridSize, activeMode);
  }, [boardIdx, activeGridSize, activeMode, generateBoard]);

  const handleTileTap = useCallback(
    (cellIdx: number) => {
      if (solvedFlash) return;
      const tile = tiles[cellIdx];
      if (!tile) return;

      if (tile.locked || tile.kind !== 'trace') {
        if (tile.kind === 'trace' && tile.locked) {
          sound.outOfMoves();
          setMissteps((m) => m + 1);
        }
        return;
      }

      const nextTiles = tiles.map((t, idx) =>
        idx === cellIdx ? { ...t, mask: rotatePortMaskCW(t.mask, 1) } : t
      );
      const nextPower = computePowerFlow(nextTiles, activeGridSize, psuCell);
      setTiles(nextTiles);
      setPoweredSet(nextPower);
      setRotations((r) => r + 1);
      sound.step(true, 0);

      const allSocketsPowered = socketCells.every((sIdx) => nextPower.has(sIdx));
      if (allSocketsPowered) {
        setSolvedFlash(true);
        sound.collectNode(6);
        if (boardIdx + 1 >= TOTAL_BOARDS) {
          sound.win();
          window.setTimeout(() => {
            onComplete({
              attempts: Math.max(1, Math.ceil(rotations / Math.max(1, activeGridSize))),
              missteps,
              timeMs: Math.max(400, Math.round(performance.now() - startTimeRef.current)),
              gridSize: activeGridSize,
              moboMode: activeMode,
            });
          }, 360);
        } else {
          window.setTimeout(() => {
            setBoardIdx((b) => b + 1);
          }, 480);
        }
      }
    },
    [
      solvedFlash,
      tiles,
      computePowerFlow,
      activeGridSize,
      psuCell,
      socketCells,
      boardIdx,
      TOTAL_BOARDS,
      onComplete,
      rotations,
      missteps,
      activeMode,
    ]
  );

  // 2.5D Isometric Motherboard PCB Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let rafId = 0;

    const render = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(260, Math.floor(rect.width));
      const h = Math.max(220, Math.floor(rect.height));
      const maxDpr = typeof navigator !== 'undefined' && navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4 ? 1.5 : 2;
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);

      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const n = activeGridSize;
      drawIsoMotherboardAndPlinth(ctx, w, h, n, sunlightMode, '#FFB800');

      const { tw, th, depth, cx, cy } = getIsoBoardMetrics(w, h, n);
      const half = (n - 1) / 2;
      const elevArr = elevRef.current;
      const pulsePhase = (performance.now() * 0.004) % 1;

      for (let sum = 0; sum <= 2 * (n - 1); sum++) {
        for (let r = 0; r < n; r++) {
          const c = sum - r;
          if (c < 0 || c >= n) continue;
          const idx = r * n + c;
          const tile = tiles[idx];
          if (!tile) continue;

          const isPowered = poweredSet.has(idx);
          const isHovered = hoveredCell === idx && tile.kind === 'trace' && !tile.locked;
          const targetElev =
            tile.kind === 'psu' || tile.kind === 'socket'
              ? depth * 0.22
              : isHovered
                ? depth * 0.24
                : isPowered
                  ? depth * 0.18
                  : tile.kind === 'empty'
                    ? 0
                    : depth * 0.16;
          elevArr[idx] = elevArr[idx] + (targetElev - elevArr[idx]) * 0.24;
          const z = elevArr[idx];

          const u = c - half;
          const v = r - half;
          const sx = cx + (u - v) * tw;
          const sy = cy + (u + v) * th - z;

          const gap = 0.9;
          const hw = tw * gap;
          const hh = th * gap;

          // High-Contrast PCB Tile Colors (clear separation on mobile & tablet)
          let topFill = sunlightMode ? '#E2F2EC' : '#0B171D';
          let leftFill = sunlightMode ? '#94C4B4' : '#060E12';
          let rightFill = sunlightMode ? '#649E8B' : '#04090C';
          let strokeColor = sunlightMode ? '#059669' : '#264653';

          if (tile.kind === 'psu') {
            topFill = '#2E1F05';
            leftFill = '#1F1403';
            rightFill = '#140C02';
            strokeColor = '#FFB800';
          } else if (tile.kind === 'socket') {
            topFill = isPowered ? '#0A3B2D' : '#161D2B';
            leftFill = isPowered ? '#06261D' : '#0D121B';
            rightFill = isPowered ? '#041A14' : '#080B11';
            strokeColor = isPowered ? '#00FF88' : '#F59E0B';
          } else if (tile.kind === 'trace') {
            if (isPowered) {
              topFill = sunlightMode ? '#CCFBF1' : '#0A2E38';
              leftFill = sunlightMode ? '#5EEAD4' : '#061D24';
              rightFill = sunlightMode ? '#2DD4BF' : '#041318';
              strokeColor = '#00F0FF';
            } else if (tile.locked) {
              topFill = '#1B162B';
              leftFill = '#110E1C';
              rightFill = '#0B0912';
              strokeColor = '#A855F7';
            } else if (isHovered) {
              topFill = sunlightMode ? '#D1FAE5' : '#143242';
              strokeColor = '#00F0FF';
            }
          } else if (tile.kind === 'empty') {
            topFill = sunlightMode ? '#E2E8F0' : '#070D12';
            leftFill = sunlightMode ? '#CBD5E1' : '#05080C';
            rightFill = sunlightMode ? '#94A3B8' : '#030508';
            strokeColor = sunlightMode ? '#94A3B8' : '#152432';
          }

          // Top face
          ctx.beginPath();
          ctx.moveTo(sx, sy - hh);
          ctx.lineTo(sx + hw, sy);
          ctx.lineTo(sx, sy + hh);
          ctx.lineTo(sx - hw, sy);
          ctx.closePath();
          ctx.fillStyle = topFill;
          ctx.fill();
          ctx.lineWidth = isPowered || tile.kind !== 'trace' || isHovered ? 1.4 : 1;
          ctx.strokeStyle = strokeColor;
          ctx.stroke();

          // Left & right extruded faces
          ctx.beginPath();
          ctx.moveTo(sx - hw, sy);
          ctx.lineTo(sx, sy + hh);
          ctx.lineTo(sx, sy + hh + depth);
          ctx.lineTo(sx - hw, sy + depth);
          ctx.closePath();
          ctx.fillStyle = leftFill;
          ctx.fill();
          ctx.lineWidth = 0.8;
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(sx, sy + hh);
          ctx.lineTo(sx + hw, sy);
          ctx.lineTo(sx + hw, sy + depth);
          ctx.lineTo(sx, sy + hh + depth);
          ctx.closePath();
          ctx.fillStyle = rightFill;
          ctx.fill();
          ctx.stroke();

          // High-Contrast Isometric PCB Traces & Sockets (crystal-clear on phone/tablet)
          ctx.save();
          ctx.translate(sx, sy);
          ctx.transform(hw / 20, hh / 20, -hw / 20, hh / 20, 0, 0);

          ctx.beginPath();
          ctx.rect(-19.4, -19.4, 38.8, 38.8);
          ctx.clip();

          if (tile.kind !== 'empty') {
            const m = tile.mask;
            // Check which ports actually mate with a neighboring tile's port
            const nMatch = (m & PORT_N) !== 0 && r > 0 && (tiles[(r - 1) * n + c]?.mask & PORT_S) !== 0;
            const eMatch = (m & PORT_E) !== 0 && c < n - 1 && (tiles[r * n + (c + 1)]?.mask & PORT_W) !== 0;
            const sMatch = (m & PORT_S) !== 0 && r < n - 1 && (tiles[(r + 1) * n + c]?.mask & PORT_N) !== 0;
            const wMatch = (m & PORT_W) !== 0 && c > 0 && (tiles[r * n + (c - 1)]?.mask & PORT_E) !== 0;

            const outerColor = isPowered
              ? 'rgba(0, 240, 255, 0.32)'
              : sunlightMode
                ? 'rgba(71, 85, 105, 0.35)'
                : 'rgba(15, 23, 42, 0.9)';
            const coreColor =
              tile.kind === 'psu'
                ? '#FFB800'
                : isPowered
                  ? '#00F0FF'
                  : sunlightMode
                    ? '#334155'
                    : '#94A3B8';

            const drawTraceArm = (dir: number, matched: boolean) => {
              const reach = matched ? 19.4 : 16.8;
              ctx.lineCap = 'butt';
              ctx.strokeStyle = outerColor;
              ctx.lineWidth = isPowered ? 5.6 : 4.4;
              ctx.beginPath();
              ctx.moveTo(0, 0);
              if (dir === PORT_N) ctx.lineTo(0, -reach);
              if (dir === PORT_E) ctx.lineTo(reach, 0);
              if (dir === PORT_S) ctx.lineTo(0, reach);
              if (dir === PORT_W) ctx.lineTo(-reach, 0);
              ctx.stroke();

              ctx.strokeStyle = coreColor;
              ctx.lineWidth = isPowered ? 2.6 : 2.1;
              ctx.beginPath();
              ctx.moveTo(0, 0);
              if (dir === PORT_N) ctx.lineTo(0, -reach);
              if (dir === PORT_E) ctx.lineTo(reach, 0);
              if (dir === PORT_S) ctx.lineTo(0, reach);
              if (dir === PORT_W) ctx.lineTo(-reach, 0);
              ctx.stroke();

              // Bright bridge pad ONLY when connected to neighbor (instant visual clarity!)
              if (matched) {
                ctx.fillStyle = isPowered ? '#00FF88' : '#CBD5E1';
                if (dir === PORT_N) ctx.fillRect(-2.4, -19.4, 4.8, 2.2);
                if (dir === PORT_E) ctx.fillRect(17.2, -2.4, 2.2, 4.8);
                if (dir === PORT_S) ctx.fillRect(-2.4, 17.2, 4.8, 2.2);
                if (dir === PORT_W) ctx.fillRect(-19.4, -2.4, 2.2, 4.8);
              }
            };

            if (m & PORT_N) drawTraceArm(PORT_N, nMatch);
            if (m & PORT_E) drawTraceArm(PORT_E, eMatch);
            if (m & PORT_S) drawTraceArm(PORT_S, sMatch);
            if (m & PORT_W) drawTraceArm(PORT_W, wMatch);

            // Component Sockets & Center PCB Via Junctions
            if (tile.kind === 'psu') {
              ctx.fillStyle = '#241703';
              ctx.strokeStyle = '#FFB800';
              ctx.lineWidth = 1.6;
              ctx.fillRect(-12, -10, 24, 20);
              ctx.strokeRect(-12, -10, 24, 20);
              ctx.fillStyle = '#FFB800';
              ctx.font = '800 9.5px ui-monospace, monospace';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText('PSU', 0, 0.5);
            } else if (tile.kind === 'socket' && tile.socketLabel) {
              ctx.fillStyle = isPowered ? '#063225' : '#0F172A';
              ctx.strokeStyle = isPowered ? '#00FF88' : '#FFB800';
              ctx.lineWidth = 1.6;
              ctx.fillRect(-12.5, -9.5, 25, 19);
              ctx.strokeRect(-12.5, -9.5, 25, 19);
              ctx.fillStyle = isPowered ? '#00FF88' : '#FFB800';
              ctx.font = '800 9px ui-monospace, monospace';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(tile.socketLabel, 0, 0.5);
            } else {
              ctx.fillStyle = isPowered ? '#063225' : '#1E293B';
              ctx.strokeStyle = isPowered ? '#00FF88' : tile.locked ? '#C084FC' : '#94A3B8';
              ctx.lineWidth = 1.3;
              ctx.beginPath();
              ctx.arc(0, 0, 3.3, 0, Math.PI * 2);
              ctx.fill();
              ctx.stroke();

              if (isPowered) {
                ctx.fillStyle = '#FFFFFF';
                const d = 14.5 * pulsePhase + 3;
                if (m & PORT_N) ctx.fillRect(-1.2, -d, 2.4, 2.4);
                if (m & PORT_E) ctx.fillRect(d - 2.4, -1.2, 2.4, 2.4);
                if (m & PORT_S) ctx.fillRect(-1.2, d - 2.4, 2.4, 2.4);
                if (m & PORT_W) ctx.fillRect(-d, -1.2, 2.4, 2.4);
              }
            }
          }

          ctx.restore();
        }
      }

      ctx.restore();
      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);
    return () => window.cancelAnimationFrame(rafId);
  }, [activeGridSize, hoveredCell, poweredSet, sunlightMode, tiles]);

  const poweredSocketsCount = socketCells.filter((sIdx) => poweredSet.has(sIdx)).length;
  const modeLabel =
    activeMode === 'power'
      ? 'POWER GRID'
      : activeMode === 'locked'
        ? 'LOCKED CHIPS'
        : 'CLOSED LOOP';

  return (
    <div className="w-full h-full flex flex-col items-center justify-between py-2.5 sm:py-4 gap-2 select-none relative">
      {/* Standalone Mode + Grid Size Controls (Daily only; Challenge/Overclock/Blitz are computer-assigned) */}
      {variant === 'daily' && (
        <div className="relative z-10 flex flex-wrap items-center justify-center gap-2 max-w-full px-2.5 shrink-0">
          <div
            role="group"
            aria-label="Motherboard mode"
            className="inline-flex items-center rounded-lg bg-[#0A111D] border border-slate-800 p-0.5 font-mono text-[10px]"
          >
            {(
              [
                { id: 'power', label: 'Power Grid', Icon: CircuitBoard },
                { id: 'locked', label: 'Locked', Icon: Lock },
                { id: 'loop', label: 'Loop', Icon: RefreshCw },
                { id: 'overclock', label: 'Overclock', Icon: Zap },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setSelectedMode(id);
                  setBoardIdx(0);
                }}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors cursor-pointer ${
                  selectedMode === id
                    ? 'bg-[#2B220A] text-[#FFB800] border border-[#FFB800]/50 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3 h-3" />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div
            role="group"
            aria-label="Motherboard grid size"
            className="inline-flex items-center rounded-lg bg-[#0A111D] border border-slate-800 p-0.5 font-mono text-[10px]"
          >
            {[5, 6, 7, 8, 9, 10].map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => {
                  setSelectedGridSize(sz);
                  setBoardIdx(0);
                }}
                className={`px-1.5 py-1 rounded-md transition-colors cursor-pointer ${
                  selectedGridSize === sz
                    ? 'bg-[#08241C] text-[#00FF88] border border-[#00FF88]/45 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {sz}×{sz}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Industrial Telemetry Header */}
      <div className="relative z-10 flex flex-col items-center shrink-0 w-full max-w-md px-2.5">
        <div className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded bg-[#070B12]/95 border border-slate-800 font-mono text-[11px] tabular-nums">
          <div className="flex items-center gap-1.5 text-slate-200 font-bold">
            <CircuitBoard className="w-3.5 h-3.5 text-[#FFB800]" />
            <span>
              {TOTAL_BOARDS > 1 ? `B${boardIdx + 1}/${TOTAL_BOARDS} · ` : ''}
              {activeGridSize}×{activeGridSize} · SOCKETS{' '}
              <strong className="text-[#00FF88]">
                {poweredSocketsCount}/{socketCells.length}
              </strong>
            </span>
          </div>
          <span
            className={`font-bold ${
              timeLeftMs < 0
                ? 'text-[#00FF88]'
                : timeLeftMs <= 6000
                  ? 'text-[#FF4460] animate-pulse'
                  : 'text-[#00F0FF]'
            }`}
          >
            {timeLeftMs < 0 ? '∞' : `${(timeLeftMs / 1000).toFixed(1)}s`}
          </span>
        </div>
      </div>

      {/* Full-bleed 2.5D Isometric Motherboard Canvas */}
      <div ref={containerRef} className="w-full flex-1 min-h-[240px] relative">
        <canvas
          ref={canvasRef}
          onPointerMove={(e) =>
            setHoveredCell(
              pickIsoCellFromPointer(canvasRef.current, e.clientX, e.clientY, activeGridSize)
            )
          }
          onPointerLeave={() => setHoveredCell(null)}
          onPointerDown={(e) => {
            if (wipedReason) return;
            const cell = pickIsoCellFromPointer(
              canvasRef.current,
              e.clientX,
              e.clientY,
              activeGridSize
            );
            if (cell !== null) handleTileTap(cell);
          }}
          className={`block w-full h-full touch-none ${
            hoveredCell !== null &&
            tiles[hoveredCell]?.kind === 'trace' &&
            !tiles[hoveredCell]?.locked
              ? 'cursor-pointer'
              : 'cursor-default'
          }`}
        />

        {wipedReason && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#060911]/90 backdrop-blur-xs p-4 text-center gap-3 font-mono">
            <div className="text-xs font-bold tracking-widest text-[#FF4460]">{wipedReason}</div>
            <button
              type="button"
              onClick={() => {
                setWipedReason(null);
                setBoardIdx(0);
                setRotations(0);
                setMissteps(0);
                setTimeLeftMs(
                  variant === 'story' && storyDifficulty === 'easy'
                    ? -1
                    : variant === 'story' && storyDifficulty === 'normal'
                      ? 75000
                      : activeMode === 'overclock' || variant === 'challenge' || variant === 'blitz'
                        ? 24000
                        : 34000
                );
                generateBoard(0, activeGridSize, activeMode);
              }}
              className="px-5 py-2 rounded bg-[#FFB800] text-[#050B14] font-bold text-xs uppercase tracking-wider cursor-pointer hover:brightness-110"
            >
              Reboot MOBO
            </button>
          </div>
        )}
      </div>

      {/* Footer Metrics */}
      <div className="relative z-10 flex items-center gap-4 font-mono text-xs text-slate-400 shrink-0 pb-1">
        <span>
          ROTATIONS:{' '}
          <strong className={sunlightMode ? 'text-slate-900' : 'text-white'}>{rotations}</strong>
        </span>
        <span>
          SOCKETS:{' '}
          <strong className="text-[#00FF88]">
            {poweredSocketsCount}/{socketCells.length}
          </strong>
        </span>
      </div>
    </div>
  );
}
