import {
  JACKPOT_ADD_PER_CHUCKER,
  JACKPOT_BASE,
  JP_ROULETTE,
  JP_WIN_PROB,
  REEL_STRIP,
  SLOT_FAKE_REACH_RATE,
  SLOT_MAX_STOCK,
  SLOT_TABLE,
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
  /** ★がそろった。JPボールを盤面に出す（出せたら true。上限なら false → すぐジャックポットチャンス） */
  ballGet(): boolean;
  jackpotChance(): void;
  rouletteTick(): void;
  /** ルーレットの結果。jackpot=true ならジャックポット */
  rouletteResult(jackpot: boolean, payout: number): void;
  jackpotChange(value: number): void;
}

type Mode = 'idle' | 'spin' | 'result' | 'chance' | 'roulette' | 'rouletteResult';

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

/**
 * スロットとジャックポットの状態機械。描画はしない（lcd.ts が state を読んで描く）。
 * 結果は回転開始時に抽選で決め、リールはその図柄に止まるよう動かす（実機と同じ方式）。
 */
export class SlotMachine {
  stock = 0;
  jackpot: number;
  mode: Mode = 'idle';
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
  lastRoulette: { jackpot: boolean; payout: number } | null = null;
  /** 表示を描き直す必要があるか（lcd.ts が見る） */
  dirty = true;

  private time = 0;
  private modeTime = 0;
  private outcome: { symbol: SlotSymbol | null; payout: number } = { symbol: null, payout: 0 };
  private rouletteFrom = 0;
  private rouletteTo = 0;
  private lastTickSeg = 0;

  constructor(
    readonly events: SlotEvents,
    jackpot: number,
  ) {
    this.jackpot = Math.max(JACKPOT_BASE, jackpot);
  }

  /** 表示用のジャックポット枚数（内部は小数で貯める） */
  get jackpotDisplay(): number {
    return Math.floor(this.jackpot);
  }

  /** 入賞1回。保留が満タンでもジャックポットは積み増す */
  addChucker(): boolean {
    this.jackpot += JACKPOT_ADD_PER_CHUCKER;
    this.events.jackpotChange(this.jackpot);
    this.dirty = true;
    if (this.stock >= SLOT_MAX_STOCK) return false;
    this.stock++;
    return true;
  }

  /** デバッグ用：次の回転を強制的に指定の図柄でそろえる */
  forceNext: SlotSymbol | null = null;

  update(dt: number): void {
    this.time += dt;
    this.modeTime += dt;
    this.chanceHold -= dt;
    switch (this.mode) {
      case 'idle':
        // ボールが落ちてたまったジャックポットチャンスを、スロットより先に消化する
        if (this.pendingChance > 0 && this.chanceHold <= 0) {
          this.pendingChance--;
          this.lastWin = null;
          this.setMode('chance');
          this.events.jackpotChance();
        } else if (this.stock > 0) {
          this.startSpin();
        }
        break;
      case 'spin':
        this.updateReels(dt);
        break;
      case 'result':
        if (this.modeTime > (this.lastWin ? 2.0 : 0.5)) this.setMode('idle');
        break;
      case 'chance':
        if (this.modeTime > 1.6) this.startRoulette();
        break;
      case 'roulette':
        this.updateRoulette();
        break;
      case 'rouletteResult':
        if (this.modeTime > 3.0) this.setMode('idle');
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
    this.stock--;
    this.lastWin = null;
    this.reach = false;
    this.outcome = this.draw();
    const targets = this.pickTargets(this.outcome.symbol);
    const t0 = this.time;
    this.reels.forEach((r, i) => {
      r.target = targets[i];
      r.stopAt = t0 + REEL_STOP_TIMES[i];
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
      // ボールを盤面に出す。もう出しきっていたら、その場でジャックポットチャンス
      if (!this.events.ballGet()) this.pendingChance++;
      this.setMode('result');
      return;
    }
    if (symbol) {
      this.lastWin = { symbol, payout };
      this.events.win(symbol, payout);
    } else {
      this.events.miss();
    }
    this.setMode('result');
  }

  private startRoulette(): void {
    const n = JP_ROULETTE.length;
    let index: number;
    if (Math.random() < JP_WIN_PROB) {
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
      const jackpot = v === 'JP';
      const payout = jackpot ? Math.floor(this.jackpot) : (v as number);
      this.lastRoulette = { jackpot, payout };
      if (jackpot) {
        this.jackpot = JACKPOT_BASE;
        this.events.jackpotChange(this.jackpot);
      }
      this.setMode('rouletteResult');
      this.events.rouletteResult(jackpot, payout);
    }
  }

  /** JPボールが手前から落ちた。今の回転が終わったらジャックポットチャンスへ */
  addJackpotChance(): void {
    this.pendingChance++;
    // 「BALL IN!!」を見せる間を置いてからルーレットへ
    this.chanceHold = 1.5;
    this.dirty = true;
  }
}
