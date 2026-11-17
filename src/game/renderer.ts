/**
 * Pixel-art Canvas 2D renderer for A one piece TD.
 * Uses 1 PNG per character and enemy, animating walking, breathing,
 * punching recoil, stretched arms, and enemy HP bars procedurally at 60fps.
 */

import { isTileBuildable, STAGE_GRID } from './mapData';
import {
  ALVIDA_GREEN_PNG_URL,
  ALVIDA_NORMAL_PNG_URL,
  Enemy,
  GRID_COLS,
  GRID_ROWS,
  LUFFY_PNG_URL,
  LUFFY_SPEC,
  Particle,
  Projectile,
  TILE_SIZE,
  Tower,
  VIRTUAL_HEIGHT,
  VIRTUAL_WIDTH,
} from './types';

interface LoadedSprite {
  img: HTMLImageElement;
  ready: boolean;
  failed: boolean;
}

export interface SpriteAssets {
  luffy: LoadedSprite;
  alvidaNormal: LoadedSprite;
  alvidaGreen: LoadedSprite;
}

function loadSingleSprite(url: string): LoadedSprite {
  const sprite: LoadedSprite = {
    img: new Image(),
    ready: false,
    failed: false,
  };
  sprite.img.referrerPolicy = 'no-referrer';
  sprite.img.onload = () => {
    sprite.ready = true;
  };
  sprite.img.onerror = () => {
    sprite.failed = true;
  };
  sprite.img.src = url;
  return sprite;
}

/**
 * Loads the single PNG asset for Luffy, Alvida bandit, and Green Alvida bandit.
 */
export function loadSpriteAssets(): SpriteAssets {
  return {
    luffy: loadSingleSprite(LUFFY_PNG_URL),
    alvidaNormal: loadSingleSprite(ALVIDA_NORMAL_PNG_URL),
    alvidaGreen: loadSingleSprite(ALVIDA_GREEN_PNG_URL),
  };
}

// Deterministic pseudo-random helper so pixel grass/flowers stay fixed every frame
function tileHash(col: number, row: number, salt = 0): number {
  const n = Math.sin(col * 127.1 + row * 311.7 + salt * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Draws an aspect-ratio-preserving sprite centered at (cx, cy) inside maxBoxSize,
 * with smooth horizontal flip, squash/stretch, and rotation for procedural animation.
 */
function drawSpriteTransformed(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cx: number,
  cy: number,
  maxBoxSize: number,
  flipX = false,
  scaleX = 1,
  scaleY = 1,
  rotationRad = 0
): void {
  const iw = img.naturalWidth || maxBoxSize;
  const ih = img.naturalHeight || maxBoxSize;
  const ratio = Math.min(maxBoxSize / iw, maxBoxSize / ih);
  const w = Math.round(iw * ratio * scaleX);
  const h = Math.round(ih * ratio * scaleY);

  ctx.save();
  ctx.translate(cx, cy);
  if (flipX) {
    ctx.scale(-1, 1);
  }
  if (rotationRad !== 0) {
    ctx.rotate(rotationRad);
  }
  ctx.drawImage(img, Math.round(-w / 2), Math.round(-h / 2), w, h);
  ctx.restore();
}

/**
 * Fallback pixel Luffy if the external PNG fails to load.
 */
function drawFallbackLuffy(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const x = Math.round(cx - 8);
  const y = Math.round(cy - 10);
  ctx.fillStyle = '#facc15';
  ctx.fillRect(x + 2, y + 2, 12, 3);
  ctx.fillRect(x + 4, y, 8, 2);
  ctx.fillStyle = '#dc2626';
  ctx.fillRect(x + 4, y + 2, 8, 1);
  ctx.fillStyle = '#fed7aa';
  ctx.fillRect(x + 5, y + 5, 6, 4);
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(x + 4, y + 9, 8, 6);
  ctx.fillStyle = '#2563eb';
  ctx.fillRect(x + 4, y + 15, 8, 3);
}

/**
 * Fallback pixel bandit if an external PNG fails to load.
 */
function drawFallbackBandit(ctx: CanvasRenderingContext2D, cx: number, cy: number, isGreen: boolean): void {
  const x = Math.round(cx - 6);
  const y = Math.round(cy - 8);
  ctx.fillStyle = isGreen ? '#16a34a' : '#ec4899';
  ctx.fillRect(x + 2, y + 1, 8, 4);
  ctx.fillStyle = '#fed7aa';
  ctx.fillRect(x + 3, y + 5, 6, 4);
  ctx.fillStyle = isGreen ? '#15803d' : '#7c3aed';
  ctx.fillRect(x + 2, y + 9, 8, 6);
}

/**
 * Builds the offscreen static stage canvas (meadow grass, dirt track, borders, trees, rocks).
 */
export function createStaticMapCanvas(): HTMLCanvasElement {
  const offscreen = document.createElement('canvas');
  offscreen.width = VIRTUAL_WIDTH;
  offscreen.height = VIRTUAL_HEIGHT;
  const ctx = offscreen.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  // 1. Paint meadow grass tiles + subtle checkerboard & flower details
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const px = c * TILE_SIZE;
      const py = r * TILE_SIZE;
      const kind = STAGE_GRID[r][c];

      const isAlt = (c + r) % 2 === 0;
      ctx.fillStyle = isAlt ? '#5ea843' : '#579f3d';
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

      const h1 = tileHash(c, r, 1);
      if (kind === 'GRASS' && h1 > 0.45) {
        ctx.fillStyle = '#4c8e35';
        const gx = px + Math.floor(tileHash(c, r, 2) * 11) + 2;
        const gy = py + Math.floor(tileHash(c, r, 3) * 10) + 3;
        ctx.fillRect(gx, gy, 2, 1);
        ctx.fillRect(gx + 1, gy - 1, 1, 1);
      }

      if (kind === 'GRASS' && r > 0 && h1 > 0.88) {
        const fx = px + Math.floor(tileHash(c, r, 4) * 10) + 3;
        const fy = py + Math.floor(tileHash(c, r, 5) * 10) + 3;
        ctx.fillStyle = h1 > 0.94 ? '#fef08a' : '#f8fafc';
        ctx.fillRect(fx, fy, 2, 2);
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(fx, fy, 1, 1);
      }
    }
  }

  // 2. Paint dirt path tiles with shaded grass-edge rims
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (STAGE_GRID[r][c] !== 'PATH') continue;
      const px = c * TILE_SIZE;
      const py = r * TILE_SIZE;

      ctx.fillStyle = '#d6ad72';
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

      const p1 = tileHash(c, r, 7);
      const p2 = tileHash(c, r, 8);
      ctx.fillStyle = '#c4985a';
      ctx.fillRect(px + Math.floor(p1 * 10) + 2, py + Math.floor(p2 * 10) + 2, 2, 2);
      ctx.fillStyle = '#e5c18a';
      ctx.fillRect(px + Math.floor(p2 * 9) + 4, py + Math.floor(p1 * 9) + 3, 2, 1);

      const upPath = STAGE_GRID[r - 1]?.[c] === 'PATH';
      const downPath = STAGE_GRID[r + 1]?.[c] === 'PATH';
      const leftPath = STAGE_GRID[r]?.[c - 1] === 'PATH';
      const rightPath = STAGE_GRID[r]?.[c + 1] === 'PATH';

      ctx.fillStyle = '#8b6538';
      if (!upPath) ctx.fillRect(px, py, TILE_SIZE, 2);
      if (!downPath) ctx.fillRect(px, py + TILE_SIZE - 2, TILE_SIZE, 2);
      if (!leftPath) ctx.fillRect(px, py, 2, TILE_SIZE);
      if (!rightPath) ctx.fillRect(px + TILE_SIZE - 2, py, 2, TILE_SIZE);

      ctx.fillStyle = '#3f762b';
      if (!upPath && r > 0) ctx.fillRect(px, py - 1, TILE_SIZE, 1);
      if (!downPath && r < GRID_ROWS - 1) ctx.fillRect(px, py + TILE_SIZE, TILE_SIZE, 1);
    }
  }

  // 3. Paint water pond, rocks, and pixel trees
  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      const px = c * TILE_SIZE;
      const py = r * TILE_SIZE;
      const kind = STAGE_GRID[r][c];

      if (kind === 'WATER') {
        ctx.fillStyle = '#2563eb';
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(px + 2, py + 2, TILE_SIZE - 4, TILE_SIZE - 4);
        ctx.fillStyle = '#3f762b';
        if (STAGE_GRID[r - 1]?.[c] !== 'WATER') ctx.fillRect(px, py, TILE_SIZE, 2);
        if (STAGE_GRID[r + 1]?.[c] !== 'WATER') ctx.fillRect(px, py + TILE_SIZE - 2, TILE_SIZE, 2);
        if (STAGE_GRID[r]?.[c - 1] !== 'WATER') ctx.fillRect(px, py, 2, TILE_SIZE);
        if (STAGE_GRID[r]?.[c + 1] !== 'WATER') ctx.fillRect(px + TILE_SIZE - 2, py, 2, TILE_SIZE);
      } else if (kind === 'ROCK') {
        ctx.fillStyle = '#3f762b';
        ctx.fillRect(px + 3, py + 11, 10, 3);
        ctx.fillStyle = '#64748b';
        ctx.fillRect(px + 3, py + 5, 10, 7);
        ctx.fillRect(px + 5, py + 4, 6, 9);
        ctx.fillStyle = '#94a3b8';
        ctx.fillRect(px + 5, py + 5, 4, 3);
        ctx.fillStyle = '#475569';
        ctx.fillRect(px + 4, py + 10, 8, 2);
      } else if (kind === 'TREE') {
        ctx.fillStyle = '#3f762b';
        ctx.fillRect(px + 3, py + 12, 10, 3);
        ctx.fillStyle = '#6b4226';
        ctx.fillRect(px + 6, py + 9, 4, 5);
        ctx.fillStyle = '#275e24';
        ctx.fillRect(px + 2, py + 3, 12, 8);
        ctx.fillRect(px + 4, py + 1, 8, 10);
        ctx.fillStyle = '#357a2f';
        ctx.fillRect(px + 3, py + 2, 9, 6);
        ctx.fillStyle = '#4ba33c';
        ctx.fillRect(px + 4, py + 2, 5, 3);
      }
    }
  }

  // 4. Entrance chevron & Exit guard post markers on the track
  const entryY = 4 * TILE_SIZE + 4;
  ctx.fillStyle = '#fef08a';
  ctx.fillRect(3, entryY + 2, 4, 4);
  ctx.fillRect(7, entryY + 1, 2, 6);
  ctx.fillRect(9, entryY + 3, 2, 2);

  const exitX = (GRID_COLS - 1) * TILE_SIZE + 6;
  const exitY = 13 * TILE_SIZE + 3;
  ctx.fillStyle = '#ef4444';
  ctx.fillRect(exitX + 2, exitY, 6, 4);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(exitX + 1, exitY, 1, 10);

  return offscreen;
}

export interface RenderFrameState {
  timeSec: number;
  towers: Tower[];
  enemies: Enemy[];
  projectiles: Projectile[];
  particles: Particle[];
  hoverTile: { col: number; row: number } | null;
  isPlacing: boolean;
  canAffordPlacement: boolean;
  movingTowerId: number | null;
  selectedTowerId: number | null;
  shakeOffset: { x: number; y: number };
}

/**
 * Renders one full pixel-art frame onto the primary 480x272 canvas.
 */
export function renderGameFrame(
  ctx: CanvasRenderingContext2D,
  staticMap: HTMLCanvasElement,
  assets: SpriteAssets,
  state: RenderFrameState
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.translate(Math.round(state.shakeOffset.x), Math.round(state.shakeOffset.y));

  // 1. Blit pre-rendered static meadow & path
  ctx.drawImage(staticMap, 0, 0);

  // 2. Subtle animated water shimmer in the corner pond
  const shimmerOffset = Math.floor(state.timeSec * 2) % 2;
  ctx.fillStyle = '#bae6fd';
  ctx.fillRect(24 * TILE_SIZE + 5 + shimmerOffset * 3, 15 * TILE_SIZE + 5, 4, 1);
  ctx.fillRect(26 * TILE_SIZE + 4 - shimmerOffset * 2, 16 * TILE_SIZE + 6, 5, 1);

  // 3. Subtle placement grid overlay while placing/moving Luffy
  if (state.isPlacing) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    for (let r = 1; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const occupied = state.towers.some(
          (t) => t.id !== state.movingTowerId && t.col === c && t.row === r
        );
        if (isTileBuildable(c, r) && !occupied) {
          ctx.fillRect(c * TILE_SIZE + 1, r * TILE_SIZE + 1, TILE_SIZE - 2, TILE_SIZE - 2);
        }
      }
    }
  }

  // 4. Range ring for the selected placed Luffy
  if (state.selectedTowerId !== null) {
    const selected = state.towers.find((t) => t.id === state.selectedTowerId);
    if (selected) {
      drawRangeCircle(ctx, selected.x, selected.y, LUFFY_SPEC.rangePx, true);
    }
  }

  // 5. Hover placement ghost & range preview
  if (state.isPlacing && state.hoverTile) {
    const { col, row } = state.hoverTile;
    const occupied = state.towers.some(
      (t) => t.id !== state.movingTowerId && t.col === col && t.row === row
    );
    const valid = isTileBuildable(col, row) && !occupied && (state.movingTowerId !== null || state.canAffordPlacement);
    const cx = col * TILE_SIZE + TILE_SIZE / 2;
    const cy = row * TILE_SIZE + TILE_SIZE / 2;

    drawRangeCircle(ctx, cx, cy, LUFFY_SPEC.rangePx, valid);

    ctx.fillStyle = valid ? 'rgba(16, 185, 129, 0.35)' : 'rgba(239, 68, 68, 0.45)';
    ctx.fillRect(col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE);

    ctx.save();
    ctx.globalAlpha = 0.78;
    if (assets.luffy.ready) {
      drawSpriteTransformed(ctx, assets.luffy.img, cx, cy - 2, 24);
    } else {
      drawFallbackLuffy(ctx, cx, cy - 2);
    }
    ctx.restore();
  }

  // 6. Placed Luffys (animated with 1 PNG: breathing idle + aimed punch lunge & squash-stretch)
  for (let i = 0; i < state.towers.length; i++) {
    const t = state.towers[i];
    const isSelected = t.id === state.selectedTowerId;
    const isPunching = t.punchAnimTimer > 0;

    // Smooth forward lunge during punch, subtle breathing while waiting
    const lungeProgress = isPunching ? Math.sin((t.punchAnimTimer / 0.16) * Math.PI) : 0;
    const lungeX = Math.cos(t.facingAngle) * lungeProgress * 3.2;
    const lungeY = Math.sin(t.facingAngle) * lungeProgress * 3.2;

    const breathe = Math.sin(state.timeSec * 3.2 + t.id) * 0.03;
    const scaleX = isPunching ? 1 + lungeProgress * 0.14 : 1 - breathe;
    const scaleY = isPunching ? 1 - lungeProgress * 0.1 : 1 + breathe;

    const dx = Math.cos(t.facingAngle);
    const dy = Math.sin(t.facingAngle);
    const aimTilt = isPunching ? Math.atan2(dy, Math.abs(dx)) * 0.58 * lungeProgress : 0;

    ctx.fillStyle = isSelected ? 'rgba(250, 204, 21, 0.5)' : 'rgba(0, 0, 0, 0.28)';
    ctx.fillRect(Math.round(t.x - 7), Math.round(t.y + 4), 14, 4);

    if (assets.luffy.ready) {
      drawSpriteTransformed(
        ctx,
        assets.luffy.img,
        t.x + lungeX,
        t.y - 2 + lungeY,
        26,
        t.facingLeft,
        scaleX,
        scaleY,
        aimTilt
      );
    } else {
      drawFallbackLuffy(ctx, t.x + lungeX, t.y - 2 + lungeY);
    }
  }

  // 7. Active Alvida bandits (animated smoothly with 1 PNG each + red HP bar when damaged)
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (!e.alive) continue;

    // Rhythmic stride hop, step squash-stretch, and swagger tilt
    const stridePhase = e.walkTime * 6.5;
    const hop = Math.abs(Math.sin(stridePhase)) * 1.8;
    const stepSquash = Math.cos(stridePhase * 2) * 0.05;
    const tilt = Math.sin(stridePhase) * 0.11;

    const ex = e.x;
    const ey = e.y - hop;

    // Grounded shadow shrinks slightly at peak of stride hop
    const shadowW = hop > 1.0 ? 8 : 10;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.26)';
    ctx.fillRect(Math.round(e.x - shadowW / 2), Math.round(e.y + 5), shadowW, 3);

    const sprite = e.kind === 'green' ? assets.alvidaGreen : assets.alvidaNormal;
    if (sprite.ready) {
      drawSpriteTransformed(
        ctx,
        sprite.img,
        ex,
        ey - 2,
        22,
        e.facingLeft,
        1 + stepSquash,
        1 - stepSquash,
        tilt
      );
    } else {
      drawFallbackBandit(ctx, ex, ey - 2, e.kind === 'green');
    }

    if (e.hitFlashTimer > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
      ctx.fillRect(Math.round(ex) - 6, Math.round(ey) - 8, 12, 13);
    } else if (e.healFlashTimer > 0) {
      ctx.fillStyle = 'rgba(74, 222, 128, 0.55)';
      ctx.fillRect(Math.round(ex) - 6, Math.round(ey) - 8, 12, 13);
    }

    // Small red HP bar above enemy head whenever damaged and not one-shotted
    if (e.hp < e.maxHp && e.hp > 0) {
      const barW = 14;
      const barH = 4;
      const bx = Math.round(ex - barW / 2);
      const by = Math.round(ey - 16);
      const fillW = Math.max(1, Math.round((barW - 2) * (e.hp / e.maxHp)));

      ctx.fillStyle = '#0f172a';
      ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = '#450a0a';
      ctx.fillRect(bx + 1, by + 1, barW - 2, barH - 2);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(bx + 1, by + 1, fillW, barH - 2);
    }
  }

  // 8. Stretched Gum-Gum rubber arm & fist hitting the exact target
  for (let i = 0; i < state.projectiles.length; i++) {
    const p = state.projectiles[i];
    if (!p.active) continue;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#9a6b42';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(p.originX, p.originY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();

    ctx.strokeStyle = '#f5cfa0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.originX, p.originY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();

    ctx.translate(Math.round(p.x), Math.round(p.y));
    ctx.rotate(p.angle);
    ctx.fillStyle = '#9a6b42';
    ctx.fillRect(-3, -3, 6, 6);
    ctx.fillStyle = '#f5cfa0';
    ctx.fillRect(-2, -2, 5, 4);
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(2, -1, 2, 2);
    ctx.restore();
  }

  // 9. Pooled pop & heal particles
  for (let i = 0; i < state.particles.length; i++) {
    const pt = state.particles[i];
    if (!pt.active) continue;
    const alpha = Math.max(0, pt.life / pt.maxLife);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pt.color;
    ctx.fillRect(Math.round(pt.x), Math.round(pt.y), pt.size, pt.size);
  }
  ctx.globalAlpha = 1;

  ctx.restore();
}

function drawRangeCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  valid: boolean
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = valid ? 'rgba(16, 185, 129, 0.14)' : 'rgba(239, 68, 68, 0.18)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = valid ? 'rgba(255, 255, 255, 0.85)' : 'rgba(252, 165, 165, 0.9)';
  ctx.stroke();
  ctx.restore();
}
