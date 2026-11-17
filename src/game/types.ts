/**
 * Core data types and fixed game balance constants for A one piece TD.
 * Kept in a single file so beginners can inspect all rules at a glance.
 */

export type GameState = 'TITLE_MENU' | 'BUILD_TEAM' | 'PLAYING' | 'PAUSED' | 'VICTORY' | 'GAME_OVER';

// Virtual pixel-art resolution (30 x 17 tiles at 16px each)
export const TILE_SIZE = 16;
export const GRID_COLS = 30;
export const GRID_ROWS = 17;
export const VIRTUAL_WIDTH = GRID_COLS * TILE_SIZE; // 480
export const VIRTUAL_HEIGHT = GRID_ROWS * TILE_SIZE; // 272

// 1 speed unit = 1 tile (block) per second
export const SPEED_UNIT_PX_PER_SEC = TILE_SIZE;

// Single PNG per character and enemy (all motion is animated procedurally)
export const LUFFY_PNG_URL = 'https://i.imgur.com/BIRbGZq.png';
export const ALVIDA_NORMAL_PNG_URL = 'https://i.imgur.com/POTiB2b.png';
export const ALVIDA_GREEN_PNG_URL = 'https://i.imgur.com/dUKVbZK.png';

export type EnemyKind = 'normal' | 'green';

export interface EnemyTypeSpec {
  kind: EnemyKind;
  name: string;
  maxHp: number;
  speedBlocksPerSec: number;
  speedPxPerSec: number;
  reward: number;
  healIntervalSec: number | null;
  healFraction: number;
}

export const ENEMY_SPECS: Record<EnemyKind, EnemyTypeSpec> = {
  normal: {
    kind: 'normal',
    name: 'Alvida bandit',
    maxHp: 1,
    speedBlocksPerSec: 1,
    speedPxPerSec: 1 * SPEED_UNIT_PX_PER_SEC,
    reward: 1,
    healIntervalSec: null,
    healFraction: 0,
  },
  green: {
    kind: 'green',
    name: 'Green Alvida bandit',
    maxHp: 2,
    speedBlocksPerSec: 1,
    speedPxPerSec: 1 * SPEED_UNIT_PX_PER_SEC,
    reward: 2,
    healIntervalSec: 5,
    healFraction: 0.5, // Heals 50% of max HP every 5 seconds
  },
};

// Economy & stage progression constants
export const STARTING_MONEY = 50;
export const MAX_LIVES = 10;
export const TOTAL_WAVES = 2;
export const WAVE_FINISH_BONUSES: Record<number, number> = {
  1: 10,
  2: 10,
};

export interface WaveSpawnEvent {
  delayAfterPrevSec: number;
  kind: EnemyKind;
}

/**
 * Builds the ordered spawn timeline for a given wave number.
 * 1 tile spacing at 1 block/sec = 1.0 second between consecutive bandits.
 */
export function buildWaveQueue(waveNumber: number): WaveSpawnEvent[] {
  const events: WaveSpawnEvent[] = [];

  if (waveNumber === 1) {
    // Wave 1: 10 normal Alvida bandits spaced by 1 tile
    for (let i = 0; i < 10; i++) {
      events.push({ delayAfterPrevSec: i === 0 ? 0 : 1.0, kind: 'normal' });
    }
    return events;
  }

  // Wave 2: 10 normal -> 3s wait -> 5 green -> 5s wait -> mix of green and normal
  for (let i = 0; i < 10; i++) {
    events.push({ delayAfterPrevSec: i === 0 ? 0 : 1.0, kind: 'normal' });
  }
  for (let i = 0; i < 5; i++) {
    events.push({ delayAfterPrevSec: i === 0 ? 3.0 : 1.0, kind: 'green' });
  }
  const mixedGroup: EnemyKind[] = [
    'normal',
    'green',
    'normal',
    'green',
    'normal',
    'green',
    'normal',
    'green',
    'normal',
    'green',
  ];
  for (let i = 0; i < mixedGroup.length; i++) {
    events.push({ delayAfterPrevSec: i === 0 ? 5.0 : 1.0, kind: mixedGroup[i] });
  }

  return events;
}

// Character metadata & stats for the 5-slot hotbar & expanded info card
export interface CharacterSpec {
  id: string;
  name: string;
  rarity: string;
  cost: number;
  costLabel: string;
  damagePerHit: number;
  hitsPerSecond: number;
  cooldownSec: number;
  rangePx: number;
  rangeTiles: number;
  maxPlacements: number;
  projectileSpeedPxPerSec: number;
  iconUrl: string;
  description: string;
}

export const LUFFY_SPEC: CharacterSpec = {
  id: 'luffy',
  name: 'Luffy',
  rarity: 'Starter',
  cost: 30,
  costLabel: '$30',
  damagePerHit: 1,
  hitsPerSecond: 3,
  cooldownSec: 1 / 3,
  rangePx: 66,
  rangeTiles: Number((66 / TILE_SIZE).toFixed(1)),
  maxPlacements: 3,
  projectileSpeedPxPerSec: 520,
  iconUrl: LUFFY_PNG_URL,
  description: 'Rubber brawler firing rapid Gum-Gum punches at nearby pirates.',
};

export const HOTBAR_SLOTS: ReadonlyArray<CharacterSpec | null> = [
  LUFFY_SPEC,
  null,
  null,
  null,
  null,
];

export type TileKind = 'GRASS' | 'PATH' | 'TREE' | 'ROCK' | 'WATER';

export interface Vec2 {
  x: number;
  y: number;
}

export interface Tower {
  id: number;
  specId: string;
  col: number;
  row: number;
  x: number;
  y: number;
  cooldownRemaining: number;
  facingAngle: number;
  facingLeft: boolean;
  punchAnimTimer: number;
  recoilTimer: number;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  pendingDamage: number;
  speedPxPerSec: number;
  reward: number;
  waypointIndex: number;
  distanceTraveled: number;
  hitFlashTimer: number;
  healFlashTimer: number;
  healTimer: number;
  walkTime: number;
  facingLeft: boolean;
  alive: boolean;
}

export interface Projectile {
  id: number;
  towerId: number;
  originX: number;
  originY: number;
  x: number;
  y: number;
  targetEnemyId: number;
  damage: number;
  angle: number;
  active: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  active: boolean;
}

export interface HudSnapshot {
  lives: number;
  money: number;
  waveNumber: number;
  waveActive: boolean;
  waveStarted: boolean;
  enemiesPopped: number;
  enemiesLeaked: number;
  towersPlaced: number;
  selectedTowerId: number | null;
}
