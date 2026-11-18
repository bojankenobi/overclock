import {
  CacheTier,
  Direction,
  ElevationLevel,
  GameMode,
  GRID_SIZE,
  GridCoord,
  HintSegment,
  PathStep,
  PuzzleLevel,
  TileData,
  ValidMove,
} from './types';

const EPOCH_UTC = Date.UTC(2026, 10, 1); // 2026-11-01 = Day #1 (so 2026-11-14 = Day #14)

export const DIR_VECTORS: Record<Direction, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
  E: { dx: 1, dy: 0 },
  W: { dx: -1, dy: 0 },
};

const ALL_DIRS: Direction[] = ['N', 'S', 'E', 'W'];

export function oppositeDir(d: Direction): Direction {
  switch (d) {
    case 'N':
      return 'S';
    case 'S':
      return 'N';
    case 'E':
      return 'W';
    case 'W':
      return 'E';
  }
}

export function formatDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getTodayDateISO(): string {
  return formatDateISO(new Date());
}

export function getDayNumber(dateStr: string): number {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return 1;
  const [y, m, d] = parts;
  const targetUTC = Date.UTC(y, m - 1, d);
  const diffDays = Math.floor((targetUTC - EPOCH_UTC) / 86_400_000) + 1;
  return diffDays >= 1 ? diffDays : Math.abs(diffDays) + 1;
}

function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function coordKey(x: number, y: number, level: ElevationLevel): string {
  return `${x},${y},${level}`;
}

/**
 * Computes valid next moves from the current tip of the player's path.
 */
export function getValidNextMoves(
  tiles: TileData[][],
  path: PathStep[],
  collectedNodeCount: number,
  totalNodes: number
): ValidMove[] {
  if (path.length === 0) return [];
  const cur = path[path.length - 1];
  const curTile = tiles[cur.y]?.[cur.x];
  if (!curTile) return [];

  const visited = new Set<string>();
  for (const step of path) {
    visited.add(coordKey(step.x, step.y, step.level));
  }

  const moves: ValidMove[] = [];

  for (const dir of ALL_DIRS) {
    const target = tryStep(tiles, cur.x, cur.y, cur.level, dir, curTile);
    if (!target) continue;

    const nextTile = tiles[target.y][target.x];
    if (nextTile.feature === 'exit' && collectedNodeCount < totalNodes) {
      continue;
    }
    if (visited.has(coordKey(target.x, target.y, target.level))) {
      continue;
    }

    moves.push({
      x: target.x,
      y: target.y,
      level: target.level,
      dir,
    });
  }

  return moves;
}

/**
 * Returns all valid 2.5D adjacent transitions from cur (used by Overclock free-routing mode).
 */
export function getAllConnectedMoves(
  tiles: TileData[][],
  cur: GridCoord
): ValidMove[] {
  const curTile = tiles[cur.y][cur.x];
  const moves: ValidMove[] = [];
  for (const dir of ALL_DIRS) {
    const target = tryStep(tiles, cur.x, cur.y, cur.level, dir, curTile);
    if (target) {
      moves.push({
        x: target.x,
        y: target.y,
        level: target.level,
        dir,
      });
    }
  }
  return moves;
}

/**
 * Computes all reachable (x, y, level) coordinates from start via 2.5D BFS.
 */
export function getReachableCoords(
  tiles: TileData[][],
  start: GridCoord
): GridCoord[] {
  const visited = new Set<string>([coordKey(start.x, start.y, start.level)]);
  const queue: GridCoord[] = [start];
  const result: GridCoord[] = [];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    result.push(cur);
    const tile = tiles[cur.y][cur.x];
    for (const dir of ALL_DIRS) {
      const nxt = tryStep(tiles, cur.x, cur.y, cur.level, dir, tile);
      if (!nxt) continue;
      const key = coordKey(nxt.x, nxt.y, nxt.level);
      if (!visited.has(key)) {
        visited.add(key);
        queue.push(nxt);
      }
    }
  }

  return result;
}

/**
 * Finds the first step along a shortest 2.5D BFS path from `from` toward `target`.
 */
export function findFirstStepToward(
  tiles: TileData[][],
  from: GridCoord,
  target: GridCoord
): ValidMove | null {
  if (from.x === target.x && from.y === target.y && from.level === target.level) {
    return null;
  }
  const startKey = coordKey(from.x, from.y, from.level);
  const visited = new Set<string>([startKey]);
  const queue: Array<{ coord: GridCoord; firstMove: ValidMove | null }> = [
    { coord: from, firstMove: null },
  ];

  while (queue.length > 0) {
    const { coord, firstMove } = queue.shift()!;
    const tile = tiles[coord.y][coord.x];
    for (const dir of ALL_DIRS) {
      const nxt = tryStep(tiles, coord.x, coord.y, coord.level, dir, tile);
      if (!nxt) continue;
      const move: ValidMove = firstMove ?? {
        x: nxt.x,
        y: nxt.y,
        level: nxt.level,
        dir,
      };
      if (nxt.x === target.x && nxt.y === target.y && nxt.level === target.level) {
        return move;
      }
      const key = coordKey(nxt.x, nxt.y, nxt.level);
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({ coord: nxt, firstMove: move });
      }
    }
  }

  return null;
}

/**
 * Deterministically picks the next Energy Node spawn on a reachable floor/platform tile
 * in Overclock mode, encouraging multi-level ramp & bridge traversal.
 */
export function pickNextOverclockTarget(
  tiles: TileData[][],
  reachable: GridCoord[],
  cursor: GridCoord,
  seedNonce: number
): GridCoord {
  const candidates = reachable.filter((c) => {
    if (c.x === cursor.x && c.y === cursor.y && c.level === cursor.level) return false;
    const t = tiles[c.y][c.x].type;
    return t === 'floor' || t === 'platform';
  });

  if (candidates.length === 0) return cursor;

  const preferLevel: ElevationLevel = cursor.level === 1 ? 0 : 1;
  const distFiltered = candidates.filter(
    (c) => Math.abs(c.x - cursor.x) + Math.abs(c.y - cursor.y) >= 3
  );
  const pool = distFiltered.length > 0 ? distFiltered : candidates;
  const levelPool = pool.filter((c) => c.level === preferLevel);
  const finalPool = levelPool.length > 0 ? levelPool : pool;

  const rng = mulberry32(hashString(`OVERCLOCK::TARGET::${seedNonce}::${cursor.x},${cursor.y}`));
  const idx = Math.floor(rng() * finalPool.length);
  return finalPool[idx];
}

function tryStep(
  tiles: TileData[][],
  cx: number,
  cy: number,
  cLevel: ElevationLevel,
  dir: Direction,
  curTile: TileData
): GridCoord | null {
  const gridSize = tiles.length;
  const { dx, dy } = DIR_VECTORS[dir];
  const nx = cx + dx;
  const ny = cy + dy;
  if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) return null;

  // Determine outgoing level from current tile
  let requiredArrivalLevel: ElevationLevel;
  if (curTile.type === 'ramp') {
    if (dir === curTile.rampDir) {
      requiredArrivalLevel = 1;
    } else if (dir === oppositeDir(curTile.rampDir!)) {
      requiredArrivalLevel = 0;
    } else {
      return null;
    }
  } else if (curTile.type === 'bridge') {
    const axis = curTile.bridgeAxis!;
    const isXMove = dir === 'E' || dir === 'W';
    if (cLevel === 1) {
      if ((axis === 'x' && !isXMove) || (axis === 'y' && isXMove)) return null;
      requiredArrivalLevel = 1;
    } else {
      if ((axis === 'x' && isXMove) || (axis === 'y' && !isXMove)) return null;
      requiredArrivalLevel = 0;
    }
  } else if (curTile.type === 'floor') {
    if (cLevel !== 0) return null;
    requiredArrivalLevel = 0;
  } else if (curTile.type === 'platform') {
    if (cLevel !== 1) return null;
    requiredArrivalLevel = 1;
  } else {
    return null;
  }

  const nextTile = tiles[ny][nx];
  if (nextTile.type === 'void') return null;

  if (nextTile.type === 'floor') {
    return requiredArrivalLevel === 0 ? { x: nx, y: ny, level: 0 } : null;
  }
  if (nextTile.type === 'platform') {
    return requiredArrivalLevel === 1 ? { x: nx, y: ny, level: 1 } : null;
  }
  if (nextTile.type === 'ramp') {
    if (requiredArrivalLevel === 0 && dir === nextTile.rampDir) {
      return { x: nx, y: ny, level: 0 };
    }
    if (requiredArrivalLevel === 1 && dir === oppositeDir(nextTile.rampDir!)) {
      return { x: nx, y: ny, level: 0 };
    }
    return null;
  }
  if (nextTile.type === 'bridge') {
    const axis = nextTile.bridgeAxis!;
    const isXMove = dir === 'E' || dir === 'W';
    if (requiredArrivalLevel === 1) {
      if ((axis === 'x' && isXMove) || (axis === 'y' && !isXMove)) {
        return { x: nx, y: ny, level: 1 };
      }
      return null;
    } else {
      if ((axis === 'x' && !isXMove) || (axis === 'y' && isXMove)) {
        return { x: nx, y: ny, level: 0 };
      }
      return null;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Exact IDA* Minimum-Turn Solver
// ---------------------------------------------------------------------------

interface SolverResult {
  solved: boolean;
  par: number;
  optimalPath: GridCoord[];
  dualBridgeCrossed: boolean;
}

function solveExactPar(
  tiles: TileData[][],
  start: GridCoord,
  exit: GridCoord,
  nodes: Array<GridCoord & { index: number }>,
  maxStates = 140000,
  prefix?: PathStep[],
  maxTurnLimit = 16
): SolverResult {
  const gridSize = tiles.length;
  // Build compact graph node list (supports up to 10x10+ grids)
  const graphNodes: GridCoord[] = [];
  const nodeIndexMap = new Map<string, number>();

  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const t = tiles[y][x];
      if (t.type === 'void') continue;
      if (t.type === 'bridge') {
        const idx0 = graphNodes.length;
        graphNodes.push({ x, y, level: 0 });
        nodeIndexMap.set(coordKey(x, y, 0), idx0);

        const idx1 = graphNodes.length;
        graphNodes.push({ x, y, level: 1 });
        nodeIndexMap.set(coordKey(x, y, 1), idx1);
      } else if (t.type === 'platform') {
        const idx = graphNodes.length;
        graphNodes.push({ x, y, level: 1 });
        nodeIndexMap.set(coordKey(x, y, 1), idx);
      } else {
        const idx = graphNodes.length;
        graphNodes.push({ x, y, level: 0 });
        nodeIndexMap.set(coordKey(x, y, 0), idx);
      }
    }
  }

  const N = graphNodes.length;
  if (N > 140) {
    return { solved: false, par: -1, optimalPath: [], dualBridgeCrossed: false };
  }

  // Precompute transition table: trans[nodeIdx * 4 + dirIdx] = nextNodeIdx or -1
  const trans = new Int16Array(N * 4).fill(-1);
  for (let i = 0; i < N; i++) {
    const gn = graphNodes[i];
    const tile = tiles[gn.y][gn.x];
    for (let d = 0; d < 4; d++) {
      const next = tryStep(tiles, gn.x, gn.y, gn.level, ALL_DIRS[d], tile);
      if (next) {
        const nIdx = nodeIndexMap.get(coordKey(next.x, next.y, next.level));
        if (nIdx !== undefined) {
          trans[i * 4 + d] = nIdx;
        }
      }
    }
  }

  const startIdx = nodeIndexMap.get(coordKey(start.x, start.y, start.level))!;
  const exitIdx = nodeIndexMap.get(coordKey(exit.x, exit.y, exit.level))!;

  let reqMask = 0n;
  for (const nd of nodes) {
    const idx = nodeIndexMap.get(coordKey(nd.x, nd.y, nd.level))!;
    reqMask |= 1n << BigInt(idx);
  }

  // Preallocated BFS queue for reachability pruning
  const bfsQueue = new Int16Array(N);

  function allRequiredReachable(cur: number, visMask: bigint): boolean {
    const remMask = reqMask & ~visMask;

    let seenMask = visMask | (1n << BigInt(cur));
    let head = 0;
    let tail = 0;

    bfsQueue[tail++] = cur;
    let reachedExit = false;

    while (head < tail) {
      const u = bfsQueue[head++];
      const base = u * 4;
      for (let d = 0; d < 4; d++) {
        const v = trans[base + d];
        if (v === -1) continue;
        if (v === exitIdx) {
          reachedExit = true;
          continue; // Exit is terminal; cannot traverse through it
        }
        const bit = 1n << BigInt(v);
        if ((seenMask & bit) === 0n) {
          seenMask |= bit;
          bfsQueue[tail++] = v;
        }
      }
    }

    if (!reachedExit) return false;
    return (seenMask & remMask) === remMask;
  }

  let statesExplored = 0;
  let aborted = false;
  const pathStack: number[] = [startIdx];

  function traceStraightToWin(
    cur: number,
    dir: number,
    visMask: bigint,
    added: number[]
  ): boolean {
    let u = cur;
    let vMask = visMask;

    while (true) {
      const nxt = trans[u * 4 + dir];
      if (nxt === -1) return false;
      const bit = 1n << BigInt(nxt);
      if ((vMask & bit) !== 0n) return false;
      if (nxt === exitIdx) {
        if ((vMask & reqMask) === reqMask) {
          added.push(nxt);
          return true;
        }
        return false;
      }
      vMask |= bit;
      added.push(nxt);
      u = nxt;
    }
  }

  function dfs(
    cur: number,
    dir: number,
    turns: number,
    limit: number,
    visMask: bigint
  ): boolean {
    if (aborted) return false;
    if (++statesExplored > maxStates) {
      aborted = true;
      return false;
    }

    // Fast 0-turns-remaining ray check
    if (turns === limit && dir !== -1) {
      const added: number[] = [];
      if (traceStraightToWin(cur, dir, visMask, added)) {
        for (const id of added) pathStack.push(id);
        return true;
      }
      return false;
    }

    if (!allRequiredReachable(cur, visMask)) {
      return false;
    }

    // Try straight first (costs 0 turns) if we already have a direction
    const tryOrder: number[] = [];
    if (dir === -1) {
      for (let d = 0; d < 4; d++) tryOrder.push(d);
    } else {
      tryOrder.push(dir);
      if (turns + 1 <= limit) {
        const opp = dir ^ 1; // N(0)<->S(1), E(2)<->W(3)
        for (let d = 0; d < 4; d++) {
          if (d !== dir && d !== opp) tryOrder.push(d);
        }
      }
    }

    for (let k = 0; k < tryOrder.length; k++) {
      const nd = tryOrder[k];
      const nxt = trans[cur * 4 + nd];
      if (nxt === -1) continue;

      const isTurn = dir !== -1 && nd !== dir;
      const nextTurns = isTurn ? turns + 1 : turns;
      if (nextTurns > limit) continue;

      if (nxt === exitIdx) {
        if ((visMask & reqMask) === reqMask) {
          pathStack.push(nxt);
          return true;
        }
        continue;
      }

      const bit = 1n << BigInt(nxt);
      if ((visMask & bit) !== 0n) continue;

      pathStack.push(nxt);
      if (dfs(nxt, nd, nextTurns, limit, visMask | bit)) {
        return true;
      }
      pathStack.pop();
    }

    return false;
  }

  let initMask = 0n;
  let initCurIdx = startIdx;
  let initDir = -1;
  let initTurns = 0;
  pathStack.length = 0;

  if (prefix && prefix.length > 0) {
    for (let i = 0; i < prefix.length; i++) {
      const p = prefix[i];
      const idx = nodeIndexMap.get(coordKey(p.x, p.y, p.level));
      if (idx === undefined) {
        return { solved: false, par: -1, optimalPath: [], dualBridgeCrossed: false };
      }
      initMask |= 1n << BigInt(idx);
      pathStack.push(idx);
      if (p.causedTurnAtPrev) initTurns++;
    }
    const last = prefix[prefix.length - 1];
    initCurIdx = pathStack[pathStack.length - 1];
    initDir = last.dirFromPrev ? ALL_DIRS.indexOf(last.dirFromPrev) : -1;
  } else {
    initMask |= 1n << BigInt(startIdx);
    pathStack.push(startIdx);
  }
  const baseStackLen = pathStack.length;

  const minLimit = prefix && prefix.length > 1 ? initTurns : 2;
  const maxLimit =
    prefix && prefix.length > 1 ? Math.max(18, initTurns + 14) : maxTurnLimit;

  for (let limit = minLimit; limit <= maxLimit; limit++) {
    pathStack.length = baseStackLen;
    if (dfs(initCurIdx, initDir, initTurns, limit, initMask)) {
      const optimalPath = pathStack.map((idx) => graphNodes[idx]);
      // Check if any bridge had BOTH Level 0 and Level 1 traversed
      const bridgeHits = new Map<string, Set<ElevationLevel>>();
      for (const p of optimalPath) {
        if (tiles[p.y][p.x].type === 'bridge') {
          const key = `${p.x},${p.y}`;
          if (!bridgeHits.has(key)) bridgeHits.set(key, new Set());
          bridgeHits.get(key)!.add(p.level);
        }
      }
      let dualBridgeCrossed = false;
      for (const levels of bridgeHits.values()) {
        if (levels.has(0) && levels.has(1)) {
          dualBridgeCrossed = true;
          break;
        }
      }

      return {
        solved: true,
        par: limit,
        optimalPath,
        dualBridgeCrossed,
      };
    }
    if (aborted) break;
  }

  return { solved: false, par: -1, optimalPath: [], dualBridgeCrossed: false };
}

// ---------------------------------------------------------------------------
// Procedural 2.5D Board Builder
// ---------------------------------------------------------------------------

function createEmptyGrid(gridSize: number = GRID_SIZE): TileData[][] {
  const tiles: TileData[][] = [];
  for (let y = 0; y < gridSize; y++) {
    const row: TileData[] = [];
    for (let x = 0; x < gridSize; x++) {
      row.push({ x, y, type: 'floor', feature: null });
    }
    tiles.push(row);
  }
  return tiles;
}

function buildProceduralCandidate(
  rng: () => number,
  mode: GameMode = 'standard',
  tier: CacheTier = 'L1',
  gridSize: number = GRID_SIZE
): {
  tiles: TileData[][];
  start: GridCoord;
  exit: GridCoord;
  nodes: Array<GridCoord & { index: number }>;
} | null {
  const isChallenge = mode === 'challenge';
  const tiles = createEmptyGrid(gridSize);

  // Calibrate bridge complexity by CPU Cache Tier (L0 -> L5) & Grid Size (5x5 -> 10x10)
  const rawBridgeCount =
    tier === 'L0'
      ? 1
      : tier === 'L1'
        ? isChallenge || rng() < 0.45
          ? 2
          : 1
        : tier === 'L4' || tier === 'L5'
          ? gridSize >= 8 && rng() < 0.35
            ? 3
            : 2
          : 2;
  const bridgeCount = gridSize <= 5 ? 1 : rawBridgeCount;
  const bridges: Array<{ x: number; y: number; axis: 'x' | 'y' }> = [];

  if (bridgeCount === 1) {
    const axis: 'x' | 'y' = rng() < 0.5 ? 'x' : 'y';
    const minC = gridSize >= 7 ? 2 : 1;
    const maxC = gridSize - 1 - minC;
    const bx = randInt(rng, minC, Math.max(minC, maxC));
    const by = randInt(rng, minC, Math.max(minC, maxC));
    bridges.push({ x: bx, y: by, axis });
  } else {
    // Place 2-3 well-spaced bridges inside [1 .. gridSize-2]
    const minC = gridSize >= 7 ? 2 : 1;
    const maxC = gridSize - 1 - minC;
    for (let attempt = 0; attempt < 25 && bridges.length < bridgeCount; attempt++) {
      const bx = randInt(rng, minC, Math.max(minC, maxC));
      const by = randInt(rng, minC, Math.max(minC, maxC));
      const axis: 'x' | 'y' =
        bridges.length === 0
          ? rng() < 0.5
            ? 'x'
            : 'y'
          : rng() < 0.65
            ? bridges[0].axis === 'x'
              ? 'y'
              : 'x'
            : bridges[0].axis;
      const tooClose = bridges.some(
        (b) => Math.abs(b.x - bx) + Math.abs(b.y - by) < 3
      );
      if (!tooClose) {
        bridges.push({ x: bx, y: by, axis });
      }
    }
    if (bridges.length === 0) {
      bridges.push({ x: Math.floor(gridSize / 2), y: Math.floor(gridSize / 2), axis: 'x' });
    }
  }

  // Stamp bridges and reserve their underpass endpoints as floor
  const reservedFloor = new Set<string>();
  const platformCandidates: Array<{ x: number; y: number }> = [];

  for (const b of bridges) {
    tiles[b.y][b.x] = {
      x: b.x,
      y: b.y,
      type: 'bridge',
      bridgeAxis: b.axis,
      feature: null,
    };

    if (b.axis === 'x') {
      // Underpass is N/S
      reservedFloor.add(`${b.x},${b.y - 1}`);
      reservedFloor.add(`${b.x},${b.y + 1}`);
      // Overpass connects E/W
      platformCandidates.push({ x: b.x - 1, y: b.y }, { x: b.x + 1, y: b.y });
    } else {
      // Underpass is E/W
      reservedFloor.add(`${b.x - 1},${b.y}`);
      reservedFloor.add(`${b.x + 1},${b.y}`);
      // Overpass connects N/S
      platformCandidates.push({ x: b.x, y: b.y - 1 }, { x: b.x, y: b.y + 1 });
    }
  }

  // Elevate platform endpoints (do not overwrite bridges or reserved underpass floor!)
  for (const p of platformCandidates) {
    if (p.x < 0 || p.x >= gridSize || p.y < 0 || p.y >= gridSize) continue;
    const key = `${p.x},${p.y}`;
    if (reservedFloor.has(key)) continue;
    if (tiles[p.y][p.x].type === 'floor') {
      tiles[p.y][p.x].type = 'platform';
    }
  }

  // Optionally expand 1-2 adjacent platform tiles so Level 1 has turning corners
  const currentPlatforms: Array<{ x: number; y: number }> = [];
  for (let y = 1; y < gridSize - 1; y++) {
    for (let x = 1; x < gridSize - 1; x++) {
      if (tiles[y][x].type === 'platform') currentPlatforms.push({ x, y });
    }
  }

  const extraPlats = isChallenge ? randInt(rng, 2, 4) : randInt(rng, 1, 3);
  for (let k = 0; k < extraPlats && currentPlatforms.length > 0; k++) {
    const base = currentPlatforms[randInt(rng, 0, currentPlatforms.length - 1)];
    const dir = ALL_DIRS[randInt(rng, 0, 3)];
    const nx = base.x + DIR_VECTORS[dir].dx;
    const ny = base.y + DIR_VECTORS[dir].dy;
    if (nx >= 1 && nx < gridSize - 1 && ny >= 1 && ny < gridSize - 1) {
      if (!reservedFloor.has(`${nx},${ny}`) && tiles[ny][nx].type === 'floor') {
        tiles[ny][nx].type = 'platform';
        currentPlatforms.push({ x: nx, y: ny });
      }
    }
  }

  // Attach ramps to connect every Level 1 connected component to Level 0!
  // Find all Level 1 connected components (platforms + bridges)
  const highVisited = new Set<string>();
  const highComponents: Array<Array<{ x: number; y: number }>> = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const t = tiles[y][x];
      if ((t.type === 'platform' || t.type === 'bridge') && !highVisited.has(`${x},${y}`)) {
        const comp: Array<{ x: number; y: number }> = [];
        const q = [{ x, y }];
        highVisited.add(`${x},${y}`);
        while (q.length > 0) {
          const cur = q.shift()!;
          comp.push(cur);
          const ct = tiles[cur.y][cur.x];
          for (const d of ALL_DIRS) {
            if (ct.type === 'bridge') {
              const isX = d === 'E' || d === 'W';
              if ((ct.bridgeAxis === 'x' && !isX) || (ct.bridgeAxis === 'y' && isX)) continue;
            }
            const nx = cur.x + DIR_VECTORS[d].dx;
            const ny = cur.y + DIR_VECTORS[d].dy;
            if (nx < 0 || nx >= gridSize || ny < 0 || ny >= gridSize) continue;
            const nt = tiles[ny][nx];
            if (nt.type === 'platform') {
              if (!highVisited.has(`${nx},${ny}`)) {
                highVisited.add(`${nx},${ny}`);
                q.push({ x: nx, y: ny });
              }
            } else if (nt.type === 'bridge') {
              const isX = d === 'E' || d === 'W';
              if ((nt.bridgeAxis === 'x' && isX) || (nt.bridgeAxis === 'y' && !isX)) {
                if (!highVisited.has(`${nx},${ny}`)) {
                  highVisited.add(`${nx},${ny}`);
                  q.push({ x: nx, y: ny });
                }
              }
            }
          }
        }
        highComponents.push(comp);
      }
    }
  }

  // For each high component, place at least 2 ramps (so player can enter AND exit Level 1!)
  for (const comp of highComponents) {
    const rampSlots: Array<{ rx: number; ry: number; rampDir: Direction }> = [];
    for (const cell of comp) {
      const ct = tiles[cell.y][cell.x];
      for (const d of ALL_DIRS) {
        if (ct.type === 'bridge') {
          const isX = d === 'E' || d === 'W';
          if ((ct.bridgeAxis === 'x' && !isX) || (ct.bridgeAxis === 'y' && isX)) continue;
        }
        // Ramp sits at (rx, ry) adjacent to high cell, pointing toward high cell!
        const rx = cell.x + DIR_VECTORS[d].dx;
        const ry = cell.y + DIR_VECTORS[d].dy;
        const lowX = rx + DIR_VECTORS[d].dx;
        const lowY = ry + DIR_VECTORS[d].dy;
        if (rx < 0 || rx >= gridSize || ry < 0 || ry >= gridSize) continue;
        if (lowX < 0 || lowX >= gridSize || lowY < 0 || lowY >= gridSize) continue;
        if (tiles[ry][rx].type !== 'floor' || reservedFloor.has(`${rx},${ry}`)) continue;
        if (tiles[lowY][lowX].type !== 'floor') continue;

        // Ramp points from low (lowX, lowY) toward high (cell.x, cell.y), which is oppositeDir(d)
        rampSlots.push({ rx, ry, rampDir: oppositeDir(d) });
      }
    }

    const shuffledRamps = shuffle(rampSlots, rng);
    let placed = 0;
    for (const slot of shuffledRamps) {
      if (tiles[slot.ry][slot.rx].type !== 'floor') continue;
      // Avoid placing two ramps right next to each other
      const hasAdjRamp = ALL_DIRS.some((d) => {
        const ax = slot.rx + DIR_VECTORS[d].dx;
        const ay = slot.ry + DIR_VECTORS[d].dy;
        return ax >= 0 && ax < gridSize && ay >= 0 && ay < gridSize && tiles[ay][ax].type === 'ramp';
      });
      if (hasAdjRamp) continue;

      tiles[slot.ry][slot.rx] = {
        x: slot.rx,
        y: slot.ry,
        type: 'ramp',
        rampDir: slot.rampDir,
        feature: null,
      };
      // Reserve the low entry tile as floor so we don't void it out
      const lowX = slot.rx - DIR_VECTORS[slot.rampDir].dx;
      const lowY = slot.ry - DIR_VECTORS[slot.rampDir].dy;
      reservedFloor.add(`${lowX},${lowY}`);

      placed++;
      if (placed >= 2) break;
    }

    if (placed < 2) return null;
  }

  // Carve strategic void cutouts on remaining non-reserved floor tiles
  const voidCandidates: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      if (tiles[y][x].type === 'floor' && !reservedFloor.has(`${x},${y}`)) {
        voidCandidates.push({ x, y });
      }
    }
  }

  const areaScale = (gridSize * gridSize) / 49;
  const baseVoidMin =
    tier === 'L0' ? 5 : tier === 'L1' ? 7 : tier === 'L2' ? 10 : tier === 'L3' ? 12 : tier === 'L4' ? 14 : 16;
  const baseVoidMax = baseVoidMin + 4;
  const targetVoids = Math.max(
    2,
    Math.min(28, Math.round(randInt(rng, baseVoidMin, baseVoidMax) * areaScale))
  );
  let voidsPlaced = 0;
  for (const vc of shuffle(voidCandidates, rng)) {
    if (voidsPlaced >= targetVoids) break;
    tiles[vc.y][vc.x].type = 'void';
    voidsPlaced++;
  }

  // Gather candidate positions for Start, Exit, and Energy Nodes
  const floorSpots: GridCoord[] = [];
  const platformSpots: GridCoord[] = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const t = tiles[y][x];
      if (t.type === 'floor') floorSpots.push({ x, y, level: 0 });
      else if (t.type === 'platform') platformSpots.push({ x, y, level: 1 });
    }
  }

  const targetNodeCount =
    tier === 'L0'
      ? isChallenge
        ? 3
        : 2
      : tier === 'L1'
        ? isChallenge
          ? 3
          : gridSize <= 5
            ? 2
            : 3
        : tier === 'L2'
          ? isChallenge
            ? 4
            : 3
          : tier === 'L3'
            ? isChallenge
              ? 5
              : 4
            : tier === 'L4'
              ? isChallenge
                ? 6
                : 5
              : isChallenge
                ? 7
                : 6;
  if (floorSpots.length < targetNodeCount + 2 || platformSpots.length < 1) return null;

  const shuffledFloors = shuffle(floorSpots, rng);
  const shuffledPlats = shuffle(platformSpots, rng);

  // Pick Start and Exit well separated
  const start = shuffledFloors[0];
  let exit: GridCoord | null = null;
  const minExitDist = isChallenge ? 5 : 4;
  for (const cand of [...shuffledFloors.slice(1), ...shuffledPlats]) {
    const dist = Math.abs(cand.x - start.x) + Math.abs(cand.y - start.y);
    if (dist >= minExitDist) {
      exit = cand;
      break;
    }
  }
  if (!exit && isChallenge) {
    for (const cand of [...shuffledFloors.slice(1), ...shuffledPlats]) {
      const dist = Math.abs(cand.x - start.x) + Math.abs(cand.y - start.y);
      if (dist >= 4) {
        exit = cand;
        break;
      }
    }
  }
  if (!exit) return null;

  tiles[start.y][start.x].feature = 'start';
  tiles[exit.y][exit.x].feature = 'exit';

  // Pick Energy Nodes (4 in standard, 5 in Daily Challenge): at least 1 on Level 1 platform
  const nodes: Array<GridCoord & { index: number }> = [];
  const used = new Set<string>([
    `${start.x},${start.y}`,
    `${exit.x},${exit.y}`,
  ]);

  // 1-2 nodes on Level 1 platforms
  const platNodeTarget = Math.min(
    shuffledPlats.length,
    isChallenge ? (rng() < 0.65 ? 2 : 1) : rng() < 0.5 ? 2 : 1
  );
  for (const p of shuffledPlats) {
    if (nodes.length >= platNodeTarget) break;
    if (used.has(`${p.x},${p.y}`)) continue;
    used.add(`${p.x},${p.y}`);
    const idx = nodes.length;
    tiles[p.y][p.x].feature = 'node';
    tiles[p.y][p.x].nodeIndex = idx;
    nodes.push({ ...p, index: idx });
  }

  // Prioritize reserved underpass floor spots for remaining nodes to encourage Over/Under crossings
  const underpassFloors = shuffle(
    floorSpots.filter((f) => reservedFloor.has(`${f.x},${f.y}`) && !used.has(`${f.x},${f.y}`)),
    rng
  );
  const otherFloors = shuffledFloors.filter((f) => !used.has(`${f.x},${f.y}`));

  for (const f of [...underpassFloors, ...otherFloors]) {
    if (nodes.length >= targetNodeCount) break;
    if (used.has(`${f.x},${f.y}`)) continue;
    used.add(`${f.x},${f.y}`);
    const idx = nodes.length;
    tiles[f.y][f.x].feature = 'node';
    tiles[f.y][f.x].nodeIndex = idx;
    nodes.push({ ...f, index: idx });
  }

  if (nodes.length < targetNodeCount) return null;

  return { tiles, start, exit, nodes };
}

/**
 * Deterministic fallback board guaranteed to solve with Over/Under bridge traversal
 */
function buildGuaranteedFallback(rng: () => number): {
  tiles: TileData[][];
  start: GridCoord;
  exit: GridCoord;
  nodes: Array<GridCoord & { index: number }>;
} {
  const tiles = createEmptyGrid();
  // Clean symmetrical 2-bridge overpass + underpass circuit
  // Void cutouts
  const voids = [
    [0, 0], [6, 0], [0, 6], [6, 6],
    [1, 1], [5, 1], [1, 5], [5, 5],
    [0, 3], [6, 3],
  ];
  for (const [vx, vy] of voids) {
    tiles[vy][vx].type = 'void';
  }

  // Central bridge along X at (3, 3)
  tiles[3][3] = { x: 3, y: 3, type: 'bridge', bridgeAxis: 'x', feature: null };
  tiles[3][2] = { x: 2, y: 3, type: 'platform', feature: null };
  tiles[3][4] = { x: 4, y: 3, type: 'platform', feature: null };
  tiles[3][1] = { x: 1, y: 3, type: 'ramp', rampDir: 'E', feature: null };
  tiles[3][5] = { x: 5, y: 3, type: 'ramp', rampDir: 'W', feature: null };

  // Secondary elevated wing on top
  tiles[2][2] = { x: 2, y: 2, type: 'platform', feature: null };
  tiles[1][2] = { x: 2, y: 1, type: 'ramp', rampDir: 'S', feature: null };

  const flipX = rng() < 0.5;
  const flipY = rng() < 0.5;

  const tx = (x: number) => (flipX ? GRID_SIZE - 1 - x : x);
  const ty = (y: number) => (flipY ? GRID_SIZE - 1 - y : y);

  const finalTiles = createEmptyGrid();
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const src = tiles[y][x];
      const nx = tx(x);
      const ny = ty(y);
      let rampDir = src.rampDir;
      if (rampDir) {
        if (flipX && (rampDir === 'E' || rampDir === 'W')) rampDir = oppositeDir(rampDir);
        if (flipY && (rampDir === 'N' || rampDir === 'S')) rampDir = oppositeDir(rampDir);
      }
      finalTiles[ny][nx] = {
        ...src,
        x: nx,
        y: ny,
        rampDir,
      };
    }
  }

  const start: GridCoord = { x: tx(1), y: ty(0), level: 0 };
  const exit: GridCoord = { x: tx(5), y: ty(6), level: 0 };
  const nodeSpecs: GridCoord[] = [
    { x: tx(3), y: ty(1), level: 0 },
    { x: tx(3), y: ty(5), level: 0 },
    { x: tx(2), y: ty(2), level: 1 },
    { x: tx(4), y: ty(3), level: 1 },
  ];

  finalTiles[start.y][start.x].feature = 'start';
  finalTiles[exit.y][exit.x].feature = 'exit';
  const nodes = nodeSpecs.map((n, idx) => {
    finalTiles[n.y][n.x].feature = 'node';
    finalTiles[n.y][n.x].nodeIndex = idx;
    return { ...n, index: idx };
  });

  return { tiles: finalTiles, start, exit, nodes };
}

/**
 * Deterministic Hard Mode fallback board (2-bridge, 5-node dual-elevation circuit)
 */
function buildGuaranteedChallengeFallback(rng: () => number): {
  tiles: TileData[][];
  start: GridCoord;
  exit: GridCoord;
  nodes: Array<GridCoord & { index: number }>;
} {
  const tiles = createEmptyGrid();
  const voids = [
    [0, 0], [6, 0], [0, 6], [6, 6],
    [1, 0], [5, 0], [0, 3], [6, 3],
    [3, 0], [3, 6], [1, 5], [5, 1],
  ];
  for (const [vx, vy] of voids) {
    tiles[vy][vx].type = 'void';
  }

  // Dual perpendicular bridges at (2,2) along X and (4,4) along Y
  tiles[2][2] = { x: 2, y: 2, type: 'bridge', bridgeAxis: 'x', feature: null };
  tiles[2][1] = { x: 1, y: 2, type: 'platform', feature: null };
  tiles[2][3] = { x: 3, y: 2, type: 'platform', feature: null };
  tiles[1][1] = { x: 1, y: 1, type: 'ramp', rampDir: 'S', feature: null };
  tiles[2][4] = { x: 4, y: 2, type: 'ramp', rampDir: 'W', feature: null };

  tiles[4][4] = { x: 4, y: 4, type: 'bridge', bridgeAxis: 'y', feature: null };
  tiles[3][4] = { x: 4, y: 3, type: 'platform', feature: null };
  tiles[5][4] = { x: 4, y: 5, type: 'platform', feature: null };
  tiles[3][3] = { x: 3, y: 3, type: 'ramp', rampDir: 'E', feature: null };
  tiles[6][4] = { x: 4, y: 6, type: 'ramp', rampDir: 'N', feature: null };

  const flipX = rng() < 0.5;
  const flipY = rng() < 0.5;
  const tx = (x: number) => (flipX ? GRID_SIZE - 1 - x : x);
  const ty = (y: number) => (flipY ? GRID_SIZE - 1 - y : y);

  const finalTiles = createEmptyGrid();
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const src = tiles[y][x];
      const nx = tx(x);
      const ny = ty(y);
      let rampDir = src.rampDir;
      if (rampDir) {
        if (flipX && (rampDir === 'E' || rampDir === 'W')) rampDir = oppositeDir(rampDir);
        if (flipY && (rampDir === 'N' || rampDir === 'S')) rampDir = oppositeDir(rampDir);
      }
      finalTiles[ny][nx] = {
        ...src,
        x: nx,
        y: ny,
        rampDir,
      };
    }
  }

  const start: GridCoord = { x: tx(0), y: ty(1), level: 0 };
  const exit: GridCoord = { x: tx(6), y: ty(5), level: 0 };
  const nodeSpecs: GridCoord[] = [
    { x: tx(2), y: ty(1), level: 0 },
    { x: tx(2), y: ty(3), level: 0 },
    { x: tx(5), y: ty(4), level: 0 },
    { x: tx(3), y: ty(2), level: 1 },
    { x: tx(4), y: ty(5), level: 1 },
  ];

  finalTiles[start.y][start.x].feature = 'start';
  finalTiles[exit.y][exit.x].feature = 'exit';
  const nodes = nodeSpecs.map((n, idx) => {
    finalTiles[n.y][n.x].feature = 'node';
    finalTiles[n.y][n.x].nodeIndex = idx;
    return { ...n, index: idx };
  });

  return { tiles: finalTiles, start, exit, nodes };
}

/**
 * Deterministically generates and verifies a 100% solvable 7x7 2.5D puzzle
 * with exact optimal PAR calculated via IDA* search.
 * In 'challenge' mode, assigns an extra-difficult layout for the date with a tight move limit.
 */
export function generateLevel(
  seedDate: string,
  mode: GameMode = 'standard',
  tier: CacheTier = 'L1',
  rngSalt = 0,
  gridSizeOverride?: number
): PuzzleLevel {
  const dayNumber = getDayNumber(seedDate);
  const targetGridSize = gridSizeOverride
    ? Math.max(5, Math.min(10, Math.round(gridSizeOverride)))
    : GRID_SIZE;

  if (mode === 'overclock') {
    const ocSeed = hashString(`GRIDLOCK::OVERCLOCK::${seedDate}::${rngSalt}`);
    const ocRng = mulberry32(ocSeed);

    for (let attempt = 0; attempt < 40; attempt++) {
      const cand = buildProceduralCandidate(ocRng, 'standard');
      if (!cand) continue;
      // Clear exit & extra nodes; keep Start + 1 live target node
      for (let y = 0; y < GRID_SIZE; y++) {
        for (let x = 0; x < GRID_SIZE; x++) {
          const tile = cand.tiles[y][x];
          if (tile.feature === 'exit' || tile.feature === 'node') {
            tile.feature = null;
            tile.nodeIndex = undefined;
          }
        }
      }
      const reachable = getReachableCoords(cand.tiles, cand.start);
      const hasL1 = reachable.some((c) => c.level === 1 && cand.tiles[c.y][c.x].type === 'platform');
      if (reachable.length >= 26 && hasL1) {
        const firstTarget = pickNextOverclockTarget(cand.tiles, reachable, cand.start, ocSeed + 1);
        cand.tiles[firstTarget.y][firstTarget.x].feature = 'node';
        cand.tiles[firstTarget.y][firstTarget.x].nodeIndex = 0;
        return {
          seedDate,
          dayNumber,
          mode: 'overclock',
          size: GRID_SIZE,
          tiles: cand.tiles,
          start: cand.start,
          exit: cand.start,
          nodes: [{ ...firstTarget, index: 0 }],
          par: 0,
          optimalPath: [],
        };
      }
    }

    const fb = buildGuaranteedChallengeFallback(ocRng);
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const tile = fb.tiles[y][x];
        if (tile.feature === 'exit' || tile.feature === 'node') {
          tile.feature = null;
          tile.nodeIndex = undefined;
        }
      }
    }
    const reachable = getReachableCoords(fb.tiles, fb.start);
    const firstTarget = pickNextOverclockTarget(fb.tiles, reachable, fb.start, ocSeed + 99);
    fb.tiles[firstTarget.y][firstTarget.x].feature = 'node';
    fb.tiles[firstTarget.y][firstTarget.x].nodeIndex = 0;
    return {
      seedDate,
      dayNumber,
      mode: 'overclock',
      size: GRID_SIZE,
      tiles: fb.tiles,
      start: fb.start,
      exit: fb.start,
      nodes: [{ ...firstTarget, index: 0 }],
      par: 0,
      optimalPath: [],
    };
  }

  const isChallenge = mode === 'challenge';
  const sizeTag = targetGridSize !== GRID_SIZE ? `::S${targetGridSize}` : '';
  const saltSuffix =
    (rngSalt > 0 ? `::RNG::${rngSalt}::${tier}` : tier !== 'L1' ? `::${tier}` : '') + sizeTag;
  const baseSeed = hashString(
    (isChallenge ? `GRIDLOCK::CHALLENGE::${seedDate}` : `GRIDLOCK::${seedDate}`) + saltSuffix
  );
  const rng = mulberry32(baseSeed);

  let bestBackup: {
    cand: NonNullable<ReturnType<typeof buildProceduralCandidate>>;
    res: SolverResult;
  } | null = null;

  const maxAttempts = targetGridSize >= 9 ? 55 : isChallenge ? 75 : 60;
  const maxTurnSearch =
    targetGridSize >= 9 ? 22 : isChallenge ? 18 : 16;
  const minParStd =
    targetGridSize <= 5
      ? 3
      : tier === 'L0'
        ? 3
        : tier === 'L1'
          ? 5
          : tier === 'L2'
            ? 7
            : tier === 'L3'
              ? 8
              : tier === 'L4'
                ? 9
                : 11;
  const minParChal =
    targetGridSize <= 5
      ? 4
      : tier === 'L0'
        ? 5
        : tier === 'L1'
          ? 6
          : tier === 'L2'
            ? 8
            : tier === 'L3'
              ? 9
              : tier === 'L4'
                ? 10
                : 12;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const cand = buildProceduralCandidate(rng, mode, tier, targetGridSize);
    if (!cand) continue;

    const res = solveExactPar(
      cand.tiles,
      cand.start,
      cand.exit,
      cand.nodes,
      targetGridSize >= 9 ? 220000 : isChallenge ? 120000 : 140000,
      undefined,
      maxTurnSearch
    );
    if (!res.solved) continue;

    if (isChallenge) {
      if (
        (tier === 'L0' || targetGridSize <= 5 || res.dualBridgeCrossed) &&
        res.par >= minParChal &&
        res.par <= maxTurnSearch &&
        res.optimalPath.length >= (tier === 'L0' || targetGridSize <= 5 ? 8 : 13)
      ) {
        const optimalSteps = Math.max(1, res.optimalPath.length - 1);
        const moveBuffer =
          tier === 'L5' || tier === 'L4' ? 1 : tier === 'L3' ? 1 : tier === 'L2' ? 2 : 3;
        return {
          seedDate,
          dayNumber,
          mode,
          tier,
          size: targetGridSize,
          tiles: cand.tiles,
          start: cand.start,
          exit: cand.exit,
          nodes: cand.nodes,
          par: res.par,
          moveLimit: optimalSteps + moveBuffer,
          optimalPath: res.optimalPath,
        };
      }

      if (
        !bestBackup ||
        (res.dualBridgeCrossed && !bestBackup.res.dualBridgeCrossed) ||
        (res.dualBridgeCrossed === bestBackup.res.dualBridgeCrossed &&
          res.par > bestBackup.res.par)
      ) {
        if (res.par >= Math.max(3, minParChal - 2)) {
          bestBackup = { cand, res };
        }
      }
    } else {
      if (
        (tier === 'L0' || targetGridSize <= 5 || res.dualBridgeCrossed) &&
        res.par >= minParStd &&
        res.par <= maxTurnSearch
      ) {
        return {
          seedDate,
          dayNumber,
          mode,
          tier,
          size: targetGridSize,
          tiles: cand.tiles,
          start: cand.start,
          exit: cand.exit,
          nodes: cand.nodes,
          par: res.par,
          optimalPath: res.optimalPath,
        };
      }

      if (!bestBackup || res.par > bestBackup.res.par) {
        bestBackup = { cand, res };
      }
    }
  }

  if (bestBackup) {
    const optimalSteps = Math.max(1, bestBackup.res.optimalPath.length - 1);
    return {
      seedDate,
      dayNumber,
      mode,
      tier,
      size: targetGridSize,
      tiles: bestBackup.cand.tiles,
      start: bestBackup.cand.start,
      exit: bestBackup.cand.exit,
      nodes: bestBackup.cand.nodes,
      par: bestBackup.res.par,
      ...(isChallenge ? { moveLimit: optimalSteps + 2 } : {}),
      optimalPath: bestBackup.res.optimalPath,
    };
  }

  // Guaranteed fallback
  const fb = isChallenge
    ? buildGuaranteedChallengeFallback(rng)
    : buildGuaranteedFallback(rng);
  const fbRes = solveExactPar(fb.tiles, fb.start, fb.exit, fb.nodes, 300000, undefined, maxTurnSearch);
  const fbOptimalSteps = Math.max(1, fbRes.optimalPath.length - 1);
  return {
    seedDate,
    dayNumber,
    mode,
    size: GRID_SIZE,
    tiles: fb.tiles,
    start: fb.start,
    exit: fb.exit,
    nodes: fb.nodes,
    par: fbRes.solved ? fbRes.par : isChallenge ? 10 : 8,
    ...(isChallenge ? { moveLimit: (fbRes.solved ? fbOptimalSteps : 20) + 2 } : {}),
    optimalPath: fbRes.optimalPath,
  };
}

function sliceToNextTarget(
  tiles: TileData[][],
  fullPath: GridCoord[],
  startIndex: number
): GridCoord[] {
  const alreadyCollected = new Set<number>();
  for (let i = 0; i <= startIndex && i < fullPath.length; i++) {
    const p = fullPath[i];
    const tile = tiles[p.y][p.x];
    if (tile.feature === 'node' && tile.nodeIndex !== undefined) {
      alreadyCollected.add(tile.nodeIndex);
    }
  }

  for (let i = startIndex + 1; i < fullPath.length; i++) {
    const p = fullPath[i];
    const tile = tiles[p.y][p.x];
    if (tile.feature === 'node' && tile.nodeIndex !== undefined && !alreadyCollected.has(tile.nodeIndex)) {
      return fullPath.slice(startIndex, i + 1);
    }
    if (tile.feature === 'exit') {
      return fullPath.slice(startIndex, i + 1);
    }
  }

  return fullPath.slice(startIndex);
}

/**
 * Computes a partial ghosted optimal path from the current tip (or nearest valid
 * branch point if the player reached a dead end) to the next uncollected Energy Node
 * (or Exit if all Energy Nodes are collected).
 */
export function getHintPathToNextNode(
  level: PuzzleLevel,
  currentPath: PathStep[]
): HintSegment | null {
  if (currentPath.length === 0) return null;

  // 1. Fast check: if currentPath matches a prefix of level.optimalPath
  if (currentPath.length <= level.optimalPath.length) {
    let matchesPrefix = true;
    for (let i = 0; i < currentPath.length; i++) {
      const a = currentPath[i];
      const b = level.optimalPath[i];
      if (a.x !== b.x || a.y !== b.y || a.level !== b.level) {
        matchesPrefix = false;
        break;
      }
    }
    if (matchesPrefix) {
      if (currentPath.length === level.optimalPath.length) return null;
      return {
        path: sliceToNextTarget(level.tiles, level.optimalPath, currentPath.length - 1),
        branchIndex: currentPath.length - 1,
      };
    }
  }

  // 2. Solve from current tip, or backtrack to the latest solvable branch point
  for (let k = currentPath.length; k >= 2; k--) {
    const prefix = currentPath.slice(0, k);
    const res = solveExactPar(
      level.tiles,
      level.start,
      level.exit,
      level.nodes,
      100000,
      prefix
    );
    if (res.solved && res.optimalPath.length > k) {
      return {
        path: sliceToNextTarget(level.tiles, res.optimalPath, k - 1),
        branchIndex: k - 1,
      };
    }
  }

  // 3. Fallback to precomputed optimalPath from Start (branchIndex = 0)
  if (level.optimalPath.length > 1) {
    return {
      path: sliceToNextTarget(level.tiles, level.optimalPath, 0),
      branchIndex: 0,
    };
  }

  return null;
}

export function createEmptyCustomGrid(): TileData[][] {
  const tiles: TileData[][] = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    const row: TileData[] = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      row.push({
        x,
        y,
        type: 'floor',
        feature: null,
      });
    }
    tiles.push(row);
  }
  tiles[3][1].feature = 'start';
  tiles[3][3].feature = 'node';
  tiles[3][3].nodeIndex = 0;
  tiles[3][5].feature = 'exit';
  return tiles;
}

export type CustomSolveResult =
  | {
      valid: true;
      level: PuzzleLevel;
      steps: number;
      dualBridgeCrossed: boolean;
    }
  | {
      valid: false;
      reason: string;
    };

export function solveCustomLevel(rawTiles: TileData[][], seedDate = getTodayDateISO()): CustomSolveResult {
  if (!Array.isArray(rawTiles) || rawTiles.length !== GRID_SIZE) {
    return { valid: false, reason: 'Grid must be 7x7.' };
  }

  let start: GridCoord | null = null;
  let exit: GridCoord | null = null;
  const nodes: Array<GridCoord & { index: number }> = [];
  const tiles: TileData[][] = [];

  for (let y = 0; y < GRID_SIZE; y++) {
    const srcRow = rawTiles[y];
    if (!Array.isArray(srcRow) || srcRow.length !== GRID_SIZE) {
      return { valid: false, reason: 'Grid row size must be 7.' };
    }
    const row: TileData[] = [];
    for (let x = 0; x < GRID_SIZE; x++) {
      const t = srcRow[x];
      const elev: ElevationLevel = t.type === 'platform' ? 1 : 0;
      const copy: TileData = {
        x,
        y,
        type: t.type,
        feature: t.feature ?? null,
        ...(t.type === 'ramp' ? { rampDir: t.rampDir ?? 'E' } : {}),
        ...(t.type === 'bridge' ? { bridgeAxis: t.bridgeAxis ?? 'x' } : {}),
      };

      if (copy.type === 'void' || copy.type === 'ramp' || copy.type === 'bridge') {
        if (copy.feature !== null) {
          copy.feature = null;
        }
      }

      if (copy.feature === 'start') {
        if (start) return { valid: false, reason: 'Only 1 Start tile is allowed.' };
        start = { x, y, level: elev };
      } else if (copy.feature === 'exit') {
        if (exit) return { valid: false, reason: 'Only 1 Exit tile is allowed.' };
        exit = { x, y, level: elev };
      } else if (copy.feature === 'node') {
        const idx = nodes.length;
        copy.nodeIndex = idx;
        nodes.push({ x, y, level: elev, index: idx });
      }
      row.push(copy);
    }
    tiles.push(row);
  }

  if (!start) return { valid: false, reason: 'Place a Start tile.' };
  if (!exit) return { valid: false, reason: 'Place an Exit tile.' };
  if (nodes.length === 0) return { valid: false, reason: 'Place at least 1 Energy Node.' };
  if (nodes.length > 5) return { valid: false, reason: 'Maximum 5 Energy Nodes allowed.' };

  const res = solveExactPar(tiles, start, exit, nodes, 120000, undefined, 20);
  if (!res.solved) {
    return { valid: false, reason: 'No valid path connects Start → all Nodes → Exit.' };
  }

  return {
    valid: true,
    steps: Math.max(1, res.optimalPath.length - 1),
    dualBridgeCrossed: res.dualBridgeCrossed,
    level: {
      seedDate,
      dayNumber: getDayNumber(seedDate),
      mode: 'standard',
      size: GRID_SIZE,
      tiles,
      start,
      exit,
      nodes,
      par: res.par,
      optimalPath: res.optimalPath,
    },
  };
}

export function generateBlitzStage(seedDate: string, stageIndex: number, rngSalt = 0): PuzzleLevel {
  const dayNumber = getDayNumber(seedDate);
  const blitzSeed = hashString(`GRIDLOCK::BLITZ::${seedDate}::${stageIndex}::${rngSalt}`);
  const rng = mulberry32(blitzSeed);

  for (let attempt = 0; attempt < 35; attempt++) {
    const cand = buildProceduralCandidate(rng, 'standard');
    if (!cand) continue;
    const res = solveExactPar(cand.tiles, cand.start, cand.exit, cand.nodes, 80000, undefined, 12);
    if (res.solved && res.par >= 3 && res.par <= 8) {
      return {
        seedDate,
        dayNumber,
        mode: 'blitz',
        size: GRID_SIZE,
        tiles: cand.tiles,
        start: cand.start,
        exit: cand.exit,
        nodes: cand.nodes,
        par: res.par,
        optimalPath: res.optimalPath,
      };
    }
  }

  const fb = buildGuaranteedFallback(rng);
  const res = solveExactPar(fb.tiles, fb.start, fb.exit, fb.nodes, 80000, undefined, 14);
  return {
    seedDate,
    dayNumber,
    mode: 'blitz',
    size: GRID_SIZE,
    tiles: fb.tiles,
    start: fb.start,
    exit: fb.exit,
    nodes: fb.nodes,
    par: res.solved ? res.par : 5,
    optimalPath: res.solved ? res.optimalPath : [],
  };
}
