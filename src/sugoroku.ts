import {
  BASE_COMPLETE_BONUS,
  BOARD,
  CARD_INFO,
  DEST_MAX_DISTANCE,
  DEST_MIN_DISTANCE,
  GOAL_BONUS,
  MAX_CARDS,
  SUGOROKU_STORAGE_KEY,
  type CardType,
  type Square,
} from './config';

/** すごろくから外へ知らせるイベント（音・払い出し・ボール出現を main でつなぐ） */
export interface SugorokuEvents {
  rollStart(): void;
  rollEnd(total: number): void;
  step(): void;
  /** メダルマスに止まった：n 枚払い出す */
  medal(n: number, sq: Square): void;
  /** 基地を手に入れた（初めて止まった） */
  baseGet(sq: Square): void;
  /** 持っている基地に止まった：配当 n 枚 */
  baseIncome(n: number, sq: Square): void;
  cardGet(card: CardType): void;
  /** 基地を全部そろえた：n 枚払い出し（基地はリセット） */
  baseComplete(n: number): void;
  /** 目的地に着いた：基地の配当＋ボーナスで n 枚払い出し。このあとジャックポットチャンス */
  goal(n: number, sq: Square): void;
  /** 流星群カード */
  shower(): void;
  /** 召喚カード：サイコロボールを出す（出せなければ false） */
  summonBall(): boolean;
}

type Mode = 'idle' | 'roll' | 'move' | 'land' | 'goal';

interface SaveData {
  pos: number;
  dest: number;
  owned: boolean[];
  cards: CardType[];
  turbo: boolean;
  pending: number;
}

const ROLL_TIME = 1.3;
const STEP_TIME = 0.24;
const WARP_STEP_TIME = 0.07;
const LAND_TIME = 1.8;
const GOAL_TIME = 2.6;

/**
 * すごろくの状態機械。描画はしない（lcd.ts が読んで描く）。
 * 位置・目的地・基地・カードは localStorage に保存する（進行要素なのでリロードで消えないように）。
 */
export class Sugoroku {
  pos = 0;
  dest = 0;
  owned: boolean[] = BOARD.map(() => false);
  cards: CardType[] = [];
  /** 次のサイコロを2個振る */
  turbo = false;
  /** 振るのを待っているサイコロの数 */
  pending = 0;
  mode: Mode = 'idle';
  /** 表示中のサイコロの目（ターボ時は2個） */
  dice: number[] = [1];
  /** ロケットが次のマスへ向かっている割合（0..1、描画の補間用） */
  moveT = 0;
  /** 中央に出すメッセージ */
  message = '';
  messageSub = '';
  dirty = true;

  private modeTime = 0;
  private stepsLeft = 0;
  private stepTime = STEP_TIME;
  private rollResult: number[] = [1];

  constructor(private readonly events: SugorokuEvents) {
    this.load();
    if (this.dest === this.pos) this.pickDestination();
  }

  get busy(): boolean {
    return this.mode !== 'idle';
  }

  get square(): Square {
    return BOARD[this.pos];
  }

  get destSquare(): Square {
    return BOARD[this.dest];
  }

  /** 目的地まであと何マスか */
  get distanceToDest(): number {
    return (this.dest - this.pos + BOARD.length) % BOARD.length;
  }

  /** 基地マスの数 */
  get baseTotal(): number {
    return BOARD.filter((s) => s.type === 'base').length;
  }

  get ownedCount(): number {
    return this.owned.filter(Boolean).length;
  }

  /** 目的地に着いたときの配当（持っている基地の合計） */
  get dividend(): number {
    return BOARD.reduce((sum, sq, i) => sum + (this.owned[i] ? sq.value : 0), 0);
  }

  /** サイコロボールが落ちた */
  addRoll(): void {
    this.pending++;
    this.save();
  }

  /** カードを使う。使えたら true */
  useCard(index: number): boolean {
    const card = this.cards[index];
    if (!card) return false;
    switch (card) {
      case 'turbo':
        if (this.turbo) return false;
        this.turbo = true;
        this.setMessage('ターボ準備OK', '次のサイコロは2個');
        break;
      case 'shower':
        this.events.shower();
        this.setMessage('流星群！', 'メダルが降ってくる');
        break;
      case 'ball':
        if (!this.events.summonBall()) return false;
        this.setMessage('召喚！', 'サイコロボール登場');
        break;
      case 'warp':
        // 移動中などは使えない
        if (this.busy) return false;
        this.stepsLeft = this.distanceToDest;
        this.stepTime = WARP_STEP_TIME;
        this.setMessage('ワープ！', `${this.destSquare.name} へ`);
        this.setMode('move');
        break;
    }
    this.cards.splice(index, 1);
    this.dirty = true;
    this.save();
    return true;
  }

  /** blocked: ジャックポットのルーレット中など、液晶の中央を使えないとき */
  update(dt: number, blocked: boolean): void {
    this.modeTime += dt;
    switch (this.mode) {
      case 'idle':
        if (this.pending > 0 && !blocked) this.startRoll();
        break;
      case 'roll':
        this.updateRoll();
        break;
      case 'move':
        this.updateMove();
        break;
      case 'land':
        if (this.modeTime > LAND_TIME) this.setMode('idle');
        break;
      case 'goal':
        if (this.modeTime > GOAL_TIME) this.setMode('idle');
        break;
    }
  }

  // ------------------------------------------------------------------ 内部

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.modeTime = 0;
    this.dirty = true;
  }

  private setMessage(main: string, sub = ''): void {
    this.message = main;
    this.messageSub = sub;
    this.dirty = true;
  }

  private startRoll(): void {
    this.pending--;
    const n = this.turbo ? 2 : 1;
    this.turbo = false;
    this.rollResult = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 6));
    this.dice = this.rollResult.map(() => 1);
    this.setMessage('');
    this.setMode('roll');
    this.events.rollStart();
  }

  private updateRoll(): void {
    if (this.modeTime < ROLL_TIME) {
      // 転がっている間は目をランダムに変える
      if (Math.floor(this.modeTime * 14) !== Math.floor((this.modeTime - 1 / 60) * 14)) {
        this.dice = this.dice.map(() => 1 + Math.floor(Math.random() * 6));
        this.dirty = true;
      }
      return;
    }
    this.dice = this.rollResult.slice();
    const total = this.dice.reduce((a, b) => a + b, 0);
    this.stepsLeft = total;
    this.stepTime = STEP_TIME;
    this.setMessage(`${total} マス進む！`);
    this.events.rollEnd(total);
    this.setMode('move');
  }

  private updateMove(): void {
    this.moveT = Math.min(1, this.modeTime / this.stepTime);
    this.dirty = true;
    if (this.modeTime < this.stepTime) return;
    this.pos = (this.pos + 1) % BOARD.length;
    this.stepsLeft--;
    this.moveT = 0;
    this.modeTime = 0;
    this.events.step();
    // 目的地は通り過ぎずにそこで止まる
    if (this.pos === this.dest) {
      this.arriveGoal();
      return;
    }
    if (this.stepsLeft <= 0) this.land();
  }

  private land(): void {
    const sq = this.square;
    switch (sq.type) {
      case 'medal':
        this.setMessage(`${sq.name}`, `メダル +${sq.value}`);
        this.events.medal(sq.value, sq);
        break;
      case 'base':
        if (!this.owned[this.pos]) {
          this.owned[this.pos] = true;
          if (this.ownedCount === this.baseTotal) {
            // 全部そろった：宇宙制覇ボーナス。基地はリセットして、また集め直せる
            this.setMessage('宇宙制覇！！', `全基地コンプリート +${BASE_COMPLETE_BONUS}`);
            this.owned = BOARD.map(() => false);
            this.events.baseComplete(BASE_COMPLETE_BONUS);
            this.save();
            this.setMode('goal');
            return;
          }
          this.setMessage(`${sq.name} 獲得！`, `目的地で毎回 +${sq.value}（${this.ownedCount}/${this.baseTotal}）`);
          this.events.baseGet(sq);
        } else {
          const n = Math.ceil(sq.value / 2);
          this.setMessage(`${sq.name}`, `収益 +${n}`);
          this.events.baseIncome(n, sq);
        }
        break;
      case 'card': {
        if (this.cards.length >= MAX_CARDS) {
          this.setMessage('流れ星', 'カードがいっぱい…');
          break;
        }
        const card = drawCard();
        this.cards.push(card);
        this.setMessage(`カード「${CARD_INFO[card].name}」`, CARD_INFO[card].desc);
        this.events.cardGet(card);
        break;
      }
    }
    this.save();
    this.setMode('land');
  }

  private arriveGoal(): void {
    const sq = this.square;
    const n = this.dividend + GOAL_BONUS;
    this.setMessage(`目的地 ${sq.name} 到着！`, `配当 +${n}　→ JACKPOT CHANCE`);
    this.pickDestination();
    this.save();
    this.setMode('goal');
    this.events.goal(n, sq);
  }

  private pickDestination(): void {
    const span = DEST_MAX_DISTANCE - DEST_MIN_DISTANCE + 1;
    const d = DEST_MIN_DISTANCE + Math.floor(Math.random() * span);
    this.dest = (this.pos + d) % BOARD.length;
    this.dirty = true;
  }

  private save(): void {
    const data: SaveData = {
      pos: this.pos,
      dest: this.dest,
      owned: this.owned,
      cards: this.cards,
      turbo: this.turbo,
      pending: this.pending,
    };
    try {
      localStorage.setItem(SUGOROKU_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // 保存できなくても続行
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(SUGOROKU_STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as Partial<SaveData>;
      const inBoard = (v: unknown) => typeof v === 'number' && v >= 0 && v < BOARD.length;
      if (inBoard(d.pos)) this.pos = d.pos!;
      if (inBoard(d.dest)) this.dest = d.dest!;
      if (Array.isArray(d.owned) && d.owned.length === BOARD.length) this.owned = d.owned.map(Boolean);
      if (Array.isArray(d.cards)) this.cards = d.cards.filter((c) => c in CARD_INFO).slice(0, MAX_CARDS);
      this.turbo = d.turbo === true;
      if (typeof d.pending === 'number' && d.pending >= 0) this.pending = Math.min(10, Math.floor(d.pending));
    } catch {
      // 壊れていたら初期状態
    }
  }

  /** デバッグ用：すごろくを最初からにする */
  reset(): void {
    this.pos = 0;
    this.owned = BOARD.map(() => false);
    this.cards = [];
    this.turbo = false;
    this.pending = 0;
    this.pickDestination();
    this.setMessage('');
    this.setMode('idle');
    this.save();
  }

  /** デバッグ用：基地をあと1つでコンプリートの状態にする */
  debugAlmostComplete(): void {
    let left = -1;
    BOARD.forEach((sq, i) => {
      if (sq.type !== 'base') return;
      this.owned[i] = true;
      left = i;
    });
    this.owned[left] = false;
    // 残りの1つの手前に移動しておく
    this.pos = (left - 1 + BOARD.length) % BOARD.length;
    if (this.dest === left || this.dest === this.pos) this.dest = (this.pos + 10) % BOARD.length;
    this.dirty = true;
    this.save();
  }

  /** デバッグ用：カードを1枚もらう */
  debugCard(card: CardType): void {
    if (this.cards.length < MAX_CARDS) this.cards.push(card);
    this.dirty = true;
    this.save();
  }
}

function drawCard(): CardType {
  const entries = Object.entries(CARD_INFO) as [CardType, { weight: number }][];
  const total = entries.reduce((a, [, v]) => a + v.weight, 0);
  let r = Math.random() * total;
  for (const [k, v] of entries) {
    if (r < v.weight) return k;
    r -= v.weight;
  }
  return entries[0][0];
}
