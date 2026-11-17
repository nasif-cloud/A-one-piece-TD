/**
 * Defines the single pixelated Bloons-style meadow stage,
 * path waypoints, scenic obstacles, and buildable tile rules.
 */

import { GRID_COLS, GRID_ROWS, TILE_SIZE, TileKind, Vec2 } from './types';

// Path corner coordinates in grid (col, row) space.
// Forms a classic Bloons-style winding meadow track with inner loops.
export const PATH_CORNERS: ReadonlyArray<{ col: number; row: number }> = [
  { col: 0, row: 4 },
  { col: 7, row: 4 },
  { col: 7, row: 12 },
  { col: 13, row: 12 },
  { col: 13, row: 3 },
  { col: 21, row: 3 },
  { col: 21, row: 9 },
  { col: 17, row: 9 },
  { col: 17, row: 13 },
  { col: 29, row: 13 },
];

// Pixel-center waypoints used by enemies when walking along the track.
// Starts slightly off-screen left and exits slightly off-screen right.
export const PATH_WAYPOINTS: ReadonlyArray<Vec2> = PATH_CORNERS.map((pt, idx) => {
  const centerX = pt.col * TILE_SIZE + TILE_SIZE / 2;
  const centerY = pt.row * TILE_SIZE + TILE_SIZE / 2;
  if (idx === 0) {
    return { x: -TILE_SIZE / 2, y: centerY };
  }
  if (idx === PATH_CORNERS.length - 1) {
    return { x: GRID_COLS * TILE_SIZE + TILE_SIZE / 2, y: centerY };
  }
  return { x: centerX, y: centerY };
});

// Scenic unbuildable props placed away from key strategic loops
const TREE_TILES: ReadonlyArray<[number, number]> = [
  [1, 1], [2, 1], [4, 1], [10, 1], [25, 1], [27, 1], [28, 2],
  [1, 7], [2, 9], [1, 13], [3, 14], [2, 15],
  [25, 6], [27, 7], [28, 9],
  [9, 15], [12, 15],
];

const ROCK_TILES: ReadonlyArray<[number, number]> = [
  [4, 8], [15, 14], [24, 3], [27, 11], [6, 15],
];

const WATER_TILES: ReadonlyArray<[number, number]> = [
  [24, 15], [25, 15], [26, 15], [27, 15],
  [24, 16], [25, 16], [26, 16], [27, 16],
];

/**
 * Builds the 30x17 tile grid once at startup.
 */
function createStageGrid(): TileKind[][] {
  const grid: TileKind[][] = Array.from({ length: GRID_ROWS }, () =>
    Array.from({ length: GRID_COLS }, () => 'GRASS' as TileKind)
  );

  // Carve orthogonal path segments between each consecutive corner
  for (let i = 0; i < PATH_CORNERS.length - 1; i++) {
    const a = PATH_CORNERS[i];
    const b = PATH_CORNERS[i + 1];
    const minC = Math.min(a.col, b.col);
    const maxC = Math.max(a.col, b.col);
    const minR = Math.min(a.row, b.row);
    const maxR = Math.max(a.row, b.row);

    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        grid[r][c] = 'PATH';
      }
    }
  }

  // Stamp scenic border props on grass tiles (never overwriting the path)
  for (const [c, r] of TREE_TILES) {
    if (grid[r]?.[c] === 'GRASS') grid[r][c] = 'TREE';
  }
  for (const [c, r] of ROCK_TILES) {
    if (grid[r]?.[c] === 'GRASS') grid[r][c] = 'ROCK';
  }
  for (const [c, r] of WATER_TILES) {
    if (grid[r]?.[c] === 'GRASS') grid[r][c] = 'WATER';
  }

  return grid;
}

export const STAGE_GRID: TileKind[][] = createStageGrid();

/**
 * Returns true if the player can place the character on this grid cell.
 */
export function isTileBuildable(col: number, row: number): boolean {
  if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) {
    return false;
  }
  // Keep top row (row 0) clear so the top HUD never overlaps a tower
  if (row === 0) {
    return false;
  }
  return STAGE_GRID[row][col] === 'GRASS';
}

/**
 * Converts a tile (col, row) into its virtual pixel center coordinate.
 */
export function tileToCenter(col: number, row: number): Vec2 {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  };
}
