import RAPIER from '@dimforge/rapier3d-compat';
import './style.css';
import {
  DEFAULT_PARAMS,
  DROP_COOLDOWN,
  DROP_Y,
  DROP_Z,
  FIXED_DT,
  FLOOR_X,
  FRONT_Z,
  INITIAL_MEDALS,
  MAX_STEPS_PER_FRAME,
  PUSHER_FRONT_RETRACTED,
  REFILL_CREDITS,
  type PhysicsParams,
} from './config';
import { createDebugPanel, type DebugStats } from './debug';
import { Machine } from './physics';
import { GameScene } from './scene';
import { CreditStore } from './storage';

/** 画面の上からこの割合までをタップすると投入 */
const DROP_ZONE_RATIO = 0.3;

async function main(): Promise<void> {
  await RAPIER.init();

  const debug = new URLSearchParams(location.search).get('debug') === '1';
  const params: PhysicsParams = { ...DEFAULT_PARAMS };

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const creditEl = document.getElementById('credits') as HTMLElement;
  const sessionEl = document.getElementById('session') as HTMLElement;
  const refillBtn = document.getElementById('refill') as HTMLButtonElement;
  const dropZone = document.getElementById('drop-zone') as HTMLElement;
  dropZone.style.height = `${DROP_ZONE_RATIO * 100}%`;

  const store = new CreditStore();
  const scene = new GameScene(canvas);
  const machine = new Machine(params);
  scene.setTilt(params.tiltDeg);
  machine.fillInitial(INITIAL_MEDALS);

  const session = { won: 0, lost: 0 };
  let shownCredits = -1;
  const updateHud = () => {
    if (store.credits !== shownCredits) {
      shownCredits = store.credits;
      creditEl.textContent = String(shownCredits);
      refillBtn.hidden = shownCredits > 0;
    }
    sessionEl.textContent = `獲得 ${session.won} ／ 没収 ${session.lost}`;
  };
  updateHud();

  refillBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    store.add(REFILL_CREDITS);
    updateHud();
  });

  // ---- 入力：画面上部タップでその横位置から投入 ----
  let lastDrop = -Infinity;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.clientY > window.innerHeight * DROP_ZONE_RATIO) return;
    const now = performance.now() / 1000;
    if (now - lastDrop < DROP_COOLDOWN) return;
    if (!store.spend()) {
      flash(refillBtn);
      return;
    }
    lastDrop = now;
    const x = scene.screenXToDropX(e.clientX) + (Math.random() - 0.5) * 0.05;
    // ほぼ水平、少しだけ傾けて落とす（完全に平らだと着地が不自然に揃う）
    const tilt = (Math.random() - 0.5) * 0.25;
    const half = tilt / 2;
    const rot = { x: Math.sin(half), y: 0, z: 0, w: Math.cos(half) };
    if (!machine.spawnMedal(x, DROP_Y, DROP_Z + (Math.random() - 0.5) * 0.3, rot, true)) {
      store.add(1); // 上限で出せなかったら返却
    }
    updateHud();
  });

  // ---- 調整パネル ----
  const stats: DebugStats = { fps: 0, medals: 0, awake: 0, stepMs: 0 };
  if (debug) {
    createDebugPanel({
      params,
      stats,
      onParamsChange: () => {
        machine.applyParams();
        scene.setTilt(params.tiltDeg);
      },
      onResetBoard: () => {
        machine.clearMedals();
        machine.fillInitial(INITIAL_MEDALS);
      },
      onAddCredits: (n) => {
        store.add(n);
        updateHud();
      },
      onStress: (n) => {
        for (let i = 0; i < n; i++) {
          machine.spawnMedal(
            (Math.random() * 2 - 1) * (FLOOR_X - 0.6),
            1.5 + (i % 20) * 0.3,
            PUSHER_FRONT_RETRACTED + 0.8 + Math.random() * (FRONT_Z - PUSHER_FRONT_RETRACTED - 2),
            undefined,
            true,
          );
        }
      },
      onPusherToggle: (running) => machine.setPusherRunning(running),
    });
  }

  window.addEventListener('resize', () => scene.resize());

  // ---- メインループ：固定タイムステップ＋描画補間 ----
  let last = performance.now();
  let acc = 0;
  let fpsFrames = 0;
  let fpsTime = 0;
  let stepMsSum = 0;
  let stepCount = 0;

  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    acc += dt;

    let steps = 0;
    let gained = 0;
    while (acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      const r = machine.step();
      gained += r.won;
      session.won += r.won;
      session.lost += r.lost;
      acc -= FIXED_DT;
      steps++;
      stepMsSum += machine.lastStepMs;
      stepCount++;
    }
    // 処理落ち時は溜まった時間を捨てる（スパイラル防止。ゲームが一瞬スローになるだけ）
    if (steps === MAX_STEPS_PER_FRAME && acc > FIXED_DT) acc = FIXED_DT * 0.5;
    if (gained > 0) store.add(gained);
    if (steps > 0) updateHud();

    scene.render(machine, acc / FIXED_DT);

    fpsFrames++;
    fpsTime += dt;
    if (fpsTime >= 0.5) {
      stats.fps = fpsFrames / fpsTime;
      stats.medals = machine.count;
      stats.awake = debug ? machine.medals.reduce((a, b) => a + (b.isSleeping() ? 0 : 1), 0) : 0;
      stats.stepMs = stepCount > 0 ? stepMsSum / stepCount : 0;
      fpsFrames = 0;
      fpsTime = 0;
      stepMsSum = 0;
      stepCount = 0;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame((t) => {
    last = t;
    requestAnimationFrame(frame);
  });

  document.getElementById('loading')?.remove();
}

function flash(el: HTMLElement): void {
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  if (el) el.textContent = `起動に失敗しました: ${String(err)}`;
});
