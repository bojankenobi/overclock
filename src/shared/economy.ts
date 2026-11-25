import type { CacheTier, GameMode, PlayerEconomy, SignalThemeId } from './types';

export const DEFAULT_ECONOMY: PlayerEconomy = {
  cycles: 100,
  totalEarnedCycles: 100,
  powerScore: 0,
  unlockedThemes: ['cyan'],
  activeTheme: 'cyan',
  overclockTimeBonusLevel: 0,
  streakShields: 0,
};

export interface ThemeSpec {
  id: SignalThemeId;
  name: string;
  cost: number;
  primary: string;
  secondary: string;
  glow: string;
}

export const SIGNAL_THEMES: Record<SignalThemeId, ThemeSpec> = {
  cyan: {
    id: 'cyan',
    name: 'Cyan Core',
    cost: 0,
    primary: '#00F0FF',
    secondary: '#38BDF8',
    glow: 'rgba(0, 240, 255, 0.55)',
  },
  gold: {
    id: 'gold',
    name: 'Solar Gold',
    cost: 300,
    primary: '#FFB800',
    secondary: '#FDE047',
    glow: 'rgba(255, 184, 0, 0.55)',
  },
  crimson: {
    id: 'crimson',
    name: 'Crimson Volt',
    cost: 600,
    primary: '#FF4460',
    secondary: '#FB7185',
    glow: 'rgba(255, 68, 96, 0.55)',
  },
  violet: {
    id: 'violet',
    name: 'Quantum Violet',
    cost: 1000,
    primary: '#C084FC',
    secondary: '#A855F7',
    glow: 'rgba(192, 132, 252, 0.55)',
  },
  emerald: {
    id: 'emerald',
    name: 'Matrix Emerald',
    cost: 1500,
    primary: '#00FF88',
    secondary: '#34D399',
    glow: 'rgba(0, 255, 136, 0.55)',
  },
};

export const HINT_PACK_COST = 120;
export const STREAK_SHIELD_COST = 350;
export const OVERCLOCK_CAP_COSTS = [400, 900, 1600] as const;

export function computeRunRewards(params: {
  mode: GameMode;
  tier?: CacheTier;
  isRng?: boolean;
  hitPar: boolean;
  firstTimeDaily: boolean;
  timeMs: number | null;
  overclockScore?: number;
}): { cycles: number; power: number } {
  const tierBonus =
    params.tier === 'L5'
      ? 200
      : params.tier === 'L4'
        ? 140
        : params.tier === 'L3'
          ? 90
          : params.tier === 'L2'
            ? 50
            : params.tier === 'L1'
              ? 20
              : 0;

  if (params.mode === 'overclock') {
    const score = Math.max(0, Math.floor(params.overclockScore ?? 0));
    return {
      cycles: Math.max(15, Math.floor(score / 8)),
      power: Math.floor(score / 4),
    };
  }

  if (params.mode === 'blitz') {
    const speedBonus = params.timeMs !== null && params.timeMs < 45000 ? 100 : 30;
    return {
      cycles: 140 + speedBonus,
      power: 180 + (params.timeMs !== null && params.timeMs < 45000 ? 120 : 40),
    };
  }

  if (params.isRng) {
    return {
      cycles: 45 + tierBonus + (params.hitPar ? 25 : 0),
      power: 35 + Math.floor(tierBonus / 2) + (params.hitPar ? 25 : 0),
    };
  }

  if (params.mode === 'challenge') {
    return {
      cycles: (params.firstTimeDaily ? 180 : 40) + (params.hitPar ? 80 : 0) + tierBonus,
      power: (params.firstTimeDaily ? 240 : 25) + (params.hitPar ? 110 : 0) + tierBonus,
    };
  }

  // Standard Daily
  return {
    cycles: (params.firstTimeDaily ? 100 : 25) + (params.hitPar ? 50 : 0) + tierBonus,
    power: (params.firstTimeDaily ? 120 : 15) + (params.hitPar ? 80 : 0) + tierBonus,
  };
}

export interface PlayerLevelInfo {
  level: number;
  title: string;
  currentXp: number;
  nextLevelXp: number;
  progressPct: number;
}

const RANK_TITLES = [
  'Circuit Novice',
  'Signal Runner',
  'Bus Technician',
  'Core Engineer',
  'Clock Tuner',
  'Overclock Specialist',
  'Silicon Architect',
  'Quantum Master',
] as const;

/** Computes player level, rank title, and XP progress bar from cumulative powerScore. */
export function getPlayerLevelInfo(powerScore: number): PlayerLevelInfo {
  const safeScore = Math.max(0, Math.floor(powerScore));
  let level = 1;
  let threshold = 0;
  let nextThreshold = 200;

  while (safeScore >= nextThreshold) {
    level += 1;
    threshold = nextThreshold;
    nextThreshold = threshold + 200 + (level - 1) * 120;
  }

  const span = Math.max(1, nextThreshold - threshold);
  const currentXp = safeScore - threshold;
  const progressPct = Math.min(100, Math.max(0, Math.round((currentXp / span) * 100)));
  const titleIdx = Math.min(RANK_TITLES.length - 1, Math.floor((level - 1) / 2));

  return {
    level,
    title: RANK_TITLES[titleIdx] ?? 'Quantum Master',
    currentXp,
    nextLevelXp: span,
    progressPct,
  };
}
