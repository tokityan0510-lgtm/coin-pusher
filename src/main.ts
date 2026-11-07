import RAPIER from '@dimforge/rapier3d-compat';
import './style.css';
import {
  DEFAULT_PARAMS,
  DROP_COOLDOWN,
  DROP_SCATTER,
  DROP_X_MAX,
  DROP_Y,
  DROP_Z,
  FIXED_DT,
  FLOOR_X,
  FRONT_Z,
  INITIAL_MEDALS,
  JACKPOT_BASE,
  JACKPOT_STORAGE_KEY,
  MAX_STEPS_PER_FRAME,
  PUSHER_FRONT_RETRACTED,
  REFILL_CREDITS,
  type PhysicsParams,
} from './config';
import { Sound } from './audio';
import { createDebugPanel, type DebugStats } from './debug';
import { Lcd } from './lcd';
import { Payout } from './payout';
import { Machine } from './physics';
import { GameScene, type LightMode } from './scene';
import { SlotMachine } from './slot';
import { CreditStore } from './storage';

/** 画面の上からこの割合までをタップすると投入 */
const DROP_ZONE_RATIO = 0.32;
/** 所持メダル表示のカウントアップ速度（枚/秒） */
const COUNT_UP_RATE = 25;

async function main(): Promise<void> {
  await RAPIER.init();

  const debug = new URLSearchParams(location.search).get('debug') === '1';
  const params: PhysicsParams = { ...DEFAULT_PARAMS };

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const canvas = $<HTMLCanvasElement>('game');
  const creditEl = $('credits');
  const creditBox = $('credit-box');
  const sessionEl = $('session');
  const refillBtn = $<HTMLButtonElement>('refill');
  const muteBtn = $<HTMLButtonElement>('mute');
  const dropZone = $('drop-zone');
  const banner = $('banner');
  const popups = $('popups');
  dropZone.style.height = `${DROP_ZONE_RATIO * 100}%`;

  const store = new CreditStore();
  const sound = new Sound();
  const lcd = new Lcd();
  const scene = new GameScene(canvas, lcd);
  const machine = new Machine(params);
  const payout = new Payout(machine);
  scene.setTilt(params.tiltDeg);
  machine.fillInitial(INITIAL_MEDALS);

  // ---- スロット ----
  const slot = new SlotMachine(
    {
      spinStart: () => sound.spinStart(),
      reelStop: (i) => sound.reelStop(i, i === 2),
      reach: () => sound.reach(),
      win: (symbol, n) => {
        sound.slotWin(symbol === '7');
        lcd.flash(1.6);
        payout.add(n);
        showBanner(symbol === '7' ? `777  +${n}` : `WIN  +${n}`, symbol === '7' ? 'big' : 'win');
      },
      miss: () => sound.miss(),
      jackpotChance: () => {
        sound.jackpotChance();
        showBanner('JACKPOT CHANCE!!', 'chance');
      },
      rouletteTick: () => sound.rouletteTick(),
      rouletteResult: (jackpot, n) => {
        if (jackpot) {
          sound.jackpot();
          lcd.flash(4);
          showBanner(`JACKPOT!!\n+${n}`, 'jackpot');
        } else {
          sound.smallPrize();
          lcd.flash(1.5);
          showBanner(`+${n}`, 'win');
        }
        payout.add(n, jackpot);
      },
      jackpotChange: (v) => {
        try {
          localStorage.setItem(JACKPOT_STORAGE_KEY, String(v));
        } catch {
          // 保存できなくても続行
        }
      },
    },
    loadJackpot(),
  );

  // ---- HUD ----
  const session = { won: 0, lost: 0, chucker: 0 };
  let shownCredits = store.credits;
  let countAcc = 0;
  creditEl.textContent = String(shownCredits);
  const updateSession = () => {
    sessionEl.textContent = `獲得 ${session.won}　没収 ${session.lost}　入賞 ${session.chucker}`;
  };
  updateSession();
  const updateRefill = () => {
    refillBtn.hidden = store.credits > 0;
  };
  updateRefill();
  const updateMute = () => {
    muteBtn.textContent = sound.isMuted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', sound.isMuted ? '音を出す' : '音を消す');
  };
  updateMute();

  let bannerTimer = 0;
  function showBanner(text: string, kind: 'win' | 'big' | 'chance' | 'jackpot'): void {
    banner.textContent = text;
    banner.className = '';
    void banner.offsetWidth;
    banner.className = `show ${kind}`;
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => (banner.className = ''), kind === 'jackpot' ? 4000 : 1800);
  }

  function popup(text: string): void {
    const el = document.createElement('div');
    el.className = 'popup';
    el.textContent = text;
    popups.appendChild(el);
    window.setTimeout(() => el.remove(), 1000);
  }

  refillBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    store.add(REFILL_CREDITS);
    updateRefill();
  });
  muteBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    sound.unlock();
    sound.setMuted(!sound.isMuted);
    updateMute();
  });

  // ---- 入力：画面上部タップでその横位置から投入 ----
  let lastDrop = -Infinity;
  let drops = 0;
  // 音はユーザー操作の中でしか開始できないので、最初の操作で有効にする
  window.addEventListener('pointerdown', () => sound.unlock(), { capture: true });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.clientY > window.innerHeight * DROP_ZONE_RATIO) return;
    const now = performance.now() / 1000;
    if (now - lastDrop < DROP_COOLDOWN) return;
    if (!store.spend()) {
      flash(refillBtn);
      return;
    }
    lastDrop = now;
    const x = clamp(scene.screenXToDropX(e.clientX) + (Math.random() * 2 - 1) * DROP_SCATTER, -DROP_X_MAX, DROP_X_MAX);
    // ほぼ水平、少しだけ傾けて落とす（完全に平らだと着地が不自然に揃う）
    const tilt = (Math.random() - 0.5) * 0.25;
    const half = tilt / 2;
    const rot = { x: Math.sin(half), y: 0, z: 0, w: Math.cos(half) };
    if (!machine.spawnMedal(x, DROP_Y, DROP_Z + (Math.random() - 0.5) * 0.1, rot, true)) {
      store.add(1); // 上限で出せなかったら返却
    } else {
      sound.insert();
    }
    if (++drops === 5) dropZone.classList.add('hint-off');
    shownCredits = Math.min(shownCredits, store.credits);
    creditEl.textContent = String(shownCredits);
    updateRefill();
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
        updateRefill();
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
      onSlotStock: () => slot.addChucker(),
      onSlotForce: (symbol) => {
        slot.forceNext = symbol;
        if (slot.stock === 0 && slot.mode === 'idle') slot.addChucker();
      },
      onShadows: (on) => scene.setShadows(on),
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
  let winSoundCooldown = 0;

  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.25);
    last = now;
    acc += dt;

    let steps = 0;
    let won = 0;
    let lost = 0;
    let chucker = 0;
    let impacts = 0;
    let impactMax = 0;
    let impactPan = 0;
    while (acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      const r = machine.step();
      won += r.won;
      lost += r.lost;
      chucker += r.chucker;
      if (r.impacts > 0) {
        impacts += r.impacts;
        if (r.impactMax > impactMax) {
          impactMax = r.impactMax;
          impactPan = r.impactPan;
        }
      }
      acc -= FIXED_DT;
      steps++;
      stepMsSum += machine.lastStepMs;
      stepCount++;
    }
    // 処理落ち時は溜まった時間を捨てる（スパイラル防止。ゲームが一瞬スローになるだけ）
    if (steps === MAX_STEPS_PER_FRAME && acc > FIXED_DT) acc = FIXED_DT * 0.5;

    // ---- 結果の反映 ----
    if (won > 0) {
      store.add(won);
      session.won += won;
      scene.flashFront();
      popup(`+${won}`);
      if (winSoundCooldown <= 0) {
        sound.win(won);
        winSoundCooldown = 0.12;
      }
      updateRefill();
    }
    if (lost > 0) {
      session.lost += lost;
      sound.lost();
    }
    for (let i = 0; i < chucker; i++) {
      session.chucker++;
      slot.addChucker();
      sound.chucker();
      scene.flashChucker();
    }
    if (impacts > 0) sound.clink(impactMax / 14, impactPan);
    if (won || lost || chucker) updateSession();
    winSoundCooldown -= dt;

    // ---- スロット・払い出し・演出 ----
    slot.update(dt);
    payout.update(dt);
    lcd.update(slot, dt);
    scene.setLightMode(lightModeFor(slot, payout));

    // 所持メダルはカウントアップで見せる（減るときは即時）
    if (shownCredits !== store.credits) {
      if (shownCredits > store.credits) {
        shownCredits = store.credits;
      } else {
        countAcc += dt * COUNT_UP_RATE;
        const n = Math.min(Math.floor(countAcc), store.credits - shownCredits);
        if (n > 0) {
          countAcc -= n;
          shownCredits += n;
          sound.tick();
          creditBox.classList.remove('bump');
          void creditBox.offsetWidth;
          creditBox.classList.add('bump');
        }
      }
      creditEl.textContent = String(shownCredits);
    } else {
      countAcc = 0;
    }

    scene.render(machine, acc / FIXED_DT, dt);

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

function lightModeFor(slot: SlotMachine, payout: Payout): LightMode {
  if (payout.jackpotActive || (slot.mode === 'rouletteResult' && slot.lastRoulette?.jackpot)) return 'jackpot';
  if (slot.mode === 'chance' || slot.mode === 'roulette') return 'chance';
  if (payout.active || (slot.mode === 'result' && slot.lastWin) || slot.mode === 'rouletteResult') return 'win';
  if (slot.mode === 'spin') return 'spin';
  return 'idle';
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function loadJackpot(): number {
  try {
    const n = Number.parseFloat(localStorage.getItem(JACKPOT_STORAGE_KEY) ?? '');
    if (Number.isFinite(n) && n >= JACKPOT_BASE) return n;
  } catch {
    // 読めなければ初期値
  }
  return JACKPOT_BASE;
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
