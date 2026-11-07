import {
  FEVER_EXTEND,
  FEVER_MULTIPLIER,
  FEVER_REEL_SPEEDUP,
  FEVER_TIME,
  JACKPOT_INFO,
  JACKPOT_TIERS,
  JP_ROULETTE,
  JP_WIN_PROB,
  REEL_STRIP,
  SLOT_FAKE_REACH_RATE,
  SLOT_MAX_STOCK,
  SLOT_TABLE,
  type JackpotTier,
  type SlotSymbol,
} from './config';

/** スロットから外へ知らせるイベント（音・演出・払い出しを main でつなぐ） */
export interface SlotEvents {
  spinStart(): void;
  reelStop(reel: number): void;
  reach(): void;
  /** 図柄がそろった。payout 枚を払い出す */
  win(symbol: SlotSymbol, payout: number): void;
  miss(): void;
  /** ★がそろった。サイコロボールを盤面に出す（出せたら true。上限なら false → 呼び出し側でその場でサイコロ） */
  ballGet(): boolean;
  jackpotChance(): void;
  rouletteTick(): void;
  /** ルーレットの結果（JP 以外）。payout 枚を払い出す */
  rouletteResult(payout: number): void;
  /** ルーレットが JP に止まった。これから MINI / MAJOR / GRAND の抽選 */
  jackpotSelect(): void;
  /** ジャックポット抽選のハイライトが1つ進んだ */
  jackpotSelectTick(): void;
  /** ジャックポット当選。payout 枚を払い出す */
  jackpotWin(tier: JackpotTier, payout: number): void;
  jackpotChange(pools: Record<JackpotTier, number>): void;
  feverStart(): void;
  feverExtend(): void;
  feverEnd(): void;
}

type Mode = 'idle' | 'spin' | 'result' | 'chance' | 'roulette' | 'jpSelect' | 'rouletteResult';

interface Reel {
  /** 中段に来ている図柄の位置（リール帯の添字、小数） */
  pos: number;
  /** 停止予定時刻（spinTime 基準） */
  stopAt: number;
  target: number;
  /** 停止アニメーション */
  stopping: boolean;
  stopFrom: number;
  stopTo: number;
  stopT: number;
  stopped: boolean;
}

const REEL_SPEED = 16; // 図柄/秒
const REEL_STOP_TIMES = [0.9, 1.35, 1.8];
const REACH_EXTRA = 1.6;
const STOP_ANIM = 0.28;
const ROULETTE_TIME = 4.5;
const JP_SELECT_TIME = 3.6;

/**
 * スロットとジャックポットの状態機械。描画はしない（lcd.ts が state を読んで描く）。
 * 結果は回転開始時に抽選で決め、リールはその図柄に止まるよう動かす（実機と同じ方式）。
 */
export class SlotMachine {
  stock = 0;
  /** ジャックポットの貯まり（内部は小数。表示は jackpotDisplay） */
  jackpots: Record<JackpotTier, number>;
  mode: Mode = 'idle';
  /** フィーバーの残り秒数（0 ならフィーバーではない） */
  feverTime = 0;
  /** ジャックポット抽選でハイライトしている段（0=MINI, 1=MAJOR, 2=GRAND） */
  jpSelectIndex = 0;
  readonly reels: Reel[] = [0, 1, 2].map((i) => ({
    pos: i * 4,
    stopAt: 0,
    target: 0,
    stopping: false,
    stopFrom: 0,
    stopTo: 0,
    stopT: 0,
    stopped: true,
  }));
  /** リーチ中か */
  reach = false;
  /** 待っているジャックポットチャンスの数 */
  pendingChance = 0;
  private chanceHold = 0;
  /** 直近の当たり（表示用） */
  lastWin: { symbol: SlotSymbol; payout: number } | null = null;
  /** ルーレットの針の角度（ラジアン）と、止まった区画 */
  rouletteAngle = 0;
  rouletteIndex = -1;
  lastRoulette: { jackpot: boolean; payout: number; tier?: JackpotTier } | null = null;
  /** 表示を描き直す必要があるか（lcd.ts が見る） */
  dirty = true;

  private time = 0;
  private modeTime = 0;
  private outcome: { symbol: SlotSymbol | null; payout: number } = { symbol: null, payout: 0 };
  private rouletteFrom = 0;
  private rouletteTo = 0;
  private lastTickSeg = 0;

  private jpTier: JackpotTier = 'MINI';
  private lastSelectStep = 0;
  /** この回転がフィーバー中に始まったか（配当を倍にする） */
  private spinInFever = false;

  constructor(
    readonly events: SlotEvents,
    jackpots: Partial<Record<JackpotTier, number>>,
  ) {
    this.jackpots = { MINI: 0, MAJOR: 0, GRAND: 0 };
    for (const t of JACKPOT_TIERS) this.jackpots[t] = Math.max(JACKPOT_INFO[t].base, jackpots[t] ?? 0);
  }

  /** 表示用のジャックポット枚数（内部は小数で貯める） */
  jackpotDisplay(tier: JackpotTier): number {
    return Math.floor(this.jackpots[tier]);
  }

  get fever(): boolean {
    return this.feverTime > 0;
  }

  /** 入賞1回。保留が満タンでもジャックポットは積み増す */
  addChucker(): boolean {
    for (const t of JACKPOT_TIERS) this.jackpots[t] += JACKPOT_INFO[t].addPerChucker;
    this.events.jackpotChange(this.jackpots);
    this.dirty = true;
    if (this.stock >= SLOT_MAX_STOCK) return false;
    this.stock++;
    return true;
  }

  /** デバッグ用：次の回転を強制的に指定の図柄でそろえる */
  forceNext: SlotSymbol | null = null;
  /** デバッグ用：次のルーレットを JP にして、指定の段を当てる */
  forceTier: JackpotTier | null = null;

  /** boardBusy: すごろくが動いている間はジャックポットチャンスを始めない（液晶の中央を取り合わないように） */
  update(dt: number, boardBusy = false): void {
    this.time += dt;
    this.modeTime += dt;
    this.chanceHold -= dt;
    if (this.feverTime > 0) {
      this.feverTime -= dt;
      if (this.feverTime <= 0) {
        this.feverTime = 0;
        this.events.feverEnd();
      }
      this.dirty = true;
    }
    switch (this.mode) {
      case 'idle':
        // ボールが落ちてたまったジャックポットチャンスを、スロットより先に消化する
        if (this.pendingChance > 0 && this.chanceHold <= 0 && !boardBusy) {
          this.pendingChance--;
          this.lastWin = null;
          this.setMode('chance');
          this.events.jackpotChance();
        } else if (this.stock > 0 || this.fever) {
          // フィーバー中は保留がなくても回り続ける
          this.startSpin();
        }
        break;
      case 'spin':
        this.updateReels(dt);
        break;
      case 'result': {
        const wait = this.lastWin ? (this.fever ? 1.1 : 2.0) : this.fever ? 0.25 : 0.5;
        if (this.modeTime > wait) this.setMode('idle');
        break;
      }
      case 'jpSelect':
        this.updateJpSelect();
        break;
      case 'chance':
        if (this.modeTime > 1.6) this.startRoulette();
        break;
      case 'roulette':
        this.updateRoulette();
        break;
      case 'rouletteResult':
        if (this.modeTime > (this.lastRoulette?.jackpot ? 5.0 : 3.0)) this.setMode('idle');
        break;
    }
  }

  /** 中段＋上下段に見えている図柄を返す（row: -1 上, 0 中, 1 下） */
  static symbolAt(index: number): SlotSymbol {
    const L = REEL_STRIP.length;
    return REEL_STRIP[((index % L) + L) % L];
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.modeTime = 0;
    this.dirty = true;
  }

  private startSpin(): void {
    if (this.stock > 0) this.stock--;
    this.spinInFever = this.fever;
    this.lastWin = null;
    this.reach = false;
    this.outcome = this.draw();
    const targets = this.pickTargets(this.outcome.symbol);
    const t0 = this.time;
    this.reels.forEach((r, i) => {
      r.target = targets[i];
      r.stopAt = t0 + REEL_STOP_TIMES[i] * (this.spinInFever ? FEVER_REEL_SPEEDUP : 1);
      r.stopping = false;
      r.stopped = false;
    });
    this.setMode('spin');
    this.events.spinStart();
  }

  /** 抽選。symbol=null はハズレ */
  private draw(): { symbol: SlotSymbol | null; payout: number } {
    if (this.forceNext) {
      const row = SLOT_TABLE.find((r) => r.symbol === this.forceNext)!;
      this.forceNext = null;
      return { symbol: row.symbol, payout: row.payout };
    }
    let r = Math.random();
    for (const row of SLOT_TABLE) {
      if (r < row.prob) return { symbol: row.symbol, payout: row.payout };
      r -= row.prob;
    }
    return { symbol: null, payout: 0 };
  }

  /** 結果に合わせて各リールの停止位置（リール帯の添字）を決める */
  private pickTargets(symbol: SlotSymbol | null): number[] {
    const indexOf = (s: SlotSymbol) => {
      const idx = REEL_STRIP.map((v, i) => (v === s ? i : -1)).filter((i) => i >= 0);
      return idx[Math.floor(Math.random() * idx.length)];
    };
    const symbols = [...new Set(REEL_STRIP)];
    const pick = () => symbols[Math.floor(Math.random() * symbols.length)];
    if (symbol) return [indexOf(symbol), indexOf(symbol), indexOf(symbol)];
    let a = pick();
    let b = pick();
    let c = pick();
    if (Math.random() < SLOT_FAKE_REACH_RATE) {
      b = a;
      while (c === a) c = pick();
    } else {
      while (a === b && b === c) c = pick();
    }
    return [indexOf(a), indexOf(b), indexOf(c)];
  }

  private updateReels(dt: number): void {
    let allStopped = true;
    this.reels.forEach((r, i) => {
      if (r.stopped) return;
      allStopped = false;
      if (r.stopping) {
        r.stopT += dt / STOP_ANIM;
        const t = Math.min(1, r.stopT);
        // 少し行き過ぎて戻る（easeOutBack）とリールが「カチッ」と止まって見える
        const c = 1.8;
        const e = 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
        r.pos = r.stopFrom + (r.stopTo - r.stopFrom) * e;
        if (t >= 1) {
          r.pos = r.stopTo;
          r.stopped = true;
          this.events.reelStop(i);
          this.onReelStopped(i);
        }
        return;
      }
      // 回転中。リーチ中の最後のリールはゆっくり
      const slow = this.reach && i === 2 ? 0.45 : 1;
      r.pos += REEL_SPEED * slow * dt;
      if (this.time >= r.stopAt) {
        // 今の位置から少し先にある目標図柄の位置で止める
        const L = REEL_STRIP.length;
        let to = Math.ceil(r.pos) + 1;
        while (((to % L) + L) % L !== r.target) to++;
        r.stopping = true;
        r.stopFrom = r.pos;
        r.stopTo = to;
        r.stopT = 0;
      }
    });
    this.dirty = true;
    if (allStopped) this.finishSpin();
  }

  private onReelStopped(i: number): void {
    if (i !== 1) return;
    const s0 = SlotMachine.symbolAt(this.reels[0].target);
    const s1 = SlotMachine.symbolAt(this.reels[1].target);
    if (s0 === s1) {
      this.reach = true;
      this.reels[2].stopAt = Math.max(this.reels[2].stopAt, this.time) + REACH_EXTRA;
      this.events.reach();
    }
  }

  private finishSpin(): void {
    const { symbol, payout } = this.outcome;
    this.reach = false;
    if (symbol === 'STAR') {
      this.lastWin = { symbol, payout: 0 };
      // サイコロボールを盤面に出す（出しきっていたときの扱いは呼び出し側）
      this.events.ballGet();
      this.setMode('result');
      return;
    }
    if (symbol) {
      const n = this.spinInFever ? payout * FEVER_MULTIPLIER : payout;
      this.lastWin = { symbol, payout: n };
      this.events.win(symbol, n);
      if (symbol === '7') {
        // 7・7・7 でフィーバー。フィーバー中なら延長
        if (this.fever) {
          this.feverTime += FEVER_EXTEND;
          this.events.feverExtend();
        } else {
          this.feverTime = FEVER_TIME;
          this.events.feverStart();
        }
      }
    } else {
      this.events.miss();
    }
    this.setMode('result');
  }

  private startRoulette(): void {
    const n = JP_ROULETTE.length;
    let index: number;
    if (this.forceTier || Math.random() < JP_WIN_PROB) {
      index = JP_ROULETTE.indexOf('JP');
    } else {
      const others = JP_ROULETTE.map((v, i) => (v === 'JP' ? -1 : i)).filter((i) => i >= 0);
      index = others[Math.floor(Math.random() * others.length)];
    }
    const seg = (Math.PI * 2) / n;
    this.rouletteIndex = -1;
    this.rouletteFrom = this.rouletteAngle % (Math.PI * 2);
    // 区画の中心に少しばらつきを持たせて止める
    const inSeg = (Math.random() - 0.5) * seg * 0.6;
    this.rouletteTo = Math.PI * 2 * 5 + index * seg + inSeg;
    this.lastTickSeg = Math.floor(this.rouletteFrom / seg);
    this.lastRoulette = null;
    this.setMode('roulette');
  }

  private updateRoulette(): void {
    const t = Math.min(1, this.modeTime / ROULETTE_TIME);
    const e = 1 - Math.pow(1 - t, 3);
    this.rouletteAngle = this.rouletteFrom + (this.rouletteTo - this.rouletteFrom) * e;
    const seg = (Math.PI * 2) / JP_ROULETTE.length;
    const s = Math.floor((this.rouletteAngle + seg / 2) / seg);
    if (s !== this.lastTickSeg) {
      this.lastTickSeg = s;
      this.events.rouletteTick();
    }
    this.dirty = true;
    if (t >= 1) {
      const n = JP_ROULETTE.length;
      const idx = ((Math.round(this.rouletteAngle / seg) % n) + n) % n;
      this.rouletteIndex = idx;
      const v = JP_ROULETTE[idx];
      if (v === 'JP') {
        this.startJpSelect();
        return;
      }
      this.lastRoulette = { jackpot: false, payout: v };
      this.setMode('rouletteResult');
      this.events.rouletteResult(v);
    }
  }

  /** JP に止まったら MINI / MAJOR / GRAND を抽選。ハイライトが減速しながら回って止まる */
  private startJpSelect(): void {
    if (this.forceTier) {
      this.jpTier = this.forceTier;
      this.forceTier = null;
    } else {
      let r = Math.random();
      this.jpTier = 'MINI';
      for (const t of JACKPOT_TIERS) {
        if (r < JACKPOT_INFO[t].prob) {
          this.jpTier = t;
          break;
        }
        r -= JACKPOT_INFO[t].prob;
      }
    }
    this.jpSelectIndex = 0;
    this.lastSelectStep = 0;
    this.setMode('jpSelect');
    this.events.jackpotSelect();
  }

  private updateJpSelect(): void {
    const target = JACKPOT_TIERS.indexOf(this.jpTier);
    const steps = 3 * 6 + target; // 6 周してから止まる
    const t = Math.min(1, this.modeTime / JP_SELECT_TIME);
    const p = 1 - Math.pow(1 - t, 2.2);
    const step = Math.min(steps, Math.floor(p * steps));
    if (step !== this.lastSelectStep) {
      this.lastSelectStep = step;
      this.jpSelectIndex = step % 3;
      this.events.jackpotSelectTick();
      this.dirty = true;
    }
    if (t < 1) return;
    this.jpSelectIndex = target;
    const tier = this.jpTier;
    const payout = Math.floor(this.jackpots[tier]);
    this.jackpots[tier] = JACKPOT_INFO[tier].base;
    this.events.jackpotChange(this.jackpots);
    this.lastRoulette = { jackpot: true, payout, tier };
    this.setMode('rouletteResult');
    this.events.jackpotWin(tier, payout);
  }

  /** すごろくで目的地に着いた。今の回転が終わったらジャックポットチャンスへ */
  addJackpotChance(): void {
    this.pendingChance++;
    // 到着の表示を見せる間を置いてからルーレットへ
    this.chanceHold = 1.5;
    this.dirty = true;
  }
}
