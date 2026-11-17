/**
 * Main interactive Game Shell for A one piece TD.
 * Runs a 60fps Canvas 2D simulation loop isolated from React re-renders,
 * handling Waves 1-2, Green Alvida healing, $50/$30/$1/$2/$10 economy,
 * 5-slot hotbar, expanded character info, Title Screen, Build Team, and modals.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Volume2,
  VolumeX,
  Pause,
  Play,
  RotateCcw,
  Move,
  Trash2,
  Users,
  ArrowLeft,
  X,
} from 'lucide-react';
import { retroAudio } from '../game/audio';
import { isTileBuildable, PATH_WAYPOINTS, tileToCenter } from '../game/mapData';
import { createStaticMapCanvas, loadSpriteAssets, renderGameFrame, SpriteAssets } from '../game/renderer';
import {
  buildWaveQueue,
  CharacterSpec,
  ENEMY_SPECS,
  Enemy,
  GameState,
  GRID_COLS,
  GRID_ROWS,
  HOTBAR_SLOTS,
  HudSnapshot,
  LUFFY_PNG_URL,
  LUFFY_SPEC,
  MAX_LIVES,
  Particle,
  Projectile,
  STARTING_MONEY,
  TILE_SIZE,
  TOTAL_WAVES,
  Tower,
  VIRTUAL_HEIGHT,
  VIRTUAL_WIDTH,
  WAVE_FINISH_BONUSES,
  WaveSpawnEvent,
} from '../game/types';

const PARTICLE_POOL_SIZE = 80;
const POP_COLORS = ['#ef4444', '#fca5a5', '#fef08a', '#ffffff'];
const HEAL_COLORS = ['#4ade80', '#86efac', '#bbf7d0'];

interface SimulationState {
  timeSec: number;
  lives: number;
  money: number;
  waveNumber: number;
  towers: Tower[];
  enemies: Enemy[];
  projectiles: Projectile[];
  particles: Particle[];
  waveQueue: WaveSpawnEvent[];
  waveQueueIndex: number;
  waveStarted: boolean;
  waveActive: boolean;
  spawnTimerSec: number;
  enemiesPopped: number;
  enemiesLeaked: number;
  nextId: number;
  shakeTimer: number;
  shakeMagnitude: number;
}

interface InfoDrawerState {
  spec: CharacterSpec;
  towerId: number | null;
}

function createInitialSimulation(): SimulationState {
  const particles: Particle[] = Array.from({ length: PARTICLE_POOL_SIZE }, () => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 0.35,
    size: 2,
    color: '#ffffff',
    active: false,
  }));

  return {
    timeSec: 0,
    lives: MAX_LIVES,
    money: STARTING_MONEY,
    waveNumber: 1,
    towers: [],
    enemies: [],
    projectiles: [],
    particles,
    waveQueue: [],
    waveQueueIndex: 0,
    waveStarted: false,
    waveActive: false,
    spawnTimerSec: 0,
    enemiesPopped: 0,
    enemiesLeaked: 0,
    nextId: 1,
    shakeTimer: 0,
    shakeMagnitude: 0,
  };
}

export default function GameShell() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const staticMapRef = useRef<HTMLCanvasElement | null>(null);
  const assetsRef = useRef<SpriteAssets | null>(null);
  const simRef = useRef<SimulationState>(createInitialSimulation());

  // Pointer & placement refs for zero-lag canvas rendering
  const hoverTileRef = useRef<{ col: number; row: number } | null>(null);
  const isPlacingRef = useRef<boolean>(false);
  const movingTowerIdRef = useRef<number | null>(null);
  const selectedTowerIdRef = useRef<number | null>(null);

  const [gameState, setGameState] = useState<GameState>('TITLE_MENU');
  const gameStateRef = useRef<GameState>('TITLE_MENU');

  const [isPlacingUI, setIsPlacingUI] = useState<boolean>(false);
  const [infoDrawer, setInfoDrawer] = useState<InfoDrawerState | null>(null);
  const [muted, setMuted] = useState<boolean>(false);
  const [hintText, setHintText] = useState<string>('');
  const [hud, setHud] = useState<HudSnapshot>({
    lives: MAX_LIVES,
    money: STARTING_MONEY,
    waveNumber: 1,
    waveActive: false,
    waveStarted: false,
    enemiesPopped: 0,
    enemiesLeaked: 0,
    towersPlaced: 0,
    selectedTowerId: null,
  });

  const updateGameState = useCallback((next: GameState) => {
    gameStateRef.current = next;
    setGameState(next);
  }, []);

  // Sync lightweight React HUD only when discrete values change
  const syncHudFromSim = useCallback(() => {
    const s = simRef.current;

    setHud((prev) => {
      const next: HudSnapshot = {
        lives: s.lives,
        money: s.money,
        waveNumber: s.waveNumber,
        waveActive: s.waveActive,
        waveStarted: s.waveStarted,
        enemiesPopped: s.enemiesPopped,
        enemiesLeaked: s.enemiesLeaked,
        towersPlaced: s.towers.length,
        selectedTowerId: selectedTowerIdRef.current,
      };
      if (
        prev.lives === next.lives &&
        prev.money === next.money &&
        prev.waveNumber === next.waveNumber &&
        prev.waveActive === next.waveActive &&
        prev.waveStarted === next.waveStarted &&
        prev.enemiesPopped === next.enemiesPopped &&
        prev.enemiesLeaked === next.enemiesLeaked &&
        prev.towersPlaced === next.towersPlaced &&
        prev.selectedTowerId === next.selectedTowerId
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  // Spawn a burst of pixel particles from the pre-allocated pool
  const spawnBurst = useCallback(
    (x: number, y: number, count: number, palette: ReadonlyArray<string> = POP_COLORS) => {
      const pool = simRef.current.particles;
      let spawned = 0;
      for (let i = 0; i < pool.length && spawned < count; i++) {
        const p = pool[i];
        if (!p.active) {
          const angle = (Math.PI * 2 * spawned) / count + (Math.random() - 0.5) * 0.5;
          const speed = 28 + Math.random() * 44;
          p.x = x;
          p.y = y;
          p.vx = Math.cos(angle) * speed;
          p.vy = Math.sin(angle) * speed;
          p.maxLife = 0.24 + Math.random() * 0.16;
          p.life = p.maxLife;
          p.size = Math.random() > 0.5 ? 3 : 2;
          p.color = palette[spawned % palette.length];
          p.active = true;
          spawned++;
        }
      }
    },
    []
  );

  // Reset the entire stage cleanly without reloading
  const resetStage = useCallback(
    (targetState: GameState) => {
      simRef.current = createInitialSimulation();
      hoverTileRef.current = null;
      isPlacingRef.current = false;
      movingTowerIdRef.current = null;
      selectedTowerIdRef.current = null;
      setIsPlacingUI(false);
      setInfoDrawer(null);
      setHintText('');
      syncHudFromSim();
      updateGameState(targetState);
    },
    [syncHudFromSim, updateGameState]
  );

  const handleStartGame = useCallback(() => {
    resetStage('PLAYING');
    retroAudio.playPlace();
  }, [resetStage]);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      retroAudio.setMuted(next);
      return next;
    });
  }, []);

  const handleSendWave = useCallback(() => {
    if (gameStateRef.current !== 'PLAYING') return;
    const s = simRef.current;
    if (s.waveStarted) return;

    if (s.towers.length === 0) {
      isPlacingRef.current = true;
      movingTowerIdRef.current = null;
      setIsPlacingUI(true);
      setHintText(`Place ${LUFFY_SPEC.name} ($${LUFFY_SPEC.cost}) on grass first`);
      return;
    }

    setHintText('');
    s.waveQueue = buildWaveQueue(s.waveNumber);
    s.waveQueueIndex = 0;
    s.spawnTimerSec = s.waveQueue[0]?.delayAfterPrevSec ?? 0;
    s.waveStarted = true;
    s.waveActive = true;
    isPlacingRef.current = false;
    movingTowerIdRef.current = null;
    setIsPlacingUI(false);
    retroAudio.playWaveStart();
    syncHudFromSim();
  }, [syncHudFromSim]);

  // Clicking a character slot on the 5-slot side hotbar opens expanded info and arms placement if affordable
  const handleHotbarSlotClick = useCallback(
    (spec: CharacterSpec | null) => {
      if (gameStateRef.current !== 'PLAYING' || !spec) return;
      const s = simRef.current;
      const countPlaced = s.towers.filter((t) => t.specId === spec.id).length;

      selectedTowerIdRef.current = null;
      movingTowerIdRef.current = null;
      setInfoDrawer({ spec, towerId: null });

      if (countPlaced < spec.maxPlacements && s.money >= spec.cost) {
        isPlacingRef.current = true;
        setIsPlacingUI(true);
        setHintText('');
      } else {
        isPlacingRef.current = false;
        setIsPlacingUI(false);
        if (countPlaced < spec.maxPlacements && s.money < spec.cost) {
          setHintText(`Need $${spec.cost} to place ${spec.name}`);
        }
      }
      syncHudFromSim();
    },
    [syncHudFromSim]
  );

  const handleArmPlacementFromInfo = useCallback(
    (spec: CharacterSpec) => {
      if (gameStateRef.current !== 'PLAYING') return;
      const s = simRef.current;
      const countPlaced = s.towers.filter((t) => t.specId === spec.id).length;
      if (countPlaced >= spec.maxPlacements) return;
      if (s.money < spec.cost) {
        setHintText(`Need $${spec.cost} to place ${spec.name}`);
        return;
      }
      selectedTowerIdRef.current = null;
      movingTowerIdRef.current = null;
      isPlacingRef.current = true;
      setIsPlacingUI(true);
      setHintText('');
      syncHudFromSim();
    },
    [syncHudFromSim]
  );

  const handleMoveSelectedTower = useCallback(
    (towerId: number) => {
      if (gameStateRef.current !== 'PLAYING') return;
      movingTowerIdRef.current = towerId;
      selectedTowerIdRef.current = towerId;
      isPlacingRef.current = true;
      setIsPlacingUI(true);
      setHintText('');
      syncHudFromSim();
    },
    [syncHudFromSim]
  );

  const handleRemoveSelectedTower = useCallback(
    (towerId: number) => {
      if (gameStateRef.current !== 'PLAYING') return;
      const s = simRef.current;
      const removed = s.towers.find((t) => t.id === towerId);
      if (removed) {
        s.money += LUFFY_SPEC.cost;
      }
      s.towers = s.towers.filter((t) => t.id !== towerId);
      if (selectedTowerIdRef.current === towerId) {
        selectedTowerIdRef.current = null;
      }
      if (movingTowerIdRef.current === towerId) {
        movingTowerIdRef.current = null;
      }
      isPlacingRef.current = false;
      setIsPlacingUI(false);
      setInfoDrawer(null);
      syncHudFromSim();
    },
    [syncHudFromSim]
  );

  // Clear hint message automatically after 2.4 seconds
  useEffect(() => {
    if (!hintText) return;
    const id = window.setTimeout(() => setHintText(''), 2400);
    return () => window.clearTimeout(id);
  }, [hintText]);

  // Global keyboard shortcuts (Enter/Space to start/send wave, Esc to pause/cancel, M to mute)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const state = gameStateRef.current;

      if (e.key === 'm' || e.key === 'M') {
        handleToggleMute();
        return;
      }

      if (state === 'TITLE_MENU' && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        handleStartGame();
        return;
      }

      if (state === 'BUILD_TEAM' && e.key === 'Escape') {
        e.preventDefault();
        updateGameState('TITLE_MENU');
        return;
      }

      if (state === 'PLAYING') {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (isPlacingRef.current) {
            isPlacingRef.current = false;
            movingTowerIdRef.current = null;
            setIsPlacingUI(false);
          } else {
            updateGameState('PAUSED');
          }
        } else if (e.key === ' ') {
          e.preventDefault();
          handleSendWave();
        }
        return;
      }

      if (state === 'PAUSED' && e.key === 'Escape') {
        e.preventDefault();
        updateGameState('PLAYING');
        return;
      }

      if ((state === 'VICTORY' || state === 'GAME_OVER') && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        resetStage('PLAYING');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSendWave, handleStartGame, handleToggleMute, resetStage, updateGameState]);

  // Initialize static map, sprites, and isolated 60fps requestAnimationFrame simulation loop
  useEffect(() => {
    staticMapRef.current = createStaticMapCanvas();
    assetsRef.current = loadSpriteAssets();

    let rafId = 0;
    let lastTimestamp = performance.now();

    const stepSimulation = (dt: number) => {
      const s = simRef.current;
      s.timeSec += dt;

      if (gameStateRef.current !== 'PLAYING') {
        return;
      }

      if (s.shakeTimer > 0) {
        s.shakeTimer = Math.max(0, s.shakeTimer - dt);
      }

      // 1. Wave spawning along the current wave's event queue (supports 3s and 5s waits)
      if (s.waveActive && s.waveQueueIndex < s.waveQueue.length) {
        s.spawnTimerSec -= dt;
        while (s.waveQueueIndex < s.waveQueue.length && s.spawnTimerSec <= 0) {
          const ev = s.waveQueue[s.waveQueueIndex];
          const spec = ENEMY_SPECS[ev.kind];
          const start = PATH_WAYPOINTS[0];

          s.enemies.push({
            id: s.nextId++,
            kind: ev.kind,
            x: start.x,
            y: start.y,
            hp: spec.maxHp,
            maxHp: spec.maxHp,
            pendingDamage: 0,
            speedPxPerSec: spec.speedPxPerSec,
            reward: spec.reward,
            waypointIndex: 1,
            distanceTraveled: 0,
            hitFlashTimer: 0,
            healFlashTimer: 0,
            healTimer: 0,
            walkTime: s.waveQueueIndex * 0.28,
            facingLeft: false,
            alive: true,
          });

          s.waveQueueIndex += 1;
          if (s.waveQueueIndex < s.waveQueue.length) {
            s.spawnTimerSec += s.waveQueue[s.waveQueueIndex].delayAfterPrevSec;
          }
        }
      }

      // 2. Move enemies along waypoints and tick Green Alvida bandit's 5s 50% heal trait
      let hudDirty = false;
      for (let i = 0; i < s.enemies.length; i++) {
        const enemy = s.enemies[i];
        if (!enemy.alive) continue;

        if (enemy.hitFlashTimer > 0) {
          enemy.hitFlashTimer = Math.max(0, enemy.hitFlashTimer - dt);
        }
        if (enemy.healFlashTimer > 0) {
          enemy.healFlashTimer = Math.max(0, enemy.healFlashTimer - dt);
        }
        enemy.walkTime += dt;

        // Green Alvida bandit heal trait: every 5 seconds, heals 50% of its max HP
        const spec = ENEMY_SPECS[enemy.kind];
        if (spec.healIntervalSec !== null) {
          enemy.healTimer += dt;
          if (enemy.healTimer >= spec.healIntervalSec) {
            enemy.healTimer -= spec.healIntervalSec;
            if (enemy.hp < enemy.maxHp) {
              const healAmount = enemy.maxHp * spec.healFraction;
              enemy.hp = Math.min(enemy.maxHp, enemy.hp + healAmount);
              enemy.healFlashTimer = 0.24;
              spawnBurst(enemy.x, enemy.y - 4, 5, HEAL_COLORS);
              retroAudio.playHeal();
            }
          }
        }

        let remainingStep = enemy.speedPxPerSec * dt;
        while (remainingStep > 0 && enemy.waypointIndex < PATH_WAYPOINTS.length) {
          const target = PATH_WAYPOINTS[enemy.waypointIndex];
          const dx = target.x - enemy.x;
          const dy = target.y - enemy.y;
          const dist = Math.hypot(dx, dy);

          if (dx < -0.05) {
            enemy.facingLeft = true;
          } else if (dx > 0.05) {
            enemy.facingLeft = false;
          }

          if (dist <= remainingStep) {
            enemy.x = target.x;
            enemy.y = target.y;
            enemy.distanceTraveled += dist;
            remainingStep -= dist;
            enemy.waypointIndex += 1;
          } else {
            enemy.x += (dx / dist) * remainingStep;
            enemy.y += (dy / dist) * remainingStep;
            enemy.distanceTraveled += remainingStep;
            remainingStep = 0;
          }
        }

        // Enemy reached the exit (leaked)
        if (enemy.waypointIndex >= PATH_WAYPOINTS.length) {
          enemy.alive = false;
          s.enemiesLeaked += 1;
          s.lives = Math.max(0, s.lives - 1);
          s.shakeTimer = 0.14;
          s.shakeMagnitude = 2.5;
          retroAudio.playLeak();
          hudDirty = true;
        }
      }

      // 3. Each placed Luffy targets and punches at 3 hits/second (1 dmg per hit)
      for (let ti = 0; ti < s.towers.length; ti++) {
        const tower = s.towers[ti];
        tower.cooldownRemaining = Math.max(0, tower.cooldownRemaining - dt);
        tower.punchAnimTimer = Math.max(0, tower.punchAnimTimer - dt);
        tower.recoilTimer = Math.max(0, tower.recoilTimer - dt);

        if (tower.cooldownRemaining <= 0) {
          let bestTarget: Enemy | null = null;
          let bestProgress = -1;

          for (let i = 0; i < s.enemies.length; i++) {
            const enemy = s.enemies[i];
            if (!enemy.alive) continue;
            if (enemy.hp - enemy.pendingDamage <= 0) continue;

            const dist = Math.hypot(enemy.x - tower.x, enemy.y - tower.y);
            if (dist <= LUFFY_SPEC.rangePx && enemy.distanceTraveled > bestProgress) {
              bestProgress = enemy.distanceTraveled;
              bestTarget = enemy;
            }
          }

          if (bestTarget) {
            const angle = Math.atan2(bestTarget.y - tower.y, bestTarget.x - tower.x);
            tower.facingAngle = angle;
            tower.facingLeft = Math.cos(angle) < 0;
            tower.cooldownRemaining = LUFFY_SPEC.cooldownSec;
            tower.punchAnimTimer = 0.16;
            tower.recoilTimer = 0.1;

            bestTarget.pendingDamage += LUFFY_SPEC.damagePerHit;

            const originX = tower.x + Math.cos(angle) * 5;
            const originY = tower.y - 2 + Math.sin(angle) * 5;
            s.projectiles.push({
              id: s.nextId++,
              towerId: tower.id,
              originX,
              originY,
              x: originX,
              y: originY,
              targetEnemyId: bestTarget.id,
              damage: LUFFY_SPEC.damagePerHit,
              angle,
              active: true,
            });
            retroAudio.playShoot();
          }
        }
      }

      // 4. Advance punch shockwave projectiles and resolve hits + $1/$2 rewards
      for (let i = 0; i < s.projectiles.length; i++) {
        const proj = s.projectiles[i];
        if (!proj.active) continue;

        const target = s.enemies.find((e) => e.id === proj.targetEnemyId && e.alive);
        if (!target) {
          proj.active = false;
          continue;
        }

        const dx = target.x - proj.x;
        const dy = target.y - proj.y;
        const dist = Math.hypot(dx, dy);
        const step = LUFFY_SPEC.projectileSpeedPxPerSec * dt;

        if (dist <= step + 3) {
          proj.active = false;
          target.hp -= proj.damage;
          target.pendingDamage = Math.max(0, target.pendingDamage - proj.damage);
          target.hitFlashTimer = 0.08;

          if (target.hp <= 0) {
            target.alive = false;
            s.enemiesPopped += 1;
            s.money += target.reward;
            spawnBurst(target.x, target.y, 7, POP_COLORS);
            retroAudio.playPop();
            hudDirty = true;
          }
        } else {
          proj.angle = Math.atan2(dy, dx);
          proj.x += (dx / dist) * step;
          proj.y += (dy / dist) * step;
        }
      }

      if (s.projectiles.length > 36) {
        s.projectiles = s.projectiles.filter((p) => p.active);
      }

      // 5. Update pooled particles
      for (let i = 0; i < s.particles.length; i++) {
        const pt = s.particles[i];
        if (!pt.active) continue;
        pt.life -= dt;
        if (pt.life <= 0) {
          pt.active = false;
        } else {
          pt.x += pt.vx * dt;
          pt.y += pt.vy * dt;
          pt.vx *= 0.92;
          pt.vy *= 0.92;
        }
      }

      if (hudDirty) {
        syncHudFromSim();
      }

      // 6. Check Defeat / Wave Clear / Stage Clear conditions
      if (s.lives <= 0) {
        s.waveActive = false;
        syncHudFromSim();
        retroAudio.playGameOver();
        updateGameState('GAME_OVER');
        return;
      }

      if (s.waveActive && s.waveQueueIndex >= s.waveQueue.length) {
        const anyAlive = s.enemies.some((e) => e.alive);
        if (!anyAlive) {
          s.waveActive = false;
          const bonus = WAVE_FINISH_BONUSES[s.waveNumber] ?? 0;
          s.money += bonus;

          if (s.waveNumber < TOTAL_WAVES) {
            const clearedWave = s.waveNumber;
            s.waveNumber += 1;
            s.waveStarted = false;
            s.enemies = [];
            setHintText(`Wave ${clearedWave} Cleared · +$${bonus} Bonus`);
            retroAudio.playWaveStart();
            syncHudFromSim();
          } else {
            syncHudFromSim();
            retroAudio.playVictory();
            updateGameState('VICTORY');
          }
        }
      }
    };

    const tick = (now: number) => {
      const rawDt = (now - lastTimestamp) / 1000;
      lastTimestamp = now;
      const dt = Math.min(Math.max(rawDt, 0), 0.05);

      stepSimulation(dt);

      const canvas = canvasRef.current;
      const staticMap = staticMapRef.current;
      const assets = assetsRef.current;
      if (canvas && staticMap && assets) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const s = simRef.current;
          const shakeX =
            s.shakeTimer > 0 ? (Math.random() * 2 - 1) * s.shakeMagnitude * (s.shakeTimer / 0.14) : 0;
          const shakeY =
            s.shakeTimer > 0 ? (Math.random() * 2 - 1) * s.shakeMagnitude * (s.shakeTimer / 0.14) : 0;

          renderGameFrame(ctx, staticMap, assets, {
            timeSec: s.timeSec,
            towers: s.towers,
            enemies: s.enemies,
            projectiles: s.projectiles,
            particles: s.particles,
            hoverTile: hoverTileRef.current,
            isPlacing: gameStateRef.current === 'PLAYING' && isPlacingRef.current,
            canAffordPlacement: s.money >= LUFFY_SPEC.cost,
            movingTowerId: movingTowerIdRef.current,
            selectedTowerId: selectedTowerIdRef.current,
            shakeOffset: { x: shakeX, y: shakeY },
          });
        }
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [spawnBurst, syncHudFromSim, updateGameState]);

  // Translate pointer client coordinates into exact 30x17 grid tile coordinates
  const pointerToTile = (e: React.PointerEvent<HTMLCanvasElement>): { col: number; row: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * VIRTUAL_WIDTH;
    const vy = ((e.clientY - rect.top) / rect.height) * VIRTUAL_HEIGHT;
    const col = Math.floor(vx / TILE_SIZE);
    const row = Math.floor(vy / TILE_SIZE);
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return null;
    return { col, row };
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (gameStateRef.current !== 'PLAYING') return;
    hoverTileRef.current = pointerToTile(e);
  };

  const handleCanvasPointerLeave = () => {
    hoverTileRef.current = null;
  };

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (gameStateRef.current !== 'PLAYING') return;
    const tile = pointerToTile(e);
    if (!tile) return;

    const s = simRef.current;
    const existingTower = s.towers.find((t) => t.col === tile.col && t.row === tile.row);

    // Clicking a placed Luffy on the field selects him and opens his expanded info card
    if (existingTower && movingTowerIdRef.current !== existingTower.id) {
      isPlacingRef.current = false;
      movingTowerIdRef.current = null;
      selectedTowerIdRef.current = existingTower.id;
      setIsPlacingUI(false);
      setInfoDrawer({ spec: LUFFY_SPEC, towerId: existingTower.id });
      syncHudFromSim();
      return;
    }

    // Place a new Luffy ($30, up to 3) or move an existing Luffy onto a valid empty grass tile
    if (isPlacingRef.current) {
      const occupied = s.towers.some(
        (t) => t.id !== movingTowerIdRef.current && t.col === tile.col && t.row === tile.row
      );

      if (!isTileBuildable(tile.col, tile.row) || occupied) {
        setHintText(occupied ? 'A character is already on that tile' : 'Cannot place on path or scenery');
        return;
      }

      const center = tileToCenter(tile.col, tile.row);

      if (movingTowerIdRef.current !== null) {
        const targetTower = s.towers.find((t) => t.id === movingTowerIdRef.current);
        if (targetTower) {
          targetTower.col = tile.col;
          targetTower.row = tile.row;
          targetTower.x = center.x;
          targetTower.y = center.y;
          selectedTowerIdRef.current = targetTower.id;
          setInfoDrawer({ spec: LUFFY_SPEC, towerId: targetTower.id });
        }
        movingTowerIdRef.current = null;
        isPlacingRef.current = false;
        setIsPlacingUI(false);
      } else {
        const luffyCount = s.towers.filter((t) => t.specId === LUFFY_SPEC.id).length;
        if (luffyCount >= LUFFY_SPEC.maxPlacements) {
          isPlacingRef.current = false;
          setIsPlacingUI(false);
          setHintText(`Max ${LUFFY_SPEC.maxPlacements} ${LUFFY_SPEC.name}s placed`);
          return;
        }
        if (s.money < LUFFY_SPEC.cost) {
          isPlacingRef.current = false;
          setIsPlacingUI(false);
          setHintText(`Need $${LUFFY_SPEC.cost} to place ${LUFFY_SPEC.name}`);
          return;
        }

        s.money -= LUFFY_SPEC.cost;
        const newId = s.nextId++;
        s.towers.push({
          id: newId,
          specId: LUFFY_SPEC.id,
          col: tile.col,
          row: tile.row,
          x: center.x,
          y: center.y,
          cooldownRemaining: 0,
          facingAngle: 0,
          facingLeft: false,
          punchAnimTimer: 0,
          recoilTimer: 0,
        });

        const nextCount = luffyCount + 1;
        if (nextCount >= LUFFY_SPEC.maxPlacements || s.money < LUFFY_SPEC.cost) {
          isPlacingRef.current = false;
          setIsPlacingUI(false);
        }
        selectedTowerIdRef.current = newId;
        setInfoDrawer({ spec: LUFFY_SPEC, towerId: newId });
      }

      setHintText('');
      spawnBurst(center.x, center.y, 6, ['#a7f3d0', '#fef08a']);
      retroAudio.playPlace();
      syncHudFromSim();
      return;
    }

    if (selectedTowerIdRef.current !== null) {
      selectedTowerIdRef.current = null;
      setInfoDrawer(null);
      syncHudFromSim();
    }
  };

  const isPlayingOverlayVisible =
    gameState !== 'TITLE_MENU' && gameState !== 'BUILD_TEAM';

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#162319] text-slate-100">
      {/* Full-viewport pixelated game map */}
      <div className="relative h-full w-full">
        <canvas
          ref={canvasRef}
          width={VIRTUAL_WIDTH}
          height={VIRTUAL_HEIGHT}
          onPointerMove={handleCanvasPointerMove}
          onPointerLeave={handleCanvasPointerLeave}
          onPointerDown={handleCanvasPointerDown}
          className={`pixelated block h-full w-full ${
            gameState === 'PLAYING' && isPlacingUI ? 'cursor-crosshair' : 'cursor-pointer'
          }`}
        />

        {/* In-Game HUD Overlay */}
        {isPlayingOverlayVisible && (
          <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-2.5 sm:p-3">
            {/* Top Perimeter Bar: Only single Lives count + Wave label */}
            <div className="flex items-start justify-between gap-3">
              <div className="pointer-events-auto flex items-center gap-3.5 border-2 border-[#3b5741] bg-[#172419]/95 px-3 py-1.5 text-sm">
                <div className="flex items-center gap-1.5 font-mono-tabular font-bold text-rose-300">
                  <svg viewBox="0 0 12 12" className="h-3.5 w-3.5 fill-rose-500" aria-hidden="true">
                    <path d="M2 2h3v1h2V2h3v1h1v3H9v2H7v2H5V8H3V6H1V3h1V2z" />
                  </svg>
                  <span>{hud.lives}</span>
                </div>

                <span className="text-[#4a6a50]" aria-hidden="true">
                  |
                </span>

                <div className="font-mono-tabular font-bold text-amber-200">
                  Wave {hud.waveNumber}
                </div>
              </div>

              {/* Top-right Mute & Pause Controls */}
              <div className="pointer-events-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleMute}
                  aria-label={muted ? 'Unmute audio' : 'Mute audio'}
                  className="flex h-9 w-9 items-center justify-center border-2 border-[#3b5741] bg-[#172419]/95 text-slate-200 transition-colors hover:border-amber-300 hover:text-white focus-visible:outline-2 focus-visible:outline-amber-300"
                >
                  {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => updateGameState(gameState === 'PAUSED' ? 'PLAYING' : 'PAUSED')}
                  aria-label={gameState === 'PAUSED' ? 'Resume game' : 'Pause game'}
                  className="flex h-9 items-center gap-1.5 border-2 border-[#3b5741] bg-[#172419]/95 px-3 text-xs font-semibold text-slate-200 transition-colors hover:border-amber-300 hover:text-white focus-visible:outline-2 focus-visible:outline-amber-300 whitespace-nowrap shrink-0"
                >
                  {gameState === 'PAUSED' ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                  <span>{gameState === 'PAUSED' ? 'Resume' : 'Pause'}</span>
                </button>
              </div>
            </div>

            {/* Transient Hint / Wave Bonus Banner */}
            {hintText && (
              <div className="self-center border-2 border-amber-400 bg-[#172419]/95 px-3 py-1 text-xs font-semibold text-amber-200">
                {hintText}
              </div>
            )}

            {/* Compact Money + 5-Slot Rectangular Hotbar + Send Button Floating on Right Edge of Map */}
            <div className="pointer-events-none absolute right-2.5 top-14 flex items-end gap-2">
              {/* Expanded Character Info Card */}
              {infoDrawer && gameState === 'PLAYING' && (
                <div className="pointer-events-auto w-56 border-2 border-[#4a6a50] bg-[#172419]/95 p-2.5 shadow-2xl">
                  <div className="flex items-start justify-between gap-2 border-b border-[#2d4532] pb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#4a6a50] bg-[#243828]">
                        <img
                          src={infoDrawer.spec.iconUrl}
                          alt={infoDrawer.spec.name}
                          referrerPolicy="no-referrer"
                          className="pixelated h-7 w-7 object-contain"
                        />
                      </div>
                      <div>
                        <div className="font-pixel text-sm font-bold text-white leading-tight">
                          {infoDrawer.spec.name}
                        </div>
                        <div className="text-[10px] font-semibold text-amber-300">
                          Rarity: {infoDrawer.spec.rarity}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setInfoDrawer(null);
                        selectedTowerIdRef.current = null;
                        syncHudFromSim();
                      }}
                      aria-label="Close character info"
                      className="p-0.5 text-slate-400 hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <p className="mt-1.5 text-[10px] leading-snug text-slate-300">
                    {infoDrawer.spec.description}
                  </p>

                  <div className="mt-2 grid grid-cols-2 gap-x-2.5 gap-y-1 border-y border-[#2d4532] py-1.5 text-[11px] font-mono-tabular">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Dmg</span>
                      <span className="font-bold text-white">{infoDrawer.spec.damagePerHit}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Speed</span>
                      <span className="font-bold text-emerald-300">{infoDrawer.spec.hitsPerSecond}/s</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Cost</span>
                      <span className="font-bold text-amber-200">{infoDrawer.spec.costLabel}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Placed</span>
                      <span className="font-bold text-white">
                        {hud.towersPlaced}/{infoDrawer.spec.maxPlacements}
                      </span>
                    </div>
                    <div className="col-span-2 flex justify-between">
                      <span className="text-slate-400">Range</span>
                      <span className="font-bold text-slate-200">{infoDrawer.spec.rangeTiles} tiles</span>
                    </div>
                  </div>

                  <div className="mt-2 flex items-center gap-1.5">
                    {infoDrawer.towerId !== null ? (
                      <>
                        <button
                          type="button"
                          onClick={() => handleMoveSelectedTower(infoDrawer.towerId!)}
                          className="flex flex-1 items-center justify-center gap-1 border border-[#4a6a50] bg-[#243828] px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-[#2f4934] whitespace-nowrap"
                        >
                          <Move className="h-3 w-3" />
                          <span>Move</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveSelectedTower(infoDrawer.towerId!)}
                          className="flex flex-1 items-center justify-center gap-1 border border-rose-800/80 bg-rose-950/80 px-2 py-1 text-[11px] font-semibold text-rose-200 transition-colors hover:bg-rose-900 whitespace-nowrap"
                        >
                          <Trash2 className="h-3 w-3" />
                          <span>Sell +${infoDrawer.spec.cost}</span>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={
                          hud.towersPlaced >= infoDrawer.spec.maxPlacements ||
                          hud.money < infoDrawer.spec.cost
                        }
                        onClick={() => handleArmPlacementFromInfo(infoDrawer.spec)}
                        className={`w-full border px-2.5 py-1 text-[11px] font-bold transition-colors whitespace-nowrap ${
                          hud.towersPlaced >= infoDrawer.spec.maxPlacements ||
                          hud.money < infoDrawer.spec.cost
                            ? 'cursor-default border-[#334737] bg-[#1d2c20] text-slate-400'
                            : 'border-emerald-300 bg-emerald-600 text-white hover:bg-emerald-500'
                        }`}
                      >
                        {hud.towersPlaced >= infoDrawer.spec.maxPlacements
                          ? `Max Placed (${infoDrawer.spec.maxPlacements}/${infoDrawer.spec.maxPlacements})`
                          : hud.money < infoDrawer.spec.cost
                          ? `Need $${infoDrawer.spec.cost}`
                          : isPlacingUI
                          ? 'Click Grass to Place'
                          : `Place ${infoDrawer.spec.name} ($${infoDrawer.spec.cost})`}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="pointer-events-auto flex flex-col items-stretch gap-1.5">
                {/* Compact Cash Display */}
                <div className="border-2 border-[#3b5741] bg-[#172419]/95 px-1 py-1 text-center font-mono-tabular text-xs font-bold text-amber-300 shadow-lg">
                  ${hud.money}
                </div>

                {/* Compact Rectangular 5-Slot Hotbar Box */}
                <div className="flex flex-col gap-1 border-2 border-[#3b5741] bg-[#172419]/90 p-1 shadow-xl">
                  {HOTBAR_SLOTS.map((slot, index) => {
                    if (!slot) {
                      return (
                        <div
                          key={`empty-slot-${index}`}
                          aria-label={`Empty hotbar slot ${index + 1}`}
                          className="flex h-11 w-11 items-center justify-center border border-[#2a3f2f] bg-[#121d14]/90 text-[10px] font-mono-tabular text-slate-600"
                        >
                          {index + 1}
                        </div>
                      );
                    }

                    const isActive =
                      infoDrawer?.spec.id === slot.id || (isPlacingUI && movingTowerIdRef.current === null);
                    const canAfford = hud.money >= slot.cost;

                    return (
                      <button
                        key={slot.id}
                        type="button"
                        onClick={() => handleHotbarSlotClick(slot)}
                        aria-label={`${slot.name} (${hud.towersPlaced}/${slot.maxPlacements})`}
                        className={`relative flex h-11 w-11 flex-col items-center justify-between border py-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-amber-300 ${
                          isActive
                            ? 'border-amber-300 bg-[#263d2a]'
                            : canAfford
                            ? 'border-[#4a6a50] bg-[#1f3122] hover:border-emerald-300'
                            : 'border-[#334737] bg-[#18241a] opacity-75 hover:border-amber-400/60'
                        }`}
                      >
                        <span className="font-mono-tabular text-[8px] font-bold leading-none text-amber-300">
                          ${slot.cost}
                        </span>
                        <img
                          src={slot.iconUrl}
                          alt={slot.name}
                          referrerPolicy="no-referrer"
                          className="pixelated h-5 w-5 object-contain"
                        />
                        <span className="font-mono-tabular text-[8px] font-bold leading-none text-emerald-300">
                          {hud.towersPlaced}/{slot.maxPlacements}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Compact Send Wave Button */}
                <button
                  type="button"
                  onClick={handleSendWave}
                  disabled={hud.waveStarted}
                  className={`flex flex-col items-center justify-center border-2 px-1 py-1.5 font-pixel text-[11px] font-bold leading-tight transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-amber-300 ${
                    hud.waveStarted
                      ? 'cursor-default border-[#334737] bg-[#1d2c20]/90 text-slate-400'
                      : hud.towersPlaced > 0
                      ? 'border-emerald-300 bg-emerald-600/95 text-white hover:bg-emerald-500'
                      : 'border-amber-300/70 bg-[#283c2b]/95 text-amber-100 hover:bg-[#324b36]'
                  }`}
                >
                  <Play className="h-3 w-3 fill-current" />
                  <span>{hud.waveStarted ? 'Active' : 'Send'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Title Screen: ONLY Title, Start Game, and Build Team */}
        {gameState === 'TITLE_MENU' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0f1b12]/65 p-6 text-center">
            <div className="mb-8 flex flex-col items-center">
              <svg
                viewBox="0 0 360 72"
                className="h-16 w-auto sm:h-20"
                role="img"
                aria-label="A one piece TD"
              >
                <rect x="6" y="8" width="348" height="56" fill="#172419" stroke="#facc15" strokeWidth="4" />
                <rect x="12" y="14" width="336" height="44" fill="none" stroke="#4ade80" strokeWidth="2" />
                <text
                  x="180"
                  y="45"
                  textAnchor="middle"
                  fill="#fef08a"
                  fontSize="26"
                  fontWeight="700"
                  fontFamily="'Pixelify Sans', monospace"
                  letterSpacing="2"
                >
                  A one piece TD
                </text>
              </svg>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
              <button
                type="button"
                onClick={handleStartGame}
                className="border-2 border-emerald-200 bg-emerald-600 px-8 py-3 font-pixel text-xl font-bold tracking-wide text-white transition-transform hover:scale-[1.03] hover:bg-emerald-500 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-amber-300 whitespace-nowrap"
              >
                Start Game
              </button>

              <button
                type="button"
                onClick={() => updateGameState('BUILD_TEAM')}
                className="flex items-center justify-center gap-2 border-2 border-amber-300 bg-[#172419] px-7 py-3 font-pixel text-xl font-bold tracking-wide text-amber-200 transition-transform hover:scale-[1.03] hover:bg-[#233726] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-amber-300 whitespace-nowrap"
              >
                <Users className="h-5 w-5" />
                <span>Build Team</span>
              </button>
            </div>
          </div>
        )}

        {/* Build Team Screen (1 starter defender unlocked for everyone: Luffy) */}
        {gameState === 'BUILD_TEAM' && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0f1b12]/75 p-4">
            <div className="w-full max-w-md border-4 border-[#3b5741] bg-[#172419] p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-[#2d4532] pb-3">
                <h2 className="font-pixel text-2xl font-bold text-amber-200">Build Team</h2>
                <span className="font-mono-tabular text-xs font-bold text-emerald-300">
                  1 / 5 Slots
                </span>
              </div>

              <div className="mt-4 flex items-center gap-4 border-2 border-emerald-400/70 bg-[#213424] p-3.5">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center border border-[#4a6a50] bg-[#172419]">
                  <img
                    src={LUFFY_PNG_URL}
                    alt={LUFFY_SPEC.name}
                    referrerPolicy="no-referrer"
                    className="pixelated h-11 w-11 object-contain"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-pixel text-lg font-bold text-white">{LUFFY_SPEC.name}</span>
                    <span className="font-mono-tabular text-xs font-bold text-emerald-300">Equipped</span>
                  </div>
                  <p className="mt-0.5 font-mono-tabular text-xs text-slate-300">
                    $30 · 3 hits/sec · 1 dmg · Max 3
                  </p>
                </div>
              </div>

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={() => updateGameState('TITLE_MENU')}
                  className="flex items-center gap-2 border-2 border-[#4a6a50] bg-[#243828] px-5 py-2 font-pixel text-base font-bold text-white transition-colors hover:bg-[#2f4934] focus-visible:outline-2 focus-visible:outline-amber-300 whitespace-nowrap"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Back</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Pause / Victory / Game Over Modal (Only shows Defeated & Leaked, no Lives count) */}
        {(gameState === 'PAUSED' || gameState === 'VICTORY' || gameState === 'GAME_OVER') && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0f1b12]/70 p-4">
            <div className="w-full max-w-sm border-4 border-[#3b5741] bg-[#172419] p-6 text-center shadow-2xl">
              <h2
                className={`font-pixel text-3xl font-bold ${
                  gameState === 'VICTORY'
                    ? 'text-emerald-300'
                    : gameState === 'GAME_OVER'
                    ? 'text-rose-400'
                    : 'text-amber-200'
                }`}
              >
                {gameState === 'PAUSED'
                  ? 'Game Paused'
                  : gameState === 'VICTORY'
                  ? 'Stage Cleared'
                  : 'Defenses Breached'}
              </h2>

              <div className="mt-4 flex justify-center gap-6 border-y border-[#2d4532] py-3 font-mono-tabular text-sm">
                <div>
                  <div className="text-xs text-slate-400">Defeated</div>
                  <div className="font-bold text-emerald-300">{hud.enemiesPopped}</div>
                </div>
                <span className="text-[#3b5741]" aria-hidden="true">
                  |
                </span>
                <div>
                  <div className="text-xs text-slate-400">Leaked</div>
                  <div className="font-bold text-rose-300">{hud.enemiesLeaked}</div>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-2.5">
                {gameState === 'PAUSED' && (
                  <button
                    type="button"
                    onClick={() => updateGameState('PLAYING')}
                    className="w-full border-2 border-emerald-300 bg-emerald-600 px-5 py-2.5 font-pixel text-lg font-bold text-white transition-colors hover:bg-emerald-500 whitespace-nowrap"
                  >
                    Resume
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => resetStage('PLAYING')}
                  className={`flex w-full items-center justify-center gap-2 border-2 px-5 py-2.5 font-pixel text-lg font-bold transition-colors whitespace-nowrap ${
                    gameState === 'PAUSED'
                      ? 'border-[#4a6a50] bg-[#243828] text-slate-100 hover:bg-[#2f4934]'
                      : 'border-emerald-300 bg-emerald-600 text-white hover:bg-emerald-500'
                  }`}
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>{gameState === 'PAUSED' ? 'Restart Stage' : 'Play Again'}</span>
                </button>

                {gameState === 'PAUSED' && (
                  <button
                    type="button"
                    onClick={() => resetStage('TITLE_MENU')}
                    className="w-full border-2 border-[#3b5741] bg-transparent px-5 py-2 text-xs font-semibold text-slate-300 transition-colors hover:bg-[#223526] hover:text-white whitespace-nowrap"
                  >
                    Main Menu
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
