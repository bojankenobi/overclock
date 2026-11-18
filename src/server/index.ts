import express from 'express';
import {
  context,
  createServer,
  getServerPort,
  reddit,
  redis,
} from '@devvit/web/server';
import { telemetryRouter } from '@devvit/analytics/server/reddit';
import {
  computeRunRewards,
  DEFAULT_ECONOMY,
  HINT_PACK_COST,
  OVERCLOCK_CAP_COSTS,
  SIGNAL_THEMES,
  STREAK_SHIELD_COST,
} from '../shared/economy';
import { getDayNumber, getTodayDateISO, solveCustomLevel } from '../shared/levelGenerator';
import type {
  BlitzLeaderboardEntry,
  ChallengeLeaderboardEntry,
  CommentResultRequest,
  CommentResultResponse,
  CompleteRunRequest,
  CompleteRunResponse,
  ComponentCompleteRequest,
  ComponentCompleteResponse,
  ComponentPillarId,
  ComponentPillarScores,
  CreateDuelRequest,
  CreateDuelResponse,
  CustomPostRequest,
  CustomPostResponse,
  CustomPuzzlePayload,
  DailyCommunityStats,
  DuelListResponse,
  DuelMetrics,
  DuelRecord,
  InitResponse,
  LeaderboardEntry,
  OverallLeaderboardEntry,
  OverclockLeaderboardEntry,
  PlayerEconomy,
  StoryLeaderboardEntry,
  ResolveDuelRequest,
  ResolveDuelResponse,
  ShopActionRequest,
  ShopActionResponse,
  SignalThemeId,
  StreakData,
} from '../shared/types';

const app = express();
app.use(express.json());
app.use(telemetryRouter);

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

const INITIAL_HINTS = 3;

function getPreviousDateISO(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function streakKey(userId: string): string {
  return `gridlock:u:${userId}:streak`;
}

function hintsKey(userId: string): string {
  return `gridlock:u:${userId}:hints`;
}

function dailyStatsKey(seedDate: string): string {
  return `gridlock:d:${seedDate}:stats`;
}

function dailyLeaderboardKey(seedDate: string): string {
  return `gridlock:d:${seedDate}:lb`;
}

function dailyLeaderboardMetaKey(seedDate: string): string {
  return `gridlock:d:${seedDate}:lb_meta`;
}

function overclockLeaderboardKey(): string {
  return `gridlock:oc:lb`;
}

function overclockLeaderboardMetaKey(): string {
  return `gridlock:oc:lb_meta`;
}

async function loadUserStreak(userId: string | undefined): Promise<StreakData> {
  if (!userId) return structuredClone(DEFAULT_STREAK);
  try {
    const raw = await redis.get(streakKey(userId));
    if (!raw) return structuredClone(DEFAULT_STREAK);
    const parsed = JSON.parse(raw) as Partial<StreakData>;
    return {
      currentStreak: typeof parsed.currentStreak === 'number' ? parsed.currentStreak : 0,
      bestStreak: typeof parsed.bestStreak === 'number' ? parsed.bestStreak : 0,
      lastCompletedDate: typeof parsed.lastCompletedDate === 'string' ? parsed.lastCompletedDate : null,
      completedDates: parsed.completedDates ?? {},
      completionRecords: parsed.completionRecords ?? {},
      challengeCompletedDates: parsed.challengeCompletedDates ?? {},
      challengeRecords: parsed.challengeRecords ?? {},
      overclockStats: parsed.overclockStats ?? { bestScore: 0, bestChain: 0, totalRuns: 0 },
    };
  } catch {
    return structuredClone(DEFAULT_STREAK);
  }
}

async function loadUserHints(userId: string | undefined): Promise<number> {
  if (!userId) return INITIAL_HINTS;
  try {
    const raw = await redis.get(hintsKey(userId));
    if (raw === undefined || raw === null) return INITIAL_HINTS;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : INITIAL_HINTS;
  } catch {
    return INITIAL_HINTS;
  }
}

async function loadDailyStats(seedDate: string): Promise<DailyCommunityStats> {
  try {
    const hash = await redis.hGetAll(dailyStatsKey(seedDate));
    return {
      totalSolves: Number(hash.totalSolves ?? 0) || 0,
      parHits: Number(hash.parHits ?? 0) || 0,
    };
  } catch {
    return { totalSolves: 0, parHits: 0 };
  }
}

async function loadDailyLeaderboard(seedDate: string, limit = 10): Promise<LeaderboardEntry[]> {
  try {
    const entries = await redis.zRange(dailyLeaderboardKey(seedDate), 0, limit - 1, {
      by: 'rank',
    });
    if (!entries.length) return [];
    const metaRaw = await redis.hGetAll(dailyLeaderboardMetaKey(seedDate));
    return entries.map((item, idx) => {
      let username = item.member;
      let turns = Math.floor(item.score / 1_000_000);
      let par = turns;
      let timeMs: number | null = null;
      const metaJson = metaRaw[item.member];
      if (metaJson) {
        try {
          const parsed = JSON.parse(metaJson) as {
            username?: string;
            turns?: number;
            par?: number;
            timeMs?: number | null;
          };
          if (parsed.username) username = parsed.username;
          if (typeof parsed.turns === 'number') turns = parsed.turns;
          if (typeof parsed.par === 'number') par = parsed.par;
          if (typeof parsed.timeMs === 'number' || parsed.timeMs === null) {
            timeMs = parsed.timeMs;
          }
        } catch {
          // Ignore malformed metadata
        }
      }
      return {
        rank: idx + 1,
        username,
        turns,
        par,
        timeMs,
      };
    });
  } catch {
    return [];
  }
}

async function loadOverclockLeaderboard(limit = 10): Promise<OverclockLeaderboardEntry[]> {
  try {
    const entries = await redis.zRange(overclockLeaderboardKey(), 0, limit - 1, {
      by: 'rank',
      reverse: true,
    });
    if (!entries.length) return [];
    const metaRaw = await redis.hGetAll(overclockLeaderboardMetaKey());
    return entries.map((item, idx) => {
      let username = item.member;
      let chain = 0;
      const metaJson = metaRaw[item.member];
      if (metaJson) {
        try {
          const parsed = JSON.parse(metaJson) as { username?: string; chain?: number };
          if (parsed.username) username = parsed.username;
          if (typeof parsed.chain === 'number') chain = parsed.chain;
        } catch {
          // Ignore malformed metadata
        }
      }
      return {
        rank: idx + 1,
        username,
        score: item.score,
        chain,
      };
    });
  } catch {
    return [];
  }
}

function blitzLeaderboardKey(seedDate: string): string {
  return `gridlock:blitz:${seedDate}:lb`;
}

function blitzLeaderboardMetaKey(seedDate: string): string {
  return `gridlock:blitz:${seedDate}:lb_meta`;
}

async function loadBlitzLeaderboard(seedDate: string, limit = 10): Promise<BlitzLeaderboardEntry[]> {
  try {
    const entries = await redis.zRange(blitzLeaderboardKey(seedDate), 0, limit - 1, {
      by: 'rank',
    });
    if (!entries.length) return [];
    const metaRaw = await redis.hGetAll(blitzLeaderboardMetaKey(seedDate));
    return entries.map((item, idx) => {
      let username = item.member;
      let turns = 0;
      let timeMs = item.score;
      const metaJson = metaRaw[item.member];
      if (metaJson) {
        try {
          const parsed = JSON.parse(metaJson) as {
            username?: string;
            timeMs?: number;
            turns?: number;
          };
          if (parsed.username) username = parsed.username;
          if (typeof parsed.timeMs === 'number') timeMs = parsed.timeMs;
          if (typeof parsed.turns === 'number') turns = parsed.turns;
        } catch {
          // Ignore malformed metadata
        }
      }
      return {
        rank: idx + 1,
        username,
        timeMs,
        turns,
      };
    });
  } catch {
    return [];
  }
}

function economyKey(userId: string): string {
  return `gridlock:u:${userId}:econ`;
}

function challengeLeaderboardKey(seedDate: string): string {
  return `gridlock:c:${seedDate}:lb`;
}

function challengeLeaderboardMetaKey(seedDate: string): string {
  return `gridlock:c:${seedDate}:lb_meta`;
}

function overallLeaderboardKey(): string {
  return `gridlock:overall:lb`;
}

function overallLeaderboardMetaKey(): string {
  return `gridlock:overall:lb_meta`;
}

async function loadUserEconomy(userId: string | undefined): Promise<PlayerEconomy> {
  if (!userId) return structuredClone(DEFAULT_ECONOMY);
  try {
    const raw = await redis.get(economyKey(userId));
    if (!raw) return structuredClone(DEFAULT_ECONOMY);
    const parsed = JSON.parse(raw) as Partial<PlayerEconomy>;
    return {
      cycles: typeof parsed.cycles === 'number' ? parsed.cycles : DEFAULT_ECONOMY.cycles,
      totalEarnedCycles:
        typeof parsed.totalEarnedCycles === 'number'
          ? parsed.totalEarnedCycles
          : DEFAULT_ECONOMY.totalEarnedCycles,
      powerScore: typeof parsed.powerScore === 'number' ? parsed.powerScore : 0,
      unlockedThemes: Array.isArray(parsed.unlockedThemes) && parsed.unlockedThemes.length > 0
        ? parsed.unlockedThemes
        : ['cyan'],
      activeTheme: parsed.activeTheme ?? 'cyan',
      overclockTimeBonusLevel:
        typeof parsed.overclockTimeBonusLevel === 'number' ? parsed.overclockTimeBonusLevel : 0,
      streakShields: typeof parsed.streakShields === 'number' ? parsed.streakShields : 0,
    };
  } catch {
    return structuredClone(DEFAULT_ECONOMY);
  }
}

async function loadChallengeLeaderboard(seedDate: string, limit = 10): Promise<ChallengeLeaderboardEntry[]> {
  try {
    const entries = await redis.zRange(challengeLeaderboardKey(seedDate), 0, limit - 1, {
      by: 'rank',
    });
    if (!entries.length) return [];
    const metaRaw = await redis.hGetAll(challengeLeaderboardMetaKey(seedDate));
    return entries.map((item, idx) => {
      let username = item.member;
      let turns = Math.floor(item.score / 1_000_000);
      let movesUsed = 0;
      let timeMs: number | null = null;
      const metaJson = metaRaw[item.member];
      if (metaJson) {
        try {
          const parsed = JSON.parse(metaJson) as {
            username?: string;
            turns?: number;
            movesUsed?: number;
            timeMs?: number | null;
          };
          if (parsed.username) username = parsed.username;
          if (typeof parsed.turns === 'number') turns = parsed.turns;
          if (typeof parsed.movesUsed === 'number') movesUsed = parsed.movesUsed;
          if (typeof parsed.timeMs === 'number' || parsed.timeMs === null) timeMs = parsed.timeMs;
        } catch {
          // Ignore malformed
        }
      }
      return { rank: idx + 1, username, turns, movesUsed, timeMs };
    });
  } catch {
    return [];
  }
}

function userPillarsKey(userId: string): string {
  return `gridlock:pillars:${userId}`;
}

async function loadUserPillars(userId: string | undefined): Promise<ComponentPillarScores> {
  if (!userId) return {};
  try {
    const raw = await redis.get(userPillarsKey(userId));
    if (!raw) return {};
    return JSON.parse(raw) as ComponentPillarScores;
  } catch {
    return {};
  }
}

async function updatePillarAndOverallScore(
  userId: string,
  memberKey: string,
  username: string,
  cycles: number,
  pillar: ComponentPillarId,
  newScore: number
): Promise<{ overallScore: number; isNewBest: boolean; pillars: ComponentPillarScores }> {
  const pillars = await loadUserPillars(userId);
  const prev = pillars[pillar] ?? 0;
  const isNewBest = newScore > prev;
  if (isNewBest) {
    pillars[pillar] = newScore;
    await redis.set(userPillarsKey(userId), JSON.stringify(pillars));
  }
  const overallScore =
    (pillars.mobo ?? 0) +
    (pillars.ram ?? 0) +
    (pillars.ssd ?? 0) +
    (pillars.gpu ?? 0) +
    (pillars.cpu ?? 0);

  await redis.zAdd(overallLeaderboardKey(), {
    member: memberKey,
    score: overallScore,
  });
  await redis.hSet(overallLeaderboardMetaKey(), {
    [memberKey]: JSON.stringify({ username, cycles, pillars }),
  });
  return { overallScore, isNewBest, pillars };
}

function computeComponentScore(req: ComponentCompleteRequest): number {
  const missteps = Math.max(0, Math.round(req.missteps ?? 0));
  const timeMs = Math.max(500, Math.min(180000, Math.round(req.timeMs ?? 15000)));
  const speedBonus = Math.max(0, Math.round((45000 - Math.min(45000, timeMs)) / 180));
  const variantMult = req.variant === 'challenge' ? 1.4 : 1.0;

  if (req.module === 'gpu') {
    const modeBase = req.mode === 'gauntlet' ? 1350 : req.mode === 'overdrive' ? 1050 : 750;
    return Math.max(100, Math.round(modeBase * variantMult + speedBonus - missteps * 75));
  }

  const grid = Math.max(5, Math.min(10, Math.round(req.gridSize ?? 5)));
  const hardModes = new Set(['locked', 'loop', 'glitch', 'parity', 'countdown']);
  const modeMult = req.mode && hardModes.has(req.mode) ? 1.2 : 1.0;
  const base = grid * 130 * variantMult * modeMult;
  return Math.max(100, Math.round(base + speedBonus - missteps * 55));
}

function computeCpuPillarScore(
  mode: string,
  tier: string,
  hitPar: boolean,
  timeMs?: number,
  missteps = 0
): number {
  const tierIndex = Math.max(0, ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'].indexOf(tier));
  const modeBase =
    mode === 'challenge' ? 1150 : mode === 'overclock' ? 900 : mode === 'blitz' ? 850 : 700;
  const clampedTime = Math.max(500, Math.min(90000, timeMs ?? 20000));
  const speedBonus = Math.max(0, Math.round((45000 - Math.min(45000, clampedTime)) / 180));
  return Math.max(
    150,
    Math.round(modeBase + tierIndex * 120 + (hitPar ? 220 : 0) + speedBonus - missteps * 60)
  );
}

async function loadOverallLeaderboard(limit = 10): Promise<OverallLeaderboardEntry[]> {
  try {
    const entries = await redis.zRange(overallLeaderboardKey(), 0, limit - 1, {
      by: 'rank',
      reverse: true,
    });
    if (!entries.length) return [];
    const metaRaw = await redis.hGetAll(overallLeaderboardMetaKey());
    return entries.map((item, idx) => {
      let username = item.member;
      let cycles = 0;
      let pillars: ComponentPillarScores | undefined;
      const metaJson = metaRaw[item.member];
      if (metaJson) {
        try {
          const parsed = JSON.parse(metaJson) as {
            username?: string;
            cycles?: number;
            pillars?: ComponentPillarScores;
          };
          if (parsed.username) username = parsed.username;
          if (typeof parsed.cycles === 'number') cycles = parsed.cycles;
          if (parsed.pillars) pillars = parsed.pillars;
        } catch {
          // Ignore
        }
      }
      return {
        rank: idx + 1,
        username,
        powerScore: item.score,
        cycles,
        ...(pillars ? { pillars } : {}),
      };
    });
  } catch {
    return [];
  }
}

function storyLeaderboardKey(): string {
  return 'gridlock:story:lb';
}

function storyLeaderboardMetaKey(): string {
  return 'gridlock:story:lb_meta';
}

async function loadStoryLeaderboard(limit = 10): Promise<StoryLeaderboardEntry[]> {
  try {
    const entries = await redis.zRange(storyLeaderboardKey(), 0, limit - 1, {
      by: 'rank',
    });
    if (!entries.length) return [];
    const metaRaw = await redis.hGetAll(storyLeaderboardMetaKey());
    return entries.map((item, idx) => {
      let username = item.member;
      let sector = 1;
      let attempts = 1;
      let timeMs = 0;
      const metaJson = metaRaw[item.member];
      if (metaJson) {
        try {
          const parsed = JSON.parse(metaJson) as {
            username?: string;
            sector?: number;
            attempts?: number;
            timeMs?: number;
          };
          if (parsed.username) username = parsed.username;
          if (typeof parsed.sector === 'number') sector = parsed.sector;
          if (typeof parsed.attempts === 'number') attempts = parsed.attempts;
          if (typeof parsed.timeMs === 'number') timeMs = parsed.timeMs;
        } catch {
          // Ignore malformed
        }
      }
      return { rank: idx + 1, username, sector, attempts, timeMs };
    });
  } catch {
    return [];
  }
}

async function resolvePostSeedDate(): Promise<string> {
  const postData = context.postData as { seedDate?: unknown } | undefined;
  if (postData && typeof postData.seedDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(postData.seedDate)) {
    return postData.seedDate;
  }
  if (context.postId) {
    const cached = await redis.get(`gridlock:post:${context.postId}:seed`);
    if (cached && /^\d{4}-\d{2}-\d{2}$/.test(cached)) {
      return cached;
    }
  }
  return getTodayDateISO();
}

async function loadCustomPuzzle(postId: string | undefined): Promise<CustomPuzzlePayload | undefined> {
  if (!postId) return undefined;
  try {
    const raw = await redis.get(`gridlock:post:${postId}:custom`);
    if (!raw) return undefined;
    return JSON.parse(raw) as CustomPuzzlePayload;
  } catch {
    return undefined;
  }
}

app.get('/api/init', async (_req, res) => {
  try {
    const seedDate = await resolvePostSeedDate();
    const userId = context.userId;
    let username: string | null = null;
    if (userId) {
      try {
        username = (await reddit.getCurrentUsername()) ?? null;
      } catch {
        username = null;
      }
    }

    const customPuzzle = await loadCustomPuzzle(context.postId);
    const boardKey = customPuzzle ? `custom:${customPuzzle.id}` : seedDate;

    const [
      streakData,
      hints,
      economy,
      dailyStats,
      leaderboard,
      challengeLeaderboard,
      overclockLeaderboard,
      blitzLeaderboard,
      overallLeaderboard,
      storyLeaderboard,
    ] = await Promise.all([
      loadUserStreak(userId),
      loadUserHints(userId),
      loadUserEconomy(userId),
      loadDailyStats(boardKey),
      loadDailyLeaderboard(boardKey),
      loadChallengeLeaderboard(seedDate),
      loadOverclockLeaderboard(),
      loadBlitzLeaderboard(seedDate),
      loadOverallLeaderboard(),
      loadStoryLeaderboard(),
    ]);

    const myPillars = await loadUserPillars(userId);
    const payload: InitResponse = {
      postId: context.postId ?? '',
      subredditName: context.subredditName ?? 'gridlock',
      username,
      seedDate,
      streakData,
      hints,
      economy,
      dailyStats,
      leaderboard,
      challengeLeaderboard,
      overclockLeaderboard,
      blitzLeaderboard,
      overallLeaderboard,
      storyLeaderboard,
      myPillars,
      ...(customPuzzle ? { customPuzzle } : {}),
    };
    res.json(payload);
  } catch (err) {
    console.error('GET /api/init failed:', err);
    res.status(500).json({ error: 'Failed to initialize OVERCLOCK session' });
  }
});

app.post('/api/custom-post', async (req, res) => {
  try {
    const subredditName = context.subredditName;
    if (!subredditName) {
      res.status(400).json({ ok: false, error: 'Missing subreddit context' } satisfies CustomPostResponse);
      return;
    }
    const { title, tiles } = req.body as CustomPostRequest;
    const cleanTitle = (title ?? '').trim().slice(0, 48) || 'Custom Circuit';

    const solved = solveCustomLevel(tiles);
    if (!solved.valid) {
      res.status(400).json({ ok: false, error: 'reason' in solved ? solved.reason : 'Invalid circuit' } satisfies CustomPostResponse);
      return;
    }

    let creator = 'Redditor';
    if (context.userId) {
      try {
        creator = (await reddit.getCurrentUsername()) ?? 'Redditor';
      } catch {
        creator = 'Redditor';
      }
    }

    const seedDate = getTodayDateISO();
    const post = await reddit.submitCustomPost({
      subredditName,
      title: `OVERCLOCK COMMUNITY — ${cleanTitle} by u/${creator} (PAR ${solved.level.par})`,
      entry: 'default',
      postData: {
        seedDate,
        isCustom: true,
        title: cleanTitle,
        creator,
      },
    });

    const customPayload: CustomPuzzlePayload = {
      id: post.id,
      title: cleanTitle,
      creator,
      level: solved.level,
    };

    await Promise.all([
      redis.set(`gridlock:post:${post.id}:seed`, seedDate),
      redis.set(`gridlock:post:${post.id}:custom`, JSON.stringify(customPayload)),
    ]);

    res.json({
      ok: true,
      postId: post.id,
      postUrl: post.permalink,
    } satisfies CustomPostResponse);
  } catch (err) {
    console.error('POST /api/custom-post failed:', err);
    res.status(500).json({ ok: false, error: 'Failed to publish custom level' } satisfies CustomPostResponse);
  }
});

app.post('/api/hints', async (req, res) => {
  try {
    const userId = context.userId;
    const { delta } = req.body as { delta?: number };
    if (typeof delta !== 'number' || !Number.isFinite(delta)) {
      res.status(400).json({ error: 'Invalid delta' });
      return;
    }
    const current = await loadUserHints(userId);
    const next = Math.max(0, Math.floor(current + delta));
    if (userId) {
      await redis.set(hintsKey(userId), String(next));
    }
    res.json({ hints: next });
  } catch (err) {
    console.error('POST /api/hints failed:', err);
    res.status(500).json({ error: 'Failed to update hints' });
  }
});

app.post('/api/complete', async (req, res) => {
  try {
    const body = req.body as CompleteRunRequest;
    const {
      seedDate,
      mode,
      tier,
      isRng,
      turns,
      par,
      movesUsed,
      moveLimit,
      nodesCollected,
      timeMs,
      overclockScore,
      overclockChain,
    } = body;
    if (!seedDate || !mode) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const userId = context.userId;
    const memberKey = userId ?? `anon_${Date.now()}`;
    let username = 'Player';
    if (userId) {
      try {
        username = (await reddit.getCurrentUsername()) ?? 'Redditor';
      } catch {
        username = 'Redditor';
      }
    }

    const customPuzzle = await loadCustomPuzzle(context.postId);
    const boardKey = customPuzzle ? `custom:${customPuzzle.id}` : seedDate;

    const [prev, prevHints, economy] = await Promise.all([
      loadUserStreak(userId),
      loadUserHints(userId),
      loadUserEconomy(userId),
    ]);
    let hints = prevHints;
    let earnedHints = 0;
    let isPersonalBest = false;
    let firstTimeDaily = false;
    const hitPar = par > 0 && turns <= par;

    if (mode === 'blitz') {
      const blitzTimeMs = Math.max(100, Math.floor(timeMs ?? 0));
      if (userId && blitzTimeMs > 0) {
        const existingScore = await redis.zScore(blitzLeaderboardKey(seedDate), memberKey);
        if (existingScore === undefined || blitzTimeMs < existingScore) {
          isPersonalBest = true;
          await redis.zAdd(blitzLeaderboardKey(seedDate), {
            member: memberKey,
            score: blitzTimeMs,
          });
          await redis.hSet(blitzLeaderboardMetaKey(seedDate), {
            [memberKey]: JSON.stringify({ username, timeMs: blitzTimeMs, turns }),
          });
        }
      }
    } else if (mode === 'overclock') {
      const score = Math.max(0, Math.floor(overclockScore ?? 0));
      const chain = Math.max(0, Math.floor(overclockChain ?? 0));
      const prevOc = prev.overclockStats ?? { bestScore: 0, bestChain: 0, totalRuns: 0 };
      isPersonalBest = score > prevOc.bestScore;
      prev.overclockStats = {
        bestScore: Math.max(prevOc.bestScore, score),
        bestChain: Math.max(prevOc.bestChain, chain),
        totalRuns: prevOc.totalRuns + 1,
      };

      if (userId && score > 0) {
        const existingScore = await redis.zScore(overclockLeaderboardKey(), memberKey);
        if (existingScore === undefined || score > existingScore) {
          await redis.zAdd(overclockLeaderboardKey(), { member: memberKey, score });
          await redis.hSet(overclockLeaderboardMetaKey(), {
            [memberKey]: JSON.stringify({ username, chain }),
          });
        }
      }
    } else {
      const isChallenge = mode === 'challenge';
      const prevMap = isChallenge
        ? (prev.challengeCompletedDates ?? {})
        : prev.completedDates;
      const prevBest = prevMap[seedDate];
      const firstTimeOnBoard = prevBest === undefined;

      const recordsMap = isChallenge
        ? (prev.challengeRecords ?? {})
        : (prev.completionRecords ?? {});
      const prevRec = recordsMap[seedDate];
      const bestTurns = prevBest === undefined ? turns : Math.min(prevBest, turns);
      const bestTimeMs =
        timeMs === null
          ? (prevRec?.bestTimeMs ?? null)
          : prevRec?.bestTimeMs !== null && prevRec?.bestTimeMs !== undefined
            ? Math.min(prevRec.bestTimeMs, timeMs)
            : timeMs;

      if (prevBest !== undefined && turns < prevBest) {
        isPersonalBest = true;
      }

      const hitParNow = turns <= par;
      const hadParBefore = prevBest !== undefined && prevBest <= par;
      if (firstTimeOnBoard) earnedHints += 1;
      if (hitParNow && !hadParBefore) earnedHints += 1;
      hints += earnedHints;

      let nextStreak = prev.currentStreak;
      let nextLastDate = prev.lastCompletedDate;
      if (!isRng) {
        firstTimeDaily = firstTimeOnBoard;
      }

      if (!isRng && prev.lastCompletedDate !== seedDate) {
        const yesterday = getPreviousDateISO(seedDate);
        if (prev.lastCompletedDate === yesterday) {
          nextStreak = prev.currentStreak + 1;
        } else if (prev.currentStreak > 0 && economy.streakShields > 0 && prev.lastCompletedDate && seedDate > prev.lastCompletedDate) {
          economy.streakShields -= 1;
          nextStreak = prev.currentStreak + 1;
        } else if (!prev.lastCompletedDate || seedDate > prev.lastCompletedDate) {
          nextStreak = 1;
        }
        nextLastDate = seedDate;
      }

      prev.currentStreak = nextStreak;
      prev.bestStreak = Math.max(prev.bestStreak, nextStreak);
      prev.lastCompletedDate = nextLastDate;

      const updatedRecord = {
        dayNumber: getDayNumber(seedDate),
        bestTurns,
        par,
        nodesCollected,
        bestTimeMs,
        completedAt: new Date().toISOString(),
        ...(isChallenge
          ? {
              bestMoves:
                prevRec?.bestMoves !== undefined
                  ? Math.min(prevRec.bestMoves, movesUsed)
                  : movesUsed,
              moveLimit,
            }
          : {}),
      };

      if (isChallenge) {
        prev.challengeCompletedDates = { ...prevMap, [seedDate]: bestTurns };
        prev.challengeRecords = { ...recordsMap, [seedDate]: updatedRecord };
      } else {
        prev.completedDates = { ...prevMap, [seedDate]: bestTurns };
        prev.completionRecords = { ...recordsMap, [seedDate]: updatedRecord };
      }

      if (firstTimeOnBoard && !isChallenge) {
        await redis.hIncrBy(dailyStatsKey(boardKey), 'totalSolves', 1);
      }
      if (hitParNow && !hadParBefore && !isChallenge) {
        await redis.hIncrBy(dailyStatsKey(boardKey), 'parHits', 1);
      }

      if (!isRng && userId && isChallenge) {
        const compositeScore = turns * 1_000_000 + movesUsed * 10_000 + Math.min(9_999, Math.floor((timeMs ?? 999_999) / 100));
        const existingScore = await redis.zScore(challengeLeaderboardKey(seedDate), memberKey);
        if (existingScore === undefined || compositeScore < existingScore) {
          await redis.zAdd(challengeLeaderboardKey(seedDate), {
            member: memberKey,
            score: compositeScore,
          });
          await redis.hSet(challengeLeaderboardMetaKey(seedDate), {
            [memberKey]: JSON.stringify({ username, turns, movesUsed, timeMs }),
          });
        }
      }

      if (!isRng && userId && !isChallenge) {
        const compositeScore = turns * 1_000_000 + Math.min(999_999, timeMs ?? 999_999);
        const existingScore = await redis.zScore(dailyLeaderboardKey(boardKey), memberKey);
        if (existingScore === undefined || compositeScore < existingScore) {
          await redis.zAdd(dailyLeaderboardKey(boardKey), {
            member: memberKey,
            score: compositeScore,
          });
          await redis.hSet(dailyLeaderboardMetaKey(boardKey), {
            [memberKey]: JSON.stringify({ username, turns, par, timeMs }),
          });
        }
      }
    }

    const { cycles: earnedCycles, power: earnedPower } = computeRunRewards({
      mode,
      tier,
      isRng,
      hitPar,
      firstTimeDaily,
      timeMs,
      overclockScore,
    });
    economy.cycles += earnedCycles;
    economy.totalEarnedCycles += earnedCycles;
    economy.powerScore += earnedPower;

    let latestPillars: ComponentPillarScores | undefined;
    if (userId) {
      const cpuPillarScore = computeCpuPillarScore(mode, tier, hitPar, timeMs, 0);
      const { overallScore, pillars: updatedPillars } = await updatePillarAndOverallScore(
        userId,
        memberKey,
        username,
        economy.cycles,
        'cpu',
        cpuPillarScore
      );
      latestPillars = updatedPillars;

      const overallList = await loadOverallLeaderboard(1);
      const isOverallLeader = overallList.length > 0 && overallList[0].username === username;

      await Promise.all([
        redis.set(streakKey(userId), JSON.stringify(prev)),
        redis.set(hintsKey(userId), String(hints)),
        redis.set(economyKey(userId), JSON.stringify(economy)),
      ]);

      if (context.subredditName && username !== 'Player' && username !== 'Redditor') {
        try {
          await reddit.setUserFlair({
            subredditName: context.subredditName,
            username,
            text: isOverallLeader
              ? `👑 #1 ARCHITECT | ${overallScore} PTS`
              : `🔥 ${Math.max(1, prev.currentStreak)}d Streak | ${overallScore} PTS`,
            backgroundColor: '#0F141F',
            textColor: 'light',
          });
        } catch {
          // Non-fatal if subreddit flair is disabled
        }
      }
    }

    const storySector = typeof req.body?.storySector === 'number' ? req.body.storySector : undefined;
    const storyAttempts = typeof req.body?.storyAttempts === 'number' ? Math.max(1, req.body.storyAttempts) : 1;
    const storyTimeMs = typeof req.body?.storyTimeMs === 'number' ? Math.max(100, req.body.storyTimeMs) : 999_999;

    if (userId && storySector !== undefined && storySector >= 1 && storySector <= 6) {
      const storyScore =
        (6 - storySector) * 100_000_000 +
        Math.min(99, storyAttempts) * 1_000_000 +
        Math.min(999_999, Math.floor(storyTimeMs / 100));
      const existingStory = await redis.zScore(storyLeaderboardKey(), memberKey);
      if (existingStory === undefined || existingStory === null || storyScore < existingStory) {
        await Promise.all([
          redis.zAdd(storyLeaderboardKey(), { member: memberKey, score: storyScore }),
          redis.hSet(storyLeaderboardMetaKey(), {
            [memberKey]: JSON.stringify({
              username,
              sector: storySector,
              attempts: storyAttempts,
              timeMs: storyTimeMs,
            }),
          }),
        ]);
      }
    }

    const [
      dailyStats,
      leaderboard,
      challengeLeaderboard,
      overclockLeaderboard,
      blitzLeaderboard,
      overallLeaderboard,
      storyLeaderboard,
    ] = await Promise.all([
      loadDailyStats(boardKey),
      loadDailyLeaderboard(boardKey),
      loadChallengeLeaderboard(seedDate),
      loadOverclockLeaderboard(),
      loadBlitzLeaderboard(seedDate),
      loadOverallLeaderboard(),
      loadStoryLeaderboard(),
    ]);

    let rank: number | undefined;
    let totalPlayers: number | undefined;
    if (userId && mode === 'standard' && !isRng) {
      const r = await redis.zRank(dailyLeaderboardKey(boardKey), memberKey);
      const card = await redis.zCard(dailyLeaderboardKey(boardKey));
      if (r !== undefined) rank = r + 1;
      totalPlayers = card;
    } else if (userId && mode === 'challenge' && !isRng) {
      const r = await redis.zRank(challengeLeaderboardKey(seedDate), memberKey);
      const card = await redis.zCard(challengeLeaderboardKey(seedDate));
      if (r !== undefined) rank = r + 1;
      totalPlayers = card;
    } else if (userId && mode === 'blitz') {
      const r = await redis.zRank(blitzLeaderboardKey(seedDate), memberKey);
      const card = await redis.zCard(blitzLeaderboardKey(seedDate));
      if (r !== undefined) rank = r + 1;
      totalPlayers = card;
    }

    const response: CompleteRunResponse = {
      streakData: prev,
      hints,
      earnedHints,
      earnedCycles,
      earnedPower,
      economy,
      isPersonalBest,
      dailyStats,
      rank,
      totalPlayers,
      leaderboard,
      challengeLeaderboard,
      overclockLeaderboard,
      blitzLeaderboard,
      overallLeaderboard,
      storyLeaderboard,
      ...(latestPillars ? { myPillars: latestPillars } : {}),
    };
    res.json(response);
  } catch (err) {
    console.error('POST /api/complete failed:', err);
    res.status(500).json({ error: 'Failed to save completion' });
  }
});

app.post('/api/component-complete', async (req, res) => {
  try {
    const body = req.body as ComponentCompleteRequest;
    if (!body || !['mobo', 'ram', 'ssd', 'gpu'].includes(body.module)) {
      res.status(400).json({ error: 'Invalid component module' });
      return;
    }
    const userId = context.userId;
    let username = 'Player';
    if (userId) {
      try {
        username = (await reddit.getCurrentUsername()) ?? 'Redditor';
      } catch {
        username = 'Redditor';
      }
    }

    const score = computeComponentScore(body);
    const cycReward = body.variant === 'challenge' ? 65 : 35;
    const pwrReward = body.variant === 'challenge' ? 45 : 25;

    let economy = { ...DEFAULT_ECONOMY };
    let pillars: ComponentPillarScores = { [body.module]: score };
    let isNewBest = true;
    let overallScore = score;

    if (userId) {
      const econRaw = await redis.get(economyKey(userId));
      if (econRaw) {
        try {
          economy = { ...DEFAULT_ECONOMY, ...(JSON.parse(econRaw) as typeof DEFAULT_ECONOMY) };
        } catch {
          // ignore
        }
      }
      economy.cycles += cycReward;
      economy.totalEarnedCycles += cycReward;
      economy.powerScore += pwrReward;

      const updated = await updatePillarAndOverallScore(
        userId,
        userId,
        username,
        economy.cycles,
        body.module,
        score
      );
      overallScore = updated.overallScore;
      isNewBest = updated.isNewBest;
      pillars = updated.pillars;

      await redis.set(economyKey(userId), JSON.stringify(economy));
    }

    const overallLeaderboard = await loadOverallLeaderboard();
    const payload: ComponentCompleteResponse = {
      ok: true,
      score,
      isNewBest,
      overallScore,
      pillars,
      economy,
      overallLeaderboard,
    };
    res.json(payload);
  } catch (err) {
    console.error('POST /api/component-complete failed:', err);
    res.status(500).json({ error: 'Failed to record component completion' });
  }
});

app.post('/api/shop/action', async (req, res) => {
  try {
    const userId = context.userId;
    if (!userId) {
      res.status(401).json({ ok: false, economy: DEFAULT_ECONOMY, hints: INITIAL_HINTS, error: 'Sign in to Reddit to use the Armory' } satisfies ShopActionResponse);
      return;
    }

    const { action, itemId } = req.body as ShopActionRequest;
    const [economy, currentHints] = await Promise.all([
      loadUserEconomy(userId),
      loadUserHints(userId),
    ]);
    let hints = currentHints;

    if (action === 'equip') {
      const themeId = itemId as SignalThemeId;
      if (!economy.unlockedThemes.includes(themeId)) {
        res.status(400).json({ ok: false, economy, hints, error: 'Theme not unlocked' } satisfies ShopActionResponse);
        return;
      }
      economy.activeTheme = themeId;
      await redis.set(economyKey(userId), JSON.stringify(economy));
      res.json({ ok: true, economy, hints } satisfies ShopActionResponse);
      return;
    }

    if (action === 'buy') {
      if (itemId === 'hint_1') {
        if (economy.cycles < HINT_PACK_COST) {
          res.status(400).json({ ok: false, economy, hints, error: 'Not enough Cycles' } satisfies ShopActionResponse);
          return;
        }
        economy.cycles -= HINT_PACK_COST;
        hints += 1;
      } else if (itemId === 'streak_shield') {
        if (economy.cycles < STREAK_SHIELD_COST) {
          res.status(400).json({ ok: false, economy, hints, error: 'Not enough Cycles' } satisfies ShopActionResponse);
          return;
        }
        economy.cycles -= STREAK_SHIELD_COST;
        economy.streakShields += 1;
      } else if (itemId === 'overclock_cap') {
        if (economy.overclockTimeBonusLevel >= OVERCLOCK_CAP_COSTS.length) {
          res.status(400).json({ ok: false, economy, hints, error: 'Capacitor already maxed' } satisfies ShopActionResponse);
          return;
        }
        const cost = OVERCLOCK_CAP_COSTS[economy.overclockTimeBonusLevel];
        if (economy.cycles < cost) {
          res.status(400).json({ ok: false, economy, hints, error: 'Not enough Cycles' } satisfies ShopActionResponse);
          return;
        }
        economy.cycles -= cost;
        economy.overclockTimeBonusLevel += 1;
      } else if (typeof itemId === 'string' && itemId.startsWith('theme_')) {
        const themeId = itemId.replace('theme_', '') as SignalThemeId;
        const spec = SIGNAL_THEMES[themeId];
        if (!spec) {
          res.status(400).json({ ok: false, economy, hints, error: 'Unknown theme' } satisfies ShopActionResponse);
          return;
        }
        if (economy.unlockedThemes.includes(themeId)) {
          economy.activeTheme = themeId;
        } else {
          if (economy.cycles < spec.cost) {
            res.status(400).json({ ok: false, economy, hints, error: 'Not enough Cycles' } satisfies ShopActionResponse);
            return;
          }
          economy.cycles -= spec.cost;
          economy.unlockedThemes.push(themeId);
          economy.activeTheme = themeId;
        }
      } else {
        res.status(400).json({ ok: false, economy, hints, error: 'Unknown item' } satisfies ShopActionResponse);
        return;
      }

      await Promise.all([
        redis.set(economyKey(userId), JSON.stringify(economy)),
        redis.set(hintsKey(userId), String(hints)),
      ]);
      res.json({ ok: true, economy, hints } satisfies ShopActionResponse);
      return;
    }

    res.status(400).json({ ok: false, economy, hints, error: 'Invalid shop action' } satisfies ShopActionResponse);
  } catch (err) {
    console.error('POST /api/shop/action failed:', err);
    res.status(500).json({ ok: false, economy: DEFAULT_ECONOMY, hints: INITIAL_HINTS, error: 'Shop error' } satisfies ShopActionResponse);
  }
});

const DUELS_LIST_KEY = 'gridlock:duels:list';
const DUEL_TTL_MS = 24 * 60 * 60 * 1000;

async function loadDuelsList(): Promise<DuelRecord[]> {
  try {
    const raw = await redis.get(DUELS_LIST_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as DuelRecord[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function saveDuelsList(list: DuelRecord[]): Promise<void> {
  // Keep latest 40 duels
  await redis.set(DUELS_LIST_KEY, JSON.stringify(list.slice(0, 40)));
}

function didChallengerWin(
  mode: DuelRecord['mode'],
  creator: DuelMetrics,
  challenger: DuelMetrics
): boolean {
  if (mode === 'overclock') {
    return challenger.score > creator.score;
  }
  if (mode === 'blitz') {
    if (challenger.timeMs !== creator.timeMs) {
      return challenger.timeMs < creator.timeMs;
    }
    return challenger.turns < creator.turns;
  }
  // standard & challenge: fewer turns wins, then faster time
  if (challenger.turns !== creator.turns) {
    return challenger.turns < creator.turns;
  }
  return challenger.timeMs < creator.timeMs;
}

app.get('/api/duels', async (_req, res) => {
  try {
    const userId = context.userId;
    const [duels, economy] = await Promise.all([loadDuelsList(), loadUserEconomy(userId)]);
    const now = Date.now();
    let changed = false;

    for (const duel of duels) {
      if (duel.status === 'open' && now > duel.expiresAt) {
        duel.status = 'expired';
        changed = true;
        // Refund Escrow CYC to creator
        const creatorEcon = await loadUserEconomy(duel.creatorId);
        creatorEcon.cycles += duel.wagerCycles;
        await redis.set(economyKey(duel.creatorId), JSON.stringify(creatorEcon));
      }
    }

    if (changed) {
      await saveDuelsList(duels);
    }

    const refreshedEconomy = changed && userId ? await loadUserEconomy(userId) : economy;
    res.json({ duels, economy: refreshedEconomy } satisfies DuelListResponse);
  } catch (err) {
    console.error('GET /api/duels failed:', err);
    res.status(500).json({ duels: [], economy: DEFAULT_ECONOMY } satisfies DuelListResponse);
  }
});

app.post('/api/duels/create', async (req, res) => {
  try {
    const userId = context.userId;
    if (!userId) {
      res.status(401).json({ ok: false, economy: DEFAULT_ECONOMY, error: 'Sign in to Reddit to create a duel' } satisfies CreateDuelResponse);
      return;
    }

    const body = req.body as CreateDuelRequest;
    const wagerCycles = Math.max(25, Math.min(1000, Math.floor(body.wagerCycles ?? 50)));
    const wagerPower = Math.max(25, Math.min(500, Math.floor(body.wagerPower ?? 50)));

    const economy = await loadUserEconomy(userId);
    if (economy.cycles < wagerCycles) {
      res.status(400).json({ ok: false, economy, error: 'Not enough Cycles for wager' } satisfies CreateDuelResponse);
      return;
    }

    let username = 'Redditor';
    try {
      username = (await reddit.getCurrentUsername()) ?? 'Redditor';
    } catch {
      username = 'Redditor';
    }

    // Escrow CYC
    economy.cycles -= wagerCycles;
    await redis.set(economyKey(userId), JSON.stringify(economy));

    const now = Date.now();
    const duel: DuelRecord = {
      id: `duel_${now}_${Math.floor(Math.random() * 10000)}`,
      type: body.type === 'bounty' ? 'bounty' : 'duel',
      mode: body.mode,
      tier: body.tier,
      seedDate: body.seedDate,
      rngSalt: body.rngSalt,
      creatorId: userId,
      creatorUsername: username,
      ...(body.targetUsername ? { targetUsername: body.targetUsername } : {}),
      wagerCycles,
      wagerPower,
      creatorMetrics: body.metrics,
      status: 'open',
      createdAt: now,
      expiresAt: now + DUEL_TTL_MS,
    };

    const duels = await loadDuelsList();
    duels.unshift(duel);
    await saveDuelsList(duels);

    res.json({ ok: true, duel, economy } satisfies CreateDuelResponse);
  } catch (err) {
    console.error('POST /api/duels/create failed:', err);
    res.status(500).json({ ok: false, economy: DEFAULT_ECONOMY, error: 'Failed to create duel' } satisfies CreateDuelResponse);
  }
});

app.post('/api/duels/cancel', async (req, res) => {
  try {
    const userId = context.userId;
    if (!userId) {
      res.status(401).json({ ok: false, economy: DEFAULT_ECONOMY, error: 'Unauthorized' });
      return;
    }
    const { duelId } = req.body as { duelId?: string };
    const duels = await loadDuelsList();
    const duel = duels.find((d) => d.id === duelId);
    const economy = await loadUserEconomy(userId);

    if (!duel || duel.status !== 'open' || duel.creatorId !== userId) {
      res.status(400).json({ ok: false, economy, error: 'Cannot cancel this duel' });
      return;
    }

    duel.status = 'cancelled';
    economy.cycles += duel.wagerCycles;
    await Promise.all([
      saveDuelsList(duels),
      redis.set(economyKey(userId), JSON.stringify(economy)),
    ]);

    res.json({ ok: true, economy });
  } catch (err) {
    console.error('POST /api/duels/cancel failed:', err);
    res.status(500).json({ ok: false, economy: DEFAULT_ECONOMY, error: 'Failed to cancel duel' });
  }
});

app.post('/api/duels/resolve', async (req, res) => {
  try {
    const userId = context.userId;
    if (!userId) {
      res.status(401).json({ ok: false, economy: DEFAULT_ECONOMY, overallLeaderboard: [], error: 'Sign in to Reddit to compete in duels' } satisfies ResolveDuelResponse);
      return;
    }

    const { duelId, metrics } = req.body as ResolveDuelRequest;
    const duels = await loadDuelsList();
    const duel = duels.find((d) => d.id === duelId);
    const challengerEcon = await loadUserEconomy(userId);

    if (!duel || duel.status !== 'open') {
      res.status(400).json({ ok: false, economy: challengerEcon, overallLeaderboard: [], error: 'Duel is no longer open' } satisfies ResolveDuelResponse);
      return;
    }
    if (duel.creatorId === userId) {
      res.status(400).json({ ok: false, economy: challengerEcon, overallLeaderboard: [], error: 'Cannot accept your own duel' } satisfies ResolveDuelResponse);
      return;
    }
    if (challengerEcon.cycles < duel.wagerCycles) {
      res.status(400).json({ ok: false, economy: challengerEcon, overallLeaderboard: [], error: 'Not enough Cycles to match wager' } satisfies ResolveDuelResponse);
      return;
    }

    let challengerName = 'Redditor';
    try {
      challengerName = (await reddit.getCurrentUsername()) ?? 'Redditor';
    } catch {
      challengerName = 'Redditor';
    }

    const challengerWon = didChallengerWin(duel.mode, duel.creatorMetrics, metrics);
    const creatorEcon = await loadUserEconomy(duel.creatorId);

    // Hybrid Escrow + PWR Transfer
    const potCycles = duel.wagerCycles * 2;
    if (challengerWon) {
      challengerEcon.cycles += duel.wagerCycles; // nets +wagerCycles
      challengerEcon.totalEarnedCycles += potCycles;
      challengerEcon.powerScore += duel.wagerPower;
      creatorEcon.powerScore = Math.max(0, creatorEcon.powerScore - duel.wagerPower);
    } else {
      challengerEcon.cycles -= duel.wagerCycles;
      challengerEcon.powerScore = Math.max(0, challengerEcon.powerScore - duel.wagerPower);
      creatorEcon.cycles += potCycles; // gets escrow + challenger's wager
      creatorEcon.totalEarnedCycles += potCycles;
      creatorEcon.powerScore += duel.wagerPower;
    }

    duel.status = 'completed';
    duel.challengerUsername = challengerName;
    duel.challengerMetrics = metrics;
    duel.winnerUsername = challengerWon ? challengerName : duel.creatorUsername;

    await Promise.all([
      saveDuelsList(duels),
      redis.set(economyKey(userId), JSON.stringify(challengerEcon)),
      redis.set(economyKey(duel.creatorId), JSON.stringify(creatorEcon)),
      redis.zAdd(overallLeaderboardKey(), { member: userId, score: challengerEcon.powerScore }),
      redis.zAdd(overallLeaderboardKey(), { member: duel.creatorId, score: creatorEcon.powerScore }),
      redis.hSet(overallLeaderboardMetaKey(), {
        [userId]: JSON.stringify({ username: challengerName, cycles: challengerEcon.cycles }),
        [duel.creatorId]: JSON.stringify({ username: duel.creatorUsername, cycles: creatorEcon.cycles }),
      }),
    ]);

    const overallLeaderboard = await loadOverallLeaderboard();
    res.json({
      ok: true,
      won: challengerWon,
      duel,
      economy: challengerEcon,
      overallLeaderboard,
    } satisfies ResolveDuelResponse);
  } catch (err) {
    console.error('POST /api/duels/resolve failed:', err);
    res.status(500).json({ ok: false, economy: DEFAULT_ECONOMY, overallLeaderboard: [], error: 'Failed to resolve duel' } satisfies ResolveDuelResponse);
  }
});

app.post('/api/comment-result', async (req, res) => {
  try {
    const { text } = req.body as CommentResultRequest;
    if (!text || typeof text !== 'string' || text.trim().length === 0 || text.length > 500) {
      res.status(400).json({ ok: false, error: 'Invalid comment text' } satisfies CommentResultResponse);
      return;
    }
    if (!context.postId) {
      res.status(400).json({ ok: false, error: 'Missing postId in context' } satisfies CommentResultResponse);
      return;
    }
    if (!context.userId) {
      res.status(401).json({ ok: false, error: 'Sign in to Reddit to post your result' } satisfies CommentResultResponse);
      return;
    }

    const comment = await reddit.submitComment({
      id: context.postId,
      text: text.trim(),
      runAs: 'USER',
    });

    res.json({ ok: true, commentId: comment.id } satisfies CommentResultResponse);
  } catch (err) {
    console.error('POST /api/comment-result failed:', err);
    res.status(500).json({
      ok: false,
      error: 'Could not post comment right now.',
    } satisfies CommentResultResponse);
  }
});

async function createDailyPost() {
  const seedDate = getTodayDateISO();
  const dayNumber = getDayNumber(seedDate);
  const subredditName = context.subredditName;
  if (!subredditName) {
    throw new Error('Missing subredditName in context');
  }

  const post = await reddit.submitCustomPost({
    subredditName,
    title: 'OVERCLOCK — Daily 2.5D Circuit Puzzle',
    entry: 'default',
    postData: {
      seedDate,
      dayNumber,
    },
  });

  await redis.set(`gridlock:post:${post.id}:seed`, seedDate);
  return post;
}

app.post('/internal/menu/post-create', async (_req, res) => {
  try {
    const post = await createDailyPost();
    res.json({
      navigateTo: post,
    });
  } catch (err) {
    console.error('Menu post-create failed:', err);
    res.status(500).json({
      showToast: 'Failed to create OVERCLOCK post',
    });
  }
});

app.post('/internal/on-app-install', async (_req, res) => {
  try {
    await createDailyPost();
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('onAppInstall failed:', err);
    res.json({ status: 'error' });
  }
});

app.post('/internal/scheduler/daily-post', async (_req, res) => {
  try {
    const today = getTodayDateISO();
    const lockKey = `gridlock:daily_posted:${today}`;
    const alreadyPosted = await redis.get(lockKey);
    if (!alreadyPosted) {
      await createDailyPost();
      await redis.set(lockKey, '1');
    }
    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Scheduler daily-post failed:', err);
    res.status(500).json({ status: 'error' });
  }
});

const server = createServer(app);
server.listen(getServerPort());
