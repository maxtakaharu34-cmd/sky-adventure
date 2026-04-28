import { useRef, useEffect, useCallback, useState } from 'react';
import { CANVAS_W, CANVAS_H, CHARACTERS, POWERUP_CONFIG } from '../game/constants';
import type { CharId } from '../game/constants';
import { Player, Platform, Coin, Powerup, Enemy, buildLevel, rectsOverlap } from '../game/entities';
import { LEVELS } from '../game/levels';
import {
  drawBackground, drawPlatform, drawCoin, drawPowerup,
  drawEnemy, drawPlayer, drawGoal, drawHUD,
  drawLevelComplete, drawGameOver,
} from '../game/renderer';
import {
  initAudio, sfxJump, sfxCoin, sfxHit, sfxPowerup,
  sfxDie, sfxClear, sfxStep,
} from '../game/sounds';

type Screen = 'menu' | 'char_select' | 'playing' | 'level_complete' | 'gameover' | 'leaderboard';
type Mode = 'single' | 'multi';

interface LeaderEntry { name: string; score: number; coins: number; date: string; }

function getLeaderboard(): LeaderEntry[] {
  try { return JSON.parse(localStorage.getItem('skyAdventureBoard') || '[]'); } catch { return []; }
}
function saveScore(entry: LeaderEntry) {
  const board = getLeaderboard();
  board.push(entry);
  board.sort((a, b) => b.score - a.score);
  localStorage.setItem('skyAdventureBoard', JSON.stringify(board.slice(0, 10)));
}

export default function SkyAdventureGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [screen, setScreen] = useState<Screen>('menu');
  const [mode, setMode] = useState<Mode>('single');
  const [p1Char, setP1Char] = useState<CharId>('rabbit');
  const [p2Char, setP2Char] = useState<CharId>('fox');
  const [currentLevel, setCurrentLevel] = useState(1);
  const [scores, setScores] = useState<number[]>([0]);
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([]);
  const [soundOn, setSoundOn] = useState(true);

  // Game refs
  const screenRef = useRef<Screen>('menu');
  const keysRef = useRef<Set<string>>(new Set());
  const playersRef = useRef<Player[]>([]);
  const platformsRef = useRef<Platform[]>([]);
  const coinsRef = useRef<Coin[]>([]);
  const powerupsRef = useRef<Powerup[]>([]);
  const enemiesRef = useRef<Enemy[]>([]);
  const camXRef = useRef(0);
  const levelRef = useRef(1);
  const soundRef = useRef(true);
  const animRef = useRef(0);
  const levelDataRef = useRef(LEVELS[0]);

  useEffect(() => { screenRef.current = screen; }, [screen]);
  useEffect(() => { soundRef.current = soundOn; }, [soundOn]);

  const sfx = useCallback((fn: () => void) => { if (soundRef.current) fn(); }, []);

  // ─── Level init ─────────────────────────────────────────────────────────
  const loadLevel = useCallback((lvlIdx: number, chars: CharId[], gameMode: Mode) => {
    const data = LEVELS[lvlIdx];
    levelDataRef.current = data;
    const { platforms, coins, powerups, enemies } = buildLevel(data);
    platformsRef.current = platforms;
    coinsRef.current = coins;
    powerupsRef.current = powerups;
    enemiesRef.current = enemies;
    camXRef.current = 0;

    const p1 = new Player(data.spawnX, data.spawnY, chars[0], 0);
    const p2 = gameMode === 'multi'
      ? new Player(data.spawnX + 40, data.spawnY, chars[1], 1)
      : null;
    playersRef.current = p2 ? [p1, p2] : [p1];
  }, []);

  // ─── Start game ─────────────────────────────────────────────────────────
  const startGame = useCallback((lvl = 1) => {
    initAudio();
    levelRef.current = lvl;
    setCurrentLevel(lvl);
    loadLevel(lvl - 1, [p1Char, p2Char], mode);
    setScreen('playing');
  }, [loadLevel, p1Char, p2Char, mode]);

  // ─── Keyboard ───────────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keysRef.current.add(e.key);
      if (e.key === ' ' || e.key === 'ArrowUp') e.preventDefault();

      if (['ArrowUp', ' ', 'w'].includes(e.key)) {
        const players = playersRef.current;
        const jumpKey = e.key === 'w' ? 1 : 0;
        const p = players[jumpKey];
        if (p && (p.onGround || p.jumpsLeft > 0)) {
          p.jump();
          sfx(sfxJump);
        }
      }

      // Pause
      if (e.key === 'p' || e.key === 'P') {
        if (screenRef.current === 'playing') setScreen('menu');
      }

      // Enter on overlays
      if (e.key === 'Enter') {
        if (screenRef.current === 'level_complete') {
          const next = levelRef.current + 1;
          if (next <= LEVELS.length) startGame(next);
          else setScreen('menu');
        }
        if (screenRef.current === 'gameover') {
          startGame(levelRef.current);
        }
      }
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [sfx, startGame]);

  // ─── Touch controls ─────────────────────────────────────────────────────
  const touchX = useRef(0);
  useEffect(() => {
    const start = (e: TouchEvent) => { touchX.current = e.touches[0].clientX; };
    const move = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - touchX.current;
      if (Math.abs(dx) > 10) {
        keysRef.current.delete('ArrowLeft');
        keysRef.current.delete('ArrowRight');
        if (dx < 0) keysRef.current.add('ArrowLeft');
        else keysRef.current.add('ArrowRight');
      }
    };
    const end = () => { keysRef.current.delete('ArrowLeft'); keysRef.current.delete('ArrowRight'); };
    window.addEventListener('touchstart', start);
    window.addEventListener('touchmove', move);
    window.addEventListener('touchend', end);
    return () => {
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
    };
  }, []);

  // ─── Game loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext('2d')!;
    let stepTimer = 0;

    const loop = () => {
      animRef.current = requestAnimationFrame(loop);
      const s = screenRef.current;

      if (s !== 'playing') {
        // Draw static background
        const lvlData = levelDataRef.current;
        drawBackground(ctx, lvlData.bgColors, camXRef.current, lvlData.width);
        if (s === 'level_complete') {
          const p = playersRef.current[0];
          drawLevelComplete(ctx, p?.score ?? 0, p?.coins ?? 0, levelRef.current);
        }
        if (s === 'gameover') {
          const p = playersRef.current[0];
          drawGameOver(ctx, p?.score ?? 0);
        }
        return;
      }

      const keys = keysRef.current;
      const players = playersRef.current;
      const platforms = platformsRef.current;
      const coins = coinsRef.current;
      const powerups = powerupsRef.current;
      const enemies = enemiesRef.current;
      const lvlData = levelDataRef.current;

      // ── Update platforms
      platforms.forEach(p => p.update());

      // ── Update players
      players.forEach(p => {
        if (!p.alive) return;
        p.update(keys, platforms, 1);

        // Coin collection
        coins.forEach(c => {
          if (c.collected) return;
          if (rectsOverlap({ x: p.x, y: p.y, w: p.w, h: p.h }, { x: c.x, y: c.y, w: c.w, h: c.h }) ||
              (p.hasPowerup('coin_magnet') && Math.hypot(p.x - c.x, p.y - c.y) < 80)) {
            c.collected = true;
            p.coins++;
            p.score += 10;
            sfx(sfxCoin);
          }
        });

        // Powerup collection
        powerups.forEach(pu => {
          if (pu.collected) return;
          if (rectsOverlap({ x: p.x, y: p.y, w: p.w, h: p.h }, { x: pu.x, y: pu.y, w: pu.w, h: pu.h })) {
            pu.collected = true;
            const cfg = POWERUP_CONFIG[pu.type];
            p.activePowerups.push({ type: pu.type, expiresAt: Date.now() + cfg.duration });
            sfx(sfxPowerup);
          }
        });

        // Enemy collision
        enemies.forEach(e => {
          if (!e.alive) return;
          if (!rectsOverlap({ x: p.x, y: p.y, w: p.w, h: p.h }, { x: e.x, y: e.y, w: e.w, h: e.h })) return;

          const playerBottom = p.y + p.h;
          const enemyTop = e.y;
          const isStomping = p.vy > 0 && playerBottom < e.y + e.h * 0.4;

          if (isStomping || p.hasPowerup('star')) {
            e.alive = false;
            p.vy = -8;
            p.score += 50;
            sfx(sfxHit);
          } else if (!p.isInvincible) {
            if (p.hasPowerup('shield')) {
              p.activePowerups = p.activePowerups.filter(ap => ap.type !== 'shield');
              p.invincibleUntil = Date.now() + 1500;
            } else {
              p.alive = false;
              sfx(sfxDie);
            }
          }
        });

        // Step sound
        if (p.onGround && (keys.has('ArrowLeft') || keys.has('ArrowRight') || keys.has('a') || keys.has('d'))) {
          stepTimer++;
          if (stepTimer % 18 === 0) sfx(sfxStep);
        }

        // Goal touch
        const goalRect = { x: lvlData.goal.x, y: lvlData.goal.y, w: 30, h: 60 };
        if (rectsOverlap({ x: p.x, y: p.y, w: p.w, h: p.h }, goalRect)) {
          p.score += 200;
          sfx(sfxClear);
          const newLvl = levelRef.current;
          setScores([...players.map(pl => pl.score)]);
          saveScore({
            name: `P1-${p.charId}`,
            score: p.score,
            coins: p.coins,
            date: new Date().toLocaleDateString(),
          });
          setScreen('level_complete');
          return;
        }
      });

      // All players dead
      if (players.length > 0 && players.every(p => !p.alive)) {
        setScreen('gameover');
        return;
      }

      // ── Update entities
      coins.forEach(c => c.update());
      powerups.forEach(pu => pu.update());
      enemies.forEach(e => e.update(platforms));

      // ── Camera follow P1
      const p1 = players[0];
      if (p1) {
        const targetCam = p1.x - CANVAS_W / 3;
        camXRef.current += (targetCam - camXRef.current) * 0.1;
        camXRef.current = Math.max(0, Math.min(camXRef.current, lvlData.width - CANVAS_W));
      }

      // ── Draw
      drawBackground(ctx, lvlData.bgColors, camXRef.current, lvlData.width);

      ctx.save();
      ctx.translate(-camXRef.current, 0);

      platforms.forEach(p => drawPlatform(ctx, p));
      coins.forEach(c => drawCoin(ctx, c));
      powerups.forEach(pu => drawPowerup(ctx, pu));
      enemies.forEach(e => drawEnemy(ctx, e));
      players.forEach(p => drawPlayer(ctx, p));
      drawGoal(ctx, lvlData.goal);

      ctx.restore();

      drawHUD(ctx, players, levelRef.current, LEVELS.length);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [sfx]);

  // ─── UI ──────────────────────────────────────────────────────────────────
  const unlockedChars = CHARACTERS.filter(c => c.unlocked);

  return (
    <div className="flex flex-col items-center gap-4 select-none">
      <canvas
        ref={canvasRef}
        className="rounded-xl shadow-2xl shadow-purple-900/60 border-2 border-purple-700"
        style={{ maxWidth: '100%', imageRendering: 'pixelated' }}
      />

      {/* ── Menu ─── */}
      {screen === 'menu' && (
        <div className="flex flex-col items-center gap-4 w-full max-w-sm">
          <div className="flex gap-2">
            <button
              onClick={() => setMode('single')}
              className={`px-4 py-2 rounded-lg text-sm font-bold ${mode === 'single' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300'}`}
            >
              1 Player
            </button>
            <button
              onClick={() => setMode('multi')}
              className={`px-4 py-2 rounded-lg text-sm font-bold ${mode === 'multi' ? 'bg-purple-600 text-white' : 'bg-gray-700 text-gray-300'}`}
            >
              2 Players
            </button>
          </div>

          {/* Character select */}
          <div className="w-full">
            <p className="text-purple-300 text-xs mb-1 text-center">P1 Character</p>
            <div className="flex justify-center gap-2 flex-wrap">
              {unlockedChars.map(c => (
                <button
                  key={c.id}
                  onClick={() => setP1Char(c.id as CharId)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold border-2 transition-all ${p1Char === c.id ? 'border-yellow-400 scale-110' : 'border-gray-600'}`}
                  style={{ background: c.color + '33', color: c.color }}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {mode === 'multi' && (
            <div className="w-full">
              <p className="text-purple-300 text-xs mb-1 text-center">P2 Character</p>
              <div className="flex justify-center gap-2 flex-wrap">
                {unlockedChars.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setP2Char(c.id as CharId)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold border-2 transition-all ${p2Char === c.id ? 'border-yellow-400 scale-110' : 'border-gray-600'}`}
                    style={{ background: c.color + '33', color: c.color }}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => startGame(1)}
              className="px-8 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl text-lg font-bold hover:scale-105 transition-transform shadow-lg"
            >
              🚀 Start
            </button>
            <button
              onClick={() => { setLeaderboard(getLeaderboard()); setScreen('leaderboard'); }}
              className="px-4 py-3 bg-gray-700 text-yellow-400 rounded-xl text-sm font-bold hover:bg-gray-600"
            >
              🏆 Scores
            </button>
            <button
              onClick={() => setSoundOn(s => !s)}
              className="px-4 py-3 bg-gray-700 text-white rounded-xl text-sm hover:bg-gray-600"
            >
              {soundOn ? '🔊' : '🔇'}
            </button>
          </div>

          <div className="text-gray-500 text-xs text-center">
            P1: ←→ Move · ↑ Jump · Space Hard Jump<br />
            P2: A D Move · W Jump
          </div>
        </div>
      )}

      {/* ── Leaderboard ─── */}
      {screen === 'leaderboard' && (
        <div className="flex flex-col items-center gap-3 w-full max-w-sm">
          <h3 className="text-yellow-400 font-bold text-lg">🏆 Top Scores</h3>
          <div className="w-full bg-gray-800 rounded-xl overflow-hidden">
            {leaderboard.length === 0 ? (
              <p className="text-gray-400 text-center p-4 text-sm">No scores yet</p>
            ) : leaderboard.map((e, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2 border-b border-gray-700 last:border-0">
                <span className="text-yellow-400 font-bold w-6 text-sm">{i + 1}</span>
                <span className="text-white text-sm flex-1">{e.name}</span>
                <span className="text-purple-400 font-bold text-sm">{e.score}pt</span>
                <span className="text-yellow-300 text-xs">🪙 {e.coins}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => setScreen('menu')}
            className="px-6 py-2 bg-purple-700 text-white rounded-lg font-bold hover:bg-purple-600"
          >
            ← Back
          </button>
        </div>
      )}

      {/* ── In-game controls ─── */}
      {screen === 'playing' && (
        <div className="flex flex-col gap-2 w-full max-w-xs md:hidden">
          <div className="flex justify-center gap-2">
            <button
              onTouchStart={(e) => { e.preventDefault(); playersRef.current[0]?.jump(); sfx(sfxJump); }}
              className="w-14 h-14 bg-purple-700 rounded-xl text-2xl font-bold active:bg-purple-500 flex items-center justify-center text-white"
            >↑</button>
          </div>
          <div className="flex justify-center gap-3">
            <button
              onTouchStart={(e) => { e.preventDefault(); keysRef.current.add('ArrowLeft'); }}
              onTouchEnd={(e) => { e.preventDefault(); keysRef.current.delete('ArrowLeft'); }}
              className="w-14 h-14 bg-purple-700 rounded-xl text-2xl font-bold active:bg-purple-500 flex items-center justify-center text-white"
            >←</button>
            <button
              onTouchStart={(e) => { e.preventDefault(); keysRef.current.add('ArrowRight'); }}
              onTouchEnd={(e) => { e.preventDefault(); keysRef.current.delete('ArrowRight'); }}
              className="w-14 h-14 bg-purple-700 rounded-xl text-2xl font-bold active:bg-purple-500 flex items-center justify-center text-white"
            >→</button>
          </div>
        </div>
      )}

      {/* ── Level complete / Game over buttons ─── */}
      {screen === 'level_complete' && (
        <div className="flex gap-3">
          <button
            onClick={() => {
              const next = currentLevel + 1;
              if (next <= LEVELS.length) startGame(next);
              else setScreen('menu');
            }}
            className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl font-bold hover:scale-105 transition-transform"
          >
            {currentLevel < LEVELS.length ? 'Next Level →' : '🏠 Menu'}
          </button>
          <button
            onClick={() => { setLeaderboard(getLeaderboard()); setScreen('leaderboard'); }}
            className="px-6 py-3 bg-gray-700 text-yellow-400 rounded-xl font-bold hover:bg-gray-600"
          >
            🏆 Scores
          </button>
        </div>
      )}

      {screen === 'gameover' && (
        <div className="flex gap-3">
          <button
            onClick={() => startGame(currentLevel)}
            className="px-6 py-3 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-xl font-bold hover:scale-105 transition-transform"
          >
            Try Again
          </button>
          <button
            onClick={() => setScreen('menu')}
            className="px-6 py-3 bg-gray-700 text-white rounded-xl font-bold hover:bg-gray-600"
          >
            Menu
          </button>
        </div>
      )}
    </div>
  );
}
