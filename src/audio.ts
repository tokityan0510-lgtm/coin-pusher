import { MUTE_STORAGE_KEY } from './config';

/**
 * 効果音はすべて Web Audio で合成する（音声ファイルを持たない＝外部取得なし・容量ゼロ）。
 * スマホのブラウザは「ユーザー操作の中で」AudioContext を開始しないと音が出ないので、
 * 最初のタップで unlock() を呼ぶこと。
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted: boolean;
  /** 同時発音数の制御（重なりすぎると音が割れる・重くなる） */
  private active = 0;
  private readonly maxVoices = 24;
  /** 衝突音の連発制限 */
  private clinkBudget = 0;
  private lastClinkRefill = 0;
  private reelLoop: { stop(): void } | null = null;

  constructor() {
    let m = false;
    try {
      m = localStorage.getItem(MUTE_STORAGE_KEY) === '1';
    } catch {
      // 読めなければ音あり
    }
    this.muted = m;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, m ? '1' : '0');
    } catch {
      // 保存できなくても続行
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.02);
  }

  /** タップ等のユーザー操作の中で呼ぶ */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      // 軽いコンプレッサーで、メダルが一気に鳴っても割れないようにする
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  // ---------------------------------------------------------------- メダル

  /** メダル同士・床に当たる「チャリッ」。strength はおよそ 0..1 */
  clink(strength: number, pan = 0): void {
    const ctx = this.ready();
    if (!ctx) return;
    // 1秒あたり最大 30 回まで
    const now = ctx.currentTime;
    this.clinkBudget = Math.min(6, this.clinkBudget + (now - this.lastClinkRefill) * 30);
    this.lastClinkRefill = now;
    if (this.clinkBudget < 1) return;
    this.clinkBudget--;
    const v = Math.min(1, Math.max(0.05, strength));
    const base = 2400 + Math.random() * 1600;
    // 金属らしさは整数倍でない倍音で出す
    this.metal(now, base, [1, 1.73, 2.61, 3.4], 0.06 + v * 0.1, 0.05 + v * 0.12, pan);
    this.noiseHit(now, 6000, 0.04 * v, 0.015, pan);
  }

  /** 投入口に入れる音 */
  insert(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.metal(t, 1900, [1, 2.4, 3.9], 0.12, 0.18);
    this.metal(t + 0.06, 2900, [1, 1.6, 2.7], 0.08, 0.12);
  }

  /** 手前に落ちて獲得したとき（受け皿に落ちる音） */
  win(count: number): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = Math.min(6, count + 1);
    for (let i = 0; i < n; i++) {
      this.metal(t + 0.08 + i * 0.045 + Math.random() * 0.03, 2100 + Math.random() * 1500, [1, 1.9, 3.1], 0.1, 0.16);
    }
  }

  /** 溝に落ちたとき（低く鈍い音） */
  lost(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(t + 0.05, 'triangle', 220, 140, 0.06, 0.12);
  }

  /** 所持メダルの加算カウント音 */
  tick(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx.currentTime, 'square', 1760, 1760, 0.025, 0.03);
  }

  // ---------------------------------------------------------------- 入賞・スロット

  /** 入賞口に入った */
  pocket(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [988, 1319, 1976].forEach((f, i) => this.tone(t + i * 0.07, 'square', f, f, 0.07, 0.12));
  }

  spinStart(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.tone(ctx.currentTime, 'square', 523, 1046, 0.06, 0.1);
    this.startReelLoop();
  }

  reelStop(i: number, last: boolean): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseHit(t, 2500, 0.18, 0.04);
    this.tone(t, 'square', 330 - i * 30, 200, 0.08, 0.06);
    if (last) this.stopReelLoop();
  }

  reach(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 6; i++) this.tone(t + i * 0.12, 'square', i % 2 ? 1175 : 1568, i % 2 ? 1175 : 1568, 0.06, 0.1);
  }

  slotWin(big: boolean): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const notes = big ? [523, 659, 784, 1046, 784, 1046, 1318, 1568] : [784, 988, 1175, 1568];
    notes.forEach((f, i) => this.tone(t + i * 0.09, 'square', f, f, 0.08, 0.14));
    notes.forEach((f, i) => this.tone(t + i * 0.09, 'triangle', f / 2, f / 2, 0.1, 0.14));
  }

  miss(): void {
    this.stopReelLoop();
  }

  jackpotChance(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 12; i++) {
      const f = 600 + i * 90;
      this.tone(t + i * 0.08, 'sawtooth', f, f * 1.02, 0.05, 0.1);
    }
  }

  rouletteTick(): void {
    const ctx = this.ready();
    if (!ctx) return;
    this.noiseHit(ctx.currentTime, 4000, 0.12, 0.02);
    this.tone(ctx.currentTime, 'square', 2093, 2093, 0.04, 0.02);
  }

  jackpot(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const seq = [523, 659, 784, 1046, 1318, 1568, 2093];
    for (let rep = 0; rep < 3; rep++) {
      seq.forEach((f, i) => this.tone(t + rep * 0.7 + i * 0.08, 'square', f, f, 0.07, 0.16));
    }
    this.tone(t + 2.1, 'sawtooth', 1046, 1046, 0.08, 1.2);
    this.tone(t + 2.1, 'square', 1568, 1568, 0.06, 1.2);
  }

  /** ルーレットのハズレ（小当たり） */
  smallPrize(): void {
    this.slotWin(false);
  }

  // ---------------------------------------------------------------- 内部

  private ready(): AudioContext | null {
    if (!this.ctx || this.muted || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  private voice(dur: number): boolean {
    if (this.active >= this.maxVoices) return false;
    this.active++;
    window.setTimeout(() => this.active--, dur * 1000 + 50);
    return true;
  }

  private panner(pan: number): AudioNode {
    const ctx = this.ctx!;
    if (pan === 0 || !ctx.createStereoPanner) return this.master!;
    const p = ctx.createStereoPanner();
    p.pan.value = pan * 0.7;
    p.connect(this.master!);
    return p;
  }

  /** 非整数倍音のサイン波を重ねた金属音 */
  private metal(t: number, f: number, ratios: number[], gain: number, decay: number, pan = 0): void {
    const ctx = this.ctx!;
    if (!this.voice(decay)) return;
    const out = this.panner(pan);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(out);
    ratios.forEach((r, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * r;
      const og = ctx.createGain();
      og.gain.value = 1 / (i + 1.5);
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + decay + 0.02);
    });
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, gain: number, dur: number): void {
    const ctx = this.ctx!;
    if (!this.voice(dur)) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.setValueAtTime(gain, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseHit(t: number, freq: number, gain: number, dur: number, pan = 0): void {
    const ctx = this.ctx!;
    if (!this.noise || !this.voice(dur)) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.panner(pan));
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur + 0.02);
  }

  /** リール回転中の「カラカラ」音 */
  private startReelLoop(): void {
    this.stopReelLoop();
    const ctx = this.ctx;
    if (!ctx) return;
    let alive = true;
    const step = () => {
      if (!alive) return;
      if (this.ready()) this.noiseHit(ctx.currentTime, 3200, 0.05, 0.02);
      window.setTimeout(step, 55);
    };
    step();
    this.reelLoop = { stop: () => (alive = false) };
  }

  private stopReelLoop(): void {
    this.reelLoop?.stop();
    this.reelLoop = null;
  }
}
