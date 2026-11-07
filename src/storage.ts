import { INITIAL_CREDITS, STORAGE_KEY } from './config';

/** 所持メダル数を localStorage に保存する。書き込みは間引き＋離脱時に確定。 */
export class CreditStore {
  private value: number;
  private saveTimer: number | undefined;

  constructor() {
    this.value = load();
    const flush = () => this.flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  get credits(): number {
    return this.value;
  }

  add(n: number): void {
    this.set(this.value + n);
  }

  /** 1枚消費できれば true */
  spend(): boolean {
    if (this.value <= 0) return false;
    this.set(this.value - 1);
    return true;
  }

  set(n: number): void {
    this.value = Math.max(0, Math.floor(n));
    if (this.saveTimer === undefined) {
      this.saveTimer = window.setTimeout(() => this.flush(), 500);
    }
  }

  flush(): void {
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    try {
      localStorage.setItem(STORAGE_KEY, String(this.value));
    } catch {
      // プライベートモード等で保存できなくてもゲームは続ける
    }
  }
}

function load(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n >= 0) return n;
    }
  } catch {
    // 読めなければ初期値
  }
  return INITIAL_CREDITS;
}
