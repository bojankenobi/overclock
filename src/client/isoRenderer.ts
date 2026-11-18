import { DIR_VECTORS, oppositeDir } from '../shared/levelGenerator';
import {
  Direction,
  ElevationLevel,
  EnergySurgeEffect,
  GameMode,
  GRID_SIZE,
  GridCoord,
  PathStep,
  PuzzleLevel,
  RippleEffect,
  SurgeParticle,
  TileData,
  ValidMove,
} from '../shared/types';

export interface IsoProjection {
  originX: number;
  originY: number;
  scale: number;
  elevH: number;
  slabThickness: number;
  gridSize: number;
  centerOffset: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

const THETA = (32 * Math.PI) / 180;
const SQUASH = 0.56;
const AX = Math.cos(THETA);
const AY = Math.sin(THETA) * SQUASH;
const BX = Math.cos(THETA + Math.PI / 2);
const BY = Math.sin(THETA + Math.PI / 2) * SQUASH;

export function computeProjection(
  width: number,
  height: number,
  gridSize: number = GRID_SIZE
): IsoProjection {
  const centerOffset = (gridSize - 1) / 2;
  // Compute normalized grid bounding box including CPU socket rim & pins
  const corners: Array<[number, number, number]> = [
    [-0.9, -0.9, 1.25],
    [gridSize - 0.1, -0.9, 1.25],
    [-0.9, gridSize - 0.1, 0],
    [gridSize - 0.1, gridSize - 0.1, 0],
    [gridSize - 0.1, gridSize - 0.1, -0.45],
    [-0.9, -0.9, -0.45],
  ];

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const elevFactor = 0.44;
  for (const [gx, gy, gz] of corners) {
    const ux = gx - centerOffset;
    const uy = gy - centerOffset;
    const sx = ux * AX + uy * BX;
    const sy = ux * AY + uy * BY - gz * elevFactor;
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const padX = Math.max(10, width * 0.035);
  const padY = Math.max(12, height * 0.04);
  const availW = Math.max(120, width - padX * 2);
  const availH = Math.max(120, height - padY * 2);

  const scale = Math.min(availW / spanX, availH / spanY);
  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;

  return {
    originX: width * 0.5 - centerX * scale,
    originY: height * 0.5 - centerY * scale,
    scale,
    elevH: scale * elevFactor,
    slabThickness: Math.max(11, Math.min(20, Math.round(scale * 0.24))),
    gridSize,
    centerOffset,
    ax: AX * scale,
    ay: AY * scale,
    bx: BX * scale,
    by: BY * scale,
  };
}

export function isoProject(
  gx: number,
  gy: number,
  gz: number,
  proj: IsoProjection
): { x: number; y: number } {
  const ux = gx - proj.centerOffset;
  const uy = gy - proj.centerOffset;
  return {
    x: proj.originX + ux * proj.ax + uy * proj.bx,
    y: proj.originY + ux * proj.ay + uy * proj.by - gz * proj.elevH,
  };
}

export function isoUnproject(
  sx: number,
  sy: number,
  gz: number,
  proj: IsoProjection
): { gx: number; gy: number } {
  const rx = sx - proj.originX;
  const ry = sy - proj.originY + gz * proj.elevH;
  const det = proj.ax * proj.by - proj.bx * proj.ay;
  const ux = (rx * proj.by - ry * proj.bx) / det;
  const uy = (proj.ax * ry - proj.ay * rx) / det;
  return { gx: ux + proj.centerOffset, gy: uy + proj.centerOffset };
}

/**
 * Picks a tile coordinate from screen pointer coordinates, prioritizing valid moves
 * and the previous step (for drag-to-undo) with magnetic snapping.
 */
export function pickTileFromPoint(
  px: number,
  py: number,
  proj: IsoProjection,
  level: PuzzleLevel,
  validMoves: ValidMove[],
  prevStep: PathStep | null,
  isDragging = false
): { x: number; y: number; level: ElevationLevel } | null {
  const snapRadius = isDragging ? 0.68 : 0.58;

  // 0. On tap (not dragging), allow direct tap on the Start anode to reset cleanly
  if (!isDragging) {
    const startTile = level.tiles[level.start.y]?.[level.start.x];
    if (startTile) {
      const sz = startTile.type === 'ramp' ? 0.5 : level.start.level;
      const sg = isoUnproject(px, py, sz, proj);
      if (Math.abs(sg.gx - level.start.x) <= 0.42 && Math.abs(sg.gy - level.start.y) <= 0.42) {
        return { x: level.start.x, y: level.start.y, level: level.start.level };
      }
    }
  }

  // 1. Check valid next moves first with magnetic snapping at their respective z-height
  let bestValid: { x: number; y: number; level: ElevationLevel; dist: number } | null = null;
  for (const vm of validMoves) {
    const tile = level.tiles[vm.y]?.[vm.x];
    if (!tile) continue;
    const z = tile.type === 'ramp' ? 0.5 : vm.level;
    const g = isoUnproject(px, py, z, proj);
    const dx = g.gx - vm.x;
    const dy = g.gy - vm.y;
    const dist = Math.hypot(dx, dy);
    if (Math.abs(dx) <= snapRadius && Math.abs(dy) <= snapRadius) {
      if (!bestValid || dist < bestValid.dist) {
        bestValid = { x: vm.x, y: vm.y, level: vm.level, dist };
      }
    }
  }
  if (bestValid) {
    return { x: bestValid.x, y: bestValid.y, level: bestValid.level };
  }

  // 2. Check previous step (for click-to-undo or drag-back-to-undo)
  if (prevStep) {
    const prevTile = level.tiles[prevStep.y]?.[prevStep.x];
    if (prevTile) {
      const z = prevTile.type === 'ramp' ? 0.5 : prevStep.level;
      const g = isoUnproject(px, py, z, proj);
      if (Math.abs(g.gx - prevStep.x) <= 0.52 && Math.abs(g.gy - prevStep.y) <= 0.52) {
        return { x: prevStep.x, y: prevStep.y, level: prevStep.level };
      }
    }
  }

  // 3. Direct elevation hit-testing (top-down: Level 1 -> Ramp 0.5 -> Level 0)
  for (const zTest of [1, 0.5, 0] as const) {
    const g = isoUnproject(px, py, zTest, proj);
    const tx = Math.round(g.gx);
    const ty = Math.round(g.gy);
    if (tx < 0 || tx >= proj.gridSize || ty < 0 || ty >= proj.gridSize) continue;
    const tile = level.tiles[ty][tx];
    if (tile.type === 'void') continue;
    if (Math.abs(g.gx - tx) <= 0.5 && Math.abs(g.gy - ty) <= 0.5) {
      if (zTest === 1 && (tile.type === 'platform' || tile.type === 'bridge')) {
        return { x: tx, y: ty, level: 1 };
      }
      if (zTest === 0.5 && tile.type === 'ramp') {
        return { x: tx, y: ty, level: 0 };
      }
      if (zTest === 0 && (tile.type === 'floor' || tile.type === 'bridge')) {
        return { x: tx, y: ty, level: 0 };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Drawing Helpers
// ---------------------------------------------------------------------------

function fillPoly(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  fill: string | CanvasGradient,
  stroke?: string,
  lineWidth = 1
) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

function getTileDiamond(
  cx: number,
  cy: number,
  z: number,
  halfSpan: number,
  proj: IsoProjection
) {
  return [
    isoProject(cx - halfSpan, cy - halfSpan, z, proj), // 0: Back (N-W)
    isoProject(cx + halfSpan, cy - halfSpan, z, proj), // 1: Right-ish (N-E)
    isoProject(cx + halfSpan, cy + halfSpan, z, proj), // 2: Front (S-E)
    isoProject(cx - halfSpan, cy + halfSpan, z, proj), // 3: Left-ish (S-W)
  ];
}

function drawExtrudedSlab(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  zTop: number,
  zBottom: number,
  halfSpan: number,
  proj: IsoProjection,
  colors: {
    top: string;
    leftFace: string;
    rightFace: string;
    topEdgeHighlight: string;
    outline: string;
  },
  extraBottomPx = 0
) {
  const top = getTileDiamond(cx, cy, zTop, halfSpan, proj);
  const bot = getTileDiamond(cx, cy, zBottom, halfSpan, proj).map((p) => ({
    x: p.x,
    y: p.y + extraBottomPx,
  }));

  // Left-front face (edge 3 -> 2)
  fillPoly(ctx, [top[3], top[2], bot[2], bot[3]], colors.leftFace, colors.outline, 0.75);
  // Right-front face (edge 1 -> 2)
  fillPoly(ctx, [top[1], top[2], bot[2], bot[1]], colors.rightFace, colors.outline, 0.75);
  // Top face
  fillPoly(ctx, top, colors.top, colors.outline, 0.9);

  // Subtle top-edge specular bevel (back-left & back-right upper edges)
  ctx.beginPath();
  ctx.moveTo(top[3].x, top[3].y);
  ctx.lineTo(top[0].x, top[0].y);
  ctx.lineTo(top[1].x, top[1].y);
  ctx.strokeStyle = colors.topEdgeHighlight;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function withClippedPoly(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  drawFn: () => void
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.clip();
  drawFn();
  ctx.restore();
}

function drawBridgeStripesPattern(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  z: number,
  deckHalfX: number,
  deckHalfY: number,
  topPoly: Array<{ x: number; y: number }>,
  proj: IsoProjection
) {
  withClippedPoly(ctx, topPoly, () => {
    // High-contrast diagonal stripes across the bridge deck in isometric grid space
    const step = 0.24;
    const stripeW = Math.max(2.6, proj.scale * 0.072);
    ctx.strokeStyle = 'rgba(241, 245, 249, 0.72)';
    ctx.lineWidth = stripeW;
    ctx.lineCap = 'butt';

    ctx.beginPath();
    for (let d = -1.2; d <= 1.2; d += step) {
      // Lines u + v = d inside [-deckHalfX..deckHalfX] x [-deckHalfY..deckHalfY]
      const u1 = Math.max(-deckHalfX - 0.1, d - deckHalfY - 0.1);
      const v1 = d - u1;
      const u2 = Math.min(deckHalfX + 0.1, d + deckHalfY + 0.1);
      const v2 = d - u2;
      const p1 = isoProject(cx + u1, cy + v1, z, proj);
      const p2 = isoProject(cx + u2, cy + v2, z, proj);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();
  });

  // Crisp high-contrast border around the striped bridge deck
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(topPoly[0].x, topPoly[0].y);
  for (let i = 1; i < topPoly.length; i++) ctx.lineTo(topPoly[i].x, topPoly[i].y);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.9)';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();
}

function drawNodeDotsPattern(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  z: number,
  halfSpan: number,
  proj: IsoProjection,
  isCollected: boolean
) {
  const topPoly = getTileDiamond(cx, cy, z, halfSpan, proj);
  // Darken tile base slightly for crisp dot contrast
  fillPoly(
    ctx,
    topPoly,
    isCollected ? 'rgba(15, 23, 42, 0.65)' : 'rgba(20, 14, 4, 0.72)',
    isCollected ? 'rgba(226, 232, 240, 0.6)' : '#FDE68A',
    1.6
  );

  withClippedPoly(ctx, topPoly, () => {
    const offsets = [-0.28, 0, 0.28];
    const rx = Math.max(2.2, proj.scale * 0.058);
    const ry = rx * 0.56;

    for (const ox of offsets) {
      for (const oy of offsets) {
        // Skip very center dot so the floating crystal / collected socket stays unobstructed
        if (ox === 0 && oy === 0) continue;
        const pt = isoProject(cx + ox, cy + oy, z + 0.005, proj);
        ctx.beginPath();
        ctx.ellipse(pt.x, pt.y, rx, ry, 0, 0, Math.PI * 2);
        if (isCollected) {
          ctx.strokeStyle = 'rgba(226, 232, 240, 0.58)';
          ctx.lineWidth = 1.25;
          ctx.stroke();
        } else {
          ctx.fillStyle = '#FEF3C7';
          ctx.fill();
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    }
  });
}

function drawExitCrosshatchPattern(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  z: number,
  halfSpan: number,
  proj: IsoProjection,
  isUnlocked: boolean
) {
  const topPoly = getTileDiamond(cx, cy, z, halfSpan, proj);
  fillPoly(
    ctx,
    topPoly,
    isUnlocked ? 'rgba(4, 34, 24, 0.85)' : 'rgba(15, 23, 42, 0.82)',
    isUnlocked ? '#FFFFFF' : '#CBD5E1',
    isUnlocked ? 2.0 : 1.5
  );

  withClippedPoly(ctx, topPoly, () => {
    const span = halfSpan + 0.04;
    const steps = [-0.3, -0.15, 0, 0.15, 0.3];
    ctx.strokeStyle = isUnlocked ? 'rgba(236, 253, 245, 0.82)' : 'rgba(203, 213, 225, 0.52)';
    ctx.lineWidth = Math.max(1.25, proj.scale * 0.028);

    ctx.beginPath();
    for (const s of steps) {
      // Crosshatch family 1 (parallel to Y axis)
      const a1 = isoProject(cx + s, cy - span, z + 0.004, proj);
      const a2 = isoProject(cx + s, cy + span, z + 0.004, proj);
      ctx.moveTo(a1.x, a1.y);
      ctx.lineTo(a2.x, a2.y);

      // Crosshatch family 2 (parallel to X axis)
      const b1 = isoProject(cx - span, cy + s, z + 0.004, proj);
      const b2 = isoProject(cx + span, cy + s, z + 0.004, proj);
      ctx.moveTo(b1.x, b1.y);
      ctx.lineTo(b2.x, b2.y);
    }
    ctx.stroke();
  });
}

function drawRampBlock(
  ctx: CanvasRenderingContext2D,
  tile: TileData,
  proj: IsoProjection,
  isHighlighted: boolean
) {
  const { x: cx, y: cy, rampDir } = tile;
  if (!rampDir) return;

  const h = 0.46;
  // Determine z height for each of the 4 corners based on rampDir
  // Corner 0: (-h, -h), 1: (+h, -h), 2: (+h, +h), 3: (-h, +h)
  const cornerCoords: Array<[number, number]> = [
    [-h, -h],
    [h, -h],
    [h, h],
    [-h, h],
  ];

  const { dx, dy } = DIR_VECTORS[rampDir];
  const cornerZ = cornerCoords.map(([ox, oy]) => {
    const dot = ox * dx + oy * dy; // +h on high side, -h on low side
    return dot > 0 ? 1 : 0;
  });

  const topPts = cornerCoords.map(([ox, oy], i) =>
    isoProject(cx + ox, cy + oy, cornerZ[i], proj)
  );
  const botPts = cornerCoords.map(([ox, oy]) => {
    const p = isoProject(cx + ox, cy + oy, 0, proj);
    return { x: p.x, y: p.y + proj.slabThickness };
  });

  // Base floor slab underneath ramp
  drawExtrudedSlab(
    ctx,
    cx,
    cy,
    0,
    0,
    h,
    proj,
    {
      top: '#121823',
      leftFace: '#0D111A',
      rightFace: '#090C13',
      topEdgeHighlight: 'rgba(148,163,184,0.12)',
      outline: 'rgba(15,23,42,0.8)',
    },
    proj.slabThickness
  );

  // Left-front side wall (3 -> 2)
  fillPoly(
    ctx,
    [topPts[3], topPts[2], botPts[2], botPts[3]],
    '#141D2D',
    'rgba(30,41,59,0.6)',
    0.8
  );
  // Right-front side wall (1 -> 2)
  fillPoly(
    ctx,
    [topPts[1], topPts[2], botPts[2], botPts[1]],
    '#0E1521',
    'rgba(30,41,59,0.6)',
    0.8
  );

  // Sloped top surface
  const topGrad = ctx.createLinearGradient(
    topPts[0].x,
    topPts[0].y,
    topPts[2].x,
    topPts[2].y
  );
  if (isHighlighted) {
    topGrad.addColorStop(0, '#22314A');
    topGrad.addColorStop(1, '#192436');
  } else {
    topGrad.addColorStop(0, '#1D273A');
    topGrad.addColorStop(1, '#151D2B');
  }
  fillPoly(ctx, topPts, topGrad, 'rgba(148, 163, 184, 0.2)', 1);

  // Ascending chevron stripes on ramp surface
  ctx.save();
  for (const frac of [0.3, 0.55, 0.78]) {
    const t = frac - 0.5;
    const px = -dy;
    const py = dx;
    const tipZ = frac;
    const wingZ = Math.max(0, frac - 0.14);
    const tip = isoProject(cx + dx * (t + 0.08), cy + dy * (t + 0.08), tipZ + 0.01, proj);
    const left = isoProject(
      cx + dx * (t - 0.06) + px * 0.18,
      cy + dy * (t - 0.06) + py * 0.18,
      wingZ + 0.01,
      proj
    );
    const right = isoProject(
      cx + dx * (t - 0.06) - px * 0.18,
      cy + dy * (t - 0.06) - py * 0.18,
      wingZ + 0.01,
      proj
    );

    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(right.x, right.y);
    ctx.strokeStyle = isHighlighted ? 'rgba(0, 240, 255, 0.65)' : 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = Math.max(1.5, proj.scale * 0.035);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

function drawBridgeOverpass(
  ctx: CanvasRenderingContext2D,
  tile: TileData,
  proj: IsoProjection,
  isHighlightedTop: boolean,
  highContrast = false
) {
  const { x: cx, y: cy, bridgeAxis } = tile;
  if (!bridgeAxis) return;

  const h = 0.46;
  const deckBottomZ = 0.78;
  const deckTopZ = 1.0;

  // Draw supporting side piers on perpendicular sides so underpass arch is clearly open!
  const pierSize = 0.11;
  const pierOffsets: Array<[number, number]> =
    bridgeAxis === 'x'
      ? [
          [0, -h + pierSize],
          [0, h - pierSize],
        ]
      : [
          [-h + pierSize, 0],
          [h - pierSize, 0],
        ];

  // Sort back pier before front pier
  pierOffsets.sort((a, b) => a[0] * AY + a[1] * BY - (b[0] * AY + b[1] * BY));

  for (const [ox, oy] of pierOffsets) {
    drawExtrudedSlab(
      ctx,
      cx + ox,
      cy + oy,
      deckBottomZ,
      0,
      pierSize,
      proj,
      {
        top: highContrast ? '#273549' : '#1A2232',
        leftFace: '#141B29',
        rightFace: '#0E131E',
        topEdgeHighlight: highContrast ? 'rgba(241, 245, 249, 0.55)' : 'rgba(148,163,184,0.18)',
        outline: highContrast ? 'rgba(226, 232, 240, 0.45)' : 'rgba(15,23,42,0.85)',
      },
      0
    );
  }

  // Draw suspended bridge deck
  const deckHalfX = bridgeAxis === 'x' ? h : 0.43;
  const deckHalfY = bridgeAxis === 'y' ? h : 0.43;

  const top = [
    isoProject(cx - deckHalfX, cy - deckHalfY, deckTopZ, proj),
    isoProject(cx + deckHalfX, cy - deckHalfY, deckTopZ, proj),
    isoProject(cx + deckHalfX, cy + deckHalfY, deckTopZ, proj),
    isoProject(cx - deckHalfX, cy + deckHalfY, deckTopZ, proj),
  ];
  const bot = [
    isoProject(cx - deckHalfX, cy - deckHalfY, deckBottomZ, proj),
    isoProject(cx + deckHalfX, cy - deckHalfY, deckBottomZ, proj),
    isoProject(cx + deckHalfX, cy + deckHalfY, deckBottomZ, proj),
    isoProject(cx - deckHalfX, cy + deckHalfY, deckBottomZ, proj),
  ];

  fillPoly(
    ctx,
    [top[3], top[2], bot[2], bot[3]],
    highContrast ? '#1E293B' : '#172030',
    highContrast ? 'rgba(226, 232, 240, 0.55)' : 'rgba(30,41,59,0.8)',
    0.9
  );
  fillPoly(
    ctx,
    [top[1], top[2], bot[2], bot[1]],
    highContrast ? '#111827' : '#111826',
    highContrast ? 'rgba(226, 232, 240, 0.55)' : 'rgba(30,41,59,0.8)',
    0.9
  );
  fillPoly(
    ctx,
    top,
    highContrast
      ? isHighlightedTop
        ? '#1E293B'
        : '#0F172A'
      : isHighlightedTop
        ? '#243248'
        : '#1E283B',
    highContrast ? 'rgba(248, 250, 252, 0.85)' : 'rgba(148, 163, 184, 0.25)',
    highContrast ? 1.4 : 1
  );

  if (highContrast) {
    drawBridgeStripesPattern(ctx, cx, cy, deckTopZ + 0.004, deckHalfX, deckHalfY, top, proj);
  }

  // Subtle bridge deck edge rails along bridgeAxis
  ctx.save();
  ctx.strokeStyle = highContrast ? '#FFFFFF' : 'rgba(0, 240, 255, 0.22)';
  ctx.lineWidth = highContrast ? Math.max(1.8, proj.scale * 0.038) : Math.max(1.2, proj.scale * 0.025);
  if (bridgeAxis === 'x') {
    const r1a = isoProject(cx - deckHalfX + 0.05, cy - deckHalfY + 0.06, deckTopZ + 0.01, proj);
    const r1b = isoProject(cx + deckHalfX - 0.05, cy - deckHalfY + 0.06, deckTopZ + 0.01, proj);
    const r2a = isoProject(cx - deckHalfX + 0.05, cy + deckHalfY - 0.06, deckTopZ + 0.01, proj);
    const r2b = isoProject(cx + deckHalfX - 0.05, cy + deckHalfY - 0.06, deckTopZ + 0.01, proj);
    ctx.beginPath();
    ctx.moveTo(r1a.x, r1a.y);
    ctx.lineTo(r1b.x, r1b.y);
    ctx.moveTo(r2a.x, r2a.y);
    ctx.lineTo(r2b.x, r2b.y);
    ctx.stroke();
  } else {
    const r1a = isoProject(cx - deckHalfX + 0.06, cy - deckHalfY + 0.05, deckTopZ + 0.01, proj);
    const r1b = isoProject(cx - deckHalfX + 0.06, cy + deckHalfY - 0.05, deckTopZ + 0.01, proj);
    const r2a = isoProject(cx + deckHalfX - 0.06, cy - deckHalfY + 0.05, deckTopZ + 0.01, proj);
    const r2b = isoProject(cx + deckHalfX - 0.06, cy + deckHalfY - 0.05, deckTopZ + 0.01, proj);
    ctx.beginPath();
    ctx.moveTo(r1a.x, r1a.y);
    ctx.lineTo(r1b.x, r1b.y);
    ctx.moveTo(r2a.x, r2a.y);
    ctx.lineTo(r2b.x, r2b.y);
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Light Trail & Features Rendering
// ---------------------------------------------------------------------------

function getStepCenterZ(tile: TileData, level: ElevationLevel): number {
  if (tile.type === 'ramp') return 0.5;
  return level;
}

function getEdgeMidpointZ(
  tile: TileData,
  level: ElevationLevel,
  dir: Direction
): number {
  if (tile.type === 'ramp') {
    return dir === tile.rampDir ? 1 : 0;
  }
  return level;
}

function drawGlowingRibbon(
  ctx: CanvasRenderingContext2D,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  proj: IsoProjection,
  alpha = 1,
  highContrast = false,
  themeColor = '#00F0FF'
) {
  const coreW = Math.max(2.6, proj.scale * 0.085);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = alpha;

  if (highContrast) {
    // High-contrast dark isolation casing so the trail pops cleanly over striped/dotted/crosshatched tiles
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = 'rgba(2, 6, 23, 0.92)';
    ctx.lineWidth = coreW * 2.9;
    ctx.stroke();
  } else {
    // Outer bloom
    ctx.save();
    ctx.globalAlpha = alpha * 0.28;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = coreW * 2.7;
    ctx.stroke();
    ctx.restore();
  }

  // Mid themed beam
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.strokeStyle = themeColor;
  ctx.lineWidth = highContrast ? coreW * 1.25 : coreW;
  ctx.stroke();

  // Crisp inner filament
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.strokeStyle = highContrast ? '#FFFFFF' : '#E0FFFF';
  ctx.lineWidth = Math.max(1.4, coreW * (highContrast ? 0.55 : 0.36));
  ctx.stroke();

  ctx.restore();
}

function drawVertexPylon(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  z: number,
  proj: IsoProjection,
  pulseIntensity = 0
) {
  const base = isoProject(cx, cy, z, proj);
  const h = Math.max(7, proj.scale * 0.17);
  const r = Math.max(3.5, proj.scale * 0.085);

  ctx.save();
  // Base shadow ring
  ctx.beginPath();
  ctx.ellipse(base.x, base.y, r * (1.45 + pulseIntensity * 0.35), r * (0.85 + pulseIntensity * 0.2), 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0, 240, 255, ${0.25 + pulseIntensity * 0.3})`;
  ctx.fill();

  // Pylon post
  ctx.beginPath();
  ctx.moveTo(base.x - r * 0.65, base.y);
  ctx.lineTo(base.x - r * 0.4, base.y - h);
  ctx.lineTo(base.x + r * 0.4, base.y - h);
  ctx.lineTo(base.x + r * 0.65, base.y);
  ctx.closePath();
  ctx.fillStyle = '#0F172A';
  ctx.strokeStyle = pulseIntensity > 0.45 ? '#A7F3D0' : '#00F0FF';
  ctx.lineWidth = 1.2 + pulseIntensity * 0.5;
  ctx.fill();
  ctx.stroke();

  // Glowing top cap
  ctx.beginPath();
  ctx.arc(base.x, base.y - h, r * (0.52 + pulseIntensity * 0.22), 0, Math.PI * 2);
  ctx.fillStyle = pulseIntensity > 0.5 ? '#FFFFFF' : '#E0FFFF';
  ctx.shadowColor = pulseIntensity > 0.5 ? '#00FF88' : '#00F0FF';
  ctx.shadowBlur = 10 + pulseIntensity * 8;
  ctx.fill();
  ctx.restore();
}

function evalCircuitWave(u: number, now: number): number {
  const waveSpacing = 3.8;
  const phase = ((u - now * 0.0052) / waveSpacing) * Math.PI * 2;
  const primary = Math.pow(0.5 + 0.5 * Math.cos(phase), 5);
  const secondary = Math.pow(0.5 + 0.5 * Math.cos(phase * 1.5 - 1.1), 4) * 0.38;
  return Math.min(1, primary + secondary);
}

function drawElectricityHalfSegment(
  ctx: CanvasRenderingContext2D,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  u1: number,
  u2: number,
  pathLen: number,
  proj: IsoProjection,
  now: number,
  highContrast: boolean
) {
  const coreW = Math.max(2.6, proj.scale * 0.085);
  const w1 = evalCircuitWave(u1, now);
  const wMid = evalCircuitWave((u1 + u2) * 0.5, now);
  const w2 = evalCircuitWave(u2, now);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 1. Pulsing outer energy bloom along the completed circuit
  const bloomGrad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
  bloomGrad.addColorStop(0, `rgba(0, 255, 196, ${0.14 + w1 * 0.42})`);
  bloomGrad.addColorStop(0.5, `rgba(0, 255, 160, ${0.14 + wMid * 0.46})`);
  bloomGrad.addColorStop(1, `rgba(0, 255, 196, ${0.14 + w2 * 0.42})`);

  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.strokeStyle = bloomGrad;
  ctx.lineWidth = coreW * (2.6 + wMid * 1.1);
  ctx.stroke();

  // 2. Flowing electric filament core gradient
  const coreGrad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
  coreGrad.addColorStop(0, `rgba(255, 255, 255, ${0.22 + w1 * 0.78})`);
  coreGrad.addColorStop(0.5, `rgba(224, 255, 250, ${0.22 + wMid * 0.78})`);
  coreGrad.addColorStop(1, `rgba(255, 255, 255, ${0.22 + w2 * 0.78})`);

  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.strokeStyle = coreGrad;
  ctx.lineWidth = Math.max(1.4, coreW * (highContrast ? 0.65 : 0.48 + wMid * 0.28));
  ctx.stroke();

  // 3. Subtle electric micro-arc shimmer when surge peak passes through this segment
  if (wMid > 0.42) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      const nx = -dy / len;
      const ny = dx / len;
      const jitter =
        Math.sin(now * 0.034 + u1 * 19.7) * Math.min(2.3, proj.scale * 0.042) * wMid;
      const mx = (p1.x + p2.x) * 0.5 + nx * jitter;
      const my = (p1.y + p2.y) * 0.5 + ny * jitter;

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(mx, my);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = `rgba(236, 253, 245, ${(wMid - 0.35) * 0.9})`;
      ctx.lineWidth = Math.max(1, coreW * 0.24);
      ctx.stroke();
    }
  }

  // 4. Traveling electric charge pulses gliding from Start to Exit
  const totalSpan = Math.max(1, pathLen - 1);
  const packetCount = Math.max(2, Math.round(totalSpan / 4.2));
  const headBase = now * 0.0052;
  for (let k = 0; k < packetCount; k++) {
    const packetU = (headBase + (k / packetCount) * totalSpan) % totalSpan;
    if (packetU >= u1 && packetU <= u2 && u2 > u1) {
      const frac = (packetU - u1) / (u2 - u1);
      const px = p1.x + (p2.x - p1.x) * frac;
      const py = p1.y + (p2.y - p1.y) * frac;
      const orbR = Math.max(2.2, proj.scale * 0.062);

      ctx.beginPath();
      ctx.arc(px, py, orbR * 2.1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 255, 160, 0.35)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, py, orbR, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.shadowColor = '#00F0FF';
      ctx.shadowBlur = 10;
      ctx.fill();
    }
  }

  ctx.restore();
}

interface OrbAnimState {
  gx: number;
  gy: number;
  gz: number;
  lastTime: number;
  levelKey: string;
}

const orbAnim: OrbAnimState = {
  gx: 0,
  gy: 0,
  gz: 0,
  lastTime: 0,
  levelKey: '',
};

function updateOrbAnimState(level: PuzzleLevel, path: PathStep[], now: number): { gx: number; gy: number; gz: number } {
  const tip = path[path.length - 1] ?? level.start;
  const tipTile = level.tiles[tip.y]?.[tip.x];
  const targetZ = tipTile ? getStepCenterZ(tipTile, tip.level) : 0;
  const key = `${level.seedDate}::${level.mode}::${level.par}::${level.start.x},${level.start.y}`;

  const dist = Math.hypot(tip.x - orbAnim.gx, tip.y - orbAnim.gy);
  if (orbAnim.levelKey !== key || orbAnim.lastTime === 0 || (path.length === 1 && dist > 1.8)) {
    orbAnim.gx = tip.x;
    orbAnim.gy = tip.y;
    orbAnim.gz = targetZ;
    orbAnim.lastTime = now;
    orbAnim.levelKey = key;
    return { gx: orbAnim.gx, gy: orbAnim.gy, gz: orbAnim.gz };
  }

  const dt = Math.min(64, Math.max(0, now - orbAnim.lastTime));
  orbAnim.lastTime = now;
  const alpha = 1 - Math.exp(-dt * 0.022);
  orbAnim.gx += (tip.x - orbAnim.gx) * alpha;
  orbAnim.gy += (tip.y - orbAnim.gy) * alpha;
  orbAnim.gz += (targetZ - orbAnim.gz) * alpha;

  return { gx: orbAnim.gx, gy: orbAnim.gy, gz: orbAnim.gz };
}

function drawCellTrail(
  ctx: CanvasRenderingContext2D,
  cellX: number,
  cellY: number,
  targetLevel: ElevationLevel,
  tiles: TileData[][],
  path: PathStep[],
  proj: IsoProjection,
  highContrast = false,
  isSolvedCircuit = false,
  now = 0,
  isOverclock = false,
  themeColor = '#00F0FF',
  orbPos?: { gx: number; gy: number; gz: number }
) {
  const tile = tiles[cellY][cellX];
  const centerZ = getStepCenterZ(tile, targetLevel);
  const centerPt = isoProject(cellX, cellY, centerZ, proj);

  for (let i = 0; i < path.length; i++) {
    const step = path[i];
    if (step.x !== cellX || step.y !== cellY || step.level !== targetLevel) continue;

    const segAlpha = isOverclock
      ? 0.2 + 0.8 * (i / Math.max(1, path.length - 1))
      : 1;

    // Incoming half-segment from previous step
    if (i > 0 && step.dirFromPrev) {
      const inDir = oppositeDir(step.dirFromPrev);
      const { dx, dy } = DIR_VECTORS[inDir];
      const edgeZ = getEdgeMidpointZ(tile, targetLevel, inDir);
      const edgePt = isoProject(cellX + dx * 0.5, cellY + dy * 0.5, edgeZ, proj);
      drawGlowingRibbon(ctx, edgePt, centerPt, proj, segAlpha, highContrast, themeColor);
      if (isSolvedCircuit) {
        drawElectricityHalfSegment(
          ctx,
          edgePt,
          centerPt,
          i - 0.5,
          i,
          path.length,
          proj,
          now,
          highContrast
        );
      }
    }

    // Outgoing half-segment to next step
    if (i < path.length - 1) {
      const next = path[i + 1];
      if (next.dirFromPrev) {
        const outDir = next.dirFromPrev;
        const { dx, dy } = DIR_VECTORS[outDir];
        const edgeZ = getEdgeMidpointZ(tile, targetLevel, outDir);
        const edgePt = isoProject(cellX + dx * 0.5, cellY + dy * 0.5, edgeZ, proj);
        drawGlowingRibbon(ctx, centerPt, edgePt, proj, segAlpha, highContrast, themeColor);
        if (isSolvedCircuit) {
          drawElectricityHalfSegment(
            ctx,
            centerPt,
            edgePt,
            i,
            i + 0.5,
            path.length,
            proj,
            now,
            highContrast
          );
        }
      }

      // 90-degree turn pylon if next step caused a turn at this vertex (hidden in Overclock wake)
      if (!isOverclock && next.causedTurnAtPrev) {
        const pylonPulse = isSolvedCircuit ? evalCircuitWave(i, now) : 0;
        drawVertexPylon(ctx, cellX, cellY, centerZ, proj, pylonPulse);
      }
    }

    // Active 2.5D hovering Light-Core orb if this is the tip of the path
    if (i === path.length - 1) {
      const activeColor = isSolvedCircuit ? '#00FF88' : themeColor;
      const pulse = isSolvedCircuit ? 0.5 + 0.5 * Math.sin(now * 0.008) : 0.5 + 0.5 * Math.sin(now * 0.004);
      const bob = Math.sin(now * 0.0045) * 0.04;
      const ox = orbPos ? orbPos.gx : cellX;
      const oy = orbPos ? orbPos.gy : cellY;
      const oz = orbPos ? orbPos.gz : centerZ;
      const groundPt = isoProject(ox, oy, oz, proj);
      const orbPt = isoProject(ox, oy, oz + 0.15 + bob, proj);
      const r = Math.max(5.5, proj.scale * (0.145 + pulse * 0.014));

      ctx.save();

      // 1. Isometric ground contact shadow + pulsing anchor ring on tile surface
      ctx.beginPath();
      ctx.ellipse(groundPt.x, groundPt.y, r * 1.15, r * 0.64, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(2, 6, 14, 0.58)';
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(groundPt.x, groundPt.y, r * (1.45 + pulse * 0.25), r * (0.81 + pulse * 0.14), 0, 0, Math.PI * 2);
      ctx.strokeStyle = activeColor;
      ctx.globalAlpha = 0.42 + pulse * 0.25;
      ctx.lineWidth = 1.4;
      ctx.stroke();

      // Vertical energy tether from surface to hovering core
      ctx.beginPath();
      ctx.moveTo(groundPt.x, groundPt.y);
      ctx.lineTo(orbPt.x, orbPt.y);
      ctx.strokeStyle = activeColor;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = Math.max(1.2, r * 0.22);
      ctx.stroke();

      // 2. Outer atmospheric halo around the 2.5D sphere
      ctx.globalAlpha = 0.24 + pulse * 0.12;
      ctx.beginPath();
      ctx.arc(orbPt.x, orbPt.y, r * 2.15, 0, Math.PI * 2);
      ctx.fillStyle = activeColor;
      ctx.fill();

      // 3. Back half of tilted isometric gyro ring
      const spin = now * 0.0032;
      const ringRx = r * 1.62;
      const ringRy = r * 0.62;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(orbPt.x, orbPt.y, ringRx, ringRy, -0.22, Math.PI, Math.PI * 2);
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // 4. Volumetric 3D shaded sphere (specular highlight top-left, deep rim bottom-right)
      ctx.globalAlpha = 1;
      const grad = ctx.createRadialGradient(
        orbPt.x - r * 0.34,
        orbPt.y - r * 0.36,
        r * 0.12,
        orbPt.x,
        orbPt.y,
        r
      );
      grad.addColorStop(0, '#FFFFFF');
      grad.addColorStop(0.38, activeColor);
      grad.addColorStop(1, '#09111E');

      ctx.beginPath();
      ctx.arc(orbPt.x, orbPt.y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.shadowColor = activeColor;
      ctx.shadowBlur = 16 + pulse * 6;
      ctx.fill();

      // Crisp specular rim
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 0.9;
      ctx.stroke();

      // 5. Front half of tilted isometric gyro ring + orbiting satellite sparks
      ctx.beginPath();
      ctx.ellipse(orbPt.x, orbPt.y, ringRx, ringRy, -0.22, 0, Math.PI);
      ctx.strokeStyle = '#FFFFFF';
      ctx.globalAlpha = 0.72;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      for (let k = 0; k < 2; k++) {
        const ang = spin + k * Math.PI;
        const cosR = Math.cos(-0.22);
        const sinR = Math.sin(-0.22);
        const lx = Math.cos(ang) * ringRx;
        const ly = Math.sin(ang) * ringRy;
        const sx = orbPt.x + lx * cosR - ly * sinR;
        const sy = orbPt.y + lx * sinR + ly * cosR;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(1.6, r * 0.2), 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF';
        ctx.globalAlpha = Math.sin(ang) >= 0 ? 0.95 : 0.45;
        ctx.fill();
      }

      ctx.restore();
    }
  }
}

function stepDir(a: GridCoord, b: GridCoord): Direction | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 1 && dy === 0) return 'E';
  if (dx === -1 && dy === 0) return 'W';
  if (dx === 0 && dy === 1) return 'S';
  if (dx === 0 && dy === -1) return 'N';
  return null;
}

function drawGhostedRibbon(
  ctx: CanvasRenderingContext2D,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  proj: IsoProjection,
  now: number
) {
  const coreW = Math.max(2, proj.scale * 0.06);
  const pulse = 0.7 + 0.3 * Math.sin(now * 0.005);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Soft ghosted aura
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.strokeStyle = `rgba(186, 230, 253, ${0.18 * pulse})`;
  ctx.lineWidth = coreW * 2.6;
  ctx.stroke();

  // Animated dashed holographic filament
  ctx.setLineDash([4, 5]);
  ctx.lineDashOffset = -(now * 0.025);
  ctx.beginPath();
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.strokeStyle = `rgba(224, 242, 254, ${0.75 * pulse})`;
  ctx.lineWidth = coreW;
  ctx.stroke();
  ctx.restore();
}

function drawCellHintTrail(
  ctx: CanvasRenderingContext2D,
  cellX: number,
  cellY: number,
  targetLevel: ElevationLevel,
  tiles: TileData[][],
  hintPath: GridCoord[] | null,
  proj: IsoProjection,
  now: number
) {
  if (!hintPath || hintPath.length < 2) return;
  const tile = tiles[cellY][cellX];
  const centerZ = getStepCenterZ(tile, targetLevel);
  const centerPt = isoProject(cellX, cellY, centerZ, proj);

  for (let i = 0; i < hintPath.length; i++) {
    const step = hintPath[i];
    if (step.x !== cellX || step.y !== cellY || step.level !== targetLevel) continue;

    if (i > 0) {
      const dirFromPrev = stepDir(hintPath[i - 1], step);
      if (dirFromPrev) {
        const inDir = oppositeDir(dirFromPrev);
        const { dx, dy } = DIR_VECTORS[inDir];
        const edgeZ = getEdgeMidpointZ(tile, targetLevel, inDir);
        const edgePt = isoProject(cellX + dx * 0.5, cellY + dy * 0.5, edgeZ, proj);
        drawGhostedRibbon(ctx, edgePt, centerPt, proj, now);
      }
    }

    if (i < hintPath.length - 1) {
      const outDir = stepDir(step, hintPath[i + 1]);
      if (outDir) {
        const { dx, dy } = DIR_VECTORS[outDir];
        const edgeZ = getEdgeMidpointZ(tile, targetLevel, outDir);
        const edgePt = isoProject(cellX + dx * 0.5, cellY + dy * 0.5, edgeZ, proj);
        drawGhostedRibbon(ctx, centerPt, edgePt, proj, now);
      }

      // Subtle ghost turn marker at corners
      if (i > 0) {
        const prevDir = stepDir(hintPath[i - 1], step);
        if (prevDir && outDir && prevDir !== outDir) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(centerPt.x, centerPt.y, Math.max(2.6, proj.scale * 0.06), 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(224, 242, 254, 0.85)';
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }
}

function drawTileFeature(
  ctx: CanvasRenderingContext2D,
  tile: TileData,
  z: number,
  proj: IsoProjection,
  now: number,
  isNodeCollected: boolean,
  isExitUnlocked: boolean,
  canTapStartReset = false,
  highContrast = false
) {
  if (!tile.feature) return;
  const center = isoProject(tile.x, tile.y, z, proj);

  if (tile.feature === 'start') {
    const r = Math.max(6, proj.scale * 0.19);
    ctx.save();
    if (canTapStartReset) {
      const pulse = 0.45 + 0.25 * Math.sin(now * 0.004);
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, r * 1.7, r * 0.96, 0, 0, Math.PI * 2);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = highContrast
        ? `rgba(255, 255, 255, ${Math.min(1, pulse + 0.25)})`
        : `rgba(0, 240, 255, ${pulse})`;
      ctx.lineWidth = highContrast ? 1.8 : 1.4;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, r * 1.25, r * 0.7, 0, 0, Math.PI * 2);
    ctx.strokeStyle = highContrast ? '#FFFFFF' : '#00F0FF';
    ctx.lineWidth = highContrast ? 2.4 : 1.8;
    ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(center.x, center.y, r * 0.55, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = highContrast ? '#FFFFFF' : '#00F0FF';
    ctx.fill();
    ctx.restore();
  } else if (tile.feature === 'node') {
    if (isNodeCollected) {
      // Collected socket ring
      const r = Math.max(5, proj.scale * 0.16);
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, r * 1.15, r * 0.65, 0, 0, Math.PI * 2);
      ctx.strokeStyle = highContrast ? '#FFFFFF' : 'rgba(255, 184, 0, 0.65)';
      ctx.lineWidth = highContrast ? 2.2 : 1.6;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, r * 0.42, r * 0.24, 0, 0, Math.PI * 2);
      ctx.fillStyle = highContrast ? '#FDE68A' : 'rgba(255, 184, 0, 0.85)';
      ctx.fill();
      ctx.restore();
    } else {
      // Floating amber octahedral energy crystal
      const bob = Math.sin(now * 0.004 + tile.x * 1.3 + tile.y) * (proj.scale * 0.045);
      const lift = proj.scale * 0.22 + bob;
      const r = Math.max(5.5, proj.scale * 0.14);

      ctx.save();
      // Ground amber aura
      const grad = ctx.createRadialGradient(
        center.x,
        center.y,
        0,
        center.x,
        center.y,
        proj.scale * 0.36
      );
      grad.addColorStop(0, 'rgba(255, 184, 0, 0.38)');
      grad.addColorStop(1, 'rgba(255, 184, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, proj.scale * 0.36, proj.scale * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();

      // Crystal diamond body
      const cy = center.y - lift;
      ctx.shadowColor = '#FFB800';
      ctx.shadowBlur = 14;

      // Left facet
      ctx.beginPath();
      ctx.moveTo(center.x, cy - r * 1.25);
      ctx.lineTo(center.x - r * 0.78, cy);
      ctx.lineTo(center.x, cy + r * 1.05);
      ctx.closePath();
      ctx.fillStyle = '#FFD147';
      ctx.fill();

      // Right facet
      ctx.beginPath();
      ctx.moveTo(center.x, cy - r * 1.25);
      ctx.lineTo(center.x + r * 0.78, cy);
      ctx.lineTo(center.x, cy + r * 1.05);
      ctx.closePath();
      ctx.fillStyle = '#E59400';
      ctx.fill();

      if (highContrast) {
        // High-contrast crisp white silhouette + dot emblem inside crystal
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.moveTo(center.x, cy - r * 1.25);
        ctx.lineTo(center.x + r * 0.78, cy);
        ctx.lineTo(center.x, cy + r * 1.05);
        ctx.lineTo(center.x - r * 0.78, cy);
        ctx.closePath();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.8;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(center.x, cy, Math.max(2.2, r * 0.28), 0, Math.PI * 2);
        ctx.fillStyle = '#090B10';
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        // Specular core highlight
        ctx.beginPath();
        ctx.moveTo(center.x, cy - r * 0.85);
        ctx.lineTo(center.x - r * 0.32, cy);
        ctx.lineTo(center.x, cy + r * 0.45);
        ctx.lineTo(center.x + r * 0.2, cy);
        ctx.closePath();
        ctx.fillStyle = '#FFF6D6';
        ctx.fill();
      }
      ctx.restore();
    }
  } else if (tile.feature === 'exit') {
    const r = Math.max(6.5, proj.scale * 0.22);
    ctx.save();
    if (isExitUnlocked) {
      const pulse = 0.75 + 0.25 * Math.sin(now * 0.006);
      // Bright emerald beacon aura
      const grad = ctx.createRadialGradient(
        center.x,
        center.y,
        0,
        center.x,
        center.y,
        proj.scale * 0.45
      );
      grad.addColorStop(0, `rgba(0, 255, 136, ${0.42 * pulse})`);
      grad.addColorStop(1, 'rgba(0, 255, 136, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, proj.scale * 0.45, proj.scale * 0.26, 0, 0, Math.PI * 2);
      ctx.fill();

      // Outer emerald diamond
      const d = getTileDiamond(tile.x, tile.y, z + 0.01, 0.26, proj);
      fillPoly(
        ctx,
        d,
        highContrast ? 'rgba(0, 255, 136, 0.35)' : 'rgba(0, 255, 136, 0.24)',
        highContrast ? '#FFFFFF' : '#00FF88',
        highContrast ? 2.4 : 2
      );

      // Rising beacon ring
      const lift = ((now % 1600) / 1600) * proj.scale * 0.36;
      const ringAlpha = 1 - (now % 1600) / 1600;
      ctx.beginPath();
      ctx.ellipse(center.x, center.y - lift, r * 0.9, r * 0.5, 0, 0, Math.PI * 2);
      ctx.strokeStyle = highContrast
        ? `rgba(255, 255, 255, ${ringAlpha * 0.95})`
        : `rgba(0, 255, 136, ${ringAlpha * 0.85})`;
      ctx.lineWidth = highContrast ? 2 : 1.6;
      ctx.stroke();

      // Core dot
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, r * 0.42, r * 0.24, 0, 0, Math.PI * 2);
      ctx.fillStyle = highContrast ? '#FFFFFF' : '#00FF88';
      ctx.shadowColor = '#00FF88';
      ctx.shadowBlur = 12;
      ctx.fill();
    } else {
      // Locked muted emerald/slate gate
      const d = getTileDiamond(tile.x, tile.y, z + 0.01, 0.24, proj);
      fillPoly(
        ctx,
        d,
        highContrast ? 'rgba(15, 23, 42, 0.85)' : 'rgba(0, 255, 136, 0.06)',
        highContrast ? '#E2E8F0' : 'rgba(0, 255, 136, 0.35)',
        highContrast ? 1.8 : 1.2
      );
      if (highContrast) {
        // Explicit X-lock symbol inside Exit gate so locked state is non-hue-dependent
        ctx.beginPath();
        ctx.moveTo(d[0].x, d[0].y);
        ctx.lineTo(d[2].x, d[2].y);
        ctx.moveTo(d[1].x, d[1].y);
        ctx.lineTo(d[3].x, d[3].y);
        ctx.strokeStyle = '#E2E8F0';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.ellipse(center.x, center.y, r * 0.35, r * 0.2, 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0, 255, 136, 0.45)';
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Main Render Frame
// ---------------------------------------------------------------------------

export interface RenderState {
  level: PuzzleLevel;
  path: PathStep[];
  validMoves: ValidMove[];
  hoveredMove: ValidMove | null;
  hintPath: GridCoord[] | null;
  ripples: RippleEffect[];
  energySurge: EnergySurgeEffect | null;
  collectedNodeIndices: Set<number>;
  showOnboarding: boolean;
  isSolved: boolean;
  highContrastPatterns: boolean;
  sunlightMode?: boolean;
  themeColor?: string;
}

export function renderIsometricBoard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: RenderState,
  now: number
): IsoProjection {
  const gridSize = state.level.size || state.level.tiles.length || GRID_SIZE;
  const proj = computeProjection(width, height, gridSize);
  const {
    level,
    path,
    validMoves,
    hoveredMove,
    hintPath,
    ripples,
    energySurge,
    collectedNodeIndices,
    showOnboarding,
    highContrastPatterns,
    sunlightMode = false,
    themeColor = '#00F0FF',
  } = state;
  const highVis = highContrastPatterns || sunlightMode;
  const isExitUnlocked = collectedNodeIndices.size === level.nodes.length;
  const isSolvedCircuit = state.isSolved || energySurge !== null;
  const mode = level.mode;
  const isOverclock = mode === 'overclock';
  const orbPos = updateOrbAnimState(level, path, now);

  // Clear background: high-luminance daylight slate in Sunlight Mode, or deep obsidian in Tron mode
  if (sunlightMode) {
    ctx.fillStyle = '#E2E8F0';
    ctx.fillRect(0, 0, width, height);

    const dayGrad = ctx.createRadialGradient(
      width * 0.5,
      height * 0.48,
      0,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.7
    );
    dayGrad.addColorStop(0, '#F8FAFC');
    dayGrad.addColorStop(0.6, '#E2E8F0');
    dayGrad.addColorStop(1, '#CBD5E1');
    ctx.fillStyle = dayGrad;
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = '#07090F';
    ctx.fillRect(0, 0, width, height);

    const bgGrad = ctx.createRadialGradient(
      width * 0.5,
      height * 0.48,
      0,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.65
    );
    bgGrad.addColorStop(
      0,
      mode === 'challenge' ? '#1B111C' : mode === 'overclock' ? '#151226' : '#0F1726'
    );
    bgGrad.addColorStop(
      0.55,
      mode === 'challenge' ? '#0F0A13' : mode === 'overclock' ? '#0C0B19' : '#090D16'
    );
    bgGrad.addColorStop(1, '#06080D');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);
  }

  // Motherboard PCB bus traces, animated data pulses, grid & scanline glow
  if (!sunlightMode) {
    drawBackgroundGridAndScanline(ctx, width, height, proj, now, mode);
  }

  // 2.5D CPU Processor Substrate, Gold Contact Pins & Inner Die Cavity
  drawProcessorSocket(ctx, proj, now, mode);

  // Subtle directional key hints outside the processor pins
  drawCompassEdgeHints(ctx, proj);

  // Sort cells back-to-front by screen Y depth
  const cells: TileData[] = [];
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      cells.push(level.tiles[y][x]);
    }
  }
  cells.sort((a, b) => a.x * AY + a.y * BY - (b.x * AY + b.y * BY));

  const validLookup = new Map<string, ValidMove>();
  for (const vm of validMoves) {
    validLookup.set(`${vm.x},${vm.y},${vm.level}`, vm);
  }

  for (const tile of cells) {
    const { x, y, type } = tile;

    if (type === 'void') {
      // Recessed subtle monolith footprint
      const d = getTileDiamond(x, y, -0.04, 0.44, proj);
      fillPoly(
        ctx,
        d,
        sunlightMode ? '#CBD5E1' : '#0B0E14',
        sunlightMode ? 'rgba(71, 85, 105, 0.45)' : 'rgba(56, 189, 248, 0.14)',
        sunlightMode ? 1.0 : 0.85
      );
      continue;
    }

    const validL0 = validLookup.has(`${x},${y},0`);
    const validL1 = validLookup.has(`${x},${y},1`);
    const hoverL0 = hoveredMove?.x === x && hoveredMove?.y === y && hoveredMove?.level === 0;
    const hoverL1 = hoveredMove?.x === x && hoveredMove?.y === y && hoveredMove?.level === 1;

    // 1. Level 0 base slab (drawn for floor, bridge underpass, and platform foundation)
    if (type === 'floor' || type === 'bridge') {
      drawExtrudedSlab(
        ctx,
        x,
        y,
        0,
        0,
        0.46,
        proj,
        sunlightMode
          ? {
              top: hoverL0 ? '#BAE6FD' : validL0 ? '#E0F2FE' : '#FFFFFF',
              leftFace: '#94A3B8',
              rightFace: '#64748B',
              topEdgeHighlight: hoverL0 || validL0 ? '#0284C7' : '#334155',
              outline: '#1E293B',
            }
          : {
              top: hoverL0 ? '#2B3E5C' : validL0 ? '#23324A' : '#1C2638',
              leftFace: '#121926',
              rightFace: '#0C111B',
              topEdgeHighlight: hoverL0
                ? 'rgba(0, 240, 255, 0.72)'
                : validL0
                  ? 'rgba(0, 240, 255, 0.38)'
                  : 'rgba(148, 163, 184, 0.28)',
              outline: 'rgba(15, 23, 42, 0.9)',
            },
        proj.slabThickness
      );

      // Underpass recessed track guide lines for bridges
      if (type === 'bridge' && tile.bridgeAxis) {
        ctx.save();
        ctx.strokeStyle = highContrastPatterns
          ? 'rgba(226, 232, 240, 0.55)'
          : 'rgba(148, 163, 184, 0.16)';
        ctx.lineWidth = highContrastPatterns ? 1.5 : 1;
        if (highContrastPatterns) ctx.setLineDash([4, 3]);
        if (tile.bridgeAxis === 'x') {
          // Underpass runs N-S
          const a1 = isoProject(x - 0.16, y - 0.44, 0.005, proj);
          const a2 = isoProject(x - 0.16, y + 0.44, 0.005, proj);
          const b1 = isoProject(x + 0.16, y - 0.44, 0.005, proj);
          const b2 = isoProject(x + 0.16, y + 0.44, 0.005, proj);
          ctx.beginPath();
          ctx.moveTo(a1.x, a1.y);
          ctx.lineTo(a2.x, a2.y);
          ctx.moveTo(b1.x, b1.y);
          ctx.lineTo(b2.x, b2.y);
          ctx.stroke();
        } else {
          // Underpass runs E-W
          const a1 = isoProject(x - 0.44, y - 0.16, 0.005, proj);
          const a2 = isoProject(x + 0.44, y - 0.16, 0.005, proj);
          const b1 = isoProject(x - 0.44, y + 0.16, 0.005, proj);
          const b2 = isoProject(x + 0.44, y + 0.16, 0.005, proj);
          ctx.beginPath();
          ctx.moveTo(a1.x, a1.y);
          ctx.lineTo(a2.x, a2.y);
          ctx.moveTo(b1.x, b1.y);
          ctx.lineTo(b2.x, b2.y);
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // 2. Bridge Ambient Occlusion Shadows + Level 0 Trail & Features
    if (type === 'floor' || type === 'bridge') {
      // Multi-layered ambient occlusion shadow underneath Level 1 bridges
      if (type === 'bridge' && tile.bridgeAxis) {
        drawBridgeAmbientOcclusion(ctx, x, y, tile.bridgeAxis, proj);
      }

      if (type === 'floor' && highContrastPatterns) {
        if (tile.feature === 'node') {
          const collected =
            tile.nodeIndex !== undefined ? collectedNodeIndices.has(tile.nodeIndex) : false;
          drawNodeDotsPattern(ctx, x, y, 0.004, 0.46, proj, collected);
        } else if (tile.feature === 'exit') {
          drawExitCrosshatchPattern(ctx, x, y, 0.004, 0.46, proj, isExitUnlocked);
        }
      }

      drawCellHintTrail(ctx, x, y, 0, level.tiles, hintPath, proj, now);
      drawCellTrail(ctx, x, y, 0, level.tiles, path, proj, highVis, isSolvedCircuit, now, isOverclock, themeColor, orbPos);

      if (type === 'floor') {
        const collected =
          tile.nodeIndex !== undefined ? collectedNodeIndices.has(tile.nodeIndex) : false;
        drawTileFeature(
          ctx,
          tile,
          0.01,
          proj,
          now,
          collected,
          isExitUnlocked,
          path.length > 1 && !state.isSolved,
          highVis
        );
      }
    }

    // 3. Ramp wedge & Ramp trail
    if (type === 'ramp') {
      drawRampBlock(ctx, tile, proj, hoverL0 || validL0);
      drawCellHintTrail(ctx, x, y, 0, level.tiles, hintPath, proj, now);
      drawCellTrail(ctx, x, y, 0, level.tiles, path, proj, highVis, isSolvedCircuit, now, isOverclock, themeColor, orbPos);
    }

    // 4. Elevated Platform (Level 1)
    if (type === 'platform') {
      drawExtrudedSlab(
        ctx,
        x,
        y,
        1,
        0,
        0.46,
        proj,
        sunlightMode
          ? {
              top: hoverL1 ? '#7DD3FC' : validL1 ? '#BAE6FD' : '#F8FAFC',
              leftFace: '#64748B',
              rightFace: '#475569',
              topEdgeHighlight: hoverL1 || validL1 ? '#0369A1' : '#0F172A',
              outline: '#0F172A',
            }
          : {
              top: hoverL1 ? '#344969' : validL1 ? '#2B3C57' : '#243147',
              leftFace: '#161F30',
              rightFace: '#101622',
              topEdgeHighlight: hoverL1
                ? 'rgba(0, 240, 255, 0.8)'
                : validL1
                  ? 'rgba(0, 240, 255, 0.45)'
                  : 'rgba(186, 230, 253, 0.36)',
              outline: 'rgba(15, 23, 42, 0.95)',
            },
        proj.slabThickness
      );

      if (highContrastPatterns) {
        if (tile.feature === 'node') {
          const collected =
            tile.nodeIndex !== undefined ? collectedNodeIndices.has(tile.nodeIndex) : false;
          drawNodeDotsPattern(ctx, x, y, 1.004, 0.46, proj, collected);
        } else if (tile.feature === 'exit') {
          drawExitCrosshatchPattern(ctx, x, y, 1.004, 0.46, proj, isExitUnlocked);
        }
      }

      drawCellHintTrail(ctx, x, y, 1, level.tiles, hintPath, proj, now);
      drawCellTrail(ctx, x, y, 1, level.tiles, path, proj, highVis, isSolvedCircuit, now, isOverclock, themeColor, orbPos);
      const collected =
        tile.nodeIndex !== undefined ? collectedNodeIndices.has(tile.nodeIndex) : false;
      drawTileFeature(
        ctx,
        tile,
        1.01,
        proj,
        now,
        collected,
        isExitUnlocked,
        path.length > 1 && !state.isSolved,
        highVis
      );
    }

    // 5. Bridge Deck (Level 1) & Overpass Trail
    if (type === 'bridge') {
      drawBridgeOverpass(ctx, tile, proj, hoverL1 || validL1, highVis);
      drawCellHintTrail(ctx, x, y, 1, level.tiles, hintPath, proj, now);
      drawCellTrail(ctx, x, y, 1, level.tiles, path, proj, highVis, isSolvedCircuit, now, isOverclock, themeColor, orbPos);
    }

    // 6. Valid move subtle tile outline affordance
    if (validL0 || validL1) {
      const targetLvl: ElevationLevel = validL1 ? 1 : 0;
      const z = type === 'ramp' ? 0.52 : targetLvl + 0.02;
      if (type !== 'ramp') {
        const isHovered =
          hoveredMove?.x === x && hoveredMove?.y === y && hoveredMove?.level === targetLvl;
        const d = getTileDiamond(x, y, z, 0.42, proj);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(d[0].x, d[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(d[i].x, d[i].y);
        ctx.closePath();
        if (sunlightMode) {
          ctx.strokeStyle = isHovered ? '#0369A1' : '#0284C7';
          ctx.lineWidth = isHovered ? 2.6 : 2.0;
        } else if (highContrastPatterns) {
          if (!isHovered) ctx.setLineDash([4, 3]);
          ctx.strokeStyle = isHovered ? '#FFFFFF' : 'rgba(241, 245, 249, 0.72)';
          ctx.lineWidth = isHovered ? 2.2 : 1.5;
        } else {
          ctx.strokeStyle = isHovered
            ? 'rgba(0, 240, 255, 0.92)'
            : 'rgba(0, 240, 255, 0.38)';
          ctx.lineWidth = isHovered ? 2.0 : 1.2;
        }
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // 7. Ripple effects on collected Energy Nodes
  for (const r of ripples) {
    const elapsed = (now - r.startTime) / 650;
    if (elapsed >= 0 && elapsed <= 1) {
      const span = 0.25 + elapsed * 0.72;
      const d = getTileDiamond(r.x, r.y, r.level + 0.02, span, proj);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(d[0].x, d[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(d[i].x, d[i].y);
      ctx.closePath();
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = (1 - elapsed) * 0.85;
      ctx.lineWidth = 2.4 * (1 - elapsed * 0.5);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 7b. Ghosted Hint Target Halo (and branch point ring if player needs to backtrack)
  if (hintPath && hintPath.length >= 2) {
    const target = hintPath[hintPath.length - 1];
    const targetTile = level.tiles[target.y]?.[target.x];
    if (targetTile) {
      const tz = getStepCenterZ(targetTile, target.level);
      const cycle = (now % 1500) / 1500;
      const targetDiamond = getTileDiamond(target.x, target.y, tz + 0.02, 0.28 + cycle * 0.14, proj);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(targetDiamond[0].x, targetDiamond[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(targetDiamond[i].x, targetDiamond[i].y);
      ctx.closePath();
      ctx.strokeStyle =
        targetTile.feature === 'exit'
          ? `rgba(0, 255, 136, ${(1 - cycle) * 0.8})`
          : `rgba(255, 184, 0, ${(1 - cycle) * 0.85})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // If hint originates behind current tip (dead-end recovery), mark the branch point
      const tip = path[path.length - 1];
      const branch = hintPath[0];
      if (tip && (tip.x !== branch.x || tip.y !== branch.y || tip.level !== branch.level)) {
        const branchTile = level.tiles[branch.y]?.[branch.x];
        if (branchTile) {
          const bz = getStepCenterZ(branchTile, branch.level);
          const bp = isoProject(branch.x, branch.y, bz, proj);
          ctx.beginPath();
          ctx.ellipse(
            bp.x,
            bp.y,
            proj.scale * 0.24,
            proj.scale * 0.14,
            0,
            0,
            Math.PI * 2
          );
          ctx.strokeStyle = 'rgba(224, 242, 254, 0.75)';
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  // 8. Holographic hover preview line from current head to hovered valid move
  if (hoveredMove && path.length > 0) {
    const cur = path[path.length - 1];
    const curTile = level.tiles[cur.y]?.[cur.x];
    const nextTile = level.tiles[hoveredMove.y]?.[hoveredMove.x];
    if (curTile && nextTile) {
      const p1 = isoProject(cur.x, cur.y, getStepCenterZ(curTile, cur.level), proj);
      const p2 = isoProject(
        hoveredMove.x,
        hoveredMove.y,
        getStepCenterZ(nextTile, hoveredMove.level),
        proj
      );

      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -(now * 0.03);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.72)';
      ctx.lineWidth = Math.max(2, proj.scale * 0.055);
      ctx.lineCap = 'round';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(p2.x, p2.y, Math.max(3.5, proj.scale * 0.08), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0, 240, 255, 0.85)';
      ctx.fill();
      ctx.restore();
    }
  }

  // 9. Zero-text onboarding pulse ring guiding from Start toward first valid neighbor(s)
  if (showOnboarding && path.length === 1 && validMoves.length > 0) {
    const startStep = path[0];
    const startTile = level.tiles[startStep.y]?.[startStep.x];
    const target = validMoves[0];
    const targetTile = level.tiles[target.y]?.[target.x];
    if (startTile && targetTile) {
      const startPt = isoProject(
        startStep.x,
        startStep.y,
        getStepCenterZ(startTile, startStep.level),
        proj
      );
      const cycle = (now % 1800) / 1800;
      const pulseAlpha = Math.sin(cycle * Math.PI);

      // Expanding pulse ring on Start tile
      const ringR = (0.24 + cycle * 0.35) * proj.scale;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(startPt.x, startPt.y, ringR, ringR * 0.56, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 240, 255, ${(1 - cycle) * 0.75})`;
      ctx.lineWidth = 1.8;
      ctx.stroke();

      // Gentle animated guide pulse toward the first valid neighbor
      const targetPt = isoProject(
        target.x,
        target.y,
        getStepCenterZ(targetTile, target.level),
        proj
      );

      const mx = startPt.x + (targetPt.x - startPt.x) * (0.25 + cycle * 0.6);
      const my = startPt.y + (targetPt.y - startPt.y) * (0.25 + cycle * 0.6);

      ctx.beginPath();
    ctx.moveTo(startPt.x, startPt.y);
    ctx.lineTo(targetPt.x, targetPt.y);
    ctx.strokeStyle = `rgba(0, 240, 255, ${0.28 * pulseAlpha})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(mx, my, Math.max(3.5, proj.scale * 0.085), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 240, 255, ${0.9 * pulseAlpha})`;
    ctx.shadowColor = '#00F0FF';
    ctx.shadowBlur = 10;
    ctx.fill();

    // Target neighbor pulse ring
    ctx.beginPath();
    ctx.ellipse(
      targetPt.x,
      targetPt.y,
      proj.scale * 0.28,
      proj.scale * 0.16,
      0,
      0,
      Math.PI * 2
    );
    ctx.strokeStyle = `rgba(0, 240, 255, ${0.55 * pulseAlpha})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    }
  }

  // 10. Screen-wide Energy Surge particle & shockwave effect on reaching Exit
  if (energySurge) {
    drawEnergySurge(ctx, width, height, level, proj, energySurge, now);
  }

  return proj;
}

function drawCompassEdgeHints(ctx: CanvasRenderingContext2D, proj: IsoProjection) {
  const c = proj.centerOffset;
  const max = proj.gridSize + 0.45;
  const hints: Array<{ gx: number; gy: number; label: string }> = [
    { gx: c, gy: -1.45, label: '↑ W' },
    { gx: max, gy: c, label: '→ D' },
    { gx: c, gy: max, label: '↓ S' },
    { gx: -1.45, gy: c, label: '← A' },
  ];
  ctx.save();
  ctx.font = `500 ${Math.max(10, Math.round(proj.scale * 0.19))}px "JetBrains Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.4)';
  for (const h of hints) {
    const p = isoProject(h.gx, h.gy, -0.05, proj);
    ctx.fillText(h.label, p.x, p.y);
  }
  ctx.restore();
}

function drawProcessorSocket(
  ctx: CanvasRenderingContext2D,
  proj: IsoProjection,
  now: number,
  mode: GameMode = 'standard'
) {
  const outerMin = -0.96;
  const outerMax = proj.gridSize - 0.04;
  const innerMin = -0.58;
  const innerMax = proj.gridSize - 0.42;
  const baseZ = -0.04;
  const subThick = 22;

  ctx.save();

  // 1. Soft drop shadow beneath the entire CPU package on the PCB
  const pkgShadow = [
    isoProject(outerMin + 0.12, outerMin + 0.12, -0.18, proj),
    isoProject(outerMax + 0.16, outerMin + 0.12, -0.18, proj),
    isoProject(outerMax + 0.16, outerMax + 0.16, -0.18, proj),
    isoProject(outerMin + 0.12, outerMax + 0.16, -0.18, proj),
  ].map((p) => ({ x: p.x, y: p.y + subThick + 8 }));
  fillPoly(ctx, pkgShadow, 'rgba(0, 0, 0, 0.65)');

  // 2. Back gold contact pins along top-left (-x) and top-right (-y) edges
  const pinW = 0.12;
  const pinLen = 0.22;
  for (let i = 0; i < proj.gridSize; i++) {
    // Top-right edge (gy = outerMin - pinLen .. outerMin)
    const pTop = [
      isoProject(i - pinW, outerMin - pinLen, baseZ - 0.02, proj),
      isoProject(i + pinW, outerMin - pinLen, baseZ - 0.02, proj),
      isoProject(i + pinW, outerMin, baseZ - 0.02, proj),
      isoProject(i - pinW, outerMin, baseZ - 0.02, proj),
    ];
    fillPoly(ctx, pTop, '#8E6D2B', '#5A4318', 0.6);

    // Top-left edge (gx = outerMin - pinLen .. outerMin)
    const pLeft = [
      isoProject(outerMin - pinLen, i - pinW, baseZ - 0.02, proj),
      isoProject(outerMin, i - pinW, baseZ - 0.02, proj),
      isoProject(outerMin, i + pinW, baseZ - 0.02, proj),
      isoProject(outerMin - pinLen, i + pinW, baseZ - 0.02, proj),
    ];
    fillPoly(ctx, pLeft, '#9F7C34', '#5A4318', 0.6);
  }

  // 3. Extruded CPU ceramic/silicon substrate housing
  const top = [
    isoProject(outerMin, outerMin, baseZ, proj),
    isoProject(outerMax, outerMin, baseZ, proj),
    isoProject(outerMax, outerMax, baseZ, proj),
    isoProject(outerMin, outerMax, baseZ, proj),
  ];
  const bot = top.map((p) => ({ x: p.x, y: p.y + subThick }));

  // Left-front extruded wall (3 -> 2)
  fillPoly(ctx, [top[3], top[2], bot[2], bot[3]], '#0B0F18', 'rgba(30, 41, 59, 0.7)', 0.9);
  // Right-front extruded wall (1 -> 2)
  fillPoly(ctx, [top[1], top[2], bot[2], bot[1]], '#070A10', 'rgba(30, 41, 59, 0.7)', 0.9);
  // Substrate top surface
  fillPoly(ctx, top, '#0F1522', 'rgba(51, 65, 85, 0.55)', 1.1);

  // Specular metallic bevel along back-left & back-right outer CPU rim
  ctx.beginPath();
  ctx.moveTo(top[3].x, top[3].y);
  ctx.lineTo(top[0].x, top[0].y);
  ctx.lineTo(top[1].x, top[1].y);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.24)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Front gold contact pins along bottom-left (+y) and bottom-right (+x) edges
  for (let i = 0; i < proj.gridSize; i++) {
    // Bottom-left edge (+y)
    const pBotLeft = [
      isoProject(i - pinW, outerMax, baseZ - 0.03, proj),
      isoProject(i + pinW, outerMax, baseZ - 0.03, proj),
      isoProject(i + pinW, outerMax + pinLen, baseZ - 0.03, proj),
      isoProject(i - pinW, outerMax + pinLen, baseZ - 0.03, proj),
    ].map((p) => ({ x: p.x, y: p.y + subThick * 0.55 }));
    fillPoly(ctx, pBotLeft, '#C79E46', '#74581F', 0.7);

    // Bottom-right edge (+x)
    const pBotRight = [
      isoProject(outerMax, i - pinW, baseZ - 0.03, proj),
      isoProject(outerMax + pinLen, i - pinW, baseZ - 0.03, proj),
      isoProject(outerMax + pinLen, i + pinW, baseZ - 0.03, proj),
      isoProject(outerMax, i + pinW, baseZ - 0.03, proj),
    ].map((p) => ({ x: p.x, y: p.y + subThick * 0.55 }));
    fillPoly(ctx, pBotRight, '#B48D3B', '#6A4F1B', 0.7);
  }

  // Pin-1 Gold/Amber orientation triangle on the top corner of the CPU package
  const pin1 = [
    isoProject(outerMin + 0.1, outerMin + 0.1, baseZ + 0.004, proj),
    isoProject(outerMin + 0.32, outerMin + 0.1, baseZ + 0.004, proj),
    isoProject(outerMin + 0.1, outerMin + 0.32, baseZ + 0.004, proj),
  ];
  fillPoly(ctx, pin1, '#FFB800');

  // Subtle corner alignment rivets on the other 3 corners of the CPU rim
  const cornerMarks: Array<[number, number]> = [
    [outerMax - 0.18, outerMin + 0.18],
    [outerMax - 0.18, outerMax - 0.18],
    [outerMin + 0.18, outerMax - 0.18],
  ];
  for (const [cx, cy] of cornerMarks) {
    const cp = isoProject(cx, cy, baseZ + 0.004, proj);
    ctx.beginPath();
    ctx.ellipse(cp.x, cp.y, Math.max(2.2, proj.scale * 0.05), Math.max(1.3, proj.scale * 0.028), 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.32)';
    ctx.fill();
  }

  // 4. Inner Processor Die Cavity (the recessed silicon well holding the 7x7 grid)
  const cavity = [
    isoProject(innerMin, innerMin, baseZ + 0.002, proj),
    isoProject(innerMax, innerMin, baseZ + 0.002, proj),
    isoProject(innerMax, innerMax, baseZ + 0.002, proj),
    isoProject(innerMin, innerMax, baseZ + 0.002, proj),
  ];
  const cavityPulse = 0.14 + 0.06 * Math.sin(now * 0.0025);
  fillPoly(
    ctx,
    cavity,
    '#06080E',
    mode === 'challenge'
      ? `rgba(255, 68, 96, ${cavityPulse + 0.08})`
      : mode === 'overclock'
        ? `rgba(168, 85, 247, ${cavityPulse + 0.1})`
        : `rgba(0, 240, 255, ${cavityPulse})`,
    mode === 'standard' ? 1.2 : 1.4
  );

  // Faint silicon trace grid inside the recessed die well
  ctx.beginPath();
  for (let i = 0; i <= proj.gridSize; i++) {
    const g = i - 0.5;
    const h1 = isoProject(innerMin + 0.04, g, baseZ + 0.004, proj);
    const h2 = isoProject(innerMax - 0.04, g, baseZ + 0.004, proj);
    ctx.moveTo(h1.x, h1.y);
    ctx.lineTo(h2.x, h2.y);

    const v1 = isoProject(g, innerMin + 0.04, baseZ + 0.004, proj);
    const v2 = isoProject(g, innerMax - 0.04, baseZ + 0.004, proj);
    ctx.moveTo(v1.x, v1.y);
    ctx.lineTo(v2.x, v2.y);
  }
  ctx.strokeStyle =
    mode === 'challenge'
      ? 'rgba(255, 72, 100, 0.055)'
      : mode === 'overclock'
        ? 'rgba(168, 85, 247, 0.06)'
        : 'rgba(0, 240, 255, 0.045)';
  ctx.lineWidth = 0.9;
  ctx.stroke();

  ctx.restore();
}

function drawBridgeAmbientOcclusion(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  bridgeAxis: 'x' | 'y',
  proj: IsoProjection
) {
  // 1. Soft wide penumbra cast onto the Level 0 slab under the bridge
  const penumbra = getTileDiamond(cx + 0.05, cy + 0.05, 0.008, 0.45, proj);
  fillPoly(ctx, penumbra, 'rgba(2, 4, 8, 0.52)');

  // 2. Deep directional core umbra matching the suspended bridge deck footprint
  const halfX = bridgeAxis === 'x' ? 0.45 : 0.38;
  const halfY = bridgeAxis === 'y' ? 0.45 : 0.38;
  const umbra = [
    isoProject(cx - halfX + 0.03, cy - halfY + 0.03, 0.01, proj),
    isoProject(cx + halfX + 0.03, cy - halfY + 0.03, 0.01, proj),
    isoProject(cx + halfX + 0.03, cy + halfY + 0.03, 0.01, proj),
    isoProject(cx - halfX + 0.03, cy + halfY + 0.03, 0.01, proj),
  ];
  fillPoly(ctx, umbra, 'rgba(1, 2, 5, 0.78)');

  // 3. Concentrated ambient occlusion contact shadows at the two pier bases
  const h = 0.46;
  const pierSize = 0.11;
  const pierOffsets: Array<[number, number]> =
    bridgeAxis === 'x'
      ? [
          [0, -h + pierSize],
          [0, h - pierSize],
        ]
      : [
          [-h + pierSize, 0],
          [h - pierSize, 0],
        ];
  for (const [ox, oy] of pierOffsets) {
    const ao = getTileDiamond(cx + ox, cy + oy, 0.012, 0.17, proj);
    fillPoly(ctx, ao, 'rgba(0, 0, 0, 0.72)');
  }
}

function drawBackgroundGridAndScanline(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  proj: IsoProjection,
  now: number,
  mode: GameMode = 'standard'
) {
  ctx.save();

  // Subtle ambient horizontal scanlines across the obsidian stage
  ctx.fillStyle =
    mode === 'challenge'
      ? 'rgba(255, 68, 96, 0.016)'
      : mode === 'overclock'
        ? 'rgba(168, 85, 247, 0.018)'
        : 'rgba(0, 240, 255, 0.015)';
  for (let sy = 0; sy < height; sy += 4) {
    ctx.fillRect(0, sy, width, 1);
  }

  // Faint extended motherboard matrix grid
  const minG = -5.5;
  const maxG = proj.gridSize + 4.5;
  const gridColor =
    mode === 'challenge'
      ? 'rgba(110, 38, 62, 0.14)'
      : mode === 'overclock'
        ? 'rgba(88, 52, 130, 0.16)'
        : 'rgba(30, 58, 95, 0.14)';
  for (let i = -5; i <= proj.gridSize + 5; i++) {
    const a = isoProject(i - 0.5, minG, -0.22, proj);
    const b = isoProject(i - 0.5, maxG, -0.22, proj);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.stroke();

    const c = isoProject(minG, i - 0.5, -0.22, proj);
    const d = isoProject(maxG, i - 0.5, -0.22, proj);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Radiating PCB bus traces extending outward from the CPU pins on all 4 sides
  const zPcb = -0.18;
  const traces: Array<Array<[number, number]>> = [];
  for (let i = 0; i < proj.gridSize; i++) {
    const fan = (i - proj.centerOffset) * 0.45;
    // North (-y) bus lanes
    traces.push([
      [i, -1.15],
      [i, -2.1],
      [i + fan, -2.1 - Math.abs(fan)],
      [i + fan, -5.2],
    ]);
    // South (+y) bus lanes
    traces.push([
      [i, proj.gridSize + 0.15],
      [i, proj.gridSize + 1.15],
      [i + fan, proj.gridSize + 1.15 + Math.abs(fan)],
      [i + fan, proj.gridSize + 4.2],
    ]);
    // West (-x) bus lanes
    traces.push([
      [-1.15, i],
      [-2.1, i],
      [-2.1 - Math.abs(fan), i + fan],
      [-5.2, i + fan],
    ]);
    // East (+x) bus lanes
    traces.push([
      [proj.gridSize + 0.15, i],
      [proj.gridSize + 1.15, i],
      [proj.gridSize + 1.15 + Math.abs(fan), i + fan],
      [proj.gridSize + 4.2, i + fan],
    ]);
  }

  for (let tIdx = 0; tIdx < traces.length; tIdx++) {
    const pts = traces[tIdx].map(([gx, gy]) => isoProject(gx, gy, zPcb, proj));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
    ctx.strokeStyle =
      mode === 'challenge'
        ? tIdx % 2 === 0
          ? 'rgba(255, 68, 96, 0.1)'
          : 'rgba(251, 146, 60, 0.055)'
        : mode === 'overclock'
          ? tIdx % 2 === 0
            ? 'rgba(168, 85, 247, 0.11)'
            : 'rgba(0, 240, 255, 0.07)'
          : tIdx % 2 === 0
            ? 'rgba(0, 240, 255, 0.085)'
            : 'rgba(56, 189, 248, 0.05)';
    ctx.lineWidth = 1.25;
    ctx.stroke();

    // Terminal PCB solder via ring
    const endPt = pts[pts.length - 1];
    ctx.beginPath();
    ctx.ellipse(endPt.x, endPt.y, 3.2, 1.9, 0, 0, Math.PI * 2);
    ctx.strokeStyle =
      mode === 'challenge'
        ? 'rgba(255, 68, 96, 0.18)'
        : mode === 'overclock'
          ? 'rgba(168, 85, 247, 0.22)'
          : 'rgba(0, 240, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Animated signal packet gliding along selected traces
    if (tIdx % 3 === 0) {
      const speed =
        (mode === 'overclock' ? 0.00062 : 0.00032) + (tIdx % 5) * 0.00005;
      const phase = ((now * speed + tIdx * 0.23) % 1);
      const segPos = phase * (pts.length - 1);
      const segIdx = Math.min(pts.length - 2, Math.floor(segPos));
      const frac = segPos - segIdx;
      const px = pts[segIdx].x + (pts[segIdx + 1].x - pts[segIdx].x) * frac;
      const py = pts[segIdx].y + (pts[segIdx + 1].y - pts[segIdx].y) * frac;
      const fade = Math.sin(phase * Math.PI);

      ctx.beginPath();
      ctx.arc(px, py, 2.2, 0, Math.PI * 2);
      ctx.fillStyle =
        mode === 'challenge'
          ? tIdx % 6 === 0
            ? `rgba(255, 184, 0, ${0.65 * fade})`
            : `rgba(255, 68, 96, ${0.72 * fade})`
          : mode === 'overclock'
            ? tIdx % 6 === 0
              ? `rgba(0, 240, 255, ${0.75 * fade})`
              : `rgba(192, 132, 252, ${0.78 * fade})`
            : tIdx % 6 === 0
              ? `rgba(255, 184, 0, ${0.55 * fade})`
              : `rgba(0, 240, 255, ${0.65 * fade})`;
      ctx.fill();
    }
  }

  // Animated diagonal scanline sweep across the silicon plane (x + y = C)
  const sweepSpeed = mode === 'overclock' ? 0.00038 : 0.00024;
  const sweepProgress = ((now * sweepSpeed) % 1.4) - 0.2;
  const diagC = -6 + sweepProgress * 24;
  const x1 = Math.min(maxG, diagC - minG);
  const y1 = diagC - x1;
  const y2 = Math.min(maxG, diagC - minG);
  const x2 = diagC - y2;
  if (x1 >= minG && y2 >= minG) {
    const p1 = isoProject(x1, y1, zPcb, proj);
    const p2 = isoProject(x2, y2, zPcb, proj);
    const midX = (p1.x + p2.x) * 0.5;
    const midY = (p1.y + p2.y) * 0.5;
    const nx = (proj.ax + proj.bx) * 1.6;
    const ny = (proj.ay + proj.by) * 1.6;
    const grad = ctx.createLinearGradient(midX - nx, midY - ny, midX + nx, midY + ny);
    if (mode === 'challenge') {
      grad.addColorStop(0, 'rgba(255, 68, 96, 0)');
      grad.addColorStop(0.5, 'rgba(255, 68, 96, 0.065)');
      grad.addColorStop(1, 'rgba(255, 68, 96, 0)');
    } else if (mode === 'overclock') {
      grad.addColorStop(0, 'rgba(168, 85, 247, 0)');
      grad.addColorStop(0.5, 'rgba(168, 85, 247, 0.075)');
      grad.addColorStop(1, 'rgba(168, 85, 247, 0)');
    } else {
      grad.addColorStop(0, 'rgba(0, 240, 255, 0)');
      grad.addColorStop(0.5, 'rgba(0, 240, 255, 0.06)');
      grad.addColorStop(1, 'rgba(0, 240, 255, 0)');
    }

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(24, proj.scale * 1.1);
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  ctx.restore();
}

export function createEnergySurge(origin: GridCoord, startTime: number): EnergySurgeEffect {
  const palette = ['#00FF88', '#00FF88', '#00F0FF', '#00F0FF', '#E0FFFF', '#FFB800'];
  const particles: SurgeParticle[] = [];
  const count = 88;

  for (let i = 0; i < count; i++) {
    const baseAngle = (i / count) * Math.PI * 2;
    const jitter = (Math.random() - 0.5) * 0.24;
    particles.push({
      angle: baseAngle + jitter,
      speed: 0.36 + Math.random() * 0.72,
      drift: (Math.random() - 0.5) * 0.28,
      size: 2.2 + Math.random() * 3.8,
      durationMs: 950 + Math.random() * 750,
      delayMs: i < 48 ? Math.random() * 90 : 80 + Math.random() * 200,
      color: palette[i % palette.length],
      isDiamond: i % 3 === 0,
    });
  }

  return { origin, startTime, particles };
}

function drawEnergySurge(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  level: PuzzleLevel,
  proj: IsoProjection,
  surge: EnergySurgeEffect,
  now: number
) {
  const elapsed = now - surge.startTime;
  if (elapsed < 0 || elapsed > 2200) return;

  const originTile = level.tiles[surge.origin.y]?.[surge.origin.x];
  if (!originTile) return;
  const originZ = getStepCenterZ(originTile, surge.origin.level);
  const originPt = isoProject(surge.origin.x, surge.origin.y, originZ, proj);
  const maxSpan = Math.hypot(width, height);

  ctx.save();

  // 1. Screen-wide emerald-cyan luminescence flash
  if (elapsed < 750) {
    const t = elapsed / 750;
    const flash = Math.sin(Math.min(1, t * 4) * (Math.PI / 2)) * Math.pow(1 - t, 1.8);
    const flashGrad = ctx.createRadialGradient(
      originPt.x,
      originPt.y,
      0,
      originPt.x,
      originPt.y,
      maxSpan * 0.85
    );
    flashGrad.addColorStop(0, `rgba(224, 255, 244, ${0.38 * flash})`);
    flashGrad.addColorStop(0.25, `rgba(0, 255, 136, ${0.22 * flash})`);
    flashGrad.addColorStop(0.6, `rgba(0, 240, 255, ${0.1 * flash})`);
    flashGrad.addColorStop(1, 'rgba(0, 240, 255, 0)');
    ctx.fillStyle = flashGrad;
    ctx.fillRect(0, 0, width, height);
  }

  // 2. Expanding screen-wide shockwave rings
  const waves = [
    { delay: 0, dur: 950, color: '0, 255, 136', width: 3.5 },
    { delay: 110, dur: 1100, color: '0, 240, 255', width: 2.4 },
    { delay: 220, dur: 1200, color: '224, 255, 255', width: 1.4 },
  ];

  for (const w of waves) {
    const we = elapsed - w.delay;
    if (we < 0 || we > w.dur) continue;
    const p = we / w.dur;
    const ease = 1 - Math.pow(1 - p, 3);
    const radius = ease * maxSpan * 0.92;
    const alpha = (1 - p) * 0.72;

    ctx.beginPath();
    ctx.arc(originPt.x, originPt.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${w.color}, ${alpha})`;
    ctx.lineWidth = Math.max(1, w.width * (1 - p * 0.5));
    ctx.shadowColor = `rgb(${w.color})`;
    ctx.shadowBlur = 14;
    ctx.stroke();
  }

  // 3. Screen-wide high-velocity energy surge particles with streak tails
  ctx.shadowBlur = 10;
  for (const pt of surge.particles) {
    const pe = elapsed - pt.delayMs;
    if (pe < 0 || pe > pt.durationMs) continue;

    const p = pe / pt.durationMs;
    const ease = 1 - Math.pow(1 - p, 3);
    const prevEase = 1 - Math.pow(1 - Math.max(0, p - 0.08), 3);

    const dist = ease * maxSpan * pt.speed;
    const prevDist = prevEase * maxSpan * pt.speed;
    const ang = pt.angle + pt.drift * ease;
    const prevAng = pt.angle + pt.drift * prevEase;

    const x = originPt.x + Math.cos(ang) * dist;
    const y = originPt.y + Math.sin(ang) * dist;
    const tx = originPt.x + Math.cos(prevAng) * prevDist;
    const ty = originPt.y + Math.sin(prevAng) * prevDist;

    const alpha = p < 0.12 ? p / 0.12 : Math.pow(1 - (p - 0.12) / 0.88, 1.4);

    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.strokeStyle = pt.color;
    ctx.fillStyle = pt.color;
    ctx.shadowColor = pt.color;

    // Velocity streak tail
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(x, y);
    ctx.lineWidth = Math.max(1, pt.size * 0.55 * (1 - p * 0.4));
    ctx.lineCap = 'round';
    ctx.stroke();

    // Glowing particle core (diamond shard or circular spark)
    const s = pt.size * (1 - p * 0.45);
    if (pt.isDiamond) {
      ctx.beginPath();
      ctx.moveTo(x, y - s * 1.15);
      ctx.lineTo(x + s * 0.85, y);
      ctx.lineTo(x, y + s * 1.15);
      ctx.lineTo(x - s * 0.85, y);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, s * 0.72, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}
