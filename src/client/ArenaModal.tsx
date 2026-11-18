import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { showToast } from '@devvit/web/client';
import { Flame, Play, Swords, Timer, Trophy, X, Zap } from 'lucide-react';
import type {
  CacheTier,
  DuelListResponse,
  DuelRecord,
  GameMode,
  PlayerEconomy,
} from '../shared/types';
import { trackJourneyInteraction } from './analytics';

export interface PendingDuelDraft {
  type: 'duel' | 'bounty';
  mode: GameMode;
  tier: CacheTier;
  wagerCycles: number;
  wagerPower: number;
  targetUsername?: string;
}

interface ArenaModalProps {
  username: string | null;
  economy: PlayerEconomy;
  currentMode: GameMode;
  currentTier: CacheTier;
  preselectedTarget?: string | null;
  onUpdateEconomy: (econ: PlayerEconomy) => void;
  onStartCreateDuel: (draft: PendingDuelDraft) => void;
  onAcceptDuel: (duel: DuelRecord) => void;
  onClose: () => void;
}

const WAGER_TIERS = [
  { cycles: 50, power: 50, label: 'Skirmish' },
  { cycles: 150, power: 100, label: 'High Stakes' },
  { cycles: 300, power: 200, label: 'All-In' },
];

export function ArenaModal({
  username,
  economy,
  currentMode,
  currentTier,
  preselectedTarget,
  onUpdateEconomy,
  onStartCreateDuel,
  onAcceptDuel,
  onClose,
}: ArenaModalProps) {
  const [tab, setTab] = useState<'open' | 'create'>(preselectedTarget ? 'create' : 'open');
  const [duels, setDuels] = useState<DuelRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedWagerIdx, setSelectedWagerIdx] = useState(0);
  const [duelMode, setDuelMode] = useState<GameMode>(currentMode);
  const [duelTier, setDuelTier] = useState<CacheTier>(currentTier);
  const [targetUser, setTargetUser] = useState(preselectedTarget ?? '');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/duels')
      .then((res) => (res.ok ? (res.json() as Promise<DuelListResponse>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        setDuels(data.duels);
        onUpdateEconomy(data.economy);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onUpdateEconomy]);

  const handleCancel = async (duelId: string) => {
    if (busyId) return;
    setBusyId(duelId);
    try {
      const res = await fetch('/api/duels/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duelId }),
      });
      const data = (await res.json()) as { ok: boolean; economy: PlayerEconomy };
      if (res.ok && data.ok) {
        onUpdateEconomy(data.economy);
        setDuels((prev) =>
          prev.map((d) => (d.id === duelId ? { ...d, status: 'cancelled' } : d))
        );
        try {
          showToast('Duel cancelled — Cycles refunded!');
        } catch {
          // Ignore
        }
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleLaunch = () => {
    const wager = WAGER_TIERS[selectedWagerIdx];
    if (economy.cycles < wager.cycles) {
      try {
        showToast(`Need ${wager.cycles} CYC to launch this wager`);
      } catch {
        // Ignore
      }
      return;
    }
    void trackJourneyInteraction('arena_launch_duel', `${duelMode}_${wager.cycles}`);
    onStartCreateDuel({
      type: targetUser.trim() ? 'duel' : 'bounty',
      mode: duelMode,
      tier: duelTier,
      wagerCycles: wager.cycles,
      wagerPower: wager.power,
      ...(targetUser.trim() ? { targetUsername: targetUser.trim().replace(/^u\//, '') } : {}),
    });
    onClose();
  };

  const openDuels = duels.filter((d) => d.status === 'open');
  const recentDuels = duels.filter((d) => d.status === 'completed').slice(0, 5);

  const formatTarget = (d: DuelRecord) => {
    if (d.mode === 'overclock') return `Beat ${d.creatorMetrics.score} pts`;
    if (d.mode === 'blitz') return `Beat ${(d.creatorMetrics.timeMs / 1000).toFixed(1)}s`;
    return `Beat ${d.creatorMetrics.turns}T · ${(d.creatorMetrics.timeMs / 1000).toFixed(1)}s`;
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
        aria-label="OVERCLOCK Arena"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[calc(100%-0.5rem)] overflow-y-auto rounded-xl cyber-panel p-4 flex flex-col gap-3.5"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
          <div className="flex items-center gap-2">
            <Swords className="w-4 h-4 text-[#FF5C77]" />
            <h2 className="font-display text-base font-bold tracking-tight text-white">
              PvP Arena &amp; Bounties
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-[#1C140A] border border-[#FFB800]/40 font-mono text-xs font-bold text-[#FFB800] tabular-nums">
              ⚡ {economy.cycles} CYC
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close arena"
              className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-800/60 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-[#0A0E17] border border-slate-800">
          <button
            type="button"
            onClick={() => setTab('open')}
            className={`py-1.5 rounded-md font-mono text-xs font-semibold transition-colors cursor-pointer ${
              tab === 'open'
                ? 'bg-[#182235] text-[#00F0FF]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Open Bounties ({openDuels.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('create')}
            className={`py-1.5 rounded-md font-mono text-xs font-semibold transition-colors cursor-pointer ${
              tab === 'create'
                ? 'bg-[#2C131C] text-[#FF5C77]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            + Launch Wager
          </button>
        </div>

        {tab === 'open' ? (
          <div className="flex flex-col gap-3">
            {loading ? (
              <p className="py-8 text-center font-mono text-xs text-slate-500">
                Loading active challenges...
              </p>
            ) : openDuels.length === 0 ? (
              <div className="py-6 px-4 text-center rounded-lg bg-[#0A0E17] border border-slate-800/80 flex flex-col items-center gap-2">
                <p className="text-xs font-medium text-slate-200">
                  No open duels on this subreddit yet
                </p>
                <p className="text-[11px] text-slate-400">
                  Launch a wager, lock your score, and dare other Redditors to beat it!
                </p>
                <button
                  type="button"
                  onClick={() => setTab('create')}
                  className="mt-1 px-3 py-1.5 rounded-lg bg-[#FF4460] text-white text-xs font-semibold cursor-pointer"
                >
                  Create First Duel
                </button>
              </div>
            ) : (
              <ul className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-0.5">
                {openDuels.map((d) => {
                  const isMine = username && d.creatorUsername === username;
                  const canAfford = economy.cycles >= d.wagerCycles;
                  return (
                    <li
                      key={d.id}
                      className="p-3 rounded-lg bg-[#0A0E17] border border-slate-800/90 flex items-center justify-between gap-3"
                    >
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-xs font-semibold text-white">
                            u/{d.creatorUsername}
                          </span>
                          {d.targetUsername && (
                            <span className="font-mono text-[10px] text-[#FF5C77]">
                              → u/{d.targetUsername}
                            </span>
                          )}
                          <span className="px-1.5 py-0.5 rounded bg-[#161D2C] font-mono text-[10px] uppercase text-[#00F0FF]">
                            {d.mode} · {d.tier}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 font-mono text-[11px] text-slate-300">
                          <span className="text-[#00FF88] font-semibold">{formatTarget(d)}</span>
                          <span className="text-slate-600">·</span>
                          <span className="text-[#FFB800]">Pot {d.wagerCycles * 2} CYC</span>
                          <span className="text-slate-600">·</span>
                          <span className="text-[#00F0FF]">±{d.wagerPower} PWR</span>
                        </div>
                      </div>

                      {isMine ? (
                        <button
                          type="button"
                          onClick={() => handleCancel(d.id)}
                          disabled={busyId === d.id}
                          className="px-2.5 py-1.5 rounded-lg bg-[#161D2C] border border-slate-700 text-xs text-slate-300 hover:text-white shrink-0 cursor-pointer"
                        >
                          Refund
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            if (!canAfford) {
                              try {
                                showToast(`Need ${d.wagerCycles} CYC to match this wager`);
                              } catch {
                                // Ignore
                              }
                              return;
                            }
                            onAcceptDuel(d);
                            onClose();
                          }}
                          disabled={!canAfford}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#FF4460] hover:bg-[#FF5C77] disabled:opacity-40 text-white text-xs font-semibold shrink-0 cursor-pointer"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>Accept</span>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {recentDuels.length > 0 && (
              <div className="border-t border-slate-800/80 pt-2.5 flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
                  Recent Settled Duels
                </span>
                {recentDuels.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between text-[11px] font-mono text-slate-400 px-2 py-1 rounded bg-[#0A0E17]/60"
                  >
                    <span className="truncate">
                      <span className="text-[#00FF88]">u/{d.winnerUsername}</span> beat{' '}
                      u/{d.winnerUsername === d.creatorUsername ? d.challengerUsername : d.creatorUsername}
                    </span>
                    <span className="text-[#FFB800] shrink-0">
                      +{d.wagerCycles} CYC / +{d.wagerPower} PWR
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  { id: 'standard', label: 'Daily', icon: Trophy },
                  { id: 'challenge', label: 'Hard', icon: Flame },
                  { id: 'blitz', label: 'Blitz', icon: Timer },
                  { id: 'overclock', label: 'Rush', icon: Zap },
                ] as const
              ).map((m) => {
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setDuelMode(m.id)}
                    className={`py-2 rounded-lg border font-mono text-xs flex items-center justify-center gap-1 cursor-pointer ${
                      duelMode === m.id
                        ? 'bg-[#182235] border-[#00F0FF] text-[#00F0FF]'
                        : 'bg-[#0A0E17] border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{m.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-slate-400">Cache Tier:</span>
              <div className="flex items-center gap-1">
                {(['L0', 'L1', 'L2', 'L3'] as CacheTier[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setDuelTier(t)}
                    className={`px-2.5 py-1 rounded font-mono text-xs border cursor-pointer ${
                      duelTier === t
                        ? 'bg-[#182235] border-[#00F0FF] text-[#00F0FF]'
                        : 'bg-[#0A0E17] border-slate-800 text-slate-400'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {WAGER_TIERS.map((w, idx) => (
                <button
                  key={w.label}
                  type="button"
                  onClick={() => setSelectedWagerIdx(idx)}
                  disabled={economy.cycles < w.cycles}
                  className={`p-2.5 rounded-lg border text-left flex flex-col gap-0.5 cursor-pointer disabled:opacity-40 ${
                    selectedWagerIdx === idx
                      ? 'bg-[#2A1E0E] border-[#FFB800] text-white'
                      : 'bg-[#0A0E17] border-slate-800 text-slate-300'
                  }`}
                >
                  <span className="font-mono text-[10px] uppercase text-slate-400">
                    {w.label}
                  </span>
                  <span className="font-mono text-xs font-bold text-[#FFB800]">
                    ⚡ {w.cycles} CYC
                  </span>
                  <span className="font-mono text-[10px] text-[#00F0FF]">
                    ±{w.power} PWR
                  </span>
                </button>
              ))}
            </div>

            <input
              type="text"
              maxLength={32}
              value={targetUser}
              onChange={(e) => setTargetUser(e.target.value)}
              placeholder="Optional: Target u/username (leave blank for Open Bounty)"
              className="w-full px-3 py-2 rounded-lg bg-[#0A0E17] border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#FF5C77]/60"
            />

            <button
              type="button"
              onClick={handleLaunch}
              className="w-full py-2.5 rounded-lg bg-[#FF4460] hover:bg-[#FF5C77] text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <Swords className="w-4 h-4" />
              <span>Play &amp; Lock Wager</span>
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
