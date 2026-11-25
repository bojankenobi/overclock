import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Check,
  CircuitBoard,
  Copy,
  Cpu,
  Flame,
  Hammer,
  HardDrive,
  HelpCircle,
  Lightbulb,
  MemoryStick,
  MessageSquare,
  MonitorPlay,
  Music,
  RotateCcw,
  Settings,
  Shuffle,
  Sun,
  Swords,
  Timer,
  Trophy,
  Undo2,
  Volume2,
  VolumeX,
  X,
  Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { showToast } from '@devvit/web/client';
import type { PendingDuelDraft } from './ArenaModal';
import type { ComponentResult } from './ComponentGames';
import { GridlockLogo } from './GridlockLogo';

const ArenaModal = lazy(() =>
  import('./ArenaModal').then((m) => ({ default: m.ArenaModal }))
);
const ArmoryModal = lazy(() =>
  import('./ArmoryModal').then((m) => ({ default: m.ArmoryModal }))
);
const CircuitCreatorModal = lazy(() =>
  import('./CircuitCreatorModal').then((m) => ({ default: m.CircuitCreatorModal }))
);
const MoboRouterGame = lazy(() =>
  import('./ComponentGames').then((m) => ({ default: m.MoboRouterGame }))
);
const RamMemoryGame = lazy(() =>
  import('./ComponentGames').then((m) => ({ default: m.RamMemoryGame }))
);
const SsdSequencerGame = lazy(() =>
  import('./ComponentGames').then((m) => ({ default: m.SsdSequencerGame }))
);
const GpuPhotonRaceGame = lazy(() =>
  import('./ComponentGames').then((m) => ({ default: m.GpuPhotonRaceGame }))
);
import { DEFAULT_ECONOMY, getPlayerLevelInfo, SIGNAL_THEMES } from '../shared/economy';
import {
  computeProjection,
  createEnergySurge,
  IsoProjection,
  pickTileFromPoint,
  renderIsometricBoard,
} from './isoRenderer';
import {
  DIR_VECTORS,
  findFirstStepToward,
  formatDateISO,
  generateBlitzStage,
  generateLevel,
  getAllConnectedMoves,
  getHintPathToNextNode,
  getReachableCoords,
  getTodayDateISO,
  getValidNextMoves,
  pickNextOverclockTarget,
} from '../shared/levelGenerator';
import {
  BlitzLeaderboardEntry,
  CacheTier,
  ChallengeLeaderboardEntry,
  CommentResultResponse,
  CompleteRunRequest,
  CompleteRunResponse,
  ComponentCompleteResponse,
  ComponentPillarScores,
  CreateDuelResponse,
  CustomPuzzlePayload,
  DailyCompletionRecord,
  DailyCommunityStats,
  Direction,
  DuelMetrics,
  DuelRecord,
  EnergySurgeEffect,
  GameMode,
  GridCoord,
  HintSegment,
  InitResponse,
  KERNEL_SECTORS,
  KernelSectorSpec,
  LeaderboardEntry,
  OverallLeaderboardEntry,
  OverclockLeaderboardEntry,
  PathStep,
  PlayerEconomy,
  PuzzleLevel,
  ResolveDuelResponse,
  RippleEffect,
  StoryLeaderboardEntry,
  StreakData,
  ValidMove,
} from '../shared/types';
import {
  trackAppReady,
  trackJourneyEnd,
  trackJourneyInteraction,
  trackJourneyProgress,
  trackJourneyStart,
} from './analytics';

const STREAK_STORAGE_KEY = 'gridlock_streak_v1';

interface TerminalLine {
  prefix: string;
  prefixClass: string;
  text: string;
}

function TerminalTypewriter({
  lines,
  resetKey,
}: {
  lines: TerminalLine[];
  resetKey: string;
}) {
  const totalChars = useMemo(
    () => lines.reduce((sum, l) => sum + l.text.length, 0),
    [lines]
  );
  const [typedCount, setTypedCount] = useState<number>(0);

  useEffect(() => {
    setTypedCount(0);
    const id = window.setInterval(() => {
      setTypedCount((prev) => {
        if (prev >= totalChars) {
          window.clearInterval(id);
          return prev;
        }
        return prev + 1;
      });
    }, 18);
    return () => window.clearInterval(id);
  }, [resetKey, totalChars]);

  let remaining = typedCount;
  const isTyping = typedCount < totalChars;

  return (
    <div
      onClick={() => setTypedCount(totalChars)}
      title={isTyping ? 'Tap to complete typing' : undefined}
      className="relative bg-[#02060D] p-3.5 sm:p-4 flex flex-col gap-2.5 text-xs leading-relaxed cursor-pointer overflow-hidden font-mono"
    >
      {/* Subtle CRT scanline sheen */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-20 bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(0,240,255,0.09)_3px)]"
      />
      {lines.map((line, i) => {
        const shownLen = Math.max(0, Math.min(line.text.length, remaining));
        remaining -= line.text.length;
        const shownText = line.text.slice(0, shownLen);
        const showCursorHere =
          (shownLen > 0 && shownLen < line.text.length) ||
          (!isTyping && i === lines.length - 1);

        if (shownLen === 0 && i > 0 && remaining <= 0) {
          return null;
        }

        return (
          <div key={line.prefix} className="relative z-10">
            <span className={`${line.prefixClass} font-bold`}>{line.prefix} </span>
            <span className="text-[#38BDF8] drop-shadow-[0_0_6px_rgba(0,240,255,0.45)]">
              {shownText}
            </span>
            {showCursorHere && (
              <span className="inline-block w-2 h-3.5 ml-0.5 align-middle bg-[#00F0FF] shadow-[0_0_8px_#00F0FF] animate-pulse" />
            )}
          </div>
        );
      })}
      {isTyping && (
        <div className="relative z-10 text-[9px] text-[#00F0FF]/55 text-right tracking-wider">
          [ TAP TERMINAL TO FAST-FORWARD ]
        </div>
      )}
    </div>
  );
}
const HINTS_STORAGE_KEY = 'gridlock_hints_v1';
const HIGH_CONTRAST_STORAGE_KEY = 'gridlock_high_contrast_v1';
const ZEN_MODE_STORAGE_KEY = 'gridlock_zen_mode_v1';
const INITIAL_HINTS = 3;

function loadHighContrastPreference(): boolean {
  try {
    return localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveHighContrastPreference(enabled: boolean) {
  try {
    localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

function loadZenModePreference(): boolean {
  try {
    return localStorage.getItem(ZEN_MODE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function saveZenModePreference(enabled: boolean) {
  try {
    localStorage.setItem(ZEN_MODE_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

function loadHintsBalance(): number {
  try {
    const raw = localStorage.getItem(HINTS_STORAGE_KEY);
    if (raw === null) return INITIAL_HINTS;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : INITIAL_HINTS;
  } catch {
    return INITIAL_HINTS;
  }
}

function saveHintsBalance(count: number) {
  try {
    localStorage.setItem(HINTS_STORAGE_KEY, String(Math.max(0, Math.floor(count))));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

const DEFAULT_STREAK: StreakData = {
  currentStreak: 0,
  bestStreak: 0,
  lastCompletedDate: null,
  completedDates: {},
  completionRecords: {},
  challengeCompletedDates: {},
  challengeRecords: {},
  overclockStats: {
    bestScore: 0,
    bestChain: 0,
    totalRuns: 0,
  },
};

const OVERCLOCK_INITIAL_MS = 20000;
const OVERCLOCK_MAX_MS = 30000;
const EMPTY_NODE_SET = new Set<number>();

function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = Math.max(1, Math.round(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function parseCompletionRecords(
  rawRecords: unknown
): Record<string, DailyCompletionRecord> {
  const cleanRecords: Record<string, DailyCompletionRecord> = {};
  if (rawRecords && typeof rawRecords === 'object') {
    for (const [dateKey, rec] of Object.entries(rawRecords as Record<string, unknown>)) {
      if (
        rec &&
        typeof rec === 'object' &&
        typeof (rec as DailyCompletionRecord).bestTurns === 'number' &&
        typeof (rec as DailyCompletionRecord).par === 'number' &&
        typeof (rec as DailyCompletionRecord).nodesCollected === 'number'
      ) {
        const r = rec as DailyCompletionRecord;
        cleanRecords[dateKey] = {
          dayNumber: typeof r.dayNumber === 'number' ? r.dayNumber : 1,
          bestTurns: r.bestTurns,
          par: r.par,
          nodesCollected: r.nodesCollected,
          bestTimeMs: typeof r.bestTimeMs === 'number' ? r.bestTimeMs : null,
          completedAt:
            typeof r.completedAt === 'string' ? r.completedAt : `${dateKey}T12:00:00.000Z`,
          ...(typeof r.bestMoves === 'number' ? { bestMoves: r.bestMoves } : {}),
          ...(typeof r.moveLimit === 'number' ? { moveLimit: r.moveLimit } : {}),
        };
      }
    }
  }
  return cleanRecords;
}

function loadStreakData(): StreakData {
  try {
    const raw = localStorage.getItem(STREAK_STORAGE_KEY);
    if (!raw) return DEFAULT_STREAK;
    const parsed = JSON.parse(raw) as Partial<StreakData>;
    return {
      currentStreak: typeof parsed.currentStreak === 'number' ? parsed.currentStreak : 0,
      bestStreak: typeof parsed.bestStreak === 'number' ? parsed.bestStreak : 0,
      lastCompletedDate:
        typeof parsed.lastCompletedDate === 'string' ? parsed.lastCompletedDate : null,
      completedDates:
        parsed.completedDates && typeof parsed.completedDates === 'object'
          ? parsed.completedDates
          : {},
      completionRecords: parseCompletionRecords(parsed.completionRecords),
      challengeCompletedDates:
        parsed.challengeCompletedDates && typeof parsed.challengeCompletedDates === 'object'
          ? parsed.challengeCompletedDates
          : {},
      challengeRecords: parseCompletionRecords(parsed.challengeRecords),
      overclockStats:
        parsed.overclockStats && typeof parsed.overclockStats === 'object'
          ? {
              bestScore:
                typeof parsed.overclockStats.bestScore === 'number'
                  ? parsed.overclockStats.bestScore
                  : 0,
              bestChain:
                typeof parsed.overclockStats.bestChain === 'number'
                  ? parsed.overclockStats.bestChain
                  : 0,
              totalRuns:
                typeof parsed.overclockStats.totalRuns === 'number'
                  ? parsed.overclockStats.totalRuns
                  : 0,
            }
          : DEFAULT_STREAK.overclockStats,
    };
  } catch {
    return DEFAULT_STREAK;
  }
}

function saveStreakData(data: StreakData) {
  try {
    localStorage.setItem(STREAK_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

function getPreviousDateISO(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  const py = dt.getUTCFullYear();
  const pm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const pd = String(dt.getUTCDate()).padStart(2, '0');
  return `${py}-${pm}-${pd}`;
}

function getNextDateISO(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  const py = dt.getUTCFullYear();
  const pm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const pd = String(dt.getUTCDate()).padStart(2, '0');
  return `${py}-${pm}-${pd}`;
}

// ---------------------------------------------------------------------------
// Procedural Web Audio Synth & Ambient Engine
// ---------------------------------------------------------------------------
import { sound } from './soundEngine';

function buildSpoilerFreeResult(
  level: PuzzleLevel,
  path: PathStep[],
  turns: number,
  missteps: number = 0
): string {
  const tokens: string[] = ['🟦'];
  let sawBridgeSinceLast = false;

  for (let i = 1; i < path.length - 1; i++) {
    const step = path[i];
    const tile = level.tiles[step.y]?.[step.x];
    if (!tile) continue;
    if (tile.type === 'bridge') {
      sawBridgeSinceLast = true;
    }
    if (tile.feature === 'node') {
      if (sawBridgeSinceLast) {
        tokens.push('🟪');
        sawBridgeSinceLast = false;
      }
      tokens.push('🟨');
    } else if (step.causedTurnAtPrev && tokens[tokens.length - 1] !== '⬜' && tokens.length < 7) {
      tokens.push('⬜');
    }
  }
  tokens.push('🟦');

  const efficiency = turns <= level.par ? '⚡' : '✦';
  const cleanTag = missteps === 0 ? '✨ Clean' : `${missteps} Err`;
  if (level.mode === 'challenge' && level.moveLimit !== undefined) {
    const movesUsed = Math.max(0, path.length - 1);
    return `OVERCLOCK CHALLENGE #${level.dayNumber} • ${turns}/${level.par} Turns • ${movesUsed}/${level.moveLimit} Moves • ${cleanTag} ${efficiency} | ${tokens.join('')}`;
  }
  return `OVERCLOCK #${level.dayNumber} • ${turns}/${level.par} Turns • ${cleanTag} ${efficiency} | ${tokens.join('')}`;
}

export default function App() {
  const todayISO = useMemo(() => getTodayDateISO(), []);
  const [seedDate, setSeedDate] = useState<string>(todayISO);
  const [gameMode, setGameMode] = useState<GameMode>('standard');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => sound.enabled);
  const [musicEnabled, setMusicEnabled] = useState<boolean>(() => sound.musicEnabled);
  const [musicVolume, setMusicVolume] = useState<number>(() => sound.musicVolume);
  const [streakData, setStreakData] = useState<StreakData>(() => loadStreakData());
  const [hints, setHints] = useState<number>(() => loadHintsBalance());

  // Preset recent dates for quick testing dropdown
  const presetDates = useMemo(() => {
    const list: string[] = [];
    const [y, m, d] = todayISO.split('-').map(Number);
    for (let offset = 0; offset < 7; offset++) {
      const dt = new Date(Date.UTC(y, m - 1, d - offset));
      list.push(
        formatDateISO(new Date(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()))
      );
    }
    return list;
  }, [todayISO]);

  const [customPuzzle, setCustomPuzzle] = useState<CustomPuzzlePayload | null>(null);
  const [showCreator, setShowCreator] = useState<boolean>(false);
  const [blitzStage, setBlitzStage] = useState<0 | 1 | 2>(0);
  const [blitzTotalTurns, setBlitzTotalTurns] = useState<number>(0);
  const [blitzElapsedMs, setBlitzElapsedMs] = useState<number>(0);
  const [blitzStarted, setBlitzStarted] = useState<boolean>(false);
  const [blitzLeaderboard, setBlitzLeaderboard] = useState<BlitzLeaderboardEntry[]>([]);
  const [challengeLeaderboard, setChallengeLeaderboard] = useState<ChallengeLeaderboardEntry[]>([]);
  const [overallLeaderboard, setOverallLeaderboard] = useState<OverallLeaderboardEntry[]>([]);
  const [myPillars, setMyPillars] = useState<ComponentPillarScores>({});
  const [economy, setEconomy] = useState<PlayerEconomy>(DEFAULT_ECONOMY);
  const [username, setUsername] = useState<string | null>(null);
  const [showArmory, setShowArmory] = useState<boolean>(false);
  const [showArena, setShowArena] = useState<boolean>(false);
  const [arenaTargetUser, setArenaTargetUser] = useState<string | null>(null);
  const [pendingDuelDraft, setPendingDuelDraft] = useState<PendingDuelDraft | null>(null);
  const [activeDuel, setActiveDuel] = useState<DuelRecord | null>(null);
  const [duelOutcome, setDuelOutcome] = useState<{
    won: boolean;
    wagerCycles: number;
    wagerPower: number;
    opponent: string;
  } | null>(null);
  const [earnedCyclesOnWin, setEarnedCyclesOnWin] = useState<number>(0);
  const [earnedPowerOnWin, setEarnedPowerOnWin] = useState<number>(0);
  const [lbTab, setLbTab] = useState<'daily' | 'challenge' | 'blitz' | 'overclock' | 'overall' | 'story'>('overall');
  const [storyLeaderboard, setStoryLeaderboard] = useState<StoryLeaderboardEntry[]>([]);
  const [cacheTier, setCacheTier] = useState<CacheTier>('L1');
  const [rngSalt, setRngSalt] = useState<number>(0);
  const [modeSeedNonce, setModeSeedNonce] = useState<number>(
    () => Math.floor(Math.random() * 900000) + 1
  );
  const [storyRunSeed, setStoryRunSeed] = useState<number>(
    () => Math.floor(Math.random() * 900000) + 1
  );
  const [missteps, setMissteps] = useState<number>(0);
  const [storyAttempts, setStoryAttempts] = useState<number>(1);
  const [storyTotalAttempts, setStoryTotalAttempts] = useState<number>(0);
  const [storyTotalTimeMs, setStoryTotalTimeMs] = useState<number>(0);
  const [storyLiveMs, setStoryLiveMs] = useState<number>(0);
  const [unlockedSector, setUnlockedSector] = useState<number>(() => {
    try {
      const saved = parseInt(localStorage.getItem('gridlock_unlocked_sector') ?? '1', 10);
      return Number.isFinite(saved) ? Math.max(1, Math.min(KERNEL_SECTORS.length, saved)) : 1;
    } catch {
      return 1;
    }
  });
  const [activeSector, setActiveSector] = useState<number>(() => {
    try {
      const saved = parseInt(localStorage.getItem('gridlock_unlocked_sector') ?? '1', 10);
      return Number.isFinite(saved) ? Math.max(1, Math.min(KERNEL_SECTORS.length, saved)) : 1;
    } catch {
      return 1;
    }
  });
  const [unlockedSectorOnWin, setUnlockedSectorOnWin] = useState<KernelSectorSpec | null>(null);
  const [isStoryMode, setIsStoryMode] = useState<boolean>(false);
  const [showStoryBriefing, setShowStoryBriefing] = useState<boolean>(false);
  const [storyComponent, setStoryComponent] = useState<'mobo' | 'ram' | 'ssd' | 'gpu' | 'cpu'>('mobo');
  const [storyDifficulty, setStoryDifficulty] = useState<'easy' | 'normal' | 'hard'>('normal');
  const [componentClearedResult, setComponentClearedResult] = useState<{
    stage: 'mobo' | 'ram' | 'ssd' | 'gpu';
    result: ComponentResult;
  } | null>(null);
  const [dailyChallengeModule, setDailyChallengeModule] = useState<
    'cpu' | 'ram' | 'ssd' | 'gpu' | 'mobo'
  >('cpu');
  const [standaloneRamSeed, setStandaloneRamSeed] = useState<number>(() =>
    Math.floor(Math.random() * 900000) + 1
  );
  const [standaloneRamResult, setStandaloneRamResult] = useState<ComponentResult | null>(null);
  const [dailyDoneMap, setDailyDoneMap] = useState<
    Partial<Record<'cpu' | 'mobo' | 'ram' | 'ssd' | 'gpu', { clearedAt: number }>>
  >(() => {
    try {
      const raw = localStorage.getItem(`overclock_daily_done_${seedDate}`);
      return raw ? (JSON.parse(raw) as Partial<Record<'cpu' | 'mobo' | 'ram' | 'ssd' | 'gpu', { clearedAt: number }>>) : {};
    } catch {
      return {};
    }
  });

  const markDailyModuleDone = useCallback(
    (mod: 'cpu' | 'mobo' | 'ram' | 'ssd' | 'gpu') => {
      setDailyDoneMap((prev) => {
        if (prev[mod]) return prev;
        const next = { ...prev, [mod]: { clearedAt: Date.now() } };
        try {
          localStorage.setItem(`overclock_daily_done_${seedDate}`, JSON.stringify(next));
        } catch {
          // Ignore storage errors
        }
        return next;
      });
    },
    [seedDate]
  );

  const isDailyModuleLocked = useCallback(
    (mod: 'cpu' | 'mobo' | 'ram' | 'ssd' | 'gpu') => {
      if (mod === 'cpu') {
        return Boolean(dailyDoneMap.cpu || streakData.completedDates[seedDate] !== undefined);
      }
      return Boolean(dailyDoneMap[mod]);
    },
    [dailyDoneMap, streakData.completedDates, seedDate]
  );

  const nextUnfinishedDailyModule = useMemo(() => {
    const order: Array<'cpu' | 'mobo' | 'ram' | 'ssd' | 'gpu'> = ['cpu', 'mobo', 'ram', 'ssd', 'gpu'];
    return order.find((m) => !isDailyModuleLocked(m)) ?? null;
  }, [isDailyModuleLocked]);

  const cpuRenderPausedRef = useRef<boolean>(false);
  cpuRenderPausedRef.current =
    (isStoryMode && storyComponent !== 'cpu') ||
    (!isStoryMode && dailyChallengeModule !== 'cpu');

  const CACHE_TIERS: CacheTier[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];
  const currentSectorSpec: KernelSectorSpec =
    KERNEL_SECTORS[Math.max(0, Math.min(KERNEL_SECTORS.length - 1, activeSector - 1))];

  const STORY_COMPONENT_SPECS: Record<
    'mobo' | 'ram' | 'ssd' | 'gpu',
    {
      slot: string;
      codeName: string;
      difficulty: 'EASY' | 'NORMAL' | 'HARD';
      badge: string;
      incident: string;
      directive: string;
      cta: string;
    }
  > = {
    mobo: {
      slot: '01/05 · MOBO',
      codeName: 'PCB_00 // THE SHATTERED BACKPLANE',
      difficulty: 'EASY',
      badge: 'EASY · 5×5→6×6 · PCB',
      incident:
        'The inner Grid is fracturing into entropy. Its copper meridians are severed, leaving the mainframe in darkness.',
      directive:
        'Re-align the 2.5D PCB traces from the PSU Core to all four subsystem sockets to begin restoring the Divine Quantum State.',
      cta: '[ ENTER GRID: WIRE BACKPLANE ]',
    },
    ram: {
      slot: '02/05 · RAM',
      codeName: 'DIMM_01 // VOLATILE ECHOES',
      difficulty: 'EASY',
      badge: 'EASY · 5×5→7×7 · VOLATILE',
      incident:
        'Power flows, yet the Grid’s volatile memory is fading into static. Ghostly light-sectors flicker before vanishing.',
      directive:
        'Imprint the glowing 2.5D registers across Matrix, Sequence Echo, and Glitch Filter before the Grid forgets itself.',
      cta: '[ ENTER GRID: IMPRINT MEMORY ]',
    },
    ssd: {
      slot: '03/05 · SSD',
      codeName: 'NVME_02 // ARCHIVE FRACTURE',
      difficulty: 'NORMAL',
      badge: 'NORMAL · 5×5→7×7 · NVME',
      incident:
        'Corrupted daemons have shattered the kernel archives. Time and sequence inside the Grid are broken.',
      directive:
        'Link data sectors in pure order (Defrag, Parity, Purge) while evading crimson ERR anomalies.',
      cta: '[ ENTER GRID: REBUILD ARCHIVE ]',
    },
    gpu: {
      slot: '04/05 · GPU',
      codeName: 'SHADER_03 // LIGHT-CYCLE CORRIDOR',
      difficulty: 'HARD',
      badge: 'NORMAL/HARD · 2.5D BUS',
      incident:
        'Only the Photon Bus remains between you and the dying CPU Core — guarded by walls of crimson firewall light.',
      directive:
        'Pilot the 3D Quantum Orb down the corridor. Harvest 12 Amber Shaders and breach the firewall.',
      cta: '[ ENTER GRID: RIDE PHOTON BUS ]',
    },
  };

  const enterStoryMode = useCallback((sectorNum?: number, freshRun = false) => {
    const isFreshAssembly = freshRun || sectorNum === undefined;
    const target = isFreshAssembly ? 1 : sectorNum;
    const spec = KERNEL_SECTORS[Math.max(0, Math.min(KERNEL_SECTORS.length - 1, target - 1))];
    if (isFreshAssembly) {
      setStoryRunSeed(Math.floor(Math.random() * 900000) + 1);
      setStoryTotalAttempts(0);
      setStoryTotalTimeMs(0);
      setStoryComponent('mobo');
      setComponentClearedResult(null);
    } else {
      setStoryComponent('cpu');
      setComponentClearedResult(null);
    }
    setStoryAttempts(1);
    setStoryLiveMs(0);
    setActiveSector(spec.sector);
    setIsStoryMode(true);
    setGameMode(spec.mode);
    setCacheTier(spec.tier);
    setRngSalt(0);
    setShowStoryBriefing(true);
  }, []);

  const handleComponentComplete = useCallback(
    (stage: 'mobo' | 'ram' | 'ssd' | 'gpu', res: ComponentResult) => {
      setStoryTotalAttempts((prev) => prev + res.attempts);
      setStoryTotalTimeMs((prev) => prev + res.timeMs);
      sound.win();
      setComponentClearedResult({ stage, result: res });
    },
    []
  );

  const advanceFromComponentDebrief = useCallback(() => {
    if (!componentClearedResult) return;
    const { stage } = componentClearedResult;
    setComponentClearedResult(null);
    if (stage === 'mobo') {
      setStoryComponent('ram');
      setShowStoryBriefing(true);
      return;
    }
    if (stage === 'ram') {
      setStoryComponent('ssd');
      setShowStoryBriefing(true);
      return;
    }
    if (stage === 'ssd') {
      setStoryComponent('gpu');
      setShowStoryBriefing(true);
      return;
    }
    setStoryComponent('cpu');
    setActiveSector(1);
    setStoryAttempts(1);
    setStoryLiveMs(0);
    setGameMode(KERNEL_SECTORS[0].mode);
    setCacheTier(KERNEL_SECTORS[0].tier);
    setShowStoryBriefing(true);
  }, [componentClearedResult]);

  const handleStandaloneRamComplete = useCallback(
    (res: ComponentResult) => {
      const mod = dailyChallengeModule;
      if (mod === 'cpu') return;
      const variant = gameMode === 'challenge' ? 'challenge' : 'daily';
      const modeName =
        res.moboMode ?? res.gpuMode ?? res.ssdMode ?? res.memoryMode ?? 'matrix';

      if (gameMode === 'standard') {
        markDailyModuleDone(mod);
      }
      setStandaloneRamResult(res);

      void (async () => {
        try {
          const resp = await fetch('/api/component-complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              module: mod,
              variant,
              gridSize: res.gridSize,
              mode: modeName,
              attempts: res.attempts,
              missteps: res.missteps,
              timeMs: res.timeMs,
            }),
          });
          if (resp.ok) {
            const data = (await resp.json()) as ComponentCompleteResponse;
            setEconomy(data.economy);
            setMyPillars(data.pillars);
            setOverallLeaderboard(data.overallLeaderboard);
            showToast(
              `${mod.toUpperCase()} +${data.score} PTS${data.isNewBest ? ' (NEW BEST!)' : ''}`
            );
            return;
          }
        } catch {
          // Fallback to local state update
        }
        const cycReward = variant === 'challenge' ? 65 : 35;
        const pwrReward = variant === 'challenge' ? 45 : 25;
        setEconomy((prev) => ({
          ...prev,
          cycles: prev.cycles + cycReward,
          powerScore: prev.powerScore + pwrReward,
        }));
        showToast(`${mod.toUpperCase()} cleared! +${cycReward} CYC`);
      })();
    },
    [gameMode, dailyChallengeModule]
  );

  const randomizeModeBoard = useCallback(() => {
    setModeSeedNonce(Math.floor(Math.random() * 900000) + 1);
  }, []);

  const completedChallengeCount = Object.keys(streakData.challengeCompletedDates ?? {}).length;
  const challengeEscalatedTier: CacheTier =
    completedChallengeCount >= 4
      ? 'L5'
      : completedChallengeCount >= 3
        ? 'L4'
        : completedChallengeCount >= 2
          ? 'L3'
          : completedChallengeCount >= 1
            ? 'L2'
            : 'L1';
  const challengeEscalatedGridSize =
    completedChallengeCount >= 4
      ? 10
      : completedChallengeCount >= 3
        ? 9
        : completedChallengeCount >= 2
          ? 8
          : completedChallengeCount >= 1
            ? 7
            : 6;

  // Auto-escalate Daily Challenge difficulty as player completes more challenges
  useEffect(() => {
    if (!isStoryMode && gameMode === 'challenge' && !activeDuel) {
      if (cacheTier !== challengeEscalatedTier) {
        setCacheTier(challengeEscalatedTier);
      }
      if (rngSalt !== 0) {
        setRngSalt(0);
      }
    }
  }, [isStoryMode, gameMode, activeDuel, challengeEscalatedTier, cacheTier, rngSalt]);

  const cycleCacheTier = useCallback(() => {
    if (isStoryMode || gameMode !== 'standard') return;
    setActiveSector((prev) => {
      const next = prev >= unlockedSector ? 1 : prev + 1;
      const spec = KERNEL_SECTORS[next - 1];
      setCacheTier(spec.tier);
      return next;
    });
    setRngSalt((prev) => (prev === 0 ? 1 : prev + 1));
  }, [isStoryMode, gameMode, unlockedSector]);

  const triggerNewRngGrid = useCallback((escalateTier = false) => {
    if (isStoryMode || gameMode !== 'standard') return;
    if (escalateTier) {
      setActiveSector((prev) => {
        const next = Math.min(unlockedSector, prev + 1);
        const spec = KERNEL_SECTORS[next - 1];
        setCacheTier(spec.tier);
        return next;
      });
    } else {
      setCacheTier(currentSectorSpec.tier);
    }
    setRngSalt((prev) => prev + 1);
  }, [isStoryMode, gameMode, unlockedSector, currentSectorSpec.tier]);

  // Deterministic puzzle generation + exact optimal PAR verification (or community custom level)
  const level: PuzzleLevel = useMemo(() => {
    if (isStoryMode) {
      return generateLevel(
        seedDate,
        currentSectorSpec.mode,
        currentSectorSpec.tier,
        storyRunSeed + currentSectorSpec.sector * 100,
        currentSectorSpec.gridSize
      );
    }
    if (gameMode === 'blitz') return generateBlitzStage(seedDate, blitzStage, modeSeedNonce);
    if (customPuzzle && gameMode === 'standard' && rngSalt === 0) return customPuzzle.level;
    const effectiveSalt = rngSalt > 0 ? modeSeedNonce + rngSalt * 7919 : modeSeedNonce;
    if (gameMode === 'challenge') {
      return generateLevel(
        seedDate,
        gameMode,
        cacheTier,
        activeDuel ? activeDuel.rngSalt : effectiveSalt,
        activeDuel ? 7 : challengeEscalatedGridSize
      );
    }
    if (gameMode === 'standard' && rngSalt > 0) {
      return generateLevel(
        seedDate,
        gameMode,
        currentSectorSpec.tier,
        effectiveSalt,
        currentSectorSpec.gridSize
      );
    }
    return generateLevel(seedDate, gameMode, cacheTier, effectiveSalt, 7);
  }, [
    isStoryMode,
    storyRunSeed,
    modeSeedNonce,
    currentSectorSpec.mode,
    currentSectorSpec.tier,
    currentSectorSpec.sector,
    currentSectorSpec.gridSize,
    customPuzzle,
    seedDate,
    gameMode,
    blitzStage,
    cacheTier,
    rngSalt,
    activeDuel,
    challengeEscalatedGridSize,
  ]);

  // Game play state
  const [path, setPath] = useState<PathStep[]>(() => [
    {
      x: level.start.x,
      y: level.start.y,
      level: level.start.level,
      dirFromPrev: null,
      causedTurnAtPrev: false,
    },
  ]);
  const [hasMovedOnce, setHasMovedOnce] = useState<boolean>(false);
  const [hoveredMove, setHoveredMove] = useState<ValidMove | null>(null);
  const [activeHint, setActiveHint] = useState<HintSegment | null>(null);
  const [ripples, setRipples] = useState<RippleEffect[]>([]);
  const [energySurge, setEnergySurge] = useState<EnergySurgeEffect | null>(null);
  const [isSolved, setIsSolved] = useState<boolean>(false);
  const [earnedHintsOnWin, setEarnedHintsOnWin] = useState<number>(0);
  const [isPersonalBestOnWin, setIsPersonalBestOnWin] = useState<boolean>(false);
  const [lastSolveTimeMs, setLastSolveTimeMs] = useState<number | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [commentPosted, setCommentPosted] = useState<boolean>(false);
  const [isPostingComment, setIsPostingComment] = useState<boolean>(false);
  const [dailyStats, setDailyStats] = useState<DailyCommunityStats>({
    totalSolves: 0,
    parHits: 0,
  });
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [overclockLeaderboard, setOverclockLeaderboard] = useState<OverclockLeaderboardEntry[]>([]);
  const [dailyRank, setDailyRank] = useState<{ rank: number; total: number } | null>(null);
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [showStats, setShowStats] = useState<boolean>(false);
  const [statsMode, setStatsMode] = useState<'standard' | 'challenge'>('standard');
  const [hoveredStreakDay, setHoveredStreakDay] = useState<string | null>(null);
  const [highContrastPatterns, setHighContrastPatterns] = useState<boolean>(() =>
    loadHighContrastPreference()
  );
  const [sunlightMode, setSunlightMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('gridlock_sunlight_mode') === 'true';
    } catch {
      return false;
    }
  });
  const [zenMode, setZenMode] = useState<boolean>(() => loadZenModePreference());
  const [contextualHint, setContextualHint] = useState<string | null>(null);
  const contextualHintTimerRef = useRef<number | null>(null);

  const triggerContextualHint = useCallback((message: string) => {
    setContextualHint(message);
    if (contextualHintTimerRef.current !== null) {
      window.clearTimeout(contextualHintTimerRef.current);
    }
    contextualHintTimerRef.current = window.setTimeout(() => {
      contextualHintTimerRef.current = null;
      setContextualHint(null);
    }, 2400);
  }, []);

  useEffect(() => {
    void trackAppReady();
    let cancelled = false;
    fetch('/api/init')
      .then((res) => (res.ok ? (res.json() as Promise<InitResponse>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        setSeedDate(data.seedDate);
        setUsername(data.username);
        setStreakData(data.streakData);
        saveStreakData(data.streakData);
        setHints(data.hints);
        saveHintsBalance(data.hints);
        setDailyStats(data.dailyStats);
        setLeaderboard(data.leaderboard);
        setChallengeLeaderboard(data.challengeLeaderboard ?? []);
        setOverclockLeaderboard(data.overclockLeaderboard);
        setBlitzLeaderboard(data.blitzLeaderboard ?? []);
        setOverallLeaderboard(data.overallLeaderboard ?? []);
        setStoryLeaderboard(data.storyLeaderboard ?? []);
        if (data.myPillars) {
          setMyPillars(data.myPillars);
        }
        if (data.economy) {
          setEconomy(data.economy);
        }
        if (data.customPuzzle) {
          setCustomPuzzle(data.customPuzzle);
        }
      })
      .catch(() => {
        // Standalone fallback uses local storage
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Overclock (Real-Time Signal Rush) state
  const [overclockTarget, setOverclockTarget] = useState<GridCoord>(
    () => level.nodes[0] ?? level.start
  );
  const [overclockScore, setOverclockScore] = useState<number>(0);
  const [overclockChain, setOverclockChain] = useState<number>(0);
  const [overclockTimeLeftMs, setOverclockTimeLeftMs] = useState<number>(OVERCLOCK_INITIAL_MS);
  const [overclockStarted, setOverclockStarted] = useState<boolean>(false);

  const winTimerRef = useRef<number | null>(null);
  const solveStartTimeRef = useRef<number | null>(null);

  // Reset board cleanly whenever seedDate / level changes
  const resetPuzzle = useCallback(
    (targetLevel: PuzzleLevel = level, isManualReset = false) => {
      if (winTimerRef.current !== null) {
        window.clearTimeout(winTimerRef.current);
        winTimerRef.current = null;
      }
      solveStartTimeRef.current = null;
      setPath([
        {
          x: targetLevel.start.x,
          y: targetLevel.start.y,
          level: targetLevel.start.level,
          dirFromPrev: null,
          causedTurnAtPrev: false,
        },
      ]);
      setHoveredMove(null);
      setActiveHint(null);
      setRipples([]);
      setEnergySurge(null);
      setIsSolved(false);
      setEarnedHintsOnWin(0);
      setIsPersonalBestOnWin(false);
      setLastSolveTimeMs(null);
      setCopied(false);
      setCommentPosted(false);
      setDailyRank(null);
      setDuelOutcome(null);
      setOverclockTarget(targetLevel.nodes[0] ?? targetLevel.start);
      setOverclockScore(0);
      setOverclockChain(0);
      setOverclockTimeLeftMs(
        OVERCLOCK_INITIAL_MS + economy.overclockTimeBonusLevel * 2000
      );
      setOverclockStarted(false);
      if (targetLevel.mode === 'blitz' && isManualReset) {
        setBlitzStage(0);
        setBlitzTotalTurns(0);
        setBlitzElapsedMs(0);
        setBlitzStarted(false);
      }
    },
    [level, economy.overclockTimeBonusLevel]
  );

  // Reset Blitz stage/timer only when entering Blitz mode
  useEffect(() => {
    if (gameMode === 'blitz') {
      setBlitzStage(0);
      setBlitzTotalTurns(0);
      setBlitzElapsedMs(0);
      setBlitzStarted(false);
    }
  }, [gameMode]);

  useEffect(() => {
    return () => {
      if (winTimerRef.current !== null) {
        window.clearTimeout(winTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setMissteps(0);
    resetPuzzle(level);
  }, [level, resetPuzzle]);

  // Precomputed reachable 2.5D tiles for Overclock target spawns
  const overclockReachable = useMemo(
    () => (level.mode === 'overclock' ? getReachableCoords(level.tiles, level.start) : []),
    [level]
  );

  // Derived board view so Overclock dynamically swaps the active Energy Node without regenerating the CPU grid
  const displayLevel: PuzzleLevel = useMemo(() => {
    if (level.mode !== 'overclock') return level;
    const nextTiles = level.tiles.map((row) =>
      row.map((tile) => {
        const isTarget = tile.x === overclockTarget.x && tile.y === overclockTarget.y;
        if (isTarget) {
          return {
            ...tile,
            feature: 'node' as const,
            nodeIndex: 0,
          };
        }
        if (tile.feature === 'node') {
          const isStart = tile.x === level.start.x && tile.y === level.start.y;
          return {
            ...tile,
            feature: isStart ? ('start' as const) : null,
            nodeIndex: undefined,
          };
        }
        return tile;
      })
    );
    return {
      ...level,
      tiles: nextTiles,
      nodes: [{ ...overclockTarget, index: 0 }],
    };
  }, [level, overclockTarget]);

  // Derived gameplay metrics
  const turns = useMemo(() => {
    let count = 0;
    for (const step of path) {
      if (step.causedTurnAtPrev) count++;
    }
    return count;
  }, [path]);

  const movesUsed = Math.max(0, path.length - 1);
  const moveLimit = level.mode === 'challenge' ? (level.moveLimit ?? null) : null;
  const movesLeft = moveLimit !== null ? Math.max(0, moveLimit - movesUsed) : null;
  const isOutOfMoves =
    level.mode === 'challenge' &&
    moveLimit !== null &&
    movesUsed >= moveLimit &&
    !isSolved &&
    energySurge === null;

  const collectedNodeIndices = useMemo(() => {
    if (level.mode === 'overclock') return EMPTY_NODE_SET;
    const set = new Set<number>();
    for (const step of path) {
      const tile = level.tiles[step.y]?.[step.x];
      if (tile && tile.feature === 'node' && tile.nodeIndex !== undefined) {
        set.add(tile.nodeIndex);
      }
    }
    return set;
  }, [path, level]);

  const validMoves = useMemo(() => {
    if (isSolved || energySurge !== null || isOutOfMoves) return [];
    const tip = path[path.length - 1];
    if (!tip || !level.tiles[tip.y]?.[tip.x]) return [];
    if (level.mode === 'overclock') {
      return getAllConnectedMoves(level.tiles, tip);
    }
    return getValidNextMoves(
      level.tiles,
      path,
      collectedNodeIndices.size,
      level.nodes.length
    );
  }, [level, path, collectedNodeIndices.size, isSolved, energySurge, isOutOfMoves]);

  // Derived Player Stats aggregated from localStorage streakData (per mode)
  const playerStats = useMemo(() => {
    const isChallengeStats = statsMode === 'challenge';
    const records =
      (isChallengeStats ? streakData.challengeRecords : streakData.completionRecords) ?? {};
    const dateTurnsMap =
      (isChallengeStats ? streakData.challengeCompletedDates : streakData.completedDates) ?? {};
    const allDates = Array.from(
      new Set([...Object.keys(dateTurnsMap), ...Object.keys(records)])
    ).sort((a, b) => b.localeCompare(a));

    const history = allDates.map((dateKey) => {
      const existingRec = records[dateKey];
      const storedTurns = dateTurnsMap[dateKey];
      if (existingRec) {
        const bestTurns =
          storedTurns !== undefined
            ? Math.min(storedTurns, existingRec.bestTurns)
            : existingRec.bestTurns;
        return {
          seedDate: dateKey,
          dayNumber: existingRec.dayNumber,
          bestTurns,
          par: existingRec.par,
          nodesCollected: existingRec.nodesCollected,
          bestTimeMs: existingRec.bestTimeMs,
          completedAt: existingRec.completedAt,
          bestMoves: existingRec.bestMoves,
          moveLimit: existingRec.moveLimit,
        };
      }
      const generated = generateLevel(dateKey, statsMode);
      return {
        seedDate: dateKey,
        dayNumber: generated.dayNumber,
        bestTurns: storedTurns ?? generated.par,
        par: generated.par,
        nodesCollected: generated.nodes.length,
        bestTimeMs: null as number | null,
        completedAt: `${dateKey}T12:00:00.000Z`,
        bestMoves: undefined as number | undefined,
        moveLimit: generated.moveLimit,
      };
    });

    const totalSolved = history.length;
    const parSolvedCount = history.filter((item) => item.bestTurns <= item.par).length;
    const parPerformancePct =
      totalSolved > 0 ? Math.round((parSolvedCount / totalSolved) * 100) : 0;
    const totalNodesCollected = history.reduce((sum, item) => sum + item.nodesCollected, 0);
    const timedSolves = history.filter(
      (item): item is typeof item & { bestTimeMs: number } => item.bestTimeMs !== null
    );
    const fastestTimeMs =
      timedSolves.length > 0 ? Math.min(...timedSolves.map((item) => item.bestTimeMs)) : null;
    const avgTimeMs =
      timedSolves.length > 0
        ? Math.round(
            timedSolves.reduce((sum, item) => sum + item.bestTimeMs, 0) / timedSolves.length
          )
        : null;

    const historyByDate = new Map(history.map((item) => [item.seedDate, item]));

    // Build chronological last 7 days (today - 6 days -> today) with consecutive streak per day
    const last7DaysStreak: Array<{
      seedDate: string;
      weekdayLabel: string;
      dayOfMonth: string;
      streakCount: number;
      completed: (typeof history)[number] | null;
      hitPar: boolean;
      isToday: boolean;
    }> = [];

    const [ty, tm, td] = todayISO.split('-').map(Number);
    const weekdayFmt = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      timeZone: 'UTC',
    });

    for (let offset = 6; offset >= 0; offset--) {
      const dt = new Date(Date.UTC(ty, tm - 1, td - offset));
      const iso = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
        dt.getUTCDate()
      ).padStart(2, '0')}`;

      let streakCount = 0;
      let cursor = iso;
      let guard = 0;
      while (historyByDate.has(cursor) && guard < 3650) {
        streakCount++;
        cursor = getPreviousDateISO(cursor);
        guard++;
      }

      const completed = historyByDate.get(iso) ?? null;
      last7DaysStreak.push({
        seedDate: iso,
        weekdayLabel: offset === 0 ? 'Today' : weekdayFmt.format(dt),
        dayOfMonth: String(dt.getUTCDate()),
        streakCount,
        completed,
        hitPar: completed ? completed.bestTurns <= completed.par : false,
        isToday: offset === 0,
      });
    }

    const max7DayStreak = Math.max(1, ...last7DaysStreak.map((d) => d.streakCount));
    const peak7DayStreak = Math.max(0, ...last7DaysStreak.map((d) => d.streakCount));
    const solvedInLast7 = last7DaysStreak.filter((d) => d.completed !== null).length;

    let modeCurrentStreak = streakData.currentStreak;
    let modeBestStreak = streakData.bestStreak;
    if (isChallengeStats) {
      let cur = 0;
      let check = historyByDate.has(todayISO)
        ? todayISO
        : historyByDate.has(getPreviousDateISO(todayISO))
          ? getPreviousDateISO(todayISO)
          : null;
      let guard = 0;
      while (check && historyByDate.has(check) && guard < 3650) {
        cur++;
        check = getPreviousDateISO(check);
        guard++;
      }
      modeCurrentStreak = cur;

      let best = 0;
      for (const d of allDates) {
        let len = 0;
        let c = d;
        let g = 0;
        while (historyByDate.has(c) && g < 3650) {
          len++;
          c = getPreviousDateISO(c);
          g++;
        }
        if (len > best) best = len;
      }
      modeBestStreak = best;
    }

    return {
      history,
      totalSolved,
      parSolvedCount,
      parPerformancePct,
      totalNodesCollected,
      fastestTimeMs,
      avgTimeMs,
      last7DaysStreak,
      max7DayStreak,
      peak7DayStreak,
      solvedInLast7,
      modeCurrentStreak,
      modeBestStreak,
    };
  }, [streakData, todayISO, statsMode]);

  const finalizeDuelOnRunComplete = useCallback(
    (metrics: DuelMetrics) => {
      if (pendingDuelDraft) {
        const draft = pendingDuelDraft;
        setPendingDuelDraft(null);
        fetch('/api/duels/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: draft.type,
            mode: draft.mode,
            tier: draft.tier,
            seedDate,
            rngSalt,
            wagerCycles: draft.wagerCycles,
            wagerPower: draft.wagerPower,
            targetUsername: draft.targetUsername,
            metrics,
          }),
        })
          .then((res) => (res.ok ? (res.json() as Promise<CreateDuelResponse>) : null))
          .then((data) => {
            if (!data?.ok) return;
            setEconomy(data.economy);
            try {
              showToast('Wager locked! Duel is now live in Arena.');
            } catch {
              // Ignore
            }
          })
          .catch(() => {});
        return;
      }

      if (activeDuel) {
        const duel = activeDuel;
        setActiveDuel(null);
        fetch('/api/duels/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duelId: duel.id, metrics }),
        })
          .then((res) => (res.ok ? (res.json() as Promise<ResolveDuelResponse>) : null))
          .then((data) => {
            if (!data?.ok || data.won === undefined) return;
            setEconomy(data.economy);
            setOverallLeaderboard(data.overallLeaderboard);
            setDuelOutcome({
              won: data.won,
              wagerCycles: duel.wagerCycles,
              wagerPower: duel.wagerPower,
              opponent: duel.creatorUsername,
            });
          })
          .catch(() => {});
      }
    },
    [pendingDuelDraft, activeDuel, seedDate, rngSalt]
  );

  // Handle completing the puzzle
  const handleVictory = useCallback(
    (finalPath: PathStep[], solveTimeMs: number | null) => {
      const finalTurns = finalPath.reduce((acc, s) => acc + (s.causedTurnAtPrev ? 1 : 0), 0);

      if (level.mode === 'blitz') {
        if (blitzStage < 2) {
          sound.collectNode(blitzStage + 2);
          setBlitzTotalTurns((prev) => prev + finalTurns);
          setBlitzStage((prev) => (prev + 1) as 0 | 1 | 2);
          triggerContextualHint(`Stage ${blitzStage + 1}/3 cleared — next grid!`);
          return;
        }
        const totalTurns = blitzTotalTurns + finalTurns;
        const totalTimeMs = Math.max(100, Math.round(blitzElapsedMs));
        setBlitzTotalTurns(totalTurns);
        setLastSolveTimeMs(totalTimeMs);
        setIsSolved(true);
        setActiveHint(null);
        sound.win();
        void trackJourneyEnd(true);
        finalizeDuelOnRunComplete({ turns: totalTurns, timeMs: totalTimeMs, score: 0 });

        fetch('/api/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            seedDate: level.seedDate,
            mode: 'blitz',
            turns: totalTurns,
            par: 0,
            movesUsed: 0,
            nodesCollected: 3,
            timeMs: totalTimeMs,
          } satisfies CompleteRunRequest),
        })
          .then((res) => (res.ok ? (res.json() as Promise<CompleteRunResponse>) : null))
          .then((data) => {
            if (!data) return;
            setIsPersonalBestOnWin(data.isPersonalBest);
            setBlitzLeaderboard(data.blitzLeaderboard ?? []);
            setChallengeLeaderboard(data.challengeLeaderboard ?? []);
            setOverallLeaderboard(data.overallLeaderboard ?? []);
        setStoryLeaderboard(data.storyLeaderboard ?? []);
        if (data.myPillars) {
          setMyPillars(data.myPillars);
        }
            if (data.economy) setEconomy(data.economy);
            setEarnedCyclesOnWin(data.earnedCycles ?? 0);
            setEarnedPowerOnWin(data.earnedPower ?? 0);
            if (data.rank && data.totalPlayers) {
              setDailyRank({ rank: data.rank, total: data.totalPlayers });
            }
          })
          .catch(() => {});
        return;
      }

      setIsSolved(true);
      setActiveHint(null);
      setLastSolveTimeMs(solveTimeMs);
      sound.win();
      if (!isStoryMode && level.mode === 'standard') {
        markDailyModuleDone('cpu');
      }

      const finalMoves = Math.max(0, finalPath.length - 1);
      const isChallenge = level.mode === 'challenge';

      const prevBestTurns = isChallenge
        ? streakData.challengeCompletedDates?.[level.seedDate]
        : streakData.completedDates[level.seedDate];
      const prevRecord = isChallenge
        ? streakData.challengeRecords?.[level.seedDate]
        : streakData.completionRecords?.[level.seedDate];
      const prevBestMoves = prevRecord?.bestMoves;
      const prevBestTimeMs = prevRecord?.bestTimeMs ?? null;

      const isFirstForSeed = prevBestTurns === undefined;
      const improvedTurns = prevBestTurns !== undefined && finalTurns < prevBestTurns;
      const improvedMoves =
        isChallenge &&
        prevBestTurns !== undefined &&
        finalTurns === prevBestTurns &&
        prevBestMoves !== undefined &&
        finalMoves < prevBestMoves;
      const improvedTime =
        prevBestTurns !== undefined &&
        finalTurns === prevBestTurns &&
        (!isChallenge || prevBestMoves === undefined || finalMoves <= prevBestMoves) &&
        prevBestTimeMs !== null &&
        solveTimeMs !== null &&
        solveTimeMs < prevBestTimeMs;

      setIsPersonalBestOnWin(isFirstForSeed || improvedTurns || improvedMoves || improvedTime);

      const alreadyCompleted = !isFirstForSeed;
      const reward = alreadyCompleted
        ? 0
        : isChallenge
          ? finalTurns <= level.par
            ? 3
            : 2
          : finalTurns <= level.par
            ? 2
            : 1;

      if (reward > 0) {
        setEarnedHintsOnWin(reward);
        setHints((prevHints) => {
          const next = prevHints + reward;
          saveHintsBalance(next);
          return next;
        });
      }

      setStreakData((prev) => {
        if (isChallenge) {
          const prevChallengeMap = prev.challengeCompletedDates ?? {};
          const prevChallengeTurns = prevChallengeMap[level.seedDate];
          const bestForDate =
            prevChallengeTurns !== undefined
              ? Math.min(prevChallengeTurns, finalTurns)
              : finalTurns;
          const prevRec = prev.challengeRecords?.[level.seedDate];
          const bestTimeMs =
            prevRec?.bestTimeMs != null && solveTimeMs != null
              ? Math.min(prevRec.bestTimeMs, solveTimeMs)
              : solveTimeMs ?? prevRec?.bestTimeMs ?? null;
          const bestMoves =
            prevRec?.bestMoves !== undefined
              ? Math.min(prevRec.bestMoves, finalMoves)
              : finalMoves;

          const updated: StreakData = {
            ...prev,
            challengeCompletedDates: {
              ...prevChallengeMap,
              [level.seedDate]: bestForDate,
            },
            challengeRecords: {
              ...(prev.challengeRecords ?? {}),
              [level.seedDate]: {
                dayNumber: level.dayNumber,
                bestTurns: bestForDate,
                par: level.par,
                nodesCollected: level.nodes.length,
                bestTimeMs,
                completedAt: new Date().toISOString(),
                bestMoves,
                moveLimit: level.moveLimit,
              },
            },
          };
          saveStreakData(updated);
          return updated;
        }

        const prevCompletedTurns = prev.completedDates[level.seedDate];
        const bestForDate =
          prevCompletedTurns !== undefined
            ? Math.min(prevCompletedTurns, finalTurns)
            : finalTurns;

        let nextStreak = prev.currentStreak;
        let nextLastDate = prev.lastCompletedDate;

        if (!prev.completedDates[level.seedDate]) {
          const expectedPrev = getPreviousDateISO(level.seedDate);
          if (prev.lastCompletedDate === expectedPrev) {
            nextStreak = prev.currentStreak + 1;
          } else if (prev.lastCompletedDate === level.seedDate) {
            nextStreak = Math.max(1, prev.currentStreak);
          } else {
            nextStreak = Math.max(1, prev.currentStreak === 0 ? 1 : 1);
          }
          nextLastDate = level.seedDate;
        } else if (nextStreak === 0) {
          nextStreak = 1;
          nextLastDate = level.seedDate;
        }

        const prevRec = prev.completionRecords?.[level.seedDate];
        const bestTimeMs =
          prevRec?.bestTimeMs != null && solveTimeMs != null
            ? Math.min(prevRec.bestTimeMs, solveTimeMs)
            : solveTimeMs ?? prevRec?.bestTimeMs ?? null;

        const updated: StreakData = {
          ...prev,
          currentStreak: nextStreak,
          bestStreak: Math.max(prev.bestStreak, nextStreak),
          lastCompletedDate: nextLastDate,
          completedDates: {
            ...prev.completedDates,
            [level.seedDate]: bestForDate,
          },
          completionRecords: {
            ...(prev.completionRecords ?? {}),
            [level.seedDate]: {
              dayNumber: level.dayNumber,
              bestTurns: bestForDate,
              par: level.par,
              nodesCollected: level.nodes.length,
              bestTimeMs,
              completedAt: new Date().toISOString(),
            },
          },
        };
        saveStreakData(updated);
        return updated;
      });

      // Kernel Architect Sector Progression: unlock next processor size & tier
      if (level.mode === 'standard' && activeSector >= unlockedSector && unlockedSector < KERNEL_SECTORS.length) {
        const nextSec = unlockedSector + 1;
        setUnlockedSector(nextSec);
        setUnlockedSectorOnWin(KERNEL_SECTORS[nextSec - 1]);
        try {
          localStorage.setItem('gridlock_unlocked_sector', String(nextSec));
        } catch {}
      } else {
        setUnlockedSectorOnWin(null);
      }

      void trackJourneyEnd(true);
      finalizeDuelOnRunComplete({
        turns: finalTurns,
        timeMs: solveTimeMs ?? 999999,
        score: 0,
      });
      const nextStoryTotalAtt = isStoryMode ? storyTotalAttempts + storyAttempts : undefined;
      const nextStoryTotalTime = isStoryMode ? storyTotalTimeMs + (solveTimeMs ?? storyLiveMs) : undefined;
      if (isStoryMode && nextStoryTotalAtt !== undefined && nextStoryTotalTime !== undefined) {
        setStoryTotalAttempts(nextStoryTotalAtt);
        setStoryTotalTimeMs(nextStoryTotalTime);
      }

      const completePayload: CompleteRunRequest = {
        seedDate: level.seedDate,
        mode: level.mode,
        tier: cacheTier,
        isRng: rngSalt > 0,
        turns: finalTurns,
        par: level.par,
        movesUsed: finalMoves,
        moveLimit: level.moveLimit,
        missteps,
        ...(isStoryMode
          ? {
              storySector: activeSector,
              storyAttempts: nextStoryTotalAtt,
              storyTimeMs: nextStoryTotalTime,
            }
          : {}),
        nodesCollected: level.nodes.length,
        timeMs: solveTimeMs,
      };
      fetch('/api/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(completePayload),
      })
        .then((res) => (res.ok ? (res.json() as Promise<CompleteRunResponse>) : null))
        .then((data) => {
          if (!data) return;
          setStreakData(data.streakData);
          saveStreakData(data.streakData);
          setHints(data.hints);
          saveHintsBalance(data.hints);
          setEarnedHintsOnWin(data.earnedHints);
          setEarnedCyclesOnWin(data.earnedCycles ?? 0);
          setEarnedPowerOnWin(data.earnedPower ?? 0);
          if (data.economy) setEconomy(data.economy);
          setIsPersonalBestOnWin(data.isPersonalBest);
          setDailyStats(data.dailyStats);
          setLeaderboard(data.leaderboard);
          setChallengeLeaderboard(data.challengeLeaderboard ?? []);
          setOverclockLeaderboard(data.overclockLeaderboard);
          setOverallLeaderboard(data.overallLeaderboard ?? []);
        setStoryLeaderboard(data.storyLeaderboard ?? []);
        if (data.myPillars) {
          setMyPillars(data.myPillars);
        }
          if (data.rank && data.totalPlayers) {
            setDailyRank({ rank: data.rank, total: data.totalPlayers });
          }
        })
        .catch(() => {
          // Local state already updated
        });
    },
    [
      level.seedDate,
      level.dayNumber,
      level.mode,
      level.par,
      level.moveLimit,
      level.nodes.length,
      streakData.completedDates,
      streakData.completionRecords,
      streakData.challengeCompletedDates,
      streakData.challengeRecords,
      blitzStage,
      blitzTotalTurns,
      blitzElapsedMs,
      triggerContextualHint,
    ]
  );

  // Live stopwatch for Blitz 3-stage sprint
  useEffect(() => {
    if (
      level.mode !== 'blitz' ||
      !blitzStarted ||
      isSolved ||
      showHelp ||
      showSettings ||
      showStats ||
      showCreator
    ) {
      return;
    }
    let lastTick = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = now - lastTick;
      lastTick = now;
      setBlitzElapsedMs((prev) => prev + dt);
    }, 100);
    return () => window.clearInterval(id);
  }, [level.mode, blitzStarted, isSolved, showHelp, showSettings, showStats, showCreator]);

  // Real-time elapsed timer for Story Mode (tracks sector clear time)
  useEffect(() => {
    if (
      !isStoryMode ||
      showStoryBriefing ||
      isSolved ||
      showHelp ||
      showSettings ||
      showStats ||
      showCreator
    ) {
      return;
    }
    let lastTick = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = now - lastTick;
      lastTick = now;
      setStoryLiveMs((prev) => prev + dt);
    }, 200);
    return () => window.clearInterval(id);
  }, [isStoryMode, showStoryBriefing, isSolved, showHelp, showSettings, showStats, showCreator]);

  // Real-time countdown ticker for Overclock mode (pauses when dialogs are open)
  useEffect(() => {
    if (
      level.mode !== 'overclock' ||
      !overclockStarted ||
      isSolved ||
      energySurge !== null ||
      showHelp ||
      showSettings ||
      showStats ||
      overclockTimeLeftMs <= 0
    ) {
      return;
    }

    let lastTick = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = now - lastTick;
      lastTick = now;
      setOverclockTimeLeftMs((prev) => Math.max(0, prev - dt));
    }, 50);

    return () => window.clearInterval(id);
  }, [
    level.mode,
    overclockStarted,
    isSolved,
    energySurge,
    showHelp,
    showSettings,
    showStats,
    isStoryMode,
    showStoryBriefing,
    overclockTimeLeftMs,
  ]);

  // Finish Overclock run when timer expires
  useEffect(() => {
    if (
      level.mode !== 'overclock' ||
      !overclockStarted ||
      overclockTimeLeftMs > 0 ||
      isSolved ||
      energySurge !== null
    ) {
      return;
    }

    const now = performance.now();
    const cursor = path[path.length - 1] ?? level.start;
    sound.win();
    setRipples((r) => [
      ...r.filter((item) => now - item.startTime < 700),
      {
        x: cursor.x,
        y: cursor.y,
        level: cursor.level,
        startTime: now,
        color: '#A855F7',
      },
    ]);
    setEnergySurge(createEnergySurge(cursor, now));

    const prevBestScore = streakData.overclockStats?.bestScore ?? 0;
    const prevBestChain = streakData.overclockStats?.bestChain ?? 0;
    const prevRuns = streakData.overclockStats?.totalRuns ?? 0;
    const isNewPersonalBest =
      overclockScore > 0 && (prevRuns === 0 || overclockScore > prevBestScore);
    setIsPersonalBestOnWin(isNewPersonalBest);

    setStreakData((prev) => {
      const prevOc = prev.overclockStats ?? { bestScore: 0, bestChain: 0, totalRuns: 0 };
      const updated: StreakData = {
        ...prev,
        overclockStats: {
          bestScore: Math.max(prevOc.bestScore, overclockScore),
          bestChain: Math.max(prevOc.bestChain, overclockChain),
          totalRuns: prevOc.totalRuns + 1,
        },
      };
      saveStreakData(updated);
      return updated;
    });

    void trackJourneyEnd(true);
    finalizeDuelOnRunComplete({
      turns: 0,
      timeMs: 0,
      score: overclockScore,
    });
    const ocPayload: CompleteRunRequest = {
      seedDate: level.seedDate,
      mode: 'overclock',
      turns: 0,
      par: 0,
      movesUsed: 0,
      nodesCollected: overclockChain,
      timeMs: null,
      overclockScore,
      overclockChain,
    };
    fetch('/api/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ocPayload),
    })
      .then((res) => (res.ok ? (res.json() as Promise<CompleteRunResponse>) : null))
      .then((data) => {
        if (!data) return;
        setStreakData(data.streakData);
        saveStreakData(data.streakData);
        setOverclockLeaderboard(data.overclockLeaderboard);
        setOverallLeaderboard(data.overallLeaderboard ?? []);
        setStoryLeaderboard(data.storyLeaderboard ?? []);
        if (data.myPillars) {
          setMyPillars(data.myPillars);
        }
        if (data.economy) setEconomy(data.economy);
        setEarnedCyclesOnWin(data.earnedCycles ?? 0);
        setEarnedPowerOnWin(data.earnedPower ?? 0);
      })
      .catch(() => {
        // Local state already updated
      });

    if (winTimerRef.current !== null) {
      window.clearTimeout(winTimerRef.current);
    }
    winTimerRef.current = window.setTimeout(() => {
      winTimerRef.current = null;
      setIsSolved(true);
    }, 480);
  }, [
    level.mode,
    level.start,
    overclockStarted,
    overclockTimeLeftMs,
    isSolved,
    energySurge,
    path,
    overclockScore,
    overclockChain,
    streakData.overclockStats,
  ]);

  // Spend 1 hint to reveal a partial ghosted optimal path to the next node
  const triggerHint = useCallback(() => {
    if (
      level.mode === 'overclock' ||
      isSolved ||
      energySurge !== null ||
      isOutOfMoves ||
      hints <= 0 ||
      activeHint !== null
    ) {
      return;
    }
    const segment = getHintPathToNextNode(level, path);
    if (!segment || segment.path.length < 2) return;

    sound.hint();
    setActiveHint(segment);
    void trackJourneyInteraction('use_hint', level.mode);
    setHints((prev) => {
      const next = Math.max(0, prev - 1);
      saveHintsBalance(next);
      return next;
    });
    fetch('/api/hints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta: -1 }),
    }).catch(() => {});
  }, [isSolved, energySurge, isOutOfMoves, hints, activeHint, level, path]);

  // Auto-clear active hint once player reaches its target node (or undoes past branch point)
  useEffect(() => {
    if (!activeHint || activeHint.path.length < 2) return;
    const target = activeHint.path[activeHint.path.length - 1];
    const reachedTarget = path.some(
      (s) => s.x === target.x && s.y === target.y && s.level === target.level
    );
    if (reachedTarget || path.length - 1 < activeHint.branchIndex) {
      setActiveHint(null);
    }
  }, [path, activeHint]);

  // Advance one step onto a valid move
  const commitMove = useCallback(
    (move: ValidMove) => {
      if (isSolved || energySurge !== null || isOutOfMoves) return;
      setHasMovedOnce(true);
      if (solveStartTimeRef.current === null) {
        solveStartTimeRef.current = performance.now();
        void trackJourneyStart();
      }
      if (level.mode === 'blitz' && !blitzStarted) {
        setBlitzStarted(true);
      }

      if (level.mode === 'overclock') {
        const last = path[path.length - 1];
        if (last.x === move.x && last.y === move.y && last.level === move.level) {
          return;
        }
        if (!overclockStarted) {
          setOverclockStarted(true);
        }

        const causedTurnAtPrev = last.dirFromPrev !== null && last.dirFromPrev !== move.dir;
        const nextStep: PathStep = {
          x: move.x,
          y: move.y,
          level: move.level,
          dirFromPrev: move.dir,
          causedTurnAtPrev,
        };
        setPath((prev) => [...prev, nextStep].slice(-7));

        const hitTarget =
          move.x === overclockTarget.x &&
          move.y === overclockTarget.y &&
          move.level === overclockTarget.level;

        if (hitTarget) {
          const nextChain = overclockChain + 1;
          const points = 100 + overclockChain * 25;
          const timeBonusMs =
            nextChain % 5 === 0 ? 4000 : Math.max(1600, 3000 - nextChain * 70);
          const now = performance.now();

          sound.collectNode(Math.min(5, ((nextChain - 1) % 5) + 1));
          setOverclockChain(nextChain);
          setOverclockScore((prev) => prev + points);
          setOverclockTimeLeftMs((prev) => Math.min(OVERCLOCK_MAX_MS, prev + timeBonusMs));
          setRipples((r) => [
            ...r.filter((item) => now - item.startTime < 700),
            {
              x: move.x,
              y: move.y,
              level: move.level,
              startTime: now,
              color: nextChain % 5 === 0 ? '#00FF88' : '#FFB800',
            },
          ]);
          const nextTarget = pickNextOverclockTarget(
            level.tiles,
            overclockReachable,
            { x: move.x, y: move.y, level: move.level },
            Math.floor(now) + nextChain * 131
          );
          setOverclockTarget(nextTarget);
        } else {
          sound.step(causedTurnAtPrev, move.level - last.level);
        }
        return;
      }

      setPath((prev) => {
        const last = prev[prev.length - 1];
        // Guard against duplicate rapid calls
        if (last.x === move.x && last.y === move.y && last.level === move.level) {
          return prev;
        }
        if (
          level.mode === 'challenge' &&
          level.moveLimit !== undefined &&
          prev.length - 1 >= level.moveLimit
        ) {
          return prev;
        }

        const causedTurnAtPrev = last.dirFromPrev !== null && last.dirFromPrev !== move.dir;
        const nextStep: PathStep = {
          x: move.x,
          y: move.y,
          level: move.level,
          dirFromPrev: move.dir,
          causedTurnAtPrev,
        };
        const nextPath = [...prev, nextStep];

        const nextTile = level.tiles[move.y]?.[move.x];
        if (!nextTile) return;
        if (nextTile.feature === 'node' && nextTile.nodeIndex !== undefined) {
          const newCollectedCount = collectedNodeIndices.size + 1;
          sound.collectNode(newCollectedCount);
          setRipples((r) => [
            ...r.filter((item) => performance.now() - item.startTime < 700),
            {
              x: move.x,
              y: move.y,
              level: move.level,
              startTime: performance.now(),
              color: '#FFB800',
            },
          ]);
        } else if (nextTile.feature === 'exit') {
          sound.reachExit();
          const now = performance.now();
          const elapsedMs =
            solveStartTimeRef.current !== null
              ? Math.max(100, Math.round(now - solveStartTimeRef.current))
              : null;
          setRipples((r) => [
            ...r.filter((item) => now - item.startTime < 700),
            {
              x: move.x,
              y: move.y,
              level: move.level,
              startTime: now,
              color: '#00FF88',
            },
          ]);
          setEnergySurge(
            createEnergySurge({ x: move.x, y: move.y, level: move.level }, now)
          );
          if (winTimerRef.current !== null) {
            window.clearTimeout(winTimerRef.current);
          }
          winTimerRef.current = window.setTimeout(() => {
            winTimerRef.current = null;
            handleVictory(nextPath, elapsedMs);
          }, 480);
        } else if (
          level.mode === 'challenge' &&
          level.moveLimit !== undefined &&
          nextPath.length - 1 >= level.moveLimit
        ) {
          sound.outOfMoves();
          setMissteps((m) => m + 1);
        } else {
          sound.step(causedTurnAtPrev, move.level - last.level);
        }

        return nextPath;
      });
    },
    [
      isSolved,
      energySurge,
      isOutOfMoves,
      level.mode,
      level.moveLimit,
      level.tiles,
      path,
      overclockStarted,
      overclockTarget,
      overclockChain,
      overclockReachable,
      collectedNodeIndices.size,
      handleVictory,
    ]
  );

  const stepBack = useCallback(() => {
    if (level.mode === 'overclock' || isSolved || energySurge !== null) return;
    if (path.length <= 1) return;
    sound.undo();
    setMissteps((m) => m + 1);
    setPath((prev) => (prev.length <= 1 ? prev : prev.slice(0, -1)));
  }, [level.mode, isSolved, energySurge, path.length]);

  // Keyboard navigation (WASD / Arrows / Backspace / R)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Do not intercept typing inside date input or select
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT') return;

      if (isStoryMode && showStoryBriefing && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        setShowStoryBriefing(false);
        return;
      }

      let dir: Direction | null = null;
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') dir = 'N';
      else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') dir = 'S';
      else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') dir = 'E';
      else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') dir = 'W';

      if (dir) {
        e.preventDefault();
        if (isSolved || energySurge !== null) return;
        // In puzzle modes, check if moving back onto previous tile
        if (level.mode !== 'overclock' && path.length >= 2) {
          const cur = path[path.length - 1];
          const prev = path[path.length - 2];
          const { dx, dy } = DIR_VECTORS[dir];
          if (cur.x + dx === prev.x && cur.y + dy === prev.y) {
            stepBack();
            return;
          }
        }
        const match = validMoves.find((m) => m.dir === dir);
        if (match) {
          commitMove(match);
        }
      } else if (e.key === 'Backspace' || e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        stepBack();
      } else if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        triggerHint();
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        resetPuzzle(undefined, true);
      } else if (e.key === '?') {
        e.preventDefault();
        setShowSettings(false);
        setShowStats(false);
        setShowHelp((prev) => !prev);
      } else if (e.key === 'Escape' && (showHelp || showSettings || showStats)) {
        e.preventDefault();
        setShowHelp(false);
        setShowSettings(false);
        setShowStats(false);
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [
    level.mode,
    validMoves,
    path,
    isSolved,
    energySurge,
    showHelp,
    showSettings,
    showStats,
    isStoryMode,
    showStoryBriefing,
    commitMove,
    stepBack,
    triggerHint,
    resetPuzzle,
  ]);

  // ---------------------------------------------------------------------------
  // Canvas Rendering Loop & Responsive HiDPI Sizing
  // ---------------------------------------------------------------------------

  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const projRef = useRef<IsoProjection | null>(null);
  const isPointerDownRef = useRef<boolean>(false);

  // Claim keyboard focus immediately inside Devvit iframe / fullscreen view
  useEffect(() => {
    const claimFocus = () => {
      try {
        window.focus();
        rootRef.current?.focus({ preventScroll: true });
      } catch {
        // ignore in restricted environments
      }
    };
    claimFocus();
    const t1 = window.setTimeout(claimFocus, 100);
    const t2 = window.setTimeout(claimFocus, 350);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);

  // Keep latest render state in a ref for smooth 60fps rAF loop
  const renderStateRef = useRef({
    level: displayLevel,
    path,
    validMoves,
    hoveredMove,
    hintPath: activeHint?.path ?? null,
    ripples,
    energySurge,
    collectedNodeIndices,
    showOnboarding: !hasMovedOnce && path.length === 1,
    isSolved,
    highContrastPatterns,
    sunlightMode,
    themeColor: SIGNAL_THEMES[economy.activeTheme]?.primary ?? '#00F0FF',
  });

  useEffect(() => {
    renderStateRef.current = {
      level: displayLevel,
      path,
      validMoves,
      hoveredMove,
      hintPath: activeHint?.path ?? null,
      ripples,
      energySurge,
      collectedNodeIndices,
      showOnboarding: !hasMovedOnce && path.length === 1,
      isSolved,
      highContrastPatterns,
      sunlightMode,
      themeColor: SIGNAL_THEMES[economy.activeTheme]?.primary ?? '#00F0FF',
    };
  }, [
    displayLevel,
    path,
    validMoves,
    hoveredMove,
    activeHint,
    ripples,
    energySurge,
    collectedNodeIndices,
    hasMovedOnce,
    isSolved,
    highContrastPatterns,
    sunlightMode,
    economy.activeTheme,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const maxDpr = typeof navigator !== 'undefined' && navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4 ? 1.5 : 2;
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      const w = Math.max(100, Math.floor(rect.width));
      const h = Math.max(100, Math.floor(rect.height));
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      projRef.current = computeProjection(w, h);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    let rafId = 0;
    const frame = (now: number) => {
      if (!cpuRenderPausedRef.current) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const maxDpr = typeof navigator !== 'undefined' && navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4 ? 1.5 : 2;
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
          const w = canvas.width / dpr;
          const h = canvas.height / dpr;
          ctx.save();
          ctx.scale(dpr, dpr);
          projRef.current = renderIsometricBoard(ctx, w, h, renderStateRef.current, now);
          ctx.restore();
        }
      }
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

  // Pointer / Touch Interactions with magnetic grid snapping
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      px: e.clientX - rect.left,
      py: e.clientY - rect.top,
    };
  };

  const resetToStart = useCallback(() => {
    if (isSolved || energySurge !== null || path.length <= 1) return;
    solveStartTimeRef.current = null;
    sound.undo();
    setMissteps((m) => m + 1);
    if (isStoryMode) setStoryAttempts((a) => a + 1);
    setHoveredMove(null);
    setActiveHint(null);
    setRipples((r) => [
      ...r.filter((item) => performance.now() - item.startTime < 700),
      {
        x: level.start.x,
        y: level.start.y,
        level: level.start.level,
        startTime: performance.now(),
        color: '#00F0FF',
      },
    ]);
    setPath([
      {
        x: level.start.x,
        y: level.start.y,
        level: level.start.level,
        dirFromPrev: null,
        causedTurnAtPrev: false,
      },
    ]);
  }, [isSolved, energySurge, path.length, level.start]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isSolved || energySurge !== null || !projRef.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isPointerDownRef.current = true;

    const { px, py } = getCanvasPoint(e);
    const prevStep =
      level.mode !== 'overclock' && path.length >= 2 ? path[path.length - 2] : null;
    const picked = pickTileFromPoint(
      px,
      py,
      projRef.current,
      displayLevel,
      validMoves,
      prevStep,
      false
    );
    if (!picked) return;

    // In Overclock mode, allow adjacent steps OR click/tap any reachable tile to step toward it via BFS
    if (level.mode === 'overclock') {
      const match = validMoves.find(
        (m) => m.x === picked.x && m.y === picked.y && m.level === picked.level
      );
      if (match) {
        commitMove(match);
        setHoveredMove(null);
        return;
      }
      const nextStep = findFirstStepToward(level.tiles, path[path.length - 1], picked);
      if (nextStep) {
        commitMove(nextStep);
        setHoveredMove(null);
      }
      return;
    }

    // 1. Tapping the Start anode while a path is active immediately resets back to Start
    if (
      path.length > 1 &&
      picked.x === level.start.x &&
      picked.y === level.start.y &&
      picked.level === level.start.level
    ) {
      isPointerDownRef.current = false;
      resetToStart();
      return;
    }

    // 2. Advancing onto a valid adjacent move
    const match = validMoves.find(
      (m) => m.x === picked.x && m.y === picked.y && m.level === picked.level
    );
    if (match) {
      commitMove(match);
      setHoveredMove(null);
      return;
    }

    // 3. Stepping back one tile or tapping any earlier visited tile to rewind directly
    if (
      prevStep &&
      picked.x === prevStep.x &&
      picked.y === prevStep.y &&
      picked.level === prevStep.level
    ) {
      stepBack();
      return;
    }

    const visitedIdx = path.findIndex(
      (s, idx) =>
        idx > 0 &&
        idx < path.length - 1 &&
        s.x === picked.x &&
        s.y === picked.y &&
        s.level === picked.level
    );
    if (visitedIdx !== -1) {
      isPointerDownRef.current = false;
      sound.undo();
      setMissteps((m) => m + 1);
      setPath((prev) => prev.slice(0, visitedIdx + 1));
      return;
    }

    // 4. Contextual hint if player taps locked Exit or wrong-elevation tile
    const pickedTile = level.tiles[picked.y]?.[picked.x];
    if (pickedTile?.feature === 'exit' && collectedNodeIndices.size < level.nodes.length) {
      triggerContextualHint(
        `Collect all Energy Nodes first (${collectedNodeIndices.size}/${level.nodes.length})`
      );
    } else if (
      pickedTile &&
      (pickedTile.type === 'platform' || pickedTile.type === 'bridge') &&
      path.length > 0
    ) {
      const tip = path[path.length - 1];
      const dist = Math.abs(picked.x - tip.x) + Math.abs(picked.y - tip.y);
      if (dist === 1 && tip.level === 0 && pickedTile.type === 'platform') {
        triggerContextualHint('Use a Ramp to climb onto elevated platforms');
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isSolved || energySurge !== null || !projRef.current) {
      if (hoveredMove) setHoveredMove(null);
      return;
    }

    const { px, py } = getCanvasPoint(e);
    const prevStep =
      level.mode !== 'overclock' && path.length >= 2 ? path[path.length - 2] : null;
    const picked = pickTileFromPoint(
      px,
      py,
      projRef.current,
      displayLevel,
      validMoves,
      prevStep,
      isPointerDownRef.current
    );

    if (isPointerDownRef.current) {
      if (!picked) return;
      const match = validMoves.find(
        (m) => m.x === picked.x && m.y === picked.y && m.level === picked.level
      );
      if (match) {
        commitMove(match);
        setHoveredMove(null);
      } else if (
        prevStep &&
        picked.x === prevStep.x &&
        picked.y === prevStep.y &&
        picked.level === prevStep.level
      ) {
        stepBack();
      }
      return;
    }

    if (picked) {
      const match = validMoves.find(
        (m) => m.x === picked.x && m.y === picked.y && m.level === picked.level
      );
      setHoveredMove(match ?? null);
    } else {
      setHoveredMove(null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    isPointerDownRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleCopyResult = async () => {
    const text =
      level.mode === 'overclock'
        ? `OVERCLOCK #${level.dayNumber} • ${overclockScore} pts • ${overclockChain} Nodes ⚡`
        : level.mode === 'blitz'
          ? `OVERCLOCK BLITZ #${level.dayNumber} • 3/3 Stages • ${formatDuration(lastSolveTimeMs)} • ${blitzTotalTurns} Turns ⚡`
          : buildSpoilerFreeResult(level, path, turns, missteps);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      try {
        showToast('Spoiler-free result copied to clipboard!');
      } catch {
        // Ignore outside Devvit
      }
    } catch {
      // Fallback textarea copy inside sandboxed iframes
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        try {
          showToast('Spoiler-free result copied to clipboard!');
        } catch {
          // Ignore outside Devvit
        }
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  const handleCommentResult = async () => {
    if (isPostingComment || commentPosted) return;
    const text =
      level.mode === 'overclock'
        ? `OVERCLOCK #${level.dayNumber} • ${overclockScore} pts • ${overclockChain} Nodes ⚡`
        : level.mode === 'blitz'
          ? `OVERCLOCK BLITZ #${level.dayNumber} • 3/3 Stages • ${formatDuration(lastSolveTimeMs)} • ${blitzTotalTurns} Turns ⚡`
          : buildSpoilerFreeResult(level, path, turns, missteps);
    setIsPostingComment(true);
    try {
      const res = await fetch('/api/comment-result', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as CommentResultResponse;
      if (res.ok && data.ok) {
        setCommentPosted(true);
        void trackJourneyInteraction('post_comment', level.mode);
        try {
          showToast('Result posted to comments!');
        } catch {
          // Ignore outside Devvit
        }
      } else {
        try {
          showToast(data.error ?? 'Could not post comment');
        } catch {
          // Ignore outside Devvit
        }
      }
    } catch {
      try {
        showToast('Could not post comment');
      } catch {
        // Ignore outside Devvit
      }
    } finally {
      setIsPostingComment(false);
    }
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    sound.setSfxEnabled(next);
    setSoundEnabled(next);
  };

  const toggleMusic = () => {
    const next = !musicEnabled;
    sound.setMusicEnabled(next);
    setMusicEnabled(next);
  };

  // Synchronize audio ambient state and intensity reactively
  useEffect(() => {
    const total = level.nodes?.length || 1;
    const ratio = collectedNodeIndices.size / total;
    sound.setGameState(gameMode, ratio);
  }, [gameMode, collectedNodeIndices.size, level.nodes?.length]);

  const toggleSunlightMode = () => {
    setSunlightMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('gridlock_sunlight_mode', String(next));
      } catch {}
      return next;
    });
  };

  const toggleHighContrast = () => {
    setHighContrastPatterns((prev) => {
      const next = !prev;
      saveHighContrastPreference(next);
      return next;
    });
  };

  const toggleZenMode = () => {
    setZenMode((prev) => {
      const next = !prev;
      saveZenModePreference(next);
      return next;
    });
  };

  const isOptimal = turns <= level.par;
  const parDiff = turns - level.par;
  const hideGameplayOverlays = zenMode && !isSolved;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onPointerEnter={() => {
        try {
          window.focus();
        } catch {
          // ignore
        }
      }}
      className="h-dvh w-screen overflow-hidden flex flex-col grid-horizon-bg text-slate-100 select-none outline-none"
    >
      {/* Subtle Single-Row Top Bar (hidden in Zen Mode during gameplay) */}
      {!hideGameplayOverlays && (
      <header className="shrink-0 h-13 px-2.5 sm:px-5 cyber-hud-bar backdrop-blur-sm flex items-center justify-between gap-2 sm:gap-4 z-20">
        {/* Zone 1: Wordmark + Mode Switcher + Day Seed */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <GridlockLogo
              className="w-28 sm:w-36 h-auto shrink-0"
              glow={false}
            />
          </div>

          {/* Mode Segmented Switcher: Desktop (md+) inline in header */}
          <div
            role="group"
            aria-label="Game mode"
            className="hidden md:inline-flex items-center rounded-md bg-[#0E131D] border border-slate-800 p-0.5 shrink-0"
          >
            <button
              type="button"
              onClick={() => enterStoryMode()}
              aria-pressed={isStoryMode}
              title="Single-Player Arcade Campaign: Progress through Terminal Sectors (5×5 L1 → 10×10 L5 Hard)"
              className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-sm transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00FF88]/60 ${
                isStoryMode
                  ? 'bg-[#08241C] text-[#00FF88] border border-[#00FF88]/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Cpu className="w-3 h-3 shrink-0" />
              <span>Story</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsStoryMode(false);
                setStandaloneRamResult(null);
                setComponentClearedResult(null);
                setIsSolved(false);
                setRngSalt(0);
                randomizeModeBoard();
                setGameMode('standard');
              }}
              aria-pressed={!isStoryMode && gameMode === 'standard'}
              className={`px-2 py-1 text-[11px] font-medium rounded-sm transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60 ${
                !isStoryMode && gameMode === 'standard'
                  ? 'bg-[#182235] text-[#00F0FF]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Daily
            </button>
            <button
              type="button"
              onClick={() => {
                setIsStoryMode(false);
                setStandaloneRamResult(null);
                setComponentClearedResult(null);
                setIsSolved(false);
                randomizeModeBoard();
                setGameMode('challenge');
              }}
              aria-pressed={!isStoryMode && gameMode === 'challenge'}
              title="Daily Challenge: Extra-difficult board with a strict move limit"
              className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-sm transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4460]/70 ${
                !isStoryMode && gameMode === 'challenge'
                  ? 'bg-[#2C131C] text-[#FF5C77] border border-[#FF4460]/35'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Flame className="w-3 h-3 shrink-0" />
              <span>Challenge</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsStoryMode(false);
                setStandaloneRamResult(null);
                setComponentClearedResult(null);
                setIsSolved(false);
                randomizeModeBoard();
                setGameMode('overclock');
              }}
              aria-pressed={!isStoryMode && gameMode === 'overclock'}
              title="Overclock: Real-time CPU signal rush — chase live Energy Nodes before the clock runs out"
              className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-sm transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]/70 ${
                !isStoryMode && gameMode === 'overclock'
                  ? 'bg-[#241338] text-[#C084FC] border border-[#A855F7]/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-3 h-3 shrink-0" />
              <span>Overclock</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setIsStoryMode(false);
                setStandaloneRamResult(null);
                setBlitzStage(0);
                setBlitzTotalTurns(0);
                setBlitzElapsedMs(0);
                setBlitzStarted(false);
                setIsSolved(false);
                randomizeModeBoard();
                setGameMode('blitz');
              }}
              aria-pressed={!isStoryMode && gameMode === 'blitz'}
              title="Blitz: 3-stage circuit sprint against the clock"
              className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-sm transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00FF88]/70 ${
                !isStoryMode && gameMode === 'blitz'
                  ? 'bg-[#08241C] text-[#00FF88] border border-[#00FF88]/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Timer className="w-3 h-3 shrink-0" />
              <span>Blitz</span>
            </button>
          </div>
        </div>

        {/* Zone 2: Live Tabular Telemetry (Desktop md+ in header; shown in sub-bar on mobile) */}
        <div className="hidden md:flex items-center gap-4 min-w-0">
          {gameMode === 'blitz' ? (
            <div className="flex items-center gap-3 font-mono text-xs tabular-nums whitespace-nowrap shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">STAGE</span>
                <span className="text-[#00FF88] font-semibold">{blitzStage + 1}/3</span>
              </div>
              <span className="text-slate-700" aria-hidden="true">·</span>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500">TIME</span>
                <span className="text-[#00F0FF] font-semibold">
                  {(blitzElapsedMs / 1000).toFixed(1)}s
                </span>
              </div>
            </div>
          ) : gameMode === 'overclock' ? (
            <div className="flex items-center gap-2 sm:gap-3.5 font-mono text-[11px] sm:text-xs tabular-nums whitespace-nowrap shrink-0">
              <div className="flex items-center gap-1 sm:gap-1.5">
                <span className="text-slate-500 sm:hidden">PTS</span>
                <span className="text-slate-500 hidden sm:inline">SCORE</span>
                <span className="text-[#C084FC] font-semibold">{overclockScore}</span>
              </div>
              <span className="text-slate-700" aria-hidden="true">
                ·
              </span>
              <div className="flex items-center gap-1 sm:gap-1.5">
                <span className="text-slate-500 sm:hidden">x</span>
                <span className="text-slate-500 hidden sm:inline">CHAIN</span>
                <span
                  className={`font-semibold ${
                    overclockChain >= 5
                      ? 'text-[#00FF88]'
                      : overclockChain >= 3
                        ? 'text-[#FFB800]'
                        : 'text-slate-100'
                  }`}
                >
                  {overclockChain}
                </span>
              </div>
              <span className="text-slate-700" aria-hidden="true">
                ·
              </span>
              <div className="flex items-center gap-1 sm:gap-1.5">
                <span className="text-slate-500 hidden sm:inline">TIME</span>
                <span
                  className={`font-semibold ${
                    overclockTimeLeftMs <= 3500
                      ? 'text-[#FF4460]'
                      : overclockTimeLeftMs <= 7000
                        ? 'text-[#FFB800]'
                        : 'text-[#00F0FF]'
                  }`}
                >
                  {(overclockTimeLeftMs / 1000).toFixed(1)}s
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 sm:gap-3 font-mono text-[11px] sm:text-xs tabular-nums whitespace-nowrap shrink-0">
              <div className="flex items-center gap-1 sm:gap-1.5">
                <span className="text-slate-500 sm:hidden">T</span>
                <span className="text-slate-500 hidden sm:inline">TURNS</span>
                <span className="text-slate-100 font-semibold">{turns}</span>
              </div>
              <span className="text-slate-700" aria-hidden="true">
                /
              </span>
              <div className="flex items-center gap-1 sm:gap-1.5">
                <span className="text-slate-500 sm:hidden">P</span>
                <span className="text-slate-500 hidden sm:inline">PAR</span>
                <span className="text-[#00F0FF] font-semibold">{level.par}</span>
              </div>
              {moveLimit !== null && movesLeft !== null && (
                <>
                  <span className="text-slate-700" aria-hidden="true">
                    ·
                  </span>
                  <div
                    title={`Hard Mode Move Limit: ${movesUsed} of ${moveLimit} moves used (${movesLeft} remaining)`}
                    className="flex items-center gap-1 sm:gap-1.5"
                  >
                    <span className="text-slate-500 sm:hidden">M</span>
                    <span className="text-slate-500 hidden sm:inline">LEFT</span>
                    <span
                      className={`font-semibold ${
                        movesLeft <= 1
                          ? 'text-[#FF4460]'
                          : movesLeft <= 4
                            ? 'text-[#FFB800]'
                            : 'text-slate-100'
                      }`}
                    >
                      {movesLeft}
                      <span className="hidden xl:inline text-slate-500 font-normal">
                        /{moveLimit}
                      </span>
                    </span>
                  </div>
                </>
              )}
              <span className="text-slate-700" aria-hidden="true">
                ·
              </span>
              <div className="flex items-center gap-1 sm:gap-1.5">
                <span className="text-slate-500 hidden sm:inline">NODES</span>
                <span
                  className={`font-semibold ${
                    collectedNodeIndices.size === level.nodes.length
                      ? 'text-[#00FF88]'
                      : 'text-[#FFB800]'
                  }`}
                >
                  {collectedNodeIndices.size}/{level.nodes.length}
                </span>
              </div>
              <span className="text-slate-700 hidden lg:inline" aria-hidden="true">
                ·
              </span>
              <div className="hidden lg:flex items-center gap-1.5" title="Missteps (undos & resets)">
                <span className="text-slate-500">ERR</span>
                <span className={missteps === 0 ? 'text-[#00FF88] font-semibold' : 'text-[#FFB800] font-semibold'}>
                  {missteps}
                </span>
              </div>
              <span className="text-slate-700 hidden lg:inline" aria-hidden="true">
                ·
              </span>
              <div className="hidden lg:flex items-center gap-1.5">
                <span className="text-slate-500">HINTS</span>
                <span className="text-sky-200 font-semibold">{hints}</span>
              </div>
            </div>
          )}

          {/* Story / Daily / Challenge Badge */}
          <div className="hidden md:flex items-center gap-1.5 shrink-0">
            {isStoryMode ? (
              <span
                title={`Story Campaign (Locked): ${currentSectorSpec.codeName}`}
                className="px-2 py-1 rounded-md bg-[#08241C] border border-[#00FF88]/40 font-mono text-[11px] font-semibold text-[#00FF88] tabular-nums"
              >
                STORY S{activeSector}/6 · {level.size}×{level.size} {currentSectorSpec.tier}
                {currentSectorSpec.mode === 'challenge' ? ' HARD' : ''}
              </span>
            ) : gameMode === 'standard' ? (
              <button
                type="button"
                onClick={cycleCacheTier}
                title={`Kernel Sector ${activeSector}/6 (${currentSectorSpec.name}: ${currentSectorSpec.gridSize}×${currentSectorSpec.gridSize} ${currentSectorSpec.tier}) · Click to cycle unlocked sectors (${unlockedSector}/6)`}
                className="px-2 py-1 rounded-md bg-[#121722] border border-slate-800 hover:border-[#00F0FF]/50 font-mono text-[11px] font-semibold text-[#00F0FF] tabular-nums cursor-pointer"
              >
                {rngSalt > 0
                  ? `S${activeSector} · ${level.size}×${level.size} ${currentSectorSpec.tier}`
                  : `DAILY · 7×7 ${cacheTier}`}
              </button>
            ) : gameMode === 'challenge' ? (
              <span
                title="Challenge size & tier auto-scale as you beat more Daily Challenges"
                className="px-2 py-1 rounded-md bg-[#1C1216] border border-[#FF3B5C]/40 font-mono text-[11px] font-semibold text-[#FF3B5C] tabular-nums"
              >
                {level.size}×{level.size} {cacheTier} · HARD
              </span>
            ) : null}
            {!isStoryMode && gameMode === 'standard' && (
              <button
                type="button"
                onClick={() => triggerNewRngGrid(false)}
                title="Generate next casual level"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#121722] border border-slate-800 hover:border-[#FFB800]/50 font-mono text-[11px] text-slate-300 hover:text-white cursor-pointer"
              >
                <Shuffle className="w-3 h-3 text-[#FFB800]" />
                <span>{rngSalt > 0 ? `Phase #${rngSalt + 1}` : 'Next Phase'}</span>
              </button>
            )}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#121722] border border-slate-800/80 font-mono text-xs text-slate-300 tabular-nums">
              <span>{seedDate}</span>
              {dailyStats.totalSolves > 0 && (
                <>
                  <span className="text-slate-600" aria-hidden="true">·</span>
                  <span className="text-[#00FF88]">{dailyStats.totalSolves} solved</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Zone 3: Functional Controls */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {gameMode !== 'overclock' && (
            <>
              <button
                type="button"
                onClick={triggerHint}
                disabled={
                  hints <= 0 ||
                  isSolved ||
                  energySurge !== null ||
                  activeHint !== null ||
                  isOutOfMoves
                }
                title={
                  isOutOfMoves
                    ? 'Out of moves — undo or retry to continue'
                    : activeHint
                      ? 'Hint active to next node'
                      : hints <= 0
                        ? 'No hints remaining — solve puzzles to earn more'
                        : 'Show optimal path to next node (H)'
                }
                className={`inline-flex items-center gap-1 sm:gap-1.5 h-7 sm:h-8 px-1.5 sm:px-2.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60 ${
                  activeHint
                    ? 'bg-sky-950/60 text-sky-200 border-sky-400/50'
                    : 'bg-[#121722] text-slate-200 border-slate-800 hover:border-sky-400/60 hover:text-white disabled:opacity-35 disabled:pointer-events-none'
                }`}
              >
                <Lightbulb className={`w-3.5 h-3.5 ${activeHint ? 'text-sky-300' : 'text-amber-300'}`} />
                <span className="hidden sm:inline">Hint</span>
                <span className="font-mono tabular-nums text-[11px] text-sky-200">{hints}</span>
              </button>

              <button
                type="button"
                onClick={stepBack}
                disabled={path.length <= 1 || isSolved || energySurge !== null}
                title="Undo step (Backspace)"
                className="hidden sm:inline-flex items-center justify-center gap-1.5 h-8 px-2.5 text-xs font-medium rounded-md bg-[#121722] text-slate-200 border border-slate-800 hover:border-slate-600 hover:text-white disabled:opacity-35 disabled:pointer-events-none transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60"
              >
                <Undo2 className="w-3.5 h-3.5" />
                <span>Undo</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              if (!isSolved && path.length > 1) {
                setMissteps((m) => m + 1);
                if (isStoryMode) setStoryAttempts((a) => a + 1);
              }
              resetPuzzle(level, true);
            }}
            disabled={
              gameMode === 'overclock'
                ? !overclockStarted && !isSolved
                : path.length <= 1 && !isSolved
            }
            title={gameMode === 'overclock' ? 'Restart Overclock run (R)' : 'Reset puzzle (R)'}
            className="hidden sm:inline-flex items-center justify-center gap-1.5 h-8 px-2.5 text-xs font-medium rounded-md bg-[#121722] text-slate-200 border border-slate-800 hover:border-slate-600 hover:text-white disabled:opacity-35 disabled:pointer-events-none transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{gameMode === 'overclock' ? 'Restart' : 'Reset'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setShowHelp(false);
              setShowSettings(false);
              setShowStats(false);
              setShowCreator(false);
              setShowArmory(false);
              setArenaTargetUser(null);
              setShowArena((prev) => !prev);
            }}
            aria-label="PvP Arena"
            aria-expanded={showArena}
            title="PvP Arena & Wager Bounties"
            className={`hidden sm:inline-flex items-center justify-center w-8 h-8 rounded-md border transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4460]/60 ${
              showArena || activeDuel || pendingDuelDraft
                ? 'bg-[#2C131C] text-[#FF5C77] border-[#FF4460]/50'
                : 'bg-[#121722] text-slate-300 border-slate-800 hover:border-[#FF4460]/50 hover:text-white'
            }`}
          >
            <Swords className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              setShowHelp(false);
              setShowSettings(false);
              setShowStats(false);
              setShowCreator(false);
              setShowArena(false);
              setShowArmory((prev) => !prev);
            }}
            aria-label="Silicon Armory"
            aria-expanded={showArmory}
            title={`Silicon Armory • ${economy.cycles} CYC • ${economy.powerScore} PWR`}
            className={`hidden sm:inline-flex items-center gap-1 h-8 px-2 rounded-md border font-mono text-[11px] font-semibold transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB800]/60 ${
              showArmory
                ? 'bg-[#2A1E0E] text-[#FFB800] border-[#FFB800]/60'
                : 'bg-[#121722] text-[#FFB800] border-slate-800 hover:border-[#FFB800]/50'
            }`}
          >
            <Cpu className="w-3.5 h-3.5 shrink-0" />
            <span className="tabular-nums">{economy.cycles}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setShowHelp(false);
              setShowSettings(false);
              setShowStats((prev) => {
                if (!prev) {
                  setStatsMode(gameMode === 'challenge' ? 'challenge' : 'standard');
                }
                return !prev;
              });
            }}
            aria-label="Player stats"
            aria-expanded={showStats}
            title="Player stats"
            className={`inline-flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-md border transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60 ${
              showStats
                ? 'bg-[#1A2336] text-[#00F0FF] border-[#00F0FF]/50'
                : 'bg-[#121722] text-slate-300 border-slate-800 hover:border-slate-600 hover:text-white'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={toggleMusic}
            aria-label={musicEnabled ? 'Mute cyber ambient synth' : 'Enable cyber ambient synth'}
            title={musicEnabled ? 'Tron Synth BGM active (click to mute)' : 'Tron Synth BGM muted (click to unmute)'}
            className="hidden sm:inline-flex relative items-center justify-center w-8 h-8 rounded-md bg-[#121722] text-slate-300 border border-slate-800 hover:border-slate-600 hover:text-white transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60"
          >
            <Music className={`w-3.5 h-3.5 ${musicEnabled ? 'text-[#00F0FF]' : 'text-slate-500'}`} />
            <span
              aria-hidden="true"
              className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full transition-all duration-150 ${
                musicEnabled
                  ? 'bg-[#00F0FF] shadow-[0_0_6px_#00F0FF]'
                  : 'bg-[#991B1B] shadow-[0_0_6px_rgba(185,28,28,0.85)]'
              }`}
            />
          </button>

          <button
            type="button"
            onClick={toggleSound}
            aria-label={soundEnabled ? 'Mute sound' : 'Unmute sound'}
            title={soundEnabled ? 'Sound enabled (click to mute)' : 'Sound muted (click to unmute)'}
            className="hidden sm:inline-flex relative items-center justify-center w-8 h-8 rounded-md bg-[#121722] text-slate-300 border border-slate-800 hover:border-slate-600 hover:text-white transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60"
          >
            {soundEnabled ? (
              <Volume2 className="w-3.5 h-3.5" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 text-slate-500" />
            )}
            <span
              aria-hidden="true"
              className={`absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full transition-all duration-150 ${
                soundEnabled
                  ? 'bg-[#00F0FF] shadow-[0_0_6px_#00F0FF]'
                  : 'bg-[#991B1B] shadow-[0_0_6px_rgba(185,28,28,0.85)]'
              }`}
            />
          </button>

          <button
            type="button"
            onClick={toggleSunlightMode}
            aria-label={sunlightMode ? 'Disable Sunlight Mode' : 'Enable Sunlight Mode'}
            aria-pressed={sunlightMode}
            title={sunlightMode ? 'Sunlight Mode active (tap for Dark Tron)' : 'Sunlight / Outdoor Mode (high-brightness board for direct sun)'}
            className={`relative inline-flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-md border transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB800]/60 ${
              sunlightMode
                ? 'bg-[#2B220A] text-[#FFB800] border-[#FFB800]/60 shadow-[0_0_8px_rgba(255,184,0,0.3)]'
                : 'bg-[#121722] text-slate-300 border-slate-800 hover:border-slate-600 hover:text-white'
            }`}
          >
            <Sun className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              setShowHelp(false);
              setShowStats(false);
              setShowSettings((prev) => !prev);
            }}
            aria-label="Settings"
            aria-expanded={showSettings}
            title="Settings"
            className={`relative inline-flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-md border transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60 ${
              showSettings || highContrastPatterns || zenMode
                ? 'bg-[#1A2336] text-[#00F0FF] border-[#00F0FF]/50'
                : 'bg-[#121722] text-slate-300 border-slate-800 hover:border-slate-600 hover:text-white'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => {
              setShowSettings(false);
              setShowStats(false);
              setShowHelp((prev) => !prev);
            }}
            aria-label="Keyboard controls"
            aria-expanded={showHelp}
            title="Keyboard controls (?)"
            className={`hidden sm:inline-flex items-center justify-center w-8 h-8 rounded-md border transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60 ${
              showHelp
                ? 'bg-[#1A2336] text-[#00F0FF] border-[#00F0FF]/50'
                : 'bg-[#121722] text-slate-300 border-slate-800 hover:border-slate-600 hover:text-white'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>
      )}

      {/* Mobile Mode Strip (5 equal columns, zero horizontal scrollbar) */}
      {!hideGameplayOverlays && (
      <div className="md:hidden shrink-0 px-2 py-1 border-b border-slate-800/50 bg-[#0A0D13]">
        <div
          role="group"
          aria-label="Game mode mobile"
          className="grid grid-cols-5 w-full rounded-md bg-[#0E131D] border border-slate-800 p-0.5"
        >
          <button
            type="button"
            onClick={() => enterStoryMode()}
            aria-pressed={isStoryMode}
            className={`inline-flex items-center justify-center gap-1 py-1 text-[10px] font-medium rounded-sm transition-colors whitespace-nowrap cursor-pointer ${
              isStoryMode
                ? 'bg-[#08241C] text-[#00FF88] border border-[#00FF88]/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="w-3 h-3 shrink-0" />
            <span>Story</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setIsStoryMode(false);
              setRngSalt(0);
              randomizeModeBoard();
              setGameMode('standard');
            }}
            aria-pressed={!isStoryMode && gameMode === 'standard'}
            className={`inline-flex items-center justify-center py-1 text-[10px] font-medium rounded-sm transition-colors whitespace-nowrap cursor-pointer ${
              !isStoryMode && gameMode === 'standard'
                ? 'bg-[#182235] text-[#00F0FF]'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Daily
          </button>
          <button
            type="button"
            onClick={() => {
              setIsStoryMode(false);
              randomizeModeBoard();
              setGameMode('challenge');
            }}
            aria-pressed={!isStoryMode && gameMode === 'challenge'}
            className={`inline-flex items-center justify-center gap-1 py-1 text-[10px] font-medium rounded-sm transition-colors whitespace-nowrap cursor-pointer ${
              !isStoryMode && gameMode === 'challenge'
                ? 'bg-[#2C131C] text-[#FF5C77] border border-[#FF4460]/35'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Flame className="w-3 h-3 shrink-0" />
            <span>Hard</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setIsStoryMode(false);
              setStandaloneRamResult(null);
              randomizeModeBoard();
              setGameMode('overclock');
            }}
            aria-pressed={!isStoryMode && gameMode === 'overclock'}
            className={`inline-flex items-center justify-center gap-1 py-1 text-[10px] font-medium rounded-sm transition-colors whitespace-nowrap cursor-pointer ${
              !isStoryMode && gameMode === 'overclock'
                ? 'bg-[#241338] text-[#C084FC] border border-[#A855F7]/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3 h-3 shrink-0" />
            <span>Overclock</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setIsStoryMode(false);
              setStandaloneRamResult(null);
              setBlitzStage(0);
              setBlitzTotalTurns(0);
              setBlitzElapsedMs(0);
              setBlitzStarted(false);
              setIsSolved(false);
              randomizeModeBoard();
              setGameMode('blitz');
            }}
            aria-pressed={!isStoryMode && gameMode === 'blitz'}
            className={`inline-flex items-center justify-center gap-1 py-1 text-[10px] font-medium rounded-sm transition-colors whitespace-nowrap cursor-pointer ${
              !isStoryMode && gameMode === 'blitz'
                ? 'bg-[#08241C] text-[#00FF88] border border-[#00FF88]/40'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Timer className="w-3 h-3 shrink-0" />
            <span>Blitz</span>
          </button>
        </div>
      </div>
      )}

      {/* Dedicated Component Module Bar for Daily, Challenge, Overclock & Blitz (5 equal columns on mobile, zero scroll) */}
      {!hideGameplayOverlays && !isStoryMode && (
          <div className="shrink-0 px-2 py-0.5 border-b border-slate-800/50 bg-[#080C12] flex items-center justify-center">
            <div
              role="group"
              aria-label="Component module selector"
              className="grid grid-cols-5 w-full sm:w-auto sm:inline-flex items-center justify-center gap-0.5 rounded-md bg-[#0E131D] border border-slate-800 p-0.5 font-mono text-[10px] sm:text-[11px]"
            >
              {(
                [
                  { id: 'cpu', label: 'CPU', Icon: Cpu, activeCls: 'bg-[#182235] text-[#00F0FF]' },
                  { id: 'mobo', label: 'MOBO', Icon: CircuitBoard, activeCls: 'bg-[#2B220A] text-[#FFB800]' },
                  { id: 'ram', label: 'RAM', Icon: MemoryStick, activeCls: 'bg-[#08241C] text-[#00FF88]' },
                  { id: 'ssd', label: 'SSD', Icon: HardDrive, activeCls: 'bg-[#102033] text-[#00F0FF]' },
                  { id: 'gpu', label: 'GPU', Icon: MonitorPlay, activeCls: 'bg-[#241338] text-[#C084FC]' },
                ] as const
              ).map(({ id, label, Icon, activeCls }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setDailyChallengeModule(id);
                    setStandaloneRamResult(null);
                    if (id !== 'cpu') {
                      setStandaloneRamSeed(Math.floor(Math.random() * 900000) + 1);
                    }
                  }}
                  className={`inline-flex items-center justify-center gap-1 px-1.5 sm:px-2.5 py-0.5 rounded-sm transition-colors cursor-pointer ${
                    dailyChallengeModule === id
                      ? `${activeCls} font-bold`
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3 h-3 shrink-0" />
                  <span>{label}</span>
                  {gameMode === 'standard' && isDailyModuleLocked(id) && (
                    <Check className="w-2.5 h-2.5 text-[#00FF88] shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

      {/* Main 2.5D Isometric Canvas Stage */}
      <main ref={containerRef} className="flex-1 min-h-0 relative w-full">
        {/* Mobile Floating CPU Telemetry & Phase Controls (uses empty top corners, zero extra header height) */}
        {!hideGameplayOverlays &&
          !isSolved &&
          !(isStoryMode && storyComponent !== 'cpu') &&
          !(!isStoryMode && dailyChallengeModule !== 'cpu') && (
            <div className="md:hidden pointer-events-none absolute top-1.5 inset-x-2 z-20 flex items-center justify-between gap-2 font-mono text-[10px]">
              <div className="pointer-events-auto flex items-center gap-1">
                {isStoryMode ? (
                  <span className="px-1.5 py-0.5 rounded bg-[#08241C]/90 border border-[#00FF88]/40 font-semibold text-[#00FF88] backdrop-blur-sm">
                    CPU S{activeSector}/6 · {level.size}×{level.size}
                  </span>
                ) : gameMode === 'standard' ? (
                  <>
                    <button
                      type="button"
                      onClick={cycleCacheTier}
                      className="px-1.5 py-0.5 rounded bg-[#0B101A]/85 border border-slate-800 text-[#00F0FF] font-semibold backdrop-blur-sm cursor-pointer"
                    >
                      {rngSalt > 0 ? `S${activeSector} ${level.size}×${level.size}` : `7×7 ${cacheTier}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerNewRngGrid(false)}
                      title="Next Phase"
                      className="p-1 rounded bg-[#0B101A]/85 border border-slate-800 text-[#FFB800] backdrop-blur-sm cursor-pointer"
                    >
                      <Shuffle className="w-3 h-3" />
                    </button>
                  </>
                ) : gameMode === 'challenge' ? (
                  <span className="px-1.5 py-0.5 rounded bg-[#1C1216]/90 border border-[#FF3B5C]/40 font-semibold text-[#FF5C77] backdrop-blur-sm">
                    {level.size}×{level.size} {cacheTier}
                  </span>
                ) : null}
              </div>

              <div className="px-2 py-0.5 rounded bg-[#0B101A]/85 border border-slate-800/80 backdrop-blur-sm flex items-center gap-1.5 tabular-nums">
                {gameMode === 'blitz' ? (
                  <>
                    <span className="text-[#00FF88] font-semibold">S{blitzStage + 1}/3</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-[#00F0FF] font-semibold">{(blitzElapsedMs / 1000).toFixed(1)}s</span>
                  </>
                ) : gameMode === 'overclock' ? (
                  <>
                    <span className="text-[#C084FC] font-semibold">{overclockScore}p</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-[#FFB800] font-semibold">{overclockChain}x</span>
                    <span className="text-slate-600">·</span>
                    <span className={overclockTimeLeftMs <= 3500 ? 'text-[#FF4460] font-semibold' : 'text-[#00F0FF] font-semibold'}>
                      {(overclockTimeLeftMs / 1000).toFixed(1)}s
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-slate-400">T{turns}/<span className="text-[#00F0FF]">P{level.par}</span></span>
                    {moveLimit !== null && movesLeft !== null && (
                      <span className={movesLeft <= 1 ? 'text-[#FF4460] font-semibold' : 'text-slate-200 font-semibold'}>
                        · {movesLeft}M
                      </span>
                    )}
                    <span className={collectedNodeIndices.size === level.nodes.length ? 'text-[#00FF88] font-semibold' : 'text-[#FFB800] font-semibold'}>
                      · {collectedNodeIndices.size}/{level.nodes.length}N
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={() => {
            if (!isPointerDownRef.current) setHoveredMove(null);
          }}
          className={`block w-full h-full touch-none ${
            hoveredMove ? 'cursor-pointer' : 'cursor-crosshair'
          }`}
        />

        {/* Quantum PC 5-Slot Blueprint Bar (Story Mode) */}
        {isStoryMode && (
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 z-20 max-w-[calc(100%-1rem)]">
            <div className="px-2 py-1 rounded-lg bg-[#070D14]/90 border border-slate-800/90 backdrop-blur-md flex items-center gap-1 sm:gap-1.5 font-mono text-[10px] shadow-lg">
              {(
                [
                  { id: 'mobo', label: '1.MOBO', Icon: CircuitBoard },
                  { id: 'ram', label: '2.RAM', Icon: MemoryStick },
                  { id: 'ssd', label: '3.SSD', Icon: HardDrive },
                  { id: 'gpu', label: '4.GPU', Icon: MonitorPlay },
                  { id: 'cpu', label: '5.CPU', Icon: Cpu },
                ] as const
              ).map(({ id, label, Icon }, idx) => {
                const order = ['mobo', 'ram', 'ssd', 'gpu', 'cpu'] as const;
                const curIdx = order.indexOf(storyComponent);
                const done = idx < curIdx;
                const active = idx === curIdx;
                return (
                  <React.Fragment key={id}>
                    {idx > 0 && <span className="text-slate-700 text-[9px]">→</span>}
                    <div
                      className={`px-1.5 py-0.5 rounded flex items-center gap-1 border ${
                        done
                          ? 'bg-[#08241C] border-[#00FF88]/50 text-[#00FF88]'
                          : active
                            ? 'bg-[#102033] border-[#00F0FF]/65 text-[#00F0FF] shadow-[0_0_10px_rgba(0,240,255,0.2)]'
                            : 'bg-[#0B101A]/70 border-slate-800 text-slate-500'
                      }`}
                    >
                      <Icon className="w-3 h-3 shrink-0" />
                      <span className="font-bold">{label}</span>
                      {done && <span className="hidden sm:inline text-[9px] opacity-85">OK</span>}
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}

        {/* Component Sub-Games Stage (MOBO -> RAM -> SSD -> GPU) */}
        {isStoryMode && storyComponent !== 'cpu' && !showStoryBriefing && !componentClearedResult && (
          <div className="absolute inset-0 z-10 bg-[#06090F] pt-10 flex items-center justify-center overflow-y-auto">
            <Suspense
              fallback={
                <div className="font-mono text-xs text-[#00F0FF] animate-pulse">
                  LOADING MODULE...
                </div>
              }
            >
              {storyComponent === 'mobo' && (
              <MoboRouterGame
                key={`mobo-${storyRunSeed}-${storyDifficulty}`}
                runSeed={storyRunSeed}
                variant="story"
                storyDifficulty={storyDifficulty}
                sunlightMode={sunlightMode}
                onComplete={(res) => handleComponentComplete('mobo', res)}
              />
            )}
            {storyComponent === 'ram' && (
              <RamMemoryGame
                key={`ram-${storyRunSeed}-${storyDifficulty}`}
                runSeed={storyRunSeed}
                variant="story"
                storyDifficulty={storyDifficulty}
                sunlightMode={sunlightMode}
                onComplete={(res) => handleComponentComplete('ram', res)}
              />
            )}
            {storyComponent === 'ssd' && (
              <SsdSequencerGame
                key={`ssd-${storyRunSeed}-${storyDifficulty}`}
                runSeed={storyRunSeed}
                variant="story"
                storyDifficulty={storyDifficulty}
                sunlightMode={sunlightMode}
                onComplete={(res) => handleComponentComplete('ssd', res)}
              />
            )}
            {storyComponent === 'gpu' && (
              <GpuPhotonRaceGame
                key={`gpu-${storyRunSeed}-${storyDifficulty}`}
                variant="story"
                storyDifficulty={storyDifficulty}
                sunlightMode={sunlightMode}
                onComplete={(res) => handleComponentComplete('gpu', res)}
              />
            )}
            </Suspense>
          </div>
        )}

        {/* Standalone MOBO / RAM / SSD / GPU Stage (Daily, Challenge, Overclock & Blitz) */}
        {!isStoryMode && dailyChallengeModule !== 'cpu' && (
            <div className="absolute inset-0 z-10 bg-[#06090F] flex items-center justify-center overflow-y-auto">
              {gameMode === 'standard' && isDailyModuleLocked(dailyChallengeModule) && !standaloneRamResult ? (
                <div className="w-full max-w-sm mx-4 rounded-xl bg-[#070D14] border border-[#00FF88]/45 shadow-[0_0_32px_rgba(0,255,136,0.16)] p-5 flex flex-col gap-4 font-mono text-center">
                  <div className="flex items-center justify-center gap-2 text-xs font-bold tracking-widest text-[#00FF88]">
                    <Check className="w-4 h-4" />
                    <span>DAILY {dailyChallengeModule.toUpperCase()} // COMPLETED TODAY</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    You already cleared today&apos;s Daily for {dailyChallengeModule.toUpperCase()}. Come back tomorrow for a new Daily, or play other modes now!
                  </p>
                  <div className="flex flex-col gap-2">
                    {nextUnfinishedDailyModule && (
                      <button
                        type="button"
                        onClick={() => {
                          setDailyChallengeModule(nextUnfinishedDailyModule);
                          setStandaloneRamResult(null);
                          setStandaloneRamSeed(Math.floor(Math.random() * 900000) + 1);
                        }}
                        className="w-full py-2 px-3 rounded-lg bg-[#00FF88] text-[#06120D] font-bold text-xs tracking-wider uppercase hover:bg-[#33FFA0] cursor-pointer"
                      >
                        Play Daily {nextUnfinishedDailyModule.toUpperCase()} →
                      </button>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setStandaloneRamResult(null);
                          randomizeModeBoard();
                          setGameMode('challenge');
                        }}
                        className="py-2 px-3 rounded-lg bg-[#2C131C] border border-[#FF4460]/40 text-[#FF8FA3] font-bold text-xs uppercase cursor-pointer"
                      >
                        Challenge
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setStandaloneRamResult(null);
                          randomizeModeBoard();
                          setGameMode('overclock');
                        }}
                        className="py-2 px-3 rounded-lg bg-[#241338] border border-[#A855F7]/40 text-[#C084FC] font-bold text-xs uppercase cursor-pointer"
                      >
                        Overclock
                      </button>
                    </div>
                  </div>
                </div>
              ) : standaloneRamResult ? (
                <div className="w-full max-w-sm mx-4 rounded-xl bg-[#070D14] border border-[#00FF88]/50 shadow-[0_0_32px_rgba(0,255,136,0.2)] p-5 flex flex-col gap-4 font-mono">
                  <div className="flex items-center justify-between border-b border-[#00FF88]/25 pb-3">
                    <span className="text-xs font-bold tracking-widest text-[#00FF88]">
                      {gameMode === 'standard' ? 'DAILY' : gameMode.toUpperCase()}{' '}
                      {dailyChallengeModule.toUpperCase()} // CLEARED
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded bg-[#08241C] border border-[#00FF88]/40 text-[#00FF88] font-bold">
                      {standaloneRamResult.gridSize
                        ? `${standaloneRamResult.gridSize}×${standaloneRamResult.gridSize} · `
                        : ''}
                      {(
                        standaloneRamResult.moboMode ??
                        standaloneRamResult.gpuMode ??
                        standaloneRamResult.ssdMode ??
                        standaloneRamResult.memoryMode ??
                        'matrix'
                      ).toUpperCase()}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-[#0A131E] border border-slate-800 p-2.5">
                      <div className="text-[10px] text-slate-400">ATTEMPTS</div>
                      <div className="text-sm font-bold text-white mt-0.5">
                        {standaloneRamResult.attempts}
                      </div>
                    </div>
                    <div className="rounded-lg bg-[#0A131E] border border-slate-800 p-2.5">
                      <div className="text-[10px] text-slate-400">MISSTEPS</div>
                      <div className="text-sm font-bold text-[#FFB800] mt-0.5">
                        {standaloneRamResult.missteps}
                      </div>
                    </div>
                    <div className="rounded-lg bg-[#0A131E] border border-slate-800 p-2.5">
                      <div className="text-[10px] text-slate-400">TIME</div>
                      <div className="text-sm font-bold text-[#00F0FF] mt-0.5">
                        {(standaloneRamResult.timeMs / 1000).toFixed(1)}s
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {gameMode !== 'standard' ? (
                      <button
                        type="button"
                        onClick={() => {
                          setStandaloneRamResult(null);
                          setStandaloneRamSeed(Math.floor(Math.random() * 900000) + 1);
                        }}
                        className="flex-1 py-2 px-3 rounded-lg bg-[#00FF88] text-[#06120D] font-bold text-xs tracking-wider uppercase hover:bg-[#33FFA0] cursor-pointer"
                      >
                        Play Again
                      </button>
                    ) : nextUnfinishedDailyModule ? (
                      <button
                        type="button"
                        onClick={() => {
                          setStandaloneRamResult(null);
                          setDailyChallengeModule(nextUnfinishedDailyModule);
                          setStandaloneRamSeed(Math.floor(Math.random() * 900000) + 1);
                        }}
                        className="flex-1 py-2 px-3 rounded-lg bg-[#00FF88] text-[#06120D] font-bold text-xs tracking-wider uppercase hover:bg-[#33FFA0] cursor-pointer"
                      >
                        Next Daily: {nextUnfinishedDailyModule.toUpperCase()}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setStandaloneRamResult(null);
                          randomizeModeBoard();
                          setGameMode('challenge');
                        }}
                        className="flex-1 py-2 px-3 rounded-lg bg-[#FF5C77] text-[#050B14] font-bold text-xs tracking-wider uppercase cursor-pointer"
                      >
                        All Daily Done · Try Challenge
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setStandaloneRamResult(null);
                        setDailyChallengeModule('cpu');
                      }}
                      className="py-2 px-3 rounded-lg bg-[#121A29] border border-slate-700 text-slate-200 font-bold text-xs uppercase hover:border-[#00F0FF]/50 cursor-pointer"
                    >
                      CPU Grid
                    </button>
                  </div>
                </div>
              ) : (
                <Suspense
                  fallback={
                    <div className="font-mono text-xs text-[#00F0FF] animate-pulse">
                      LOADING MODULE...
                    </div>
                  }
                >
                  {dailyChallengeModule === 'mobo' ? (
                    <MoboRouterGame
                      key={`standalone-mobo-${gameMode}-${standaloneRamSeed}`}
                      runSeed={level.dayNumber * 6133 + standaloneRamSeed}
                      variant={
                        gameMode === 'challenge'
                          ? 'challenge'
                          : gameMode === 'overclock'
                            ? 'overclock'
                            : gameMode === 'blitz'
                              ? 'blitz'
                              : 'daily'
                      }
                      initialGridSize={
                        gameMode === 'challenge'
                          ? Math.max(5, Math.min(10, challengeEscalatedGridSize))
                          : 5
                      }
                      initialMode={
                        gameMode === 'overclock'
                          ? 'overclock'
                          : gameMode === 'challenge'
                            ? 'locked'
                            : 'power'
                      }
                      sunlightMode={sunlightMode}
                      onComplete={handleStandaloneRamComplete}
                    />
                  ) : dailyChallengeModule === 'gpu' ? (
                    <GpuPhotonRaceGame
                      key={`standalone-gpu-${gameMode}-${standaloneRamSeed}`}
                      variant={
                        gameMode === 'challenge'
                          ? 'challenge'
                          : gameMode === 'overclock'
                            ? 'overclock'
                            : gameMode === 'blitz'
                              ? 'blitz'
                              : 'daily'
                      }
                      initialMode={
                        gameMode === 'overclock'
                          ? 'overclock'
                          : gameMode === 'challenge'
                            ? 'gauntlet'
                            : 'overdrive'
                      }
                      sunlightMode={sunlightMode}
                      onComplete={handleStandaloneRamComplete}
                    />
                  ) : dailyChallengeModule === 'ssd' ? (
                    <SsdSequencerGame
                      key={`standalone-ssd-${gameMode}-${standaloneRamSeed}`}
                      runSeed={level.dayNumber * 4999 + standaloneRamSeed}
                      variant={
                        gameMode === 'challenge'
                          ? 'challenge'
                          : gameMode === 'overclock'
                            ? 'overclock'
                            : gameMode === 'blitz'
                              ? 'blitz'
                              : 'daily'
                      }
                      initialGridSize={
                        gameMode === 'challenge'
                          ? Math.max(5, Math.min(10, challengeEscalatedGridSize))
                          : 5
                      }
                      initialMode={
                        gameMode === 'overclock'
                          ? 'overclock'
                          : gameMode === 'challenge'
                            ? 'parity'
                            : 'sequential'
                      }
                      sunlightMode={sunlightMode}
                      onComplete={handleStandaloneRamComplete}
                    />
                  ) : (
                    <RamMemoryGame
                      key={`standalone-ram-${gameMode}-${standaloneRamSeed}`}
                      runSeed={level.dayNumber * 3571 + standaloneRamSeed}
                      variant={
                        gameMode === 'challenge'
                          ? 'challenge'
                          : gameMode === 'overclock'
                            ? 'overclock'
                            : gameMode === 'blitz'
                              ? 'blitz'
                              : 'daily'
                      }
                      initialGridSize={
                        gameMode === 'challenge'
                          ? Math.max(5, Math.min(10, challengeEscalatedGridSize))
                          : 5
                      }
                      initialMode={
                        gameMode === 'overclock'
                          ? 'overclock'
                          : gameMode === 'challenge'
                            ? 'glitch'
                            : 'matrix'
                      }
                      sunlightMode={sunlightMode}
                      onComplete={handleStandaloneRamComplete}
                    />
                  )}
                </Suspense>
              )}
            </div>
          )}

        {/* Daily CPU Once-Per-Day Lock Overlay */}
        {!hideGameplayOverlays &&
          !isStoryMode &&
          gameMode === 'standard' &&
          dailyChallengeModule === 'cpu' &&
          !isSolved &&
          isDailyModuleLocked('cpu') && (
            <div className="absolute inset-0 z-20 bg-[#06090F]/92 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="w-full max-w-sm rounded-xl bg-[#070D14] border border-[#00FF88]/45 shadow-[0_0_32px_rgba(0,255,136,0.18)] p-5 flex flex-col gap-4 font-mono text-center">
                <div className="flex items-center justify-center gap-2 text-xs font-bold tracking-widest text-[#00FF88]">
                  <Check className="w-4 h-4" />
                  <span>DAILY CPU // COMPLETED TODAY</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  You already finished today&apos;s Daily CPU puzzle. Try the other Daily modules or switch to Challenge, Overclock, Blitz, or Story!
                </p>
                <div className="flex flex-col gap-2">
                  {nextUnfinishedDailyModule && (
                    <button
                      type="button"
                      onClick={() => {
                        setDailyChallengeModule(nextUnfinishedDailyModule);
                        setStandaloneRamResult(null);
                        setStandaloneRamSeed(Math.floor(Math.random() * 900000) + 1);
                      }}
                      className="w-full py-2 px-3 rounded-lg bg-[#00FF88] text-[#06120D] font-bold text-xs tracking-wider uppercase hover:bg-[#33FFA0] cursor-pointer"
                    >
                      Play Daily {nextUnfinishedDailyModule.toUpperCase()} →
                    </button>
                  )}
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        randomizeModeBoard();
                        setGameMode('challenge');
                      }}
                      className="py-2 px-2 rounded-lg bg-[#2C131C] border border-[#FF4460]/40 text-[#FF8FA3] font-bold text-[11px] uppercase cursor-pointer"
                    >
                      Challenge
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        randomizeModeBoard();
                        setGameMode('overclock');
                      }}
                      className="py-2 px-2 rounded-lg bg-[#241338] border border-[#A855F7]/40 text-[#C084FC] font-bold text-[11px] uppercase cursor-pointer"
                    >
                      Overclock
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBlitzStage(0);
                        setBlitzTotalTurns(0);
                        setBlitzElapsedMs(0);
                        setBlitzStarted(false);
                        setIsSolved(false);
                        randomizeModeBoard();
                        setGameMode('blitz');
                      }}
                      className="py-2 px-2 rounded-lg bg-[#08241C] border border-[#00FF88]/40 text-[#00FF88] font-bold text-[11px] uppercase cursor-pointer"
                    >
                      Blitz
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

        {/* Kernel Architect Mission Status Pill (Desktop & Tablet) */}
        {!hideGameplayOverlays && !isSolved && !isStoryMode && dailyChallengeModule === 'cpu' && (
          <div className="pointer-events-none hidden sm:flex absolute top-2.5 left-3 z-10 max-w-[calc(100%-1.5rem)]">
            <div className="px-2.5 py-1 rounded-md bg-[#0B101A]/80 border border-slate-800/80 backdrop-blur-sm flex items-center gap-2 font-mono text-[10px] text-slate-300 shadow">
              <Cpu className="w-3 h-3 text-[#00F0FF] shrink-0" />
              <span className="text-[#00F0FF] font-semibold">
                {gameMode === 'standard' && rngSalt > 0
                  ? `SECTOR ${activeSector}/6 · ${currentSectorSpec.name.toUpperCase()} (${level.size}×${level.size} ${currentSectorSpec.tier})`
                  : gameMode === 'challenge'
                    ? `CHALLENGE DIE (${level.size}×${level.size} ${cacheTier})`
                    : gameMode === 'overclock'
                      ? 'OVERCLOCK BUS (7×7)'
                      : gameMode === 'blitz'
                        ? `BLITZ STAGE ${blitzStage + 1}/3`
                        : `DAILY KERNEL (7×7 ${cacheTier})`}
              </span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="text-slate-400 truncate max-w-[260px]">
                {gameMode === 'standard' && rngSalt > 0
                  ? currentSectorSpec.objective
                  : gameMode === 'overclock'
                    ? 'Route live spikes before clock drains'
                    : `Route ${level.nodes.length} spikes & close the bus`}
              </span>
            </div>
          </div>
        )}

        {/* Active Duel / Wager Banner */}
        {(activeDuel || pendingDuelDraft) && !isSolved && (
          <div className="pointer-events-none absolute top-12 left-1/2 -translate-x-1/2 z-20 max-w-[calc(100%-1.5rem)]">
            <div className="px-3 py-1 rounded-full bg-[#2C131C]/95 border border-[#FF4460]/55 text-[#FF8FA3] font-mono text-[11px] shadow-lg backdrop-blur-sm flex items-center gap-2 whitespace-nowrap">
              <Swords className="w-3.5 h-3.5 text-[#FF5C77] shrink-0" />
              <span>
                {activeDuel
                  ? `DUEL vs u/${activeDuel.creatorUsername} · Pot ${activeDuel.wagerCycles * 2} CYC / ±${activeDuel.wagerPower} PWR`
                  : `LOCKING WAGER: ${pendingDuelDraft?.wagerCycles} CYC / ${pendingDuelDraft?.wagerPower} PWR`}
              </span>
            </div>
          </div>
        )}

        {/* Contextual Onboarding Prompt (before first move) & Dynamic Feedback Pill */}
        <AnimatePresence>
          {!(isStoryMode && storyComponent !== 'cpu') &&
            !(!isStoryMode && dailyChallengeModule !== 'cpu') &&
            (contextualHint ||
              (!hideGameplayOverlays && !hasMovedOnce && path.length === 1 && !isSolved)) && (
            <motion.div
              key={contextualHint ?? 'onboarding-prompt'}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-20 max-w-[calc(100%-1.5rem)]"
            >
              {contextualHint ? (
                <div className="px-3 py-1.5 rounded-full bg-[#1C140A]/95 border border-[#FFB800]/45 text-[#FFD166] font-mono text-[11px] shadow-lg backdrop-blur-sm whitespace-nowrap">
                  {contextualHint}
                </div>
              ) : (
                <div className="hidden sm:flex px-3 py-1.5 rounded-full bg-[#0F141F]/90 border border-[#00F0FF]/30 text-slate-200 text-xs shadow-lg backdrop-blur-sm items-center gap-1.5 whitespace-nowrap">
                  <span className="w-2 h-2 rotate-45 bg-[#00F0FF] shrink-0" />
                  <span>
                    {gameMode === 'overclock'
                      ? 'Tap or drag to chase gold Nodes before time runs out'
                      : 'Drag or tap from Start → collect gold Nodes → reach Exit'}
                  </span>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Minimal Floating Settings Trigger when Zen Mode hides the top bar */}
        {hideGameplayOverlays && (
          <button
            type="button"
            onClick={() => {
              setShowHelp(false);
              setShowStats(false);
              setShowSettings((prev) => !prev);
            }}
            aria-label="Settings (Zen Mode active)"
            aria-expanded={showSettings}
            title="Settings (Zen Mode active)"
            className={`absolute top-3 right-3 sm:right-5 z-20 inline-flex items-center justify-center w-8 h-8 rounded-md border backdrop-blur-sm transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60 ${
              showSettings
                ? 'bg-[#1A2336]/95 text-[#00F0FF] border-[#00F0FF]/50 opacity-100'
                : 'bg-[#121722]/60 text-slate-300 border-slate-800/80 opacity-60 hover:opacity-100 hover:border-[#00F0FF]/50 hover:text-white'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Subtle Bottom Legend (hidden in Zen Mode, on Out-of-Moves, or on mobile while thumb controls are active) */}
        {!hideGameplayOverlays && !isOutOfMoves && (
        <div
          className={`pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 items-center gap-4 text-[11px] font-mono whitespace-nowrap ${
            highContrastPatterns ? 'text-slate-200' : 'text-slate-500'
          } ${
            (gameMode === 'overclock' ? overclockStarted : path.length > 1) && !isSolved
              ? 'hidden sm:flex'
              : 'flex'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <span
              className={`w-2.5 h-2.5 rotate-45 inline-block ${
                highContrastPatterns
                  ? 'bg-white ring-1 ring-white/80'
                  : 'bg-[#00F0FF]'
              }`}
            />
            <span>{gameMode === 'overclock' ? 'Cursor' : 'Start'}</span>
          </span>
          <span className="flex items-center gap-1.5">
            {highContrastPatterns ? (
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
                <rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#140E04" stroke="#FDE68A" strokeWidth="1.2" />
                <circle cx="4.3" cy="4.3" r="1.35" fill="#FEF3C7" />
                <circle cx="9.7" cy="4.3" r="1.35" fill="#FEF3C7" />
                <circle cx="4.3" cy="9.7" r="1.35" fill="#FEF3C7" />
                <circle cx="9.7" cy="9.7" r="1.35" fill="#FEF3C7" />
              </svg>
            ) : (
              <span className="w-2 h-2 rotate-45 bg-[#FFB800] inline-block" />
            )}
            <span>{gameMode === 'overclock' ? 'Target Node' : 'Node'}</span>
          </span>
          {gameMode !== 'overclock' && (
            <span className="flex items-center gap-1.5">
              {highContrastPatterns ? (
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
                  <rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#042218" stroke="#FFFFFF" strokeWidth="1.2" />
                  <path d="M4.5 1V13M9.5 1V13M1 4.5H13M1 9.5H13" stroke="#ECFDF5" strokeWidth="1.15" />
                </svg>
              ) : (
                <span className="w-2 h-2 rotate-45 bg-[#00FF88] inline-block" />
              )}
              <span>Exit</span>
            </span>
          )}
          {highContrastPatterns && (
            <span className="flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
                <rect x="0.75" y="0.75" width="12.5" height="12.5" rx="2" fill="#0F172A" stroke="#F8FAFC" strokeWidth="1.2" />
                <path d="M-1 7L7 -1M1 13L13 1M7 15L15 7" stroke="#F1F5F9" strokeWidth="2.1" />
              </svg>
              <span>Bridge</span>
            </span>
          )}
        </div>
        )}

        {/* Daily Challenge Out-of-Moves Prompt */}
        {isOutOfMoves && (
          <div
            role="status"
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 px-3 py-2 rounded-xl bg-[#160D14]/95 border border-[#FF4460]/45 shadow-2xl backdrop-blur-sm max-w-[calc(100vw-1.5rem)]"
          >
            <div className="flex items-center gap-2 pr-1">
              <Flame className="w-4 h-4 text-[#FF5C77] shrink-0" />
              <div className="flex flex-col leading-tight">
                <span className="text-xs font-semibold text-white whitespace-nowrap">
                  Move Limit Reached
                </span>
                <span className="font-mono text-[11px] text-[#FF8FA3] tabular-nums whitespace-nowrap">
                  {movesUsed}/{moveLimit} moves used
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={stepBack}
              className="inline-flex items-center justify-center gap-1.5 min-h-[40px] sm:min-h-[34px] px-3 rounded-lg bg-[#1C2333] text-slate-100 border border-slate-700/80 hover:border-slate-500 text-xs font-medium whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Undo</span>
            </button>
            <button
              type="button"
              onClick={resetToStart}
              className="inline-flex items-center justify-center gap-1.5 min-h-[40px] sm:min-h-[34px] px-3 rounded-lg bg-[#FF4460] text-white hover:bg-[#FF5C77] text-xs font-semibold whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4460]"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        )}

        {/* Thumb-friendly Mobile Reset & Undo Bar */}
        {!hideGameplayOverlays &&
          !isOutOfMoves &&
          !isSolved &&
          energySurge === null &&
          (gameMode === 'overclock' ? overclockStarted : path.length > 1) && (
            <div className="sm:hidden absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5">
              {gameMode !== 'overclock' && (
                <button
                  type="button"
                  onClick={stepBack}
                  className="inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-[#121722]/95 text-slate-100 border border-slate-700/80 shadow-lg text-xs font-medium active:scale-[0.98] transition-transform whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60"
                >
                  <Undo2 className="w-4 h-4" />
                  <span>Undo</span>
                </button>
              )}
              <button
                type="button"
                onClick={gameMode === 'overclock' ? () => resetPuzzle() : resetToStart}
                className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-[#121722]/95 shadow-lg text-xs font-medium active:scale-[0.98] transition-transform whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 ${
                  gameMode === 'overclock'
                    ? 'text-[#C084FC] border border-[#A855F7]/45 focus-visible:ring-[#A855F7]/60'
                    : 'text-[#00F0FF] border border-[#00F0FF]/40 focus-visible:ring-[#00F0FF]/60'
                }`}
              >
                <RotateCcw className="w-4 h-4" />
                <span>{gameMode === 'overclock' ? 'Restart Run' : 'Reset Start'}</span>
              </button>
            </div>
          )}

        {/* Keyboard Controls Pop-up */}
        <AnimatePresence>
          {showHelp && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
              onClick={() => setShowHelp(false)}
              className="absolute inset-0 z-30 bg-[#090B10]/40"
            >
              <motion.div
                role="dialog"
                aria-label="Keyboard Controls"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                onClick={(e) => e.stopPropagation()}
                className="absolute top-3 right-3 sm:right-5 w-72 rounded-xl cyber-panel p-4 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                  <h2 className="font-display text-sm font-semibold text-white">
                    Controls
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowHelp(false)}
                    aria-label="Close controls"
                    className="inline-flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-white hover:bg-slate-800/70 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <ul className="flex flex-col gap-2.5 text-xs">
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-slate-300">Move along grid</span>
                    <span className="flex items-center gap-1 font-mono text-[11px] text-slate-100 shrink-0">
                      <kbd className="px-1.5 py-0.5 rounded bg-[#161E2E] border border-slate-700/80">
                        WASD
                      </kbd>
                      <span className="text-slate-600">/</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-[#161E2E] border border-slate-700/80">
                        Arrows
                      </kbd>
                    </span>
                  </li>
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-slate-300">Optimal path hint</span>
                    <kbd className="px-1.5 py-0.5 rounded bg-[#161E2E] border border-slate-700/80 font-mono text-[11px] text-sky-200 shrink-0">
                      H
                    </kbd>
                  </li>
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-slate-300">Undo last step</span>
                    <span className="flex items-center gap-1 font-mono text-[11px] text-slate-100 shrink-0">
                      <kbd className="px-1.5 py-0.5 rounded bg-[#161E2E] border border-slate-700/80">
                        Backspace
                      </kbd>
                      <span className="text-slate-600">/</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-[#161E2E] border border-slate-700/80">
                        Z
                      </kbd>
                    </span>
                  </li>
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-slate-300">Reset board</span>
                    <kbd className="px-1.5 py-0.5 rounded bg-[#161E2E] border border-slate-700/80 font-mono text-[11px] text-slate-100 shrink-0">
                      R
                    </kbd>
                  </li>
                </ul>

                <p className="border-t border-slate-800/80 pt-2.5 text-[11px] text-slate-400 leading-relaxed">
                  Click, tap, or drag along adjacent tiles to trace the path. Use Ramps to climb to L1 Platforms and cross Bridges both over and under.
                </p>

                <div className="border-t border-slate-800/80 pt-2.5 flex flex-col gap-1.5 text-[11px] text-slate-300">
                  <div><span className="text-[#00F0FF] font-semibold">L0–L3 &amp; RNG:</span> Cycle cache complexity or roll fresh grids anytime.</div>
                  <div><span className="text-[#00FF88] font-semibold">Blitz:</span> Clear 3 grids back-to-back against the clock.</div>
                  <div><span className="text-[#FF5C77] font-semibold">Arena (⚔️):</span> Wager CYC &amp; PWR in 1v1 duels &amp; open bounties.</div>
                  <div><span className="text-[#FFB800] font-semibold">Armory:</span> Spend CYC on beam themes, hints &amp; upgrades.</div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Settings Pop-up */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 z-30 bg-[#090B10]/40"
            >
              <motion.div
                role="dialog"
                aria-label="Settings"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                onClick={(e) => e.stopPropagation()}
                className="absolute top-3 right-3 sm:right-5 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl bg-[#0F141F] border border-slate-800 shadow-2xl p-4 flex flex-col gap-3.5"
              >
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                  <h2 className="font-display text-sm font-semibold text-white">
                    Settings
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowSettings(false)}
                    aria-label="Close settings"
                    className="inline-flex items-center justify-center w-6 h-6 rounded text-slate-400 hover:text-white hover:bg-slate-800/70 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Mobile Quick Actions (keeps top mobile header clean) */}
                <div className="sm:hidden grid grid-cols-2 gap-1.5 pb-2 border-b border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => {
                      setShowSettings(false);
                      setArenaTargetUser(null);
                      setShowArena(true);
                    }}
                    className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md bg-[#2C131C]/80 border border-[#FF4460]/40 text-[#FF8FA3] font-mono text-[11px] cursor-pointer"
                  >
                    <Swords className="w-3.5 h-3.5" />
                    <span>PvP Arena</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSettings(false);
                      setShowArmory(true);
                    }}
                    className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md bg-[#2A1E0E]/80 border border-[#FFB800]/45 text-[#FFB800] font-mono text-[11px] cursor-pointer"
                  >
                    <Cpu className="w-3.5 h-3.5" />
                    <span>{economy.cycles} CYC</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowSettings(false);
                      setShowHelp(true);
                    }}
                    className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md bg-[#121722] border border-slate-700 text-slate-200 font-mono text-[11px] cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5 text-slate-300" />
                    <span>Controls</span>
                  </button>
                </div>

                {/* Sunlight / Outdoor Mode Toggle */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span id="sunlight-mode-label" className="text-xs font-medium text-slate-100 flex items-center gap-1.5">
                      <Sun className="w-3.5 h-3.5 text-[#FFB800]" />
                      Sunlight / Outdoor Mode
                    </span>
                    <span className="text-[11px] text-slate-400">
                      High-brightness daylight board for direct sun on phone/tablet.
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={sunlightMode}
                    aria-labelledby="sunlight-mode-label"
                    onClick={toggleSunlightMode}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB800]/60 ${
                      sunlightMode
                        ? 'bg-[#FFB800]/25 border-[#FFB800]'
                        : 'bg-[#161E2E] border-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                        sunlightMode
                          ? 'translate-x-5.5 bg-[#FFB800]'
                          : 'translate-x-1 bg-slate-400'
                      }`}
                    />
                  </button>
                </div>

                {/* High-Contrast Patterns Toggle */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span id="hc-patterns-label" className="text-xs font-medium text-slate-100">
                      High-Contrast Patterns
                    </span>
                    <span className="text-[11px] text-slate-400 leading-relaxed">
                      Distinct dots, crosshatch &amp; stripes for Nodes, Exits &amp; Bridges.
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={highContrastPatterns}
                    aria-labelledby="hc-patterns-label"
                    onClick={toggleHighContrast}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60 ${
                      highContrastPatterns
                        ? 'bg-[#00F0FF]/25 border-[#00F0FF]'
                        : 'bg-[#161E2E] border-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                        highContrastPatterns
                          ? 'translate-x-5.5 bg-[#00F0FF]'
                          : 'translate-x-1 bg-slate-400'
                      }`}
                    />
                  </button>
                </div>

                {/* Pattern Legend Swatches */}
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#0A0E17] border border-slate-800/80">
                    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
                      <rect x="1" y="1" width="16" height="16" rx="2.5" fill="#140E04" stroke="#FDE68A" strokeWidth="1.2" />
                      <circle cx="5.5" cy="5.5" r="1.6" fill="#FEF3C7" />
                      <circle cx="12.5" cy="5.5" r="1.6" fill="#FEF3C7" />
                      <circle cx="5.5" cy="12.5" r="1.6" fill="#FEF3C7" />
                      <circle cx="12.5" cy="12.5" r="1.6" fill="#FEF3C7" />
                    </svg>
                    <div className="flex flex-col leading-tight min-w-0">
                      <span className="text-[11px] font-medium text-slate-200">Nodes</span>
                      <span className="text-[10px] text-slate-400">Dots</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#0A0E17] border border-slate-800/80">
                    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
                      <rect x="1" y="1" width="16" height="16" rx="2.5" fill="#042218" stroke="#FFFFFF" strokeWidth="1.2" />
                      <path d="M5.5 1.5V16.5M12.5 1.5V16.5M1.5 5.5H16.5M1.5 12.5H16.5" stroke="#ECFDF5" strokeWidth="1.2" />
                    </svg>
                    <div className="flex flex-col leading-tight min-w-0">
                      <span className="text-[11px] font-medium text-slate-200">Exits</span>
                      <span className="text-[10px] text-slate-400">Hatch</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[#0A0E17] border border-slate-800/80">
                    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
                      <rect x="1" y="1" width="16" height="16" rx="2.5" fill="#0F172A" stroke="#F8FAFC" strokeWidth="1.2" />
                      <path d="M-1 9L9 -1M2 16L16 2M9 19L19 9" stroke="#F1F5F9" strokeWidth="2.4" />
                    </svg>
                    <div className="flex flex-col leading-tight min-w-0">
                      <span className="text-[11px] font-medium text-slate-200">Bridges</span>
                      <span className="text-[10px] text-slate-400">Stripes</span>
                    </div>
                  </div>
                </div>

                {/* Zen Mode Toggle */}
                <div className="flex items-start justify-between gap-3 border-t border-slate-800/80 pt-3">
                  <div className="flex flex-col gap-0.5">
                    <span id="zen-mode-label" className="text-xs font-medium text-slate-100">
                      Zen Mode
                    </span>
                    <span className="text-[11px] text-slate-400 leading-relaxed">
                      Hides counters, seed bar &amp; legend during play for a distraction-free board.
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={zenMode}
                    aria-labelledby="zen-mode-label"
                    onClick={toggleZenMode}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60 ${
                      zenMode
                        ? 'bg-[#00F0FF]/25 border-[#00F0FF]'
                        : 'bg-[#161E2E] border-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                        zenMode
                          ? 'translate-x-5.5 bg-[#00F0FF]'
                          : 'translate-x-1 bg-slate-400'
                      }`}
                    />
                  </button>
                </div>

                {/* Background Music Toggle + Volume */}
                <div className="flex flex-col gap-2.5 border-t border-slate-800/80 pt-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-col gap-0.5">
                      <span id="music-synth-label" className="text-xs font-medium text-slate-100 flex items-center gap-1.5">
                        <Music className="w-3.5 h-3.5 text-[#00F0FF]" />
                        Background Music
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Ambient soundtrack tracks with automatic SFX ducking.
                      </span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={musicEnabled}
                      aria-labelledby="music-synth-label"
                      onClick={toggleMusic}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60 ${
                        musicEnabled
                          ? 'bg-[#00F0FF]/25 border-[#00F0FF]'
                          : 'bg-[#161E2E] border-slate-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                          musicEnabled
                            ? 'translate-x-5.5 bg-[#00F0FF]'
                            : 'translate-x-1 bg-slate-400'
                        }`}
                      />
                    </button>
                  </div>
                  {musicEnabled && (
                    <div className="flex items-center gap-2.5 pl-0.5">
                      <span className="text-[11px] text-slate-400 w-14 shrink-0">Volume</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round(musicVolume * 100)}
                        onChange={(e) => {
                          const v = Number(e.target.value) / 100;
                          setMusicVolume(v);
                          sound.setMusicVolume(v);
                        }}
                        aria-label="Background music volume"
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-[#00F0FF]"
                      />
                      <span className="text-[11px] text-slate-300 tabular-nums w-8 text-right shrink-0">
                        {Math.round(musicVolume * 100)}%
                      </span>
                    </div>
                  )}
                </div>

                {/* Sound Effects Toggle */}
                <div className="flex items-center justify-between gap-3 border-t border-slate-800/80 pt-3">
                  <div className="flex flex-col gap-0.5">
                    <span id="sound-fx-label" className="text-xs font-medium text-slate-100">
                      Sound Effects
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Synthesized audio chimes for moves &amp; nodes.
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={soundEnabled}
                    aria-labelledby="sound-fx-label"
                    onClick={toggleSound}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60 ${
                      soundEnabled
                        ? 'bg-[#00F0FF]/25 border-[#00F0FF]'
                        : 'bg-[#161E2E] border-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                        soundEnabled
                          ? 'translate-x-5.5 bg-[#00F0FF]'
                          : 'translate-x-1 bg-slate-400'
                      }`}
                    />
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Player Stats Modal */}
        <AnimatePresence>
          {showStats && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              onClick={() => setShowStats(false)}
              className="absolute inset-0 z-40 flex items-center justify-center bg-[#090B10]/75 backdrop-blur-sm p-3 sm:p-4"
            >
              <motion.div
                role="dialog"
                aria-label="Player Stats"
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-lg max-h-[calc(100%-1rem)] overflow-y-auto rounded-xl cyber-panel p-4 sm:p-5 flex flex-col gap-3.5"
              >
                <div className="flex items-center justify-between gap-2 border-b border-slate-800/80 pb-3 shrink-0">
                  <div className="flex items-baseline gap-2.5 min-w-0">
                    <h2 className="font-display text-base sm:text-lg font-bold tracking-tight text-white">
                      Player Stats
                    </h2>
                    <span className="font-mono text-xs text-slate-400 tabular-nums truncate">
                      {playerStats.totalSolved === 1
                        ? '1 Solved'
                        : `${playerStats.totalSolved} Solved`}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div
                      role="group"
                      aria-label="Stats mode filter"
                      className="inline-flex items-center rounded-md bg-[#0A0E17] border border-slate-800 p-0.5"
                    >
                      <button
                        type="button"
                        onClick={() => setStatsMode('standard')}
                        aria-pressed={statsMode === 'standard'}
                        className={`px-2 py-1 text-[11px] font-medium rounded-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60 ${
                          statsMode === 'standard'
                            ? 'bg-[#182235] text-[#00F0FF]'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Daily
                      </button>
                      <button
                        type="button"
                        onClick={() => setStatsMode('challenge')}
                        aria-pressed={statsMode === 'challenge'}
                        className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF4460]/70 ${
                          statsMode === 'challenge'
                            ? 'bg-[#2C131C] text-[#FF5C77]'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <Flame className="w-3 h-3" />
                        <span>Challenge</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowStats(false)}
                      aria-label="Close stats"
                      className="inline-flex items-center justify-center w-7 h-7 rounded text-slate-400 hover:text-white hover:bg-slate-800/70 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 4-Metric Summary Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 shrink-0">
                  <div className="rounded-lg bg-[#0A0E17] border border-slate-800/80 p-3 flex flex-col gap-1">
                    <span className="text-[11px] font-mono text-slate-400">Streak</span>
                    <span className="font-mono text-lg font-bold text-white tabular-nums">
                      🔥 {playerStats.modeCurrentStreak}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                      Best {playerStats.modeBestStreak}
                    </span>
                  </div>

                  <div className="rounded-lg bg-[#0A0E17] border border-slate-800/80 p-3 flex flex-col gap-1">
                    <span className="text-[11px] font-mono text-slate-400">Par Rate</span>
                    <span
                      className={`font-mono text-lg font-bold tabular-nums ${
                        playerStats.totalSolved > 0 && playerStats.parPerformancePct >= 75
                          ? 'text-[#00FF88]'
                          : 'text-[#00F0FF]'
                      }`}
                    >
                      {playerStats.totalSolved > 0 ? `${playerStats.parPerformancePct}%` : '—'}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                      {playerStats.parSolvedCount}/{playerStats.totalSolved} at Par
                    </span>
                  </div>

                  <div className="rounded-lg bg-[#0A0E17] border border-slate-800/80 p-3 flex flex-col gap-1">
                    <span className="text-[11px] font-mono text-slate-400">Total Nodes</span>
                    <span className="font-mono text-lg font-bold text-[#FFB800] tabular-nums">
                      {playerStats.totalNodesCollected}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                      Energy collected
                    </span>
                  </div>

                  <div className="rounded-lg bg-[#0A0E17] border border-slate-800/80 p-3 flex flex-col gap-1">
                    <span className="text-[11px] font-mono text-slate-400">Best Time</span>
                    <span className="font-mono text-lg font-bold text-slate-100 tabular-nums">
                      {formatDuration(playerStats.fastestTimeMs)}
                    </span>
                    <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                      Avg {formatDuration(playerStats.avgTimeMs)}
                    </span>
                  </div>
                </div>

                {/* Last 7 Days Streak Progress Bar Chart */}
                <div className="rounded-lg bg-[#0A0E17] border border-slate-800/80 p-3 flex flex-col gap-2.5 shrink-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-medium text-slate-200 whitespace-nowrap">
                        Last 7 Days Streak
                      </span>
                      <span className="text-[11px] font-mono text-slate-400 tabular-nums whitespace-nowrap">
                        {playerStats.solvedInLast7}/7 solved
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] font-mono text-slate-400 shrink-0">
                      {hoveredStreakDay ? (
                        (() => {
                          const target = playerStats.last7DaysStreak.find(
                            (d) => d.seedDate === hoveredStreakDay
                          );
                          if (!target) return null;
                          if (!target.completed) {
                            return (
                              <span className="text-slate-300 tabular-nums">
                                {target.seedDate} · Unsolved
                              </span>
                            );
                          }
                          return (
                            <span className="text-slate-200 tabular-nums">
                              #{target.completed.dayNumber} · Streak {target.streakCount} ·{' '}
                              {target.completed.bestTurns}/{target.completed.par}t
                            </span>
                          );
                        })()
                      ) : (
                        <>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-xs bg-[#00FF88] inline-block" />
                            <span>Par</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="w-2 h-2 rounded-xs bg-[#00F0FF] inline-block" />
                            <span>Solved</span>
                          </span>
                          {playerStats.peak7DayStreak > 0 && (
                            <span className="hidden xs:inline text-slate-300 tabular-nums">
                              Peak {playerStats.peak7DayStreak}d
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* 7-Column Bar Chart Plot */}
                  <div
                    role="img"
                    aria-label="Bar chart of daily puzzle completion streaks over the last 7 days"
                    className="relative grid grid-cols-7 gap-1.5 sm:gap-2 pt-4 pb-0.5 items-end"
                  >
                    {/* Subtle horizontal guide lines */}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 top-4 bottom-8 flex flex-col justify-between"
                    >
                      <div className="border-t border-slate-800/50" />
                      <div className="border-t border-slate-800/40" />
                      <div className="border-t border-slate-800/70" />
                    </div>

                    {playerStats.last7DaysStreak.map((day) => {
                      const hasStreak = day.streakCount > 0;
                      const heightPct = hasStreak
                        ? Math.max(22, Math.round((day.streakCount / playerStats.max7DayStreak) * 100))
                        : 0;
                      const barColorClass = day.hitPar
                        ? 'bg-gradient-to-t from-[#00CC6E] to-[#00FF88] shadow-[0_0_10px_rgba(0,255,136,0.22)]'
                        : 'bg-gradient-to-t from-[#00A3CC] to-[#00F0FF] shadow-[0_0_10px_rgba(0,240,255,0.22)]';

                      return (
                        <button
                          key={day.seedDate}
                          type="button"
                          onMouseEnter={() => setHoveredStreakDay(day.seedDate)}
                          onMouseLeave={() => setHoveredStreakDay(null)}
                          onFocus={() => setHoveredStreakDay(day.seedDate)}
                          onBlur={() => setHoveredStreakDay(null)}
                          onClick={() => {
                            setGameMode(statsMode);
                            setSeedDate(day.seedDate);
                            setShowStats(false);
                          }}
                          title={
                            day.completed
                              ? `${day.seedDate} · Streak ${day.streakCount} · ${day.completed.bestTurns}/${day.completed.par} Turns`
                              : `${day.seedDate} · Click to play`
                          }
                          className="group relative z-10 flex flex-col items-center gap-1.5 cursor-pointer rounded-md py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60"
                        >
                          {/* Bar Column Area */}
                          <div className="w-full h-18 flex flex-col items-center justify-end px-1 sm:px-1.5">
                            <span
                              className={`font-mono text-[10px] tabular-nums leading-none mb-1 shrink-0 transition-colors ${
                                hasStreak
                                  ? day.hitPar
                                    ? 'text-[#00FF88] font-semibold'
                                    : 'text-[#00F0FF] font-semibold'
                                  : 'text-slate-600'
                              }`}
                            >
                              {hasStreak ? day.streakCount : '—'}
                            </span>

                            <div className="w-full flex-1 flex items-end justify-center min-h-0">
                              {hasStreak ? (
                                <div
                                  style={{ height: `${heightPct}%` }}
                                  className={`w-full max-w-7 rounded-t-sm transition-all duration-200 group-hover:brightness-115 ${barColorClass} ${
                                    day.seedDate === seedDate ? 'ring-1 ring-white/70' : ''
                                  }`}
                                />
                              ) : (
                                <div
                                  className={`w-full max-w-7 h-1.5 rounded-xs transition-colors ${
                                    day.isToday
                                      ? 'border border-dashed border-[#00F0FF]/55 bg-[#00F0FF]/10'
                                      : 'bg-slate-800/80 group-hover:bg-slate-700'
                                  }`}
                                />
                              )}
                            </div>
                          </div>

                          {/* X-Axis Day Label */}
                          <div className="flex flex-col items-center leading-tight font-mono tabular-nums">
                            <span
                              className={`text-[10px] ${
                                day.isToday
                                  ? 'text-[#00F0FF] font-semibold'
                                  : 'text-slate-400 group-hover:text-slate-200'
                              }`}
                            >
                              {day.weekdayLabel}
                            </span>
                            <span className="text-[9px] text-slate-500">
                              {day.dayOfMonth}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Overclock Arcade Personal Records Banner (when player has completed >= 1 run) */}
                {(streakData.overclockStats?.totalRuns ?? 0) > 0 && (
                  <div className="rounded-lg bg-[#160E24] border border-[#A855F7]/30 px-3 py-2.5 flex items-center justify-between gap-3 shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <Zap className="w-3.5 h-3.5 text-[#C084FC] shrink-0" />
                      <span className="text-xs font-medium text-slate-100 whitespace-nowrap">
                        Overclock Arcade
                      </span>
                    </div>
                    <div className="flex items-center gap-3 font-mono text-[11px] tabular-nums shrink-0">
                      <span className="text-slate-300">
                        Best{' '}
                        <span className="text-[#C084FC] font-semibold">
                          {streakData.overclockStats?.bestScore ?? 0}
                        </span>
                      </span>
                      <span className="text-slate-300">
                        Chain{' '}
                        <span className="text-[#FFB800] font-semibold">
                          {streakData.overclockStats?.bestChain ?? 0}
                        </span>
                      </span>
                      <span className="text-slate-400">
                        {streakData.overclockStats?.totalRuns ?? 0} runs
                      </span>
                    </div>
                  </div>
                )}

                {/* Completion History Table */}
                <div className="flex flex-col min-h-0 border-t border-slate-800/80 pt-3">
                  <div className="grid grid-cols-[1.2fr_0.95fr_0.6fr_0.65fr] gap-2 px-2.5 pb-2 text-[11px] font-mono text-slate-400 border-b border-slate-800/70 shrink-0">
                    <span>Puzzle</span>
                    <span>Turns / Par</span>
                    <span className="text-right">Nodes</span>
                    <span className="text-right">Time</span>
                  </div>

                  {playerStats.history.length === 0 ? (
                    <div className="py-8 px-4 text-center flex flex-col items-center gap-1.5">
                      <p className="text-xs font-medium text-slate-200">
                        {statsMode === 'challenge'
                          ? 'No completed Daily Challenges yet'
                          : 'No completed daily puzzles yet'}
                      </p>
                      <p className="text-[11px] text-slate-400 max-w-xs">
                        {statsMode === 'challenge'
                          ? 'Collect all 5 Energy Nodes and reach the Exit within the strict move limit to record Challenge clears.'
                          : 'Collect all Energy Nodes and reach the Exit to record your completion times, Par rate, and streak.'}
                      </p>
                    </div>
                  ) : (
                    <ul className="overflow-y-auto max-h-48 sm:max-h-56 divide-y divide-slate-800/60 pr-0.5">
                      {playerStats.history.map((entry) => {
                        const hitPar = entry.bestTurns <= entry.par;
                        const delta = entry.bestTurns - entry.par;
                        const isActiveSeed =
                          entry.seedDate === seedDate && gameMode === statsMode;
                        return (
                          <li key={entry.seedDate}>
                            <button
                              type="button"
                              onClick={() => {
                                setGameMode(statsMode);
                                setSeedDate(entry.seedDate);
                                setShowStats(false);
                              }}
                              title={`Load ${statsMode === 'challenge' ? 'Challenge' : 'Daily'} #${entry.dayNumber} (${entry.seedDate})`}
                              className={`w-full grid grid-cols-[1.2fr_0.95fr_0.6fr_0.65fr] gap-2 items-center px-2.5 py-2 text-left font-mono text-xs tabular-nums transition-colors cursor-pointer hover:bg-[#161E2E]/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60 ${
                                isActiveSeed ? 'bg-[#161E2E]/50' : ''
                              }`}
                            >
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span className="text-white font-semibold">
                                  #{entry.dayNumber}
                                </span>
                                <span className="text-slate-400 text-[11px] truncate">
                                  {entry.seedDate}
                                </span>
                              </span>

                              <span className="flex items-center gap-1.5">
                                <span className="text-slate-100">
                                  {entry.bestTurns}/{entry.par}
                                </span>
                                <span
                                  className={`text-[10px] font-semibold ${
                                    hitPar ? 'text-[#00FF88]' : 'text-[#FFB800]'
                                  }`}
                                >
                                  {hitPar ? 'PAR' : `+${delta}`}
                                </span>
                              </span>

                              <span className="text-right text-[#FFB800] font-medium">
                                {entry.nodesCollected}
                              </span>

                              <span className="text-right text-slate-200">
                                {formatDuration(entry.bestTimeMs)}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                {/* Subreddit Leaderboard (6 Modes: Overall + Story + 4 Arcade/Daily Modes) */}
                <div className="rounded-lg bg-[#0A0E17] border border-slate-800/80 overflow-hidden">
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-800/80 flex-wrap">
                    <div className="flex items-center gap-1 flex-wrap">
                      {(
                        [
                          { id: 'overall', label: 'Overall' },
                          { id: 'story', label: 'Story' },
                          { id: 'daily', label: 'Daily' },
                          { id: 'challenge', label: 'Hard' },
                          { id: 'blitz', label: 'Blitz' },
                          { id: 'overclock', label: 'Rush' },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setLbTab(tab.id)}
                          className={`px-2 py-0.5 rounded font-mono text-[10px] uppercase tracking-wider cursor-pointer transition-colors ${
                            lbTab === tab.id
                              ? 'bg-[#182235] text-[#00F0FF] font-semibold'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    <Trophy className="w-3.5 h-3.5 text-[#FFB800]" />
                  </div>

                  {lbTab === 'story' ? (
                    storyLeaderboard.length === 0 ? (
                      <p className="px-3 py-4 text-center text-[11px] text-slate-500">
                        Play Story Mode to post your Sector, Attempts &amp; Time!
                      </p>
                    ) : (
                      <ul className="divide-y divide-slate-800/60 max-h-36 overflow-y-auto">
                        {storyLeaderboard.slice(0, 5).map((entry) => (
                          <li
                            key={`${entry.rank}-${entry.username}`}
                            className="flex items-center justify-between px-3 py-1.5 font-mono text-xs tabular-nums"
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <span className={entry.rank === 1 ? 'text-[#FFB800] font-bold w-4' : 'text-slate-500 w-4'}>
                                {entry.rank === 1 ? '👑' : `#${entry.rank}`}
                              </span>
                              <span className="text-slate-200 truncate">u/{entry.username}</span>
                            </span>
                            <span className="flex items-center gap-2 shrink-0">
                              <span className="text-[#00FF88] font-semibold">S{entry.sector}/6</span>
                              <span className="text-slate-400">{entry.attempts} att</span>
                              <span className="text-slate-200">{formatDuration(entry.timeMs)}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : lbTab === 'overall' ? (
                    <div className="flex flex-col">
                      {/* Player 5-Pillar Breakdown & Weakest Link Callout */}
                      {(() => {
                        const pillarList = [
                          { id: 'mobo', label: 'MOBO', val: myPillars.mobo ?? 0 },
                          { id: 'ram', label: 'RAM', val: myPillars.ram ?? 0 },
                          { id: 'ssd', label: 'SSD', val: myPillars.ssd ?? 0 },
                          { id: 'gpu', label: 'GPU', val: myPillars.gpu ?? 0 },
                          { id: 'cpu', label: 'CPU', val: myPillars.cpu ?? 0 },
                        ];
                        const total = pillarList.reduce((acc, p) => acc + p.val, 0);
                        const weakest = [...pillarList].sort((a, b) => a.val - b.val)[0];
                        return (
                          <div className="px-3 py-2 bg-[#0D1320] border-b border-slate-800/80 flex flex-col gap-1.5 font-mono text-[10px]">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">5-PILLAR ARCHITECT SCORE</span>
                              <span className="text-[#00FF88] font-bold">{total} PTS</span>
                            </div>
                            <div className="grid grid-cols-5 gap-1 text-center">
                              {pillarList.map((p) => (
                                <div
                                  key={p.id}
                                  className={`rounded px-1 py-0.5 border ${
                                    p.val > 0
                                      ? 'bg-[#08241C]/70 border-[#00FF88]/35 text-[#00FF88]'
                                      : 'bg-[#121826] border-slate-800 text-slate-500'
                                  }`}
                                >
                                  <div className="text-[9px] opacity-80">{p.label}</div>
                                  <div className="font-bold tabular-nums">{p.val}</div>
                                </div>
                              ))}
                            </div>
                            <div className="text-[10px] text-[#FFB800]">
                              Weakest link: <strong>{weakest.label}</strong> ({weakest.val} pts) — beat your record to climb!
                            </div>
                          </div>
                        );
                      })()}

                      {(() => {
                        const lvl = getPlayerLevelInfo(economy.powerScore);
                        return (
                          <div className="px-3 py-2.5 bg-gradient-to-r from-[#0D1526] to-[#111C33] border-b border-slate-800/80 flex flex-col gap-1.5 font-mono">
                            <div className="flex items-center justify-between text-xs">
                              <span className="flex items-center gap-2">
                                <span className="px-1.5 py-0.5 rounded bg-[#00F0FF]/15 border border-[#00F0FF]/40 text-[#00F0FF] font-bold text-[10px]">
                                  LVL {lvl.level}
                                </span>
                                <span className="text-slate-100 font-semibold">{lvl.title}</span>
                              </span>
                              <span className="text-[10px] text-slate-400 tabular-nums">
                                {lvl.currentXp} / {lvl.nextLevelXp} XP
                              </span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-slate-800/90 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-[#00F0FF] to-[#00FF88] transition-all duration-300"
                                style={{ width: `${lvl.progressPct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })()}

                      {overallLeaderboard.length === 0 ? (
                        <p className="px-3 py-4 text-center text-[11px] text-slate-500">
                          Play MOBO, RAM, SSD, GPU &amp; CPU to build your 5-Pillar Architect Score!
                        </p>
                      ) : (
                        <>
                        <ul className="divide-y divide-slate-800/60 max-h-64 overflow-y-auto">
                          {overallLeaderboard.slice(0, 10).map((entry) => {
                            const entryLvl = getPlayerLevelInfo(entry.powerScore);
                            const isMe = username && entry.username === username;
                            const rankBadge =
                              entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `#${entry.rank}`;
                            const rankColor =
                              entry.rank === 1
                                ? 'text-[#FFB800] font-bold'
                                : entry.rank === 2
                                  ? 'text-slate-200 font-bold'
                                  : entry.rank === 3
                                    ? 'text-[#FB923C] font-bold'
                                    : 'text-slate-500';
                            return (
                            <li
                              key={`${entry.rank}-${entry.username}`}
                              className={`flex items-center justify-between gap-2 px-3 py-2 font-mono text-xs tabular-nums ${
                                isMe
                                  ? 'bg-[#00F0FF]/10 border-l-2 border-l-[#00F0FF]'
                                  : entry.rank <= 3
                                    ? 'bg-slate-900/40'
                                    : ''
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`${rankColor} w-6 text-center shrink-0`}>
                                  {rankBadge}
                                </span>
                                <span className={`truncate ${isMe ? 'text-[#00F0FF] font-semibold' : 'text-slate-200'}`}>
                                  u/{entry.username}
                                </span>
                                <span className="px-1.5 py-0.5 rounded bg-slate-800/90 text-[9px] text-slate-300 shrink-0">
                                  L{entryLvl.level}
                                </span>
                              </div>
                              <span className="flex items-center gap-2 shrink-0">
                                <span className="text-[#00F0FF] font-semibold">
                                  {entry.powerScore} PTS
                                </span>
                                {username && entry.username !== username && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setShowStats(false);
                                      setArenaTargetUser(entry.username);
                                      setShowArena(true);
                                    }}
                                    title={`Challenge u/${entry.username}`}
                                    className="p-1 rounded bg-[#2C131C] border border-[#FF4460]/40 text-[#FF5C77] hover:bg-[#3D1A26] cursor-pointer"
                                  >
                                    <Swords className="w-3 h-3" />
                                  </button>
                                )}
                              </span>
                            </li>
                            );
                          })}
                        </ul>
                        {username && !overallLeaderboard.slice(0, 10).some((e) => e.username === username) && (() => {
                          const myEntry = overallLeaderboard.find((e) => e.username === username);
                          const myLvl = getPlayerLevelInfo(myEntry?.powerScore ?? economy.powerScore);
                          return (
                            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-[#00F0FF]/10 border-t border-[#00F0FF]/30 font-mono text-xs tabular-nums">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-[#00F0FF] font-bold w-6 text-center shrink-0">
                                  {myEntry ? `#${myEntry.rank}` : 'YOU'}
                                </span>
                                <span className="text-[#00F0FF] font-semibold truncate">
                                  u/{username}
                                </span>
                                <span className="px-1.5 py-0.5 rounded bg-slate-800/90 text-[9px] text-slate-300 shrink-0">
                                  L{myLvl.level}
                                </span>
                              </div>
                              <span className="text-[#00F0FF] font-semibold shrink-0">
                                {myEntry?.powerScore ?? economy.powerScore} PTS
                              </span>
                            </div>
                          );
                        })()}
                        </>
                      )}
                    </div>
                  ) : lbTab === 'challenge' ? (
                    challengeLeaderboard.length === 0 ? (
                      <p className="px-3 py-4 text-center text-[11px] text-slate-500">
                        No Challenge clears recorded yet today.
                      </p>
                    ) : (
                      <ul className="divide-y divide-slate-800/60 max-h-36 overflow-y-auto">
                        {challengeLeaderboard.slice(0, 5).map((entry) => (
                          <li
                            key={`${entry.rank}-${entry.username}`}
                            className="flex items-center justify-between px-3 py-1.5 font-mono text-xs tabular-nums"
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="text-slate-500 w-4">#{entry.rank}</span>
                              <span className="text-slate-200 truncate">u/{entry.username}</span>
                            </span>
                            <span className="text-[#FF5C77] font-semibold">
                              {entry.turns}T · {entry.movesUsed}M
                            </span>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : lbTab === 'blitz' ? (
                    blitzLeaderboard.length === 0 ? (
                      <p className="px-3 py-4 text-center text-[11px] text-slate-500">
                        No Blitz Sprint times recorded yet today.
                      </p>
                    ) : (
                      <ul className="divide-y divide-slate-800/60 max-h-36 overflow-y-auto">
                        {blitzLeaderboard.slice(0, 5).map((entry) => (
                          <li
                            key={`${entry.rank}-${entry.username}`}
                            className="flex items-center justify-between px-3 py-1.5 font-mono text-xs tabular-nums"
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="text-slate-500 w-4">#{entry.rank}</span>
                              <span className="text-slate-200 truncate">u/{entry.username}</span>
                            </span>
                            <span className="text-[#00FF88] font-semibold">
                              {(entry.timeMs / 1000).toFixed(1)}s ({entry.turns}T)
                            </span>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : lbTab === 'overclock' ? (
                    overclockLeaderboard.length === 0 ? (
                      <p className="px-3 py-4 text-center text-[11px] text-slate-500">
                        No Overclock scores recorded yet today.
                      </p>
                    ) : (
                      <ul className="divide-y divide-slate-800/60 max-h-36 overflow-y-auto">
                        {overclockLeaderboard.slice(0, 5).map((entry) => (
                          <li
                            key={`${entry.rank}-${entry.username}`}
                            className="flex items-center justify-between px-3 py-1.5 font-mono text-xs tabular-nums"
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="text-slate-500 w-4">#{entry.rank}</span>
                              <span className="text-slate-200 truncate">u/{entry.username}</span>
                            </span>
                            <span className="text-[#C084FC] font-semibold">
                              {entry.score} pts ({entry.chain}x)
                            </span>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : leaderboard.length === 0 ? (
                    <p className="px-3 py-4 text-center text-[11px] text-slate-500">
                      Be the first on the leaderboard today!
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-800/60 max-h-36 overflow-y-auto">
                      {leaderboard.slice(0, 5).map((entry) => (
                        <li
                          key={`${entry.rank}-${entry.username}`}
                          className="flex items-center justify-between px-3 py-1.5 font-mono text-xs tabular-nums"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="text-slate-500 w-4">#{entry.rank}</span>
                            <span className="text-slate-200 truncate">u/{entry.username}</span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span
                              className={
                                entry.turns <= entry.par
                                  ? 'text-[#00FF88] font-semibold'
                                  : 'text-slate-200'
                              }
                            >
                              {entry.turns}/{entry.par}T
                            </span>
                            <span className="text-slate-400">
                              {formatDuration(entry.timeMs)}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* PvP Arena Modal */}
        <AnimatePresence>
          {showArena && (
            <Suspense fallback={null}>
              <ArenaModal
                username={username}
                economy={economy}
                currentMode={gameMode}
                currentTier={cacheTier}
                preselectedTarget={arenaTargetUser}
                onUpdateEconomy={setEconomy}
                onStartCreateDuel={(draft) => {
                  setIsStoryMode(false);
                  setDailyChallengeModule('cpu');
                  setStandaloneRamResult(null);
                  setActiveDuel(null);
                  setPendingDuelDraft(draft);
                  setGameMode(draft.mode);
                  setCacheTier(draft.tier);
                  setRngSalt(Math.floor(Math.random() * 900000) + 1);
                }}
                onAcceptDuel={(duel) => {
                  setIsStoryMode(false);
                  setDailyChallengeModule('cpu');
                  setStandaloneRamResult(null);
                  setPendingDuelDraft(null);
                  setActiveDuel(duel);
                  setSeedDate(duel.seedDate);
                  setGameMode(duel.mode);
                  setCacheTier(duel.tier);
                  setRngSalt(duel.rngSalt);
                }}
                onClose={() => {
                  setShowArena(false);
                  setArenaTargetUser(null);
                }}
              />
            </Suspense>
          )}
        </AnimatePresence>

        {/* Silicon Armory Modal */}
        <AnimatePresence>
          {showArmory && (
            <Suspense fallback={null}>
              <ArmoryModal
                economy={economy}
                hints={hints}
                onUpdate={(nextEcon, nextHints) => {
                  setEconomy(nextEcon);
                  setHints(nextHints);
                  saveHintsBalance(nextHints);
                }}
                onClose={() => setShowArmory(false)}
              />
            </Suspense>
          )}
        </AnimatePresence>

        {/* Circuit Creator Modal */}
        <AnimatePresence>
          {showCreator && (
            <Suspense fallback={null}>
              <CircuitCreatorModal onClose={() => setShowCreator(false)} />
            </Suspense>
          )}
        </AnimatePresence>

        {/* Arcade Terminal Story Briefing Overlay */}
        <AnimatePresence>
          {isStoryMode && showStoryBriefing && !isSolved && !componentClearedResult && (() => {
            const compSpec =
              storyComponent !== 'cpu' ? STORY_COMPONENT_SPECS[storyComponent] : null;
            const slotHeader = compSpec
              ? `SYS_TERMINAL // ${compSpec.slot}`
              : `SYS_TERMINAL // 05/05 · CPU (${currentSectorSpec.sector}/6)`;
            const difficulty = compSpec ? compSpec.difficulty : currentSectorSpec.difficulty;
            const badgeText = compSpec
              ? compSpec.badge
              : `${currentSectorSpec.difficulty} · ${currentSectorSpec.gridSize}×${currentSectorSpec.gridSize} · ${currentSectorSpec.tier}`;
            const codeName = compSpec ? compSpec.codeName : currentSectorSpec.codeName;
            const incident = compSpec ? compSpec.incident : currentSectorSpec.incident;
            const directive = compSpec ? compSpec.directive : currentSectorSpec.directive;
            const ctaText = compSpec
              ? compSpec.cta
              : `[ INITIALIZE SECTOR 0${currentSectorSpec.sector} ]`;

            return (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="absolute inset-0 z-30 flex items-center justify-center bg-[#06090F]/85 backdrop-blur-sm p-4"
              >
                <motion.div
                  role="dialog"
                  aria-label="PowerShell Grid Terminal"
                  initial={{ opacity: 0, scale: 0.96, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 10 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="w-full max-w-lg rounded-lg bg-[#02060D] border border-[#00F0FF]/55 shadow-[0_0_40px_rgba(0,240,255,0.22)] overflow-hidden flex flex-col font-mono"
                >
                  {/* CMD / PowerShell Title Bar */}
                  <div className="flex items-center justify-between px-3.5 py-2 bg-[#071324] border-b border-[#00F0FF]/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[11px] font-bold text-[#00F0FF] px-1.5 py-0.5 rounded bg-[#0C243D] border border-[#00F0FF]/40">
                        &gt;_
                      </span>
                      <span className="text-[11px] font-bold tracking-wider text-[#7DD3FC] truncate">
                        PowerShell // {slotHeader}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          difficulty === 'HARD'
                            ? 'bg-[#2C131C] text-[#FF5C77] border-[#FF4460]/40'
                            : 'bg-[#082032] text-[#00F0FF] border-[#00F0FF]/45'
                        }`}
                      >
                        {badgeText}
                      </span>
                      <span className="hidden sm:inline text-[10px] text-slate-500 select-none">
                        ─ □ ✕
                      </span>
                    </div>
                  </div>

                  {/* Module Command Header */}
                  <div className="px-3.5 pt-3 pb-1 bg-[#02060D] border-b border-[#00F0FF]/15 flex items-center justify-between">
                    <span className="text-[11px] text-[#00F0FF]/80">
                      PS C:\GRID\CORE&gt; <span className="text-white font-bold">{codeName}</span>
                    </span>
                  </div>

                  {/* Neon-Blue Letter-by-Letter Terminal Output */}
                  <TerminalTypewriter
                    resetKey={`briefing-${storyComponent}-${currentSectorSpec.sector}`}
                    lines={[
                      {
                        prefix: 'PS C:\\GRID>',
                        prefixClass: 'text-[#00F0FF]',
                        text: `.\\diagnose --target=${storyComponent.toUpperCase()}`,
                      },
                      {
                        prefix: '[ANOMALY]',
                        prefixClass: 'text-[#38BDF8]',
                        text: incident,
                      },
                      {
                        prefix: '[DIRECTIVE]',
                        prefixClass: 'text-[#00F0FF]',
                        text: directive,
                      },
                    ]}
                  />

                  {/* Story Difficulty Selector (Easy / Normal / Hard) */}
                  <div className="px-3.5 py-2 bg-[#040A14] border-t border-[#00F0FF]/15 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                      Story Difficulty:
                    </span>
                    <div
                      role="group"
                      aria-label="Story difficulty"
                      className="inline-flex items-center rounded bg-[#0A111D] border border-slate-800 p-0.5 text-[10px]"
                    >
                      {(
                        [
                          { id: 'easy', label: 'Easy (∞)', cls: 'bg-[#08241C] text-[#00FF88] border border-[#00FF88]/40' },
                          { id: 'normal', label: 'Normal', cls: 'bg-[#102438] text-[#00F0FF] border border-[#00F0FF]/45' },
                          { id: 'hard', label: 'Hard', cls: 'bg-[#2C131C] text-[#FF5C77] border border-[#FF4460]/45' },
                        ] as const
                      ).map(({ id, label, cls }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setStoryDifficulty(id)}
                          className={`px-2 py-0.5 rounded-xs font-bold uppercase cursor-pointer transition-colors ${
                            storyDifficulty === id ? cls : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Command Prompt CTA Bar */}
                  <div className="px-3.5 py-3 bg-[#050C18] border-t border-[#00F0FF]/25 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <span className="text-[11px] text-[#00F0FF] flex items-center gap-1">
                      <span>PS C:\GRID&gt;</span>
                      <span className="text-[#7DD3FC]">ready_to_execute</span>
                      <span className="inline-block w-1.5 h-3.5 bg-[#00F0FF] animate-pulse" />
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowStoryBriefing(false)}
                      className="w-full sm:w-auto py-2 px-4 rounded bg-[#00F0FF] text-[#020A14] font-bold text-xs tracking-wider uppercase hover:bg-[#38F5FF] active:scale-[0.99] transition-all cursor-pointer shadow-[0_0_20px_rgba(0,240,255,0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]"
                    >
                      ▶ {ctaText}
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            );
          })()}
        </AnimatePresence>

        {/* Component Cleared Terminal Debrief Overlay (RAM -> SSD -> GPU) */}
        <AnimatePresence>
          {isStoryMode && componentClearedResult && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 z-30 flex items-center justify-center bg-[#06090F]/85 backdrop-blur-sm p-4"
            >
              <motion.div
                role="dialog"
                aria-label="PowerShell Subsystem Sync"
                initial={{ opacity: 0, scale: 0.96, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 10 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="w-full max-w-lg rounded-lg bg-[#02060D] border border-[#00F0FF]/55 shadow-[0_0_40px_rgba(0,240,255,0.22)] overflow-hidden flex flex-col font-mono"
              >
                <div className="flex items-center justify-between px-3.5 py-2 bg-[#071324] border-b border-[#00F0FF]/30">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-[#00F0FF] px-1.5 py-0.5 rounded bg-[#0C243D] border border-[#00F0FF]/40">
                      &gt;_
                    </span>
                    <span className="text-[11px] font-bold tracking-wider text-[#7DD3FC]">
                      PowerShell // {componentClearedResult.stage.toUpperCase()} ONLINE
                    </span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[#082032] border border-[#00F0FF]/45 text-[#00F0FF] font-bold">
                    HARMONIZED
                  </span>
                </div>

                <TerminalTypewriter
                  resetKey={`debrief-${componentClearedResult.stage}-${componentClearedResult.result.timeMs}`}
                  lines={[
                    {
                      prefix: 'PS C:\\GRID>',
                      prefixClass: 'text-[#00F0FF]',
                      text: `${componentClearedResult.stage.toUpperCase()} subsystem locked into quantum phase. Inner Grid integrity rising.`,
                    },
                  ]}
                />

                <div className="px-3.5 pb-3 grid grid-cols-3 gap-2 text-center bg-[#02060D]">
                  <div className="rounded bg-[#06101E] border border-[#00F0FF]/25 p-2">
                    <div className="text-[10px] text-[#7DD3FC]/70">ATTEMPTS</div>
                    <div className="text-sm font-bold text-white mt-0.5">
                      {componentClearedResult.result.attempts}
                    </div>
                  </div>
                  <div className="rounded bg-[#06101E] border border-[#00F0FF]/25 p-2">
                    <div className="text-[10px] text-[#7DD3FC]/70">MISSTEPS</div>
                    <div className="text-sm font-bold text-[#00F0FF] mt-0.5">
                      {componentClearedResult.result.missteps}
                    </div>
                  </div>
                  <div className="rounded bg-[#06101E] border border-[#00F0FF]/25 p-2">
                    <div className="text-[10px] text-[#7DD3FC]/70">TIME</div>
                    <div className="text-sm font-bold text-[#38BDF8] mt-0.5">
                      {(componentClearedResult.result.timeMs / 1000).toFixed(1)}s
                    </div>
                  </div>
                </div>

                <div className="px-3.5 py-3 bg-[#050C18] border-t border-[#00F0FF]/25">
                  <button
                    type="button"
                    onClick={advanceFromComponentDebrief}
                    className="w-full py-2.5 px-4 rounded bg-[#00F0FF] text-[#020A14] font-bold text-xs tracking-wider uppercase hover:bg-[#38F5FF] active:scale-[0.99] transition-all cursor-pointer shadow-[0_0_20px_rgba(0,240,255,0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]"
                  >
                    ▶{' '}
                    {componentClearedResult.stage === 'mobo'
                      ? 'NEXT: RAM MEMORY MATRIX →'
                      : componentClearedResult.stage === 'ram'
                        ? 'NEXT: SSD PACKET DEFRAG →'
                        : componentClearedResult.stage === 'ssd'
                          ? 'NEXT: GPU PHOTON RACE →'
                          : 'NEXT: CPU 2.5D CORE →'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* End State Overlay Card */}
        <AnimatePresence>
          {isSolved && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 z-30 flex items-center justify-center bg-[#090B10]/75 backdrop-blur-sm p-4"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: 8 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="w-full max-w-sm rounded-xl cyber-panel p-6 flex flex-col gap-5"
              >
                <div className="flex items-baseline justify-between border-b border-slate-800/80 pb-4">
                  <div className="flex items-center gap-2 min-w-0">
                    <h2 className="font-display text-xl font-bold tracking-tight text-white">
                      {isStoryMode
                        ? `SECTOR 0${activeSector}/06`
                        : level.mode === 'challenge'
                          ? `CHALLENGE #${level.dayNumber}`
                          : level.mode === 'overclock'
                            ? `OVERCLOCK #${level.dayNumber}`
                            : level.mode === 'blitz'
                              ? `BLITZ #${level.dayNumber}`
                              : `DAILY #${level.dayNumber}`}
                    </h2>
                    {level.mode === 'challenge' && (
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#FF5C77] px-1.5 py-0.5 rounded bg-[#2C131C] border border-[#FF4460]/35">
                        Hard
                      </span>
                    )}
                    {level.mode === 'overclock' && (
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#C084FC] px-1.5 py-0.5 rounded bg-[#241338] border border-[#A855F7]/40">
                        Rush
                      </span>
                    )}
                    {level.mode === 'blitz' && (
                      <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#00FF88] px-1.5 py-0.5 rounded bg-[#08241C] border border-[#00FF88]/40">
                        3/3 Sprint
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-xs text-slate-400 tabular-nums">
                    {isStoryMode ? `${level.size}×${level.size} ${currentSectorSpec.tier}` : level.seedDate}
                  </span>
                </div>

                {isStoryMode && (
                  <div className="rounded-lg bg-[#071216] border border-[#00FF88]/35 p-3 font-mono text-xs leading-relaxed">
                    <span className="text-[#00FF88] font-bold">&gt; [POST-OP LOG]: </span>
                    <span className="text-slate-200">{currentSectorSpec.debrief}</span>
                  </div>
                )}

                {!isStoryMode && unlockedSectorOnWin && (
                  <div className="rounded-lg bg-[#08241C] border border-[#00FF88]/45 px-3 py-2 flex items-center justify-between gap-2 font-mono text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <Cpu className="w-4 h-4 text-[#00FF88] shrink-0" />
                      <span className="text-[#00FF88] font-semibold truncate">
                        CHIP UPGRADE: SECTOR {unlockedSectorOnWin.sector}/6
                      </span>
                    </div>
                    <span className="text-white font-bold shrink-0">
                      {unlockedSectorOnWin.gridSize}×{unlockedSectorOnWin.gridSize} {unlockedSectorOnWin.tier}
                    </span>
                  </div>
                )}

                {isPersonalBestOnWin && (
                  <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-md bg-[#FFB800]/10 border border-[#FFB800]/35 text-[#FFD166]">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide">
                      <Trophy className="w-3.5 h-3.5 text-[#FFB800] shrink-0" />
                      <span>Personal Best</span>
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-[#FFB800]/90">
                      New Record
                    </span>
                  </div>
                )}

                {duelOutcome && (
                  <div
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-md border font-mono text-xs ${
                      duelOutcome.won
                        ? 'bg-[#06241B] border-[#00FF88]/45 text-[#00FF88]'
                        : 'bg-[#2C131C] border-[#FF4460]/45 text-[#FF8FA3]'
                    }`}
                  >
                    <span className="font-bold">
                      {duelOutcome.won
                        ? `⚔️ DUEL WON vs u/${duelOutcome.opponent}!`
                        : `⚔️ DUEL LOST vs u/${duelOutcome.opponent}`}
                    </span>
                    <span className="font-semibold">
                      {duelOutcome.won
                        ? `+${duelOutcome.wagerCycles} CYC · +${duelOutcome.wagerPower} PWR`
                        : `-${duelOutcome.wagerCycles} CYC · -${duelOutcome.wagerPower} PWR`}
                    </span>
                  </div>
                )}

                {(earnedCyclesOnWin > 0 || earnedPowerOnWin > 0) && (
                  <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-md bg-[#0A0E17] border border-slate-800 font-mono text-xs tabular-nums">
                    <span className="text-[#FFB800] font-semibold">+{earnedCyclesOnWin} CYC</span>
                    <span className="text-[#00F0FF] font-semibold">+{earnedPowerOnWin} PWR</span>
                  </div>
                )}

                {level.mode === 'blitz' ? (
                  <div className="flex flex-col gap-3 font-mono text-sm tabular-nums">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">STAGES CLEARED</span>
                      <span className="text-[#00FF88] font-bold">3 / 3</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">TOTAL TIME</span>
                      <span className="text-[#00F0FF] font-bold text-base">
                        {(blitzElapsedMs / 1000).toFixed(1)}s
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">TOTAL TURNS</span>
                      <span className="text-white font-semibold">{blitzTotalTurns}</span>
                    </div>
                    {dailyRank && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">BLITZ RANK</span>
                        <span className="text-[#00FF88] font-semibold">
                          #{dailyRank.rank} of {dailyRank.total}
                        </span>
                      </div>
                    )}
                  </div>
                ) : level.mode === 'overclock' ? (
                  <div className="flex flex-col gap-3 font-mono text-sm tabular-nums">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">SCORE</span>
                      <span className="text-[#C084FC] font-bold text-base">
                        {overclockScore}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">NODES ROUTED</span>
                      <span className="text-[#FFB800] font-semibold">
                        {overclockChain}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">BEST SCORE</span>
                      <span className="text-white font-semibold">
                        {Math.max(overclockScore, streakData.overclockStats?.bestScore ?? 0)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">BEST CHAIN</span>
                      <span className="text-white font-semibold">
                        {Math.max(overclockChain, streakData.overclockStats?.bestChain ?? 0)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3 font-mono text-sm tabular-nums">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">TURNS</span>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-semibold">
                          {turns} (PAR: {level.par})
                        </span>
                        <span
                          className={`text-xs font-semibold ${
                            isOptimal ? 'text-[#00FF88]' : 'text-[#FFB800]'
                          }`}
                        >
                          {isOptimal ? 'OPTIMAL' : `+${parDiff}`}
                        </span>
                      </div>
                    </div>

                    {level.mode === 'challenge' && level.moveLimit !== undefined && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">MOVES</span>
                        <span className="text-white font-semibold">
                          {movesUsed} / {level.moveLimit}
                        </span>
                      </div>
                    )}

                    {isStoryMode && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">ATTEMPTS</span>
                        <span className="text-[#00F0FF] font-semibold">
                          {storyAttempts} (Total: {storyTotalAttempts})
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">MISSTEPS</span>
                      <span
                        className={`font-semibold ${
                          missteps === 0 ? 'text-[#00FF88]' : 'text-[#FFB800]'
                        }`}
                      >
                        {missteps === 0 ? '0 · CLEAN RUN' : `${missteps} (undos/resets)`}
                      </span>
                    </div>

                    {(lastSolveTimeMs !== null || isStoryMode) && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">{isStoryMode ? 'SECTOR TIME' : 'TIME'}</span>
                        <span className="text-white font-semibold">
                          {formatDuration(lastSolveTimeMs ?? storyLiveMs)}
                          {isStoryMode && storyTotalTimeMs > 0 && (
                            <span className="text-slate-400 font-normal ml-1.5">
                              (Σ {formatDuration(storyTotalTimeMs)})
                            </span>
                          )}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">STREAK</span>
                      <span className="text-white font-semibold">
                        🔥 {streakData.currentStreak}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">HINTS</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sky-200 font-semibold">{hints}</span>
                        {earnedHintsOnWin > 0 && (
                          <span className="text-xs font-semibold text-[#00FF88]">
                            +{earnedHintsOnWin}
                          </span>
                        )}
                      </div>
                    </div>

                    {dailyRank && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400">RANK</span>
                        <span className="text-[#00F0FF] font-semibold">
                          #{dailyRank.rank} of {dailyRank.total}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-2.5 pt-1">
                  {isStoryMode ? (
                    <button
                      type="button"
                      onClick={() => {
                        const nextSec = activeSector < KERNEL_SECTORS.length ? activeSector + 1 : 1;
                        if (nextSec > unlockedSector) {
                          setUnlockedSector(nextSec);
                          try {
                            localStorage.setItem('gridlock_unlocked_sector', String(nextSec));
                          } catch {}
                        }
                        enterStoryMode(nextSec, nextSec === 1);
                      }}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#00FF88] text-[#06120D] hover:bg-[#33FFA0] font-mono font-bold text-xs tracking-wider uppercase active:scale-[0.99] transition-all whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00FF88]"
                    >
                      <Cpu className="w-4 h-4" />
                      <span>
                        {activeSector < KERNEL_SECTORS.length
                          ? `[ ADVANCE TO SECTOR 0${activeSector + 1} → ]`
                          : '[ SYSTEM RESTORED · REPLAY SECTOR 01 ]'}
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleCommentResult}
                      disabled={isPostingComment || commentPosted}
                      className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm active:scale-[0.99] transition-all whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 disabled:opacity-70 ${
                        level.mode === 'overclock'
                          ? 'bg-[#A855F7] text-white hover:bg-[#B975FA] focus-visible:ring-[#A855F7]'
                          : 'bg-[#00F0FF] text-[#090B10] hover:bg-[#33F3FF] focus-visible:ring-[#00F0FF]'
                      }`}
                    >
                      {commentPosted ? (
                        <>
                          <Check className="w-4 h-4" />
                          <span>Posted to Comments</span>
                        </>
                      ) : (
                        <>
                          <MessageSquare className="w-4 h-4" />
                          <span>
                            {isPostingComment ? 'Posting...' : 'Post Result to Comments'}
                          </span>
                        </>
                      )}
                    </button>
                  )}

                  <div className={`grid gap-2 ${!isStoryMode && level.mode === 'standard' ? 'grid-cols-3' : 'grid-cols-2'}`}>
                    <button
                      type="button"
                      onClick={handleCopyResult}
                      title="Copy spoiler-free emoji result to paste in chat or comments"
                      className="inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-lg bg-[#161D2C] text-slate-200 border border-slate-800 hover:border-slate-600 hover:text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-[#00FF88]" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copied!' : 'Copy Share'}</span>
                    </button>
                    {!isStoryMode && level.mode === 'standard' && (
                      <button
                        type="button"
                        onClick={() => triggerNewRngGrid(true)}
                        title="Advance to next procedural level"
                        className="inline-flex items-center justify-center gap-1 px-2.5 py-2 rounded-lg bg-[#161D2C] text-[#FFB800] border border-[#FFB800]/35 hover:border-[#FFB800]/70 text-xs font-medium transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFB800]/60"
                      >
                        <Shuffle className="w-3.5 h-3.5" />
                        <span>Next Level</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setStatsMode(gameMode === 'challenge' ? 'challenge' : 'standard');
                        setLbTab(
                          isStoryMode
                            ? 'story'
                            : gameMode === 'challenge'
                              ? 'challenge'
                              : gameMode === 'blitz'
                                ? 'blitz'
                                : gameMode === 'overclock'
                                  ? 'overclock'
                                  : 'daily'
                        );
                        setShowStats(true);
                      }}
                      className="px-2.5 py-2 rounded-lg bg-[#161D2C] text-slate-200 border border-slate-800 hover:border-slate-600 hover:text-white text-xs font-medium transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60"
                    >
                      Leaderboard
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsSolved(false)}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900/80 text-slate-300 border border-slate-800 hover:border-slate-600 hover:text-white text-xs font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F0FF]/60"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Close &amp; Continue</span>
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
