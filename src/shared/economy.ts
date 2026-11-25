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
  arctic: {
    id: 'arctic',
    name: 'Arctic Ice',
    cost: 2000,
    primary: '#7DD3FC',
    secondary: '#E0F2FE',
    glow: 'rgba(125, 211, 252, 0.55)',
  },
  amber: {
    id: 'amber',
    name: 'Neon Amber',
    cost: 2600,
    primary: '#FB923C',
    secondary: '#FDBA74',
    glow: 'rgba(251, 146, 60, 0.55)',
  },
  plasma: {
    id: 'plasma',
    name: 'Hyper Plasma',
    cost: 3500,
    primary: '#F472B6',
    secondary: '#E879F9',
    glow: 'rgba(244, 114, 182, 0.55)',
  },
};

export const HINT_PACK_COST = 150;
export const STREAK_SHIELD_COST = 450;
export const OVERCLOCK_CAP_COSTS = [450, 950, 1600, 2400, 3500] as const;

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
      ? 100
      : params.tier === 'L4'
        ? 70
        : params.tier === 'L3'
          ? 45
          : params.tier === 'L2'
            ? 25
            : params.tier === 'L1'
              ? 10
              : 0;

  if (params.mode === 'overclock') {
    const score = Math.max(0, Math.floor(params.overclockScore ?? 0));
    return {
      cycles: Math.min(140, Math.max(10, Math.floor(score / 14))),
      power: Math.min(180, Math.floor(score / 7)),
    };
  }

  if (params.mode === 'blitz') {
    const speedBonus = params.timeMs !== null && params.timeMs < 45000 ? 55 : 15;
    return {
      cycles: 75 + speedBonus,
      power: 95 + (params.timeMs !== null && params.timeMs < 45000 ? 65 : 20),
    };
  }

  if (params.isRng) {
    return {
      cycles: 25 + tierBonus + (params.hitPar ? 15 : 0),
      power: 20 + Math.floor(tierBonus / 2) + (params.hitPar ? 15 : 0),
    };
  }

  if (params.mode === 'challenge') {
    return {
      cycles: (params.firstTimeDaily ? 100 : 20) + (params.hitPar ? 45 : 0) + tierBonus,
      power: (params.firstTimeDaily ? 130 : 15) + (params.hitPar ? 60 : 0) + tierBonus,
    };
  }

  // Standard Daily
  return {
    cycles: (params.firstTimeDaily ? 60 : 15) + (params.hitPar ? 30 : 0) + tierBonus,
    power: (params.firstTimeDaily ? 75 : 10) + (params.hitPar ? 45 : 0) + tierBonus,
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
