export const GRID_SIZE = 7;

export type Direction = 'N' | 'S' | 'E' | 'W';

export type TileType = 'floor' | 'void' | 'platform' | 'ramp' | 'bridge';

export type ElevationLevel = 0 | 1;

export type TileFeature = 'start' | 'exit' | 'node' | null;

export interface TileData {
  x: number;
  y: number;
  type: TileType;
  /** For 'ramp': direction pointing from low (Level 0) toward high (Level 1) */
  rampDir?: Direction;
  /** For 'bridge': 'x' means Level 1 deck runs E-W & Level 0 underpass runs N-S; 'y' is opposite */
  bridgeAxis?: 'x' | 'y';
  feature: TileFeature;
  /** 0-based index for 'node' tiles */
  nodeIndex?: number;
}

export interface GridCoord {
  x: number;
  y: number;
  level: ElevationLevel;
}

export interface PathStep extends GridCoord {
  dirFromPrev: Direction | null;
  /** True when entering this step caused a 90-degree turn at the previous vertex */
  causedTurnAtPrev: boolean;
}

export interface ValidMove {
  x: number;
  y: number;
  level: ElevationLevel;
  dir: Direction;
}

export interface RippleEffect {
  x: number;
  y: number;
  level: ElevationLevel;
  startTime: number;
  color: string;
}

export type GameMode = 'standard' | 'challenge' | 'overclock' | 'blitz';

export type CacheTier = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

export type StoryDifficulty = 'EASY' | 'NORMAL' | 'HARD';

export interface KernelSectorSpec {
  sector: number;
  name: string;
  codeName: string;
  difficulty: StoryDifficulty;
  gridSize: number;
  tier: CacheTier;
  mode: 'standard' | 'challenge';
  objective: string;
  incident: string;
  directive: string;
  debrief: string;
}

export const KERNEL_SECTORS: KernelSectorSpec[] = [
  {
    sector: 1,
    name: 'Boot Sector',
    codeName: 'SECTOR 01 // BOOT_SECTOR',
    difficulty: 'EASY',
    gridSize: 5,
    tier: 'L1',
    mode: 'standard',
    objective: 'Route 2 spikes to jump-start the Boot Bus',
    incident: 'CRITICAL FAULT: A solar CME wiped the primary 5×5 boot register. Core AI is dark.',
    directive: 'Route the photon beam through all energy spikes and close the circuit at the Exit port.',
    debrief: 'BOOT_BUS ONLINE. Auxiliary clock restored — routing power to the Bus Controller.',
  },
  {
    sector: 2,
    name: 'Bus Controller',
    codeName: 'SECTOR 02 // BUS_CONTROLLER',
    difficulty: 'EASY',
    gridSize: 6,
    tier: 'L2',
    mode: 'standard',
    objective: 'Bridge clock lines across dual elevation',
    incident: 'SIGNAL COLLISION: Clock traces on the 6×6 memory bus are shorting across elevation.',
    directive: 'Climb the ramps and cross the dual-level bridge to charge every spike without crossing your beam.',
    debrief: 'BUS SYNCHRONIZED. Entering NORMAL complexity sectors.',
  },
  {
    sector: 3,
    name: 'Cache Matrix',
    codeName: 'SECTOR 03 // CACHE_MATRIX',
    difficulty: 'NORMAL',
    gridSize: 7,
    tier: 'L3',
    mode: 'standard',
    objective: 'Synchronize L3 cache around dead sectors',
    incident: 'WARNING: 7×7 L3 Cache Matrix is fragmented. Burned void sectors block direct lines.',
    directive: 'Navigate around the void cutouts, charge all 4 cache spikes, and lock the loop.',
    debrief: 'CACHE MATRIX STABILIZED. Escalating to 8×8 Hypervisor Die.',
  },
  {
    sector: 4,
    name: 'Hypervisor Die',
    codeName: 'SECTOR 04 // HYPERVISOR_DIE',
    difficulty: 'NORMAL',
    gridSize: 8,
    tier: 'L4',
    mode: 'standard',
    objective: 'Stabilize high-capacity 8×8 multi-bridge array',
    incident: 'MEMORY DRIFT: 8×8 Hypervisor array requires balanced multi-bridge routing.',
    directive: 'Charge all 5 energy spikes across the 8×8 silicon array and seal the exit bus.',
    debrief: 'HYPERVISOR CONTAINED. Warning: entering HARD MODE sectors with strict move limits!',
  },
  {
    sector: 5,
    name: 'Neural Core',
    codeName: 'SECTOR 05 // NEURAL_CORE [HARD]',
    difficulty: 'HARD',
    gridSize: 9,
    tier: 'L4',
    mode: 'challenge',
    objective: 'HARD MODE: Link 6 synaptic spikes under pressure',
    incident: 'CORE BREACH: 9×9 synaptic bus is destabilizing. Power capacitor limits total moves.',
    directive: 'Bridge all 6 neural spikes inside the strict move budget to restore AI consciousness.',
    debrief: 'NEURAL CORE LINKED. Final barrier ahead: the 10×10 Quantum Die is overloading.',
  },
  {
    sector: 6,
    name: 'Quantum Core',
    codeName: 'SECTOR 06 // QUANTUM_CORE [FINAL HARD]',
    difficulty: 'HARD',
    gridSize: 10,
    tier: 'L5',
    mode: 'challenge',
    objective: 'FINAL PROTOCOL: Power the 10×10 Quantum Die',
    incident: 'MELTDOWN IMMINENT: The 10×10 Quantum Core is one cycle away from total gridlock.',
    directive: 'Execute the master route through all spikes under hard move limits. Restore the system, Architect.',
    debrief: 'SYSTEM RESTORED // QUANTUM CORE ONLINE. All 6 silicon sectors operating at 100% capacity.',
  },
];

export type SignalThemeId =
  | 'cyan'
  | 'gold'
  | 'crimson'
  | 'violet'
  | 'emerald'
  | 'arctic'
  | 'amber'
  | 'plasma';

export interface PlayerEconomy {
  cycles: number;
  totalEarnedCycles: number;
  powerScore: number;
  unlockedThemes: SignalThemeId[];
  activeTheme: SignalThemeId;
  overclockTimeBonusLevel: number; // 0..3 (+2s per level in Overclock)
  streakShields: number;
}

export interface OverclockStats {
  bestScore: number;
  bestChain: number;
  totalRuns: number;
}

export interface PuzzleLevel {
  seedDate: string;
  dayNumber: number;
  mode: GameMode;
  tier?: CacheTier;
  size: number;
  tiles: TileData[][];
  start: GridCoord;
  exit: GridCoord;
  nodes: Array<GridCoord & { index: number }>;
  par: number;
  /** Hard-mode tile step limit (present when mode === 'challenge') */
  moveLimit?: number;
  /** Precomputed optimal path for solver verification only */
  optimalPath: GridCoord[];
}

export interface DailyCompletionRecord {
  dayNumber: number;
  bestTurns: number;
  par: number;
  nodesCollected: number;
  bestTimeMs: number | null;
  completedAt: string;
  bestMoves?: number;
  moveLimit?: number;
  missteps?: number;
}

export interface StreakData {
  currentStreak: number;
  bestStreak: number;
  lastCompletedDate: string | null;
  /** Map of YYYY-MM-DD -> best turns achieved (Standard mode) */
  completedDates: Record<string, number>;
  /** Per-date completion telemetry (Standard mode) */
  completionRecords?: Record<string, DailyCompletionRecord>;
  /** Map of YYYY-MM-DD -> best turns achieved (Daily Challenge mode) */
  challengeCompletedDates?: Record<string, number>;
  /** Per-date completion telemetry (Daily Challenge mode) */
  challengeRecords?: Record<string, DailyCompletionRecord>;
  /** Arcade high-score records for Overclock mode */
  overclockStats?: OverclockStats;
}

export interface HintSegment {
  /** Coordinates from branch point (or active tip) through the next node or exit */
  path: GridCoord[];
  /** Index in player's current path where this optimal continuation begins */
  branchIndex: number;
}

export interface SurgeParticle {
  angle: number;
  speed: number;
  drift: number;
  size: number;
  durationMs: number;
  delayMs: number;
  color: string;
  isDiamond: boolean;
}

export interface EnergySurgeEffect {
  origin: GridCoord;
  startTime: number;
  particles: SurgeParticle[];
}

export interface LeaderboardEntry {
  rank: number;
  username: string;
  turns: number;
  par: number;
  timeMs: number | null;
}

export interface OverclockLeaderboardEntry {
  rank: number;
  username: string;
  score: number;
  chain: number;
}

export interface DailyCommunityStats {
  totalSolves: number;
  parHits: number;
}

export interface CustomPuzzlePayload {
  id: string;
  title: string;
  creator: string;
  level: PuzzleLevel;
}

export interface BlitzLeaderboardEntry {
  rank: number;
  username: string;
  timeMs: number;
  turns: number;
}

export interface ChallengeLeaderboardEntry {
  rank: number;
  username: string;
  turns: number;
  movesUsed: number;
  timeMs: number | null;
}

export type ComponentPillarId = 'mobo' | 'ram' | 'ssd' | 'gpu' | 'cpu';

export type ComponentPillarScores = Partial<Record<ComponentPillarId, number>>;

export interface OverallLeaderboardEntry {
  rank: number;
  username: string;
  powerScore: number;
  cycles: number;
  pillars?: ComponentPillarScores;
}

export interface StoryLeaderboardEntry {
  rank: number;
  username: string;
  sector: number;
  attempts: number;
  timeMs: number;
}

export interface InitResponse {
  postId: string;
  subredditName: string;
  username: string | null;
  seedDate: string;
  streakData: StreakData;
  hints: number;
  economy: PlayerEconomy;
  dailyStats: DailyCommunityStats;
  leaderboard: LeaderboardEntry[];
  challengeLeaderboard: ChallengeLeaderboardEntry[];
  overclockLeaderboard: OverclockLeaderboardEntry[];
  blitzLeaderboard: BlitzLeaderboardEntry[];
  overallLeaderboard: OverallLeaderboardEntry[];
  storyLeaderboard?: StoryLeaderboardEntry[];
  myPillars?: ComponentPillarScores;
  customPuzzle?: CustomPuzzlePayload;
}

export interface CustomPostRequest {
  title: string;
  tiles: TileData[][];
}

export interface CustomPostResponse {
  ok: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
}

export interface CompleteRunRequest {
  seedDate: string;
  mode: GameMode;
  tier?: CacheTier;
  isRng?: boolean;
  turns: number;
  par: number;
  movesUsed: number;
  moveLimit?: number;
  missteps?: number;
  storySector?: number;
  storyAttempts?: number;
  storyTimeMs?: number;
  nodesCollected: number;
  timeMs: number | null;
  overclockScore?: number;
  overclockChain?: number;
}

export interface CompleteRunResponse {
  streakData: StreakData;
  hints: number;
  earnedHints: number;
  earnedCycles: number;
  earnedPower: number;
  economy: PlayerEconomy;
  isPersonalBest: boolean;
  dailyStats: DailyCommunityStats;
  rank?: number;
  totalPlayers?: number;
  leaderboard: LeaderboardEntry[];
  challengeLeaderboard: ChallengeLeaderboardEntry[];
  overclockLeaderboard: OverclockLeaderboardEntry[];
  blitzLeaderboard: BlitzLeaderboardEntry[];
  overallLeaderboard: OverallLeaderboardEntry[];
  storyLeaderboard?: StoryLeaderboardEntry[];
  myPillars?: ComponentPillarScores;
}

export type ShopItemId =
  | 'hint_1'
  | 'overclock_cap'
  | 'streak_shield'
  | `theme_${SignalThemeId}`;

export interface ShopActionRequest {
  action: 'buy' | 'equip';
  itemId: ShopItemId | SignalThemeId;
}

export interface ShopActionResponse {
  ok: boolean;
  economy: PlayerEconomy;
  hints: number;
  error?: string;
}

export type DuelStatus = 'open' | 'completed' | 'cancelled' | 'expired';

export interface DuelMetrics {
  turns: number;
  timeMs: number;
  score: number;
}

export interface DuelRecord {
  id: string;
  type: 'duel' | 'bounty';
  mode: GameMode;
  tier: CacheTier;
  seedDate: string;
  rngSalt: number;
  creatorId: string;
  creatorUsername: string;
  targetUsername?: string;
  wagerCycles: number;
  wagerPower: number;
  creatorMetrics: DuelMetrics;
  challengerUsername?: string;
  challengerMetrics?: DuelMetrics;
  winnerUsername?: string;
  status: DuelStatus;
  createdAt: number;
  expiresAt: number;
}

export interface DuelListResponse {
  duels: DuelRecord[];
  economy: PlayerEconomy;
}

export interface CreateDuelRequest {
  type: 'duel' | 'bounty';
  mode: GameMode;
  tier: CacheTier;
  seedDate: string;
  rngSalt: number;
  wagerCycles: number;
  wagerPower: number;
  targetUsername?: string;
  metrics: DuelMetrics;
}

export interface CreateDuelResponse {
  ok: boolean;
  duel?: DuelRecord;
  economy: PlayerEconomy;
  error?: string;
}

export interface ResolveDuelRequest {
  duelId: string;
  metrics: DuelMetrics;
}

export interface ResolveDuelResponse {
  ok: boolean;
  won?: boolean;
  duel?: DuelRecord;
  economy: PlayerEconomy;
  overallLeaderboard: OverallLeaderboardEntry[];
  error?: string;
}

export interface CommentResultRequest {
  text: string;
}

export interface CommentResultResponse {
  ok: boolean;
  commentId?: string;
  error?: string;
}

export interface ComponentCompleteRequest {
  module: 'mobo' | 'ram' | 'ssd' | 'gpu';
  variant: 'daily' | 'challenge';
  gridSize?: number;
  mode?: string;
  attempts: number;
  missteps: number;
  timeMs: number;
}

export interface ComponentCompleteResponse {
  ok: boolean;
  score: number;
  isNewBest: boolean;
  overallScore: number;
  pillars: ComponentPillarScores;
  economy: PlayerEconomy;
  overallLeaderboard: OverallLeaderboardEntry[];
}
