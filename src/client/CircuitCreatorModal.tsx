import React, { useState } from 'react';
import { motion } from 'motion/react';
import { navigateTo, showToast } from '@devvit/web/client';
import { CheckCircle2, Hammer, RotateCcw, Send, Sparkles, Wand2, X } from 'lucide-react';
import {
  createEmptyCustomGrid,
  CustomSolveResult,
  generateLevel,
  getTodayDateISO,
  solveCustomLevel,
} from '../shared/levelGenerator';
import type { CacheTier, CustomPostResponse, Direction, TileData } from '../shared/types';
import { trackJourneyInteraction } from './analytics';

type ToolId =
  | 'floor'
  | 'platform'
  | 'ramp'
  | 'bridge'
  | 'void'
  | 'start'
  | 'node'
  | 'exit';

const TOOLS: Array<{ id: ToolId; label: string; badge: string; accent: string }> = [
  { id: 'floor', label: 'Floor', badge: 'L0', accent: 'border-slate-700 text-slate-200' },
  { id: 'platform', label: 'Platform', badge: 'L1', accent: 'border-sky-500/50 text-sky-200' },
  { id: 'ramp', label: 'Ramp', badge: '▲', accent: 'border-indigo-400/50 text-indigo-200' },
  { id: 'bridge', label: 'Bridge', badge: '╬', accent: 'border-purple-400/50 text-purple-200' },
  { id: 'void', label: 'Void', badge: '✕', accent: 'border-slate-800 text-slate-500' },
  { id: 'start', label: 'Start', badge: '◆', accent: 'border-[#00F0FF]/60 text-[#00F0FF]' },
  { id: 'node', label: 'Node', badge: '●', accent: 'border-[#FFB800]/60 text-[#FFB800]' },
  { id: 'exit', label: 'Exit', badge: '▣', accent: 'border-[#00FF88]/60 text-[#00FF88]' },
];

const RAMP_ORDER: Direction[] = ['N', 'E', 'S', 'W'];
const RAMP_ARROW: Record<Direction, string> = { N: '↑', E: '→', S: '↓', W: '←' };

interface CircuitCreatorModalProps {
  onClose: () => void;
}

export function CircuitCreatorModal({ onClose }: CircuitCreatorModalProps) {
  const [tiles, setTiles] = useState<TileData[][]>(() => createEmptyCustomGrid());
  const [tool, setTool] = useState<ToolId>('platform');
  const [title, setTitle] = useState('');
  const [solveResult, setSolveResult] = useState<CustomSolveResult | null>(null);
  const [assistTip, setAssistTip] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const loadBlueprint = (tier: CacheTier) => {
    const salt = Math.floor(Math.random() * 900000) + 1;
    const gen = generateLevel(getTodayDateISO(), 'standard', tier, salt);
    setTiles(gen.tiles.map((row) => row.map((c) => ({ ...c }))));
    const res = solveCustomLevel(gen.tiles);
    setSolveResult(res);
    setAssistTip(`Loaded ${tier} blueprint — tweak any tiles to make it yours!`);
    void trackJourneyInteraction('creator_blueprint', tier);
  };

  const handleAutoAssist = () => {
    const current = solveCustomLevel(tiles);
    if (current.valid) {
      if (!current.dualBridgeCrossed) {
        setAssistTip('Tip: Route a path BOTH over and under a Bridge (╬) for S-Tier!');
      } else if (current.level.par < 8) {
        setAssistTip('Tip: Move Nodes onto L1 Platforms or add Voids to raise PAR.');
      } else {
        setAssistTip('Masterpiece! Your circuit is S-Tier ready to publish.');
      }
      setSolveResult(current);
      return;
    }

    // Try smart single-tile repairs: convert blocking voids to floor or add missing ramp
    for (let y = 0; y < tiles.length; y++) {
      for (let x = 0; x < tiles[y].length; x++) {
        if (tiles[y][x].type === 'void') {
          const candidate = tiles.map((row) => row.map((c) => ({ ...c })));
          candidate[y][x].type = 'floor';
          const check = solveCustomLevel(candidate);
          if (check.valid) {
            setTiles(candidate);
            setSolveResult(check);
            setAssistTip(`Auto-Assist cleared blocking Void at (${x},${y}) — now solvable!`);
            return;
          }
        }
      }
    }

    // Fallback: offer a fresh L1 blueprint
    loadBlueprint('L1');
    setAssistTip('Grid was disconnected — generated a fresh solvable L1 circuit!');
  };

  const handleCellClick = (x: number, y: number) => {
    setSolveResult(null);
    setTiles((prev) => {
      const next = prev.map((row) => row.map((cell) => ({ ...cell })));
      const cell = next[y][x];

      if (tool === 'floor' || tool === 'void' || tool === 'platform') {
        cell.type = tool;
        if (tool === 'void') {
          cell.feature = null;
          cell.nodeIndex = undefined;
        }
        cell.rampDir = undefined;
        cell.bridgeAxis = undefined;
      } else if (tool === 'ramp') {
        if (cell.type === 'ramp') {
          const curIdx = RAMP_ORDER.indexOf(cell.rampDir ?? 'N');
          cell.rampDir = RAMP_ORDER[(curIdx + 1) % RAMP_ORDER.length];
        } else {
          cell.type = 'ramp';
          cell.rampDir = 'E';
        }
        cell.feature = null;
        cell.nodeIndex = undefined;
        cell.bridgeAxis = undefined;
      } else if (tool === 'bridge') {
        if (cell.type === 'bridge') {
          cell.bridgeAxis = cell.bridgeAxis === 'x' ? 'y' : 'x';
        } else {
          cell.type = 'bridge';
          cell.bridgeAxis = 'x';
        }
        cell.feature = null;
        cell.nodeIndex = undefined;
        cell.rampDir = undefined;
      } else if (tool === 'start') {
        if (cell.type === 'void' || cell.type === 'ramp' || cell.type === 'bridge') {
          cell.type = 'floor';
        }
        for (let r = 0; r < next.length; r++) {
          for (let c = 0; c < next[r].length; c++) {
            if (next[r][c].feature === 'start') next[r][c].feature = null;
          }
        }
        cell.feature = 'start';
        cell.nodeIndex = undefined;
      } else if (tool === 'exit') {
        if (cell.type === 'void' || cell.type === 'ramp' || cell.type === 'bridge') {
          cell.type = 'floor';
        }
        for (let r = 0; r < next.length; r++) {
          for (let c = 0; c < next[r].length; c++) {
            if (next[r][c].feature === 'exit') next[r][c].feature = null;
          }
        }
        cell.feature = 'exit';
        cell.nodeIndex = undefined;
      } else if (tool === 'node') {
        if (cell.type === 'void' || cell.type === 'ramp' || cell.type === 'bridge') {
          cell.type = 'floor';
        }
        cell.feature = cell.feature === 'node' ? null : 'node';
      }

      return next;
    });
  };

  const handleVerify = () => {
    const res = solveCustomLevel(tiles);
    setSolveResult(res);
    void trackJourneyInteraction('creator_verify', res.valid ? 'valid' : 'invalid');
  };

  const handlePublish = async () => {
    const verified = solveResult?.valid ? solveResult : solveCustomLevel(tiles);
    setSolveResult(verified);
    if (!verified.valid) return;

    setIsPublishing(true);
    try {
      const res = await fetch('/api/custom-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || 'Custom Circuit',
          tiles,
        }),
      });
      const data = (await res.json()) as CustomPostResponse;
      if (res.ok && data.ok) {
        void trackJourneyInteraction('creator_publish', `par_${verified.level.par}`);
        try {
          showToast('Circuit published to subreddit!');
        } catch {
          // Ignore outside Devvit
        }
        if (data.postUrl) {
          try {
            navigateTo(data.postUrl);
          } catch {
            // Ignore outside Devvit
          }
        }
        onClose();
      } else {
        setSolveResult({ valid: false, reason: data.error ?? 'Failed to publish.' });
      }
    } catch {
      setSolveResult({ valid: false, reason: 'Network error publishing circuit.' });
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onClick={onClose}
      className="absolute inset-0 z-30 flex items-center justify-center bg-[#090B10]/80 backdrop-blur-sm p-3 sm:p-4"
    >
      <motion.div
        role="dialog"
        aria-label="Circuit Creator"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[calc(100%-0.5rem)] overflow-y-auto rounded-xl cyber-panel p-4 flex flex-col gap-3"
      >
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
          <div className="flex items-center gap-2">
            <Hammer className="w-4 h-4 text-[#00F0FF]" />
            <h2 className="font-display text-base font-bold tracking-tight text-white">
              Circuit Creator
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close creator"
            className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-800/60 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <input
          type="text"
          maxLength={48}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Circuit title (e.g. Twin Overpass)"
          className="w-full px-3 py-1.5 rounded-lg bg-[#0A0E17] border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#00F0FF]/60"
        />

        {/* Architect Blueprints & Smart Assist */}
        <div className="flex items-center justify-between gap-1.5 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="font-mono text-[10px] text-slate-500 uppercase mr-1">Starter:</span>
            {(['L1', 'L2', 'L3'] as CacheTier[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => loadBlueprint(t)}
                className="px-2 py-1 rounded bg-[#0A0E17] border border-slate-800 hover:border-[#00F0FF]/50 font-mono text-[10px] text-slate-300 hover:text-white cursor-pointer"
              >
                {t}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={handleAutoAssist}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#182235] border border-[#00F0FF]/40 text-[#00F0FF] hover:bg-[#1E2C44] font-mono text-[10px] font-semibold cursor-pointer"
          >
            <Wand2 className="w-3 h-3" />
            <span>Auto-Assist</span>
          </button>
        </div>

        {/* Tool Palette */}
        <div className="grid grid-cols-4 gap-1.5">
          {TOOLS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTool(item.id)}
              className={`px-2 py-1.5 rounded-md border text-[11px] font-mono flex items-center justify-center gap-1 transition-colors cursor-pointer ${
                tool === item.id
                  ? 'bg-[#182235] border-[#00F0FF] text-white'
                  : `bg-[#0A0E17] ${item.accent} hover:border-slate-500`
              }`}
            >
              <span>{item.badge}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {/* 7x7 Grid */}
        <div className="grid grid-cols-7 gap-1 p-2 rounded-lg bg-[#090B10] border border-slate-800/80 aspect-square max-w-[280px] w-full mx-auto">
          {tiles.map((row, y) =>
            row.map((cell, x) => {
              let bg = 'bg-[#141B29] border-slate-800';
              let glyph = '';
              if (cell.type === 'void') bg = 'bg-[#07090D] border-slate-900 opacity-50';
              else if (cell.type === 'platform') bg = 'bg-[#1E2B45] border-sky-500/40';
              else if (cell.type === 'ramp') {
                bg = 'bg-indigo-950/70 border-indigo-400/50 text-indigo-200';
                glyph = RAMP_ARROW[cell.rampDir ?? 'E'];
              } else if (cell.type === 'bridge') {
                bg = 'bg-purple-950/70 border-purple-400/50 text-purple-200';
                glyph = cell.bridgeAxis === 'y' ? '║' : '═';
              }

              if (cell.feature === 'start') glyph = '◆';
              else if (cell.feature === 'exit') glyph = '▣';
              else if (cell.feature === 'node') glyph = '●';

              const glyphColor =
                cell.feature === 'start'
                  ? 'text-[#00F0FF]'
                  : cell.feature === 'exit'
                    ? 'text-[#00FF88]'
                    : cell.feature === 'node'
                      ? 'text-[#FFB800]'
                      : '';

              return (
                <button
                  key={`${x}-${y}`}
                  type="button"
                  onClick={() => handleCellClick(x, y)}
                  className={`rounded border flex items-center justify-center font-mono text-xs font-bold transition-transform active:scale-95 cursor-pointer ${bg} ${glyphColor}`}
                  title={`(${x},${y}) ${cell.type}${cell.feature ? ` • ${cell.feature}` : ''}`}
                >
                  {glyph}
                </button>
              );
            })
          )}
        </div>

        {/* Solver Status + Ego Architect Rating */}
        {solveResult && (
          <div
            className={`px-3 py-2 rounded-lg border text-xs font-mono flex flex-col gap-1 ${
              solveResult.valid
                ? 'bg-[#06241B] border-[#00FF88]/40 text-[#00FF88]'
                : 'bg-[#2C131C] border-[#FF4460]/40 text-[#FF8FA3]'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span>
                {solveResult.valid
                  ? `✓ PAR ${solveResult.level.par} · ${solveResult.steps} steps`
                  : 'reason' in solveResult
                    ? solveResult.reason
                    : 'Invalid circuit'}
              </span>
              {solveResult.valid && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/30 text-[10px] font-bold text-[#FFD166]">
                  <Sparkles className="w-3 h-3" />
                  {solveResult.level.par >= 10 && solveResult.dualBridgeCrossed
                    ? 'S-TIER'
                    : solveResult.level.par >= 7
                      ? 'A-TIER'
                      : 'B-TIER'}
                </span>
              )}
            </div>
            {assistTip && (
              <span className="text-[10px] text-slate-300 font-sans">{assistTip}</span>
            )}
          </div>
        )}
        {!solveResult && assistTip && (
          <div className="px-3 py-1.5 rounded-lg bg-[#121722] border border-slate-800 text-[11px] text-slate-300">
            {assistTip}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              setTiles(createEmptyCustomGrid());
              setSolveResult(null);
            }}
            className="px-3 py-2 rounded-lg bg-[#161D2C] text-slate-300 border border-slate-800 hover:border-slate-600 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
          <button
            type="button"
            onClick={handleVerify}
            className="flex-1 px-3 py-2 rounded-lg bg-[#161D2C] text-slate-100 border border-slate-700 hover:border-[#00F0FF]/60 text-xs font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-[#00F0FF]" />
            <span>Verify PAR</span>
          </button>
          <button
            type="button"
            onClick={handlePublish}
            disabled={isPublishing}
            className="flex-1 px-3 py-2 rounded-lg bg-[#00F0FF] text-[#090B10] hover:bg-[#33F3FF] disabled:opacity-60 text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isPublishing ? 'Publishing...' : 'Publish Post'}</span>
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
