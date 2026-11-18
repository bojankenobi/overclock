import React, { useState } from 'react';
import { motion } from 'motion/react';
import { showToast } from '@devvit/web/client';
import { Check, Cpu, Lightbulb, Shield, Sparkles, X, Zap } from 'lucide-react';
import {
  HINT_PACK_COST,
  OVERCLOCK_CAP_COSTS,
  SIGNAL_THEMES,
  STREAK_SHIELD_COST,
} from '../shared/economy';
import type {
  PlayerEconomy,
  ShopActionResponse,
  ShopItemId,
  SignalThemeId,
} from '../shared/types';
import { trackJourneyInteraction } from './analytics';

interface ArmoryModalProps {
  economy: PlayerEconomy;
  hints: number;
  onUpdate: (economy: PlayerEconomy, hints: number) => void;
  onClose: () => void;
}

export function ArmoryModal({ economy, hints, onUpdate, onClose }: ArmoryModalProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleAction = async (action: 'buy' | 'equip', itemId: ShopItemId | SignalThemeId) => {
    if (busyId) return;
    setBusyId(itemId);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/shop/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, itemId }),
      });
      const data = (await res.json()) as ShopActionResponse;
      if (res.ok && data.ok) {
        onUpdate(data.economy, data.hints);
        void trackJourneyInteraction(`shop_${action}`, itemId);
        try {
          showToast(action === 'equip' ? 'Theme equipped!' : 'Purchase complete!');
        } catch {
          // Ignore outside Devvit
        }
      } else {
        setErrorMsg(data.error ?? 'Action failed');
      }
    } catch {
      setErrorMsg('Network error');
    } finally {
      setBusyId(null);
    }
  };

  const capLevel = economy.overclockTimeBonusLevel;
  const capMaxed = capLevel >= OVERCLOCK_CAP_COSTS.length;
  const capCost = capMaxed ? 0 : OVERCLOCK_CAP_COSTS[capLevel];

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
        aria-label="Silicon Armory"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[calc(100%-0.5rem)] overflow-y-auto rounded-xl cyber-panel p-4 flex flex-col gap-3.5"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[#FFB800]" />
            <h2 className="font-display text-base font-bold tracking-tight text-white">
              Silicon Armory
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded bg-[#1C140A] border border-[#FFB800]/40 font-mono text-xs font-bold text-[#FFB800] tabular-nums">
              ⚡ {economy.cycles} CYC
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close armory"
              className="w-7 h-7 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-800/60 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="px-3 py-1.5 rounded-md bg-[#2C131C] border border-[#FF4460]/40 text-xs text-[#FF8FA3] font-mono">
            {errorMsg}
          </div>
        )}

        {/* Signal Beam Themes */}
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
            Signal Beam Themes
          </span>
          <div className="grid grid-cols-1 gap-1.5">
            {Object.values(SIGNAL_THEMES).map((theme) => {
              const unlocked = economy.unlockedThemes.includes(theme.id);
              const active = economy.activeTheme === theme.id;
              const canAfford = economy.cycles >= theme.cost;

              return (
                <div
                  key={theme.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#0A0E17] border border-slate-800/80"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-3.5 h-3.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: theme.primary,
                        boxShadow: `0 0 10px ${theme.primary}`,
                      }}
                    />
                    <span className="text-xs font-medium text-slate-100 truncate">
                      {theme.name}
                    </span>
                  </div>

                  {active ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#06241B] border border-[#00FF88]/40 font-mono text-[10px] font-semibold text-[#00FF88]">
                      <Check className="w-3 h-3" />
                      Equipped
                    </span>
                  ) : unlocked ? (
                    <button
                      type="button"
                      onClick={() => handleAction('equip', theme.id)}
                      disabled={busyId !== null}
                      className="px-2.5 py-1 rounded bg-[#161D2C] border border-slate-700 hover:border-[#00F0FF]/60 font-mono text-[11px] text-slate-200 cursor-pointer"
                    >
                      Equip
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleAction('buy', `theme_${theme.id}`)}
                      disabled={!canAfford || busyId !== null}
                      className="px-2.5 py-1 rounded bg-[#1C140A] border border-[#FFB800]/45 hover:bg-[#2A1E0E] disabled:opacity-40 font-mono text-[11px] font-semibold text-[#FFB800] cursor-pointer"
                    >
                      ⚡ {theme.cost}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Tactical Upgrades */}
        <div className="flex flex-col gap-2 border-t border-slate-800/80 pt-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
            Processor Upgrades &amp; Supplies
          </span>

          {/* +1 Hint */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#0A0E17] border border-slate-800/80">
            <div className="flex items-center gap-2.5 min-w-0">
              <Lightbulb className="w-4 h-4 text-amber-300 shrink-0" />
              <div className="flex flex-col leading-tight">
                <span className="text-xs font-medium text-slate-100">
                  Hint Module (+1)
                </span>
                <span className="text-[10px] text-slate-400">Owned: {hints}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleAction('buy', 'hint_1')}
              disabled={economy.cycles < HINT_PACK_COST || busyId !== null}
              className="px-2.5 py-1 rounded bg-[#1C140A] border border-[#FFB800]/45 hover:bg-[#2A1E0E] disabled:opacity-40 font-mono text-[11px] font-semibold text-[#FFB800] cursor-pointer"
            >
              ⚡ {HINT_PACK_COST}
            </button>
          </div>

          {/* Overclock Capacitor */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#0A0E17] border border-slate-800/80">
            <div className="flex items-center gap-2.5 min-w-0">
              <Zap className="w-4 h-4 text-[#C084FC] shrink-0" />
              <div className="flex flex-col leading-tight">
                <span className="text-xs font-medium text-slate-100">
                  Overclock Capacitor (Lv.{capLevel}/3)
                </span>
                <span className="text-[10px] text-slate-400">
                  +2s Overclock start time per level
                </span>
              </div>
            </div>
            {capMaxed ? (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#241338] border border-[#A855F7]/40 font-mono text-[10px] text-[#C084FC]">
                <Sparkles className="w-3 h-3" />
                MAX
              </span>
            ) : (
              <button
                type="button"
                onClick={() => handleAction('buy', 'overclock_cap')}
                disabled={economy.cycles < capCost || busyId !== null}
                className="px-2.5 py-1 rounded bg-[#1C140A] border border-[#FFB800]/45 hover:bg-[#2A1E0E] disabled:opacity-40 font-mono text-[11px] font-semibold text-[#FFB800] cursor-pointer"
              >
                ⚡ {capCost}
              </button>
            )}
          </div>

          {/* Streak Shield */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#0A0E17] border border-slate-800/80">
            <div className="flex items-center gap-2.5 min-w-0">
              <Shield className="w-4 h-4 text-[#00F0FF] shrink-0" />
              <div className="flex flex-col leading-tight">
                <span className="text-xs font-medium text-slate-100">
                  Streak Shield (1x Freeze)
                </span>
                <span className="text-[10px] text-slate-400">
                  Owned: {economy.streakShields} · Auto-protects missed days
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleAction('buy', 'streak_shield')}
              disabled={economy.cycles < STREAK_SHIELD_COST || busyId !== null}
              className="px-2.5 py-1 rounded bg-[#1C140A] border border-[#FFB800]/45 hover:bg-[#2A1E0E] disabled:opacity-40 font-mono text-[11px] font-semibold text-[#FFB800] cursor-pointer"
            >
              ⚡ {STREAK_SHIELD_COST}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
