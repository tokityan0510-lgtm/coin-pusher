import RAPIER from '@dimforge/rapier3d-compat';
import './style.css';
import {
  DEFAULT_PARAMS,
  AUTO_FIRE_INTERVAL,
  BALL_RADIUS,
  CHUCKER_BAR_HEIGHT,
  CHUCKER_Y,
  DROP_COOLDOWN,
  DROP_SCATTER,
  DROP_X_MAX,
  DROP_Y,
  DROP_Z,
  FIXED_DT,
  FLOOR_X,
  FRONT_Z,
  INITIAL_MEDALS,
  FEVER_RAIN,
  JACKPOT_TIERS,
  JACKPOT_STORAGE_KEY,
  OLD_JACKPOT_STORAGE_KEY,
  MAX_CARDS,
  MAX_STEPS_PER_FRAME,
  PUSHER_FRONT_RETRACTED,
  REFILL_CREDITS,
  SHOWER_CARD_MEDALS,
  CARD_INFO,
  type JackpotTier,
  type PhysicsParams,
} from './config';
import { Sound } from './audio';
import { createDebugPanel, type DebugStats } from './debug';
import { Lcd } from './lcd';
import { Payout } from './payout';
import { Machine } from './physics';
import { GameScene, type LightMode } from './scene';
import { SlotMachine } from './slot';
import { Sugoroku } from './sugoroku';
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
  const cardsEl = $('cards');
  const refillBtn = $<HTMLButtonElement>('refill');
  const muteBtn = $<HTMLButtonElement>('mute');
  const autoBtn = $<HTMLButtonElement>('auto');
  const aimEl = $('aim');
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
        sound.slotWin(symbol === '7' || symbol === 'BAR');
        lcd.flash(1.6);
        payout.add(n);
        if (symbol === '7') showBanner(slot.fever ? `777  +${n}\nFEVER 延長！` : `777  +${n}\nFEVER 突入！`, 'big');
        else showBanner(`WIN  +${n}`, 'win');
      },
      miss: () => sound.miss(),
      ballGet: () => {
        if (spawnDiceBall()) {
          sound.ballGet();
          lcd.flash(1.2);
          showBanner('BALL GET!\n手前に落とせばサイコロ', 'ball');
          return true;
        }
        // 盤面のボールが最大数なら、その場でサイコロを振る
        board.addRoll();
        showBanner('DICE!', 'win');
        return false;
      },
      jackpotChance: () => {
        sound.jackpotChance();
        showBanner('JACKPOT CHANCE!!', 'chance');
      },
      rouletteTick: () => sound.rouletteTick(),
      rouletteResult: (n) => {
        sound.smallPrize();
        lcd.flash(1.5);
        showBanner(`+${n}`, 'win');
        payout.add(n);
      },
      jackpotSelect: () => {
        sound.jackpotChance();
        lcd.flash(1);
        showBanner('JACKPOT!!\nMINI・MAJOR・GRAND 抽選', 'chance');
      },
      jackpotSelectTick: () => sound.rouletteTick(),
      jackpotWin: (tier, n) => {
        sound.jackpot();
        if (tier === 'GRAND') window.setTimeout(() => sound.jackpot(), 2600);
        lcd.flash(tier === 'GRAND' ? 8 : 4);
        showBanner(`${tier} JACKPOT!!\n+${n.toLocaleString()}`, tier === 'GRAND' ? 'grand' : 'jackpot');
        payout.add(n, true);
      },
      jackpotChange: (pools) => {
        try {
          localStorage.setItem(JACKPOT_STORAGE_KEY, JSON.stringify(pools));
        } catch {
          // 保存できなくても続行
        }
      },
      feverStart: () => {
        sound.fever();
        payout.add(FEVER_RAIN);
      },
      feverExtend: () => sound.fever(),
      feverEnd: () => showBanner('FEVER 終了', 'lost'),
    },
    loadJackpots(),
  );

  /** サイコロボールを入賞口の枠より下、左右どちらかに出す */
  function spawnDiceBall(): boolean {
    const side = Math.random() < 0.5 ? -1 : 1;
    const x = side * (1.3 + Math.random() * (FLOOR_X - 2.2));
    return machine.spawnBall(x, CHUCKER_Y - CHUCKER_BAR_HEIGHT / 2 - BALL_RADIUS - 0.05, DROP_Z);
  }

  // ---- すごろく ----
  const board = new Sugoroku({
    rollStart: () => sound.diceRoll(),
    rollEnd: () => sound.diceStop(),
    step: () => sound.step(),
    medal: (n) => {
      payout.add(n);
      sound.slotWin(false);
    },
    baseGet: () => {
      sound.baseGet();
      lcd.flash(1.2);
    },
    baseIncome: (n) => {
      payout.add(n);
      sound.slotWin(false);
    },
    cardGet: () => {
      sound.cardGet();
      updateCards();
    },
    baseComplete: (n) => {
      sound.jackpot();
      lcd.flash(4);
      showBanner(`宇宙制覇！！\n+${n}`, 'jackpot');
      payout.add(n, true);
    },
    goal: (n, sq) => {
      payout.add(n);
      sound.goal();
      lcd.flash(2.5);
      showBanner(`目的地 ${sq.name}\n到着！ +${n}`, 'ball');
      slot.addJackpotChance();
    },
    shower: () => payout.add(SHOWER_CARD_MEDALS, true),
    summonBall: () => spawnDiceBall(),
  });

  // ---- HUD ----
  const session = { won: 0, lost: 0, chucker: 0 };
  function updateCards(): void {
    cardsEl.replaceChildren(
      ...Array.from({ length: MAX_CARDS }, (_, i) => {
        const card = board.cards[i];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = card ? `card ${card}` : 'card empty';
        btn.disabled = !card;
        if (card) {
          btn.innerHTML = `<b>${CARD_INFO[card].name}</b><small>${CARD_INFO[card].desc}</small>`;
          btn.addEventListener('pointerdown', (e) => e.stopPropagation());
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (board.useCard(i)) {
              sound.cardUse();
              updateCards();
            } else {
              flash(btn);
            }
          });
        } else {
          btn.textContent = 'カード';
        }
        return btn;
      }),
    );
  }
  updateCards();
  let shownCredits = store.credits;
  let countAcc = 0;
  creditEl.textContent = String(shownCredits);
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
  function showBanner(text: string, kind: 'win' | 'big' | 'chance' | 'jackpot' | 'grand' | 'ball' | 'lost'): void {
    banner.textContent = text;
    banner.className = '';
    void banner.offsetWidth;
    banner.className = `show ${kind}`;
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => (banner.className = ''), kind === 'grand' ? 7000 : kind === 'jackpot' ? 4000 : 1800);
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
  /** 狙う位置（画面幅に対する割合）。オート投入はここを狙い続ける。最初は中央（入賞口） */
  let aimRatio = 0.5;
  let autoOn = false;
  let autoAcc = 0;

  /** 1枚投入する。所持メダルが無ければ false */
  function dropMedal(): boolean {
    if (!store.spend()) {
      flash(refillBtn);
      return false;
    }
    const aimX = scene.screenXToDropX(aimRatio * window.innerWidth);
    const x = clamp(aimX + (Math.random() * 2 - 1) * DROP_SCATTER, -DROP_X_MAX, DROP_X_MAX);
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
    return true;
  }

  function setAim(clientX: number): void {
    aimRatio = clamp(clientX / window.innerWidth, 0, 1);
    aimEl.style.left = `${aimRatio * 100}%`;
  }

  function setAuto(on: boolean): void {
    autoOn = on;
    autoAcc = AUTO_FIRE_INTERVAL; // オンにしたらすぐ1枚目を出す
    autoBtn.classList.toggle('on', on);
    autoBtn.setAttribute('aria-pressed', String(on));
    aimEl.classList.toggle('show', on);
  }
  setAim(window.innerWidth / 2);

  // 音はユーザー操作の中でしか開始できないので、最初の操作で有効にする
  window.addEventListener('pointerdown', () => sound.unlock(), { capture: true });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.clientY > window.innerHeight * DROP_ZONE_RATIO) return;
    setAim(e.clientX);
    // オート中のタップは狙いの変更だけ
    if (autoOn) return;
    const now = performance.now() / 1000;
    if (now - lastDrop < DROP_COOLDOWN) return;
    lastDrop = now;
    dropMedal();
  });
  // オート中は、上部をなぞると狙いが動く
  canvas.addEventListener('pointermove', (e) => {
    if (autoOn && e.buttons && e.clientY <= window.innerHeight * DROP_ZONE_RATIO) setAim(e.clientX);
  });
  autoBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  autoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    sound.unlock();
    setAuto(!autoOn);
  });

  // ---- 調整パネル ----
  const stats: DebugStats = { fps: 0, medals: 0, awake: 0, stepMs: 0, won: 0, lost: 0, chucker: 0 };
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
        machine.clearBalls();
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
      onSpawnBall: () => {
        if (!spawnDiceBall()) showBanner('ボールは最大数です', 'win');
      },
      onRoll: () => board.addRoll(),
      onCard: (card) => {
        board.debugCard(card);
        updateCards();
      },
      onGrand: () => {
        slot.forceTier = 'GRAND';
        slot.addJackpotChance();
      },
      onAlmostComplete: () => board.debugAlmostComplete(),
      onBoardReset: () => {
        board.reset();
        updateCards();
      },
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
    let ballWon = 0;
    let ballLost = 0;
    let impacts = 0;
    let impactMax = 0;
    let impactPan = 0;
    while (acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      const r = machine.step();
      won += r.won;
      lost += r.lost;
      chucker += r.chucker;
      ballWon += r.ballWon;
      ballLost += r.ballLost;
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
    for (let i = 0; i < ballWon; i++) {
      board.addRoll();
      sound.ballDrop();
      scene.flashFront();
      showBanner('DICE ROLL!', 'chance');
    }
    if (ballLost > 0) {
      sound.lost();
      showBanner('BALL LOST…', 'lost');
    }
    if (impacts > 0) sound.clink(impactMax / 14, impactPan);
    winSoundCooldown -= dt;

    // ---- オート投入 ----
    if (autoOn) {
      autoAcc += dt;
      while (autoOn && autoAcc >= AUTO_FIRE_INTERVAL) {
        autoAcc -= AUTO_FIRE_INTERVAL;
        if (!dropMedal()) setAuto(false); // メダルが無くなったら止める
      }
    }

    // ---- スロット・払い出し・演出 ----
    // ジャックポットチャンスとすごろくは液晶の中央を使うので、交互に進める
    const chanceActive =
      slot.pendingChance > 0 || slot.mode === 'chance' || slot.mode === 'roulette' || slot.mode === 'rouletteResult';
    slot.update(dt, board.busy);
    board.update(dt, chanceActive);
    payout.update(dt);
    lcd.update(slot, board, dt);
    scene.setLightMode(lightModeFor(slot, payout, board));

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
      stats.won = session.won;
      stats.lost = session.lost;
      stats.chucker = session.chucker;
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

function lightModeFor(slot: SlotMachine, payout: Payout, board: Sugoroku): LightMode {
  if (payout.jackpotActive || slot.fever || (slot.mode === 'rouletteResult' && slot.lastRoulette?.jackpot)) return 'jackpot';
  if (slot.mode === 'chance' || slot.mode === 'roulette' || slot.mode === 'jpSelect' || board.mode === 'goal') return 'chance';
  if (board.mode === 'roll' || board.mode === 'move') return 'spin';
  if (payout.active || (slot.mode === 'result' && slot.lastWin) || slot.mode === 'rouletteResult') return 'win';
  if (slot.mode === 'spin') return 'spin';
  return 'idle';
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function loadJackpots(): Partial<Record<JackpotTier, number>> {
  try {
    const raw = localStorage.getItem(JACKPOT_STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Record<string, unknown>;
      const out: Partial<Record<JackpotTier, number>> = {};
      for (const t of JACKPOT_TIERS) if (typeof d[t] === 'number' && Number.isFinite(d[t])) out[t] = d[t] as number;
      return out;
    }
    // 旧バージョン（1段階）のジャックポットは MINI に引き継ぐ
    const old = Number.parseFloat(localStorage.getItem(OLD_JACKPOT_STORAGE_KEY) ?? '');
    if (Number.isFinite(old)) return { MINI: old };
  } catch {
    // 読めなければ初期値
  }
  return {};
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
