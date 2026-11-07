import * as THREE from 'three';
import { BOARD, CARD_INFO, JACKPOT_TIERS, JP_ROULETTE, SLOT_MAX_STOCK, type JackpotTier, type SlotSymbol } from './config';
import { SlotMachine } from './slot';
import type { Sugoroku } from './sugoroku';
import { starPath } from './textures';

/** 液晶の解像度（3D の液晶パネルの縦横比もこれに合わせる） */
export const LCD_PX_W = 512;
export const LCD_PX_H = 352;
const W = LCD_PX_W;
const H = LCD_PX_H;

// レイアウト
const HEADER_H = 32;
const BOARD_TOP = 34;
const BOARD_H = 192;
const COLS = 9; // 上下の段のマス数
const ROWS = 3; // 左右の列のマス数（四隅を除く）
const CELL_W = (W - 12) / COLS;
const CELL_H = BOARD_H / (ROWS + 2);
const BOTTOM_TOP = BOARD_TOP + BOARD_H + 6;

/**
 * 筐体奥の液晶。外周がすごろく、中央がサイコロ・メッセージ・ルーレット、下段がスロット。
 * Canvas に描いてテクスチャにする。動きがあるときは毎フレーム、止まっているときは 0.25 秒ごとに描き直す。
 */
export class Lcd {
  readonly texture: THREE.CanvasTexture;
  private readonly g: CanvasRenderingContext2D;
  private flashTime = 0;
  private time = 0;
  private lastDraw = -1;
  private readonly stars: [number, number, number][] = [];

  constructor() {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    this.g = c.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    for (let i = 0; i < 60; i++) this.stars.push([Math.random() * W, Math.random() * H, Math.random()]);
  }

  /** 当たり時などに背景を点滅させる */
  flash(seconds: number): void {
    this.flashTime = Math.max(this.flashTime, seconds);
  }

  update(slot: SlotMachine, board: Sugoroku, dt: number): void {
    this.time += dt;
    const flashing = this.flashTime > 0;
    if (flashing) this.flashTime -= dt;
    const animating =
      flashing ||
      slot.reach ||
      slot.fever ||
      slot.mode === 'spin' ||
      slot.mode === 'chance' ||
      slot.mode === 'roulette' ||
      slot.mode === 'jpSelect' ||
      board.busy;
    const blinkDue = this.time - this.lastDraw > 0.25;
    if (!slot.dirty && !board.dirty && !animating && !blinkDue) return;
    slot.dirty = false;
    board.dirty = false;
    this.lastDraw = this.time;
    this.draw(slot, board, flashing);
    this.texture.needsUpdate = true;
  }

  private draw(slot: SlotMachine, board: Sugoroku, flashing: boolean): void {
    const g = this.g;
    const on = Math.floor(this.time * 8) % 2 === 0;

    // 背景：宇宙
    const bg = g.createLinearGradient(0, 0, 0, H);
    if (flashing && on) {
      bg.addColorStop(0, '#4a2a00');
      bg.addColorStop(1, '#8a1050');
    } else {
      bg.addColorStop(0, '#05061a');
      bg.addColorStop(1, '#1a0c3a');
    }
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    for (const [x, y, b] of this.stars) {
      g.fillStyle = `rgba(255,255,255,${0.25 + 0.5 * b * (0.6 + 0.4 * Math.sin(this.time * 2 + x))})`;
      g.fillRect(x, y, 1.5, 1.5);
    }

    this.drawHeader(slot);
    this.drawBoard(board, on);
    this.drawCenter(slot, board, on);
    this.drawBottom(slot, board, on);
  }

  // ------------------------------------------------------------------ 上段

  private drawHeader(slot: SlotMachine): void {
    const g = this.g;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(0, 0, W, HEADER_H);
    g.textBaseline = 'middle';
    // GRAND / MAJOR / MINI を横に並べる（GRAND を一番目立たせる）
    const cols: [JackpotTier, number, number][] = [
      ['GRAND', 6, 196],
      ['MAJOR', 206, 150],
      ['MINI', 360, 146],
    ];
    for (const [tier, x, w] of cols) {
      const c = TIER_COLOR[tier];
      roundRect(g, x, 3, w, HEADER_H - 6, 6);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fill();
      g.strokeStyle = c;
      g.lineWidth = 1.5;
      g.stroke();
      g.textAlign = 'left';
      g.font = `bold ${tier === 'GRAND' ? 14 : 12}px system-ui, sans-serif`;
      g.fillStyle = c;
      g.fillText(tier, x + 7, 17);
      g.textAlign = 'right';
      g.font = `bold ${tier === 'GRAND' ? 22 : 18}px system-ui, sans-serif`;
      g.fillStyle = '#fff';
      g.shadowColor = c;
      g.shadowBlur = 8;
      g.fillText(slot.jackpotDisplay(tier).toLocaleString(), x + w - 7, 17);
      g.shadowBlur = 0;
    }
  }

  // ------------------------------------------------------------------ すごろく

  /** マス i の左上座標（外周を時計回り。左上から） */
  private cellRect(i: number): [number, number, number, number] {
    const x0 = 6;
    const y0 = BOARD_TOP;
    if (i < COLS) return [x0 + i * CELL_W, y0, CELL_W, CELL_H];
    i -= COLS;
    if (i < ROWS) return [x0 + (COLS - 1) * CELL_W, y0 + (i + 1) * CELL_H, CELL_W, CELL_H];
    i -= ROWS;
    if (i < COLS) return [x0 + (COLS - 1 - i) * CELL_W, y0 + (ROWS + 1) * CELL_H, CELL_W, CELL_H];
    i -= COLS;
    return [x0, y0 + (ROWS - i) * CELL_H, CELL_W, CELL_H];
  }

  private drawBoard(board: Sugoroku, on: boolean): void {
    const g = this.g;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    BOARD.forEach((sq, i) => {
      const [x, y, w, h] = this.cellRect(i);
      const pad = 2;
      let fill = '#1d3c8f';
      if (sq.type === 'base') fill = board.owned[i] ? '#b07a10' : '#5a3a14';
      else if (sq.type === 'card') fill = '#16704a';
      roundRect(g, x + pad, y + pad, w - pad * 2, h - pad * 2, 5);
      g.fillStyle = fill;
      g.fill();
      const isDest = i === board.dest;
      g.lineWidth = isDest ? 3 : 1;
      g.strokeStyle = isDest ? (on ? '#ffe14a' : '#ff5c8a') : 'rgba(255,255,255,0.25)';
      g.stroke();
      const cx = x + w / 2;
      const cy = y + h / 2;
      if (isDest) {
        starPath(g, cx, cy, 13);
        g.fillStyle = on ? '#ffe14a' : '#ffb000';
        g.fill();
        g.font = 'bold 10px system-ui, sans-serif';
        g.fillStyle = '#3a1a00';
        g.fillText('GOAL', cx, cy + 1);
        return;
      }
      switch (sq.type) {
        case 'medal':
          g.font = 'bold 15px system-ui, sans-serif';
          g.fillStyle = '#cfe6ff';
          g.fillText(`+${sq.value}`, cx, cy + 1);
          break;
        case 'base':
          // 基地：ドームの形。持っていれば旗
          g.beginPath();
          g.arc(cx, cy + 6, 11, Math.PI, 0);
          g.closePath();
          g.fillStyle = board.owned[i] ? '#ffe9a8' : '#c49a5a';
          g.fill();
          if (board.owned[i]) {
            g.fillStyle = '#ff3d6e';
            g.fillRect(cx + 1, cy - 12, 9, 6);
            g.fillStyle = '#fff';
            g.fillRect(cx, cy - 12, 1.5, 14);
          }
          break;
        case 'card':
          g.fillStyle = '#e8fff2';
          roundRect(g, cx - 8, cy - 11, 16, 22, 3);
          g.fill();
          g.font = 'bold 14px system-ui, sans-serif';
          g.fillStyle = '#16704a';
          g.fillText('?', cx, cy + 1);
          break;
      }
    });

    // ロケット（移動中は次のマスとの間を補間）
    const from = this.cellCenter(board.pos);
    const to = this.cellCenter((board.pos + 1) % BOARD.length);
    const t = board.mode === 'move' ? board.moveT : 0;
    const rx = from[0] + (to[0] - from[0]) * t;
    const ry = from[1] + (to[1] - from[1]) * t - (board.mode === 'move' ? Math.sin(t * Math.PI) * 8 : 0);
    drawRocket(g, rx, ry - 2, Math.atan2(to[1] - from[1], to[0] - from[0]));
  }

  private cellCenter(i: number): [number, number] {
    const [x, y, w, h] = this.cellRect(i);
    return [x + w / 2, y + h / 2];
  }

  // ------------------------------------------------------------------ 中央

  private drawCenter(slot: SlotMachine, board: Sugoroku, on: boolean): void {
    const g = this.g;
    const x0 = 6 + CELL_W + 4;
    const x1 = 6 + (COLS - 1) * CELL_W - 4;
    const y0 = BOARD_TOP + CELL_H + 4;
    const y1 = BOARD_TOP + (ROWS + 1) * CELL_H - 4;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    roundRect(g, x0, y0, x1 - x0, y1 - y0, 8);
    g.fillStyle = 'rgba(0,0,10,0.55)';
    g.fill();
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    if (slot.mode === 'jpSelect' || (slot.mode === 'rouletteResult' && slot.lastRoulette?.jackpot)) {
      this.drawJpSelect(slot, x0, x1, cy, on);
      return;
    }
    if (slot.mode === 'chance' || slot.mode === 'roulette' || slot.mode === 'rouletteResult') {
      this.drawRoulette(slot, cx, cy, on);
      return;
    }
    if (board.mode === 'roll' || (board.mode === 'move' && board.message === '')) {
      const n = board.dice.length;
      board.dice.forEach((v, k) => drawDie(g, cx + (k - (n - 1) / 2) * 70, cy, 56, v, board.mode === 'roll'));
      return;
    }
    if (board.message && board.mode !== 'idle') {
      if (board.mode === 'move') {
        // 進んでいる間はサイコロの目を小さく左に
        board.dice.forEach((v, k) => drawDie(g, x0 + 30 + k * 40, cy, 32, v, false));
      }
      g.font = 'bold 24px system-ui, sans-serif';
      g.fillStyle = board.mode === 'goal' ? (on ? '#ffe14a' : '#ff9a3a') : '#ffffff';
      g.shadowColor = '#000';
      g.shadowBlur = 6;
      fitText(g, board.message, cx, cy - (board.messageSub ? 13 : 0), x1 - x0 - 20);
      if (board.messageSub) {
        g.font = 'bold 15px system-ui, sans-serif';
        g.fillStyle = '#9fffcf';
        fitText(g, board.messageSub, cx, cy + 18, x1 - x0 - 20);
      }
      g.shadowBlur = 0;
      return;
    }
    // ふだんの表示：現在地・基地・配当
    g.font = 'bold 15px system-ui, sans-serif';
    g.fillStyle = '#cfe6ff';
    g.fillText(`${board.square.name} → 目的地 ${board.destSquare.name}（あと ${board.distanceToDest} マス）`, cx, y0 + 18);
    g.font = 'bold 14px system-ui, sans-serif';
    g.fillStyle = '#ffd36b';
    const total = BOARD.filter((s) => s.type === 'base').length;
    g.fillText(`基地 ${board.ownedCount}/${total}（全部で +500）　目的地の配当 +${board.dividend}`, cx, y0 + 42);
    g.font = '13px system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.7)';
    const cards = board.cards.length ? board.cards.map((c) => CARD_INFO[c].name).join('・') : 'なし';
    g.fillText(`カード：${cards}${board.turbo ? '（ターボ準備中）' : ''}`, cx, y0 + 64);
    if (board.pending > 0) {
      g.font = 'bold 14px system-ui, sans-serif';
      g.fillStyle = on ? '#ffe14a' : '#ffffff';
      g.fillText(`サイコロ待ち ×${board.pending}`, cx, y0 + 86);
    }
  }

  /** ジャックポットの段の抽選：3つの枠をハイライトが回って止まる */
  private drawJpSelect(slot: SlotMachine, x0: number, x1: number, cy: number, on: boolean): void {
    const g = this.g;
    const done = slot.mode === 'rouletteResult';
    const w = (x1 - x0 - 40) / 3;
    JACKPOT_TIERS.forEach((tier, i) => {
      const x = x0 + 10 + i * (w + 10);
      const lit = slot.jpSelectIndex === i;
      const c = TIER_COLOR[tier];
      roundRect(g, x, cy - 34, w, 68, 8);
      g.fillStyle = lit ? (done && !on ? '#000' : c) : 'rgba(255,255,255,0.08)';
      g.fill();
      g.strokeStyle = c;
      g.lineWidth = lit ? 4 : 2;
      g.stroke();
      g.textAlign = 'center';
      g.font = `bold ${tier === 'GRAND' ? 20 : 17}px system-ui, sans-serif`;
      g.fillStyle = lit && !(done && !on) ? '#1a0a00' : c;
      g.fillText(tier, x + w / 2, cy - 12);
      g.font = 'bold 18px system-ui, sans-serif';
      g.fillStyle = lit && !(done && !on) ? '#1a0a00' : '#ffffff';
      const amount = done && lit && slot.lastRoulette ? slot.lastRoulette.payout : slot.jackpotDisplay(tier);
      g.fillText(amount.toLocaleString(), x + w / 2, cy + 14);
    });
  }

  private drawRoulette(slot: SlotMachine, cx: number, cy: number, on: boolean): void {
    const g = this.g;
    const R = 46;
    const n = JP_ROULETTE.length;
    const seg = (Math.PI * 2) / n;
    for (let i = 0; i < n; i++) {
      // 区画 i の中心が角度 (i*seg - angle) にある。針は真上
      const a = -Math.PI / 2 + i * seg - slot.rouletteAngle;
      const v = JP_ROULETTE[i];
      const hit = slot.mode === 'rouletteResult' && slot.rouletteIndex === i;
      g.beginPath();
      g.moveTo(cx, cy + 6);
      g.arc(cx, cy + 6, R, a - seg / 2, a + seg / 2);
      g.closePath();
      g.fillStyle = v === 'JP' ? (hit && on ? '#fff3a0' : '#e8b400') : hit && on ? '#ffffff' : i % 2 ? '#2b4cd6' : '#1a2f8f';
      g.fill();
      g.strokeStyle = '#000';
      g.lineWidth = 2;
      g.stroke();
      g.save();
      g.translate(cx + Math.cos(a) * R * 0.66, cy + 6 + Math.sin(a) * R * 0.66);
      g.rotate(a + Math.PI / 2);
      g.fillStyle = v === 'JP' ? '#a3002f' : '#ffffff';
      g.font = `bold ${v === 'JP' ? 15 : 13}px system-ui, sans-serif`;
      g.fillText(String(v), 0, 0);
      g.restore();
    }
    g.beginPath();
    g.arc(cx, cy + 6, 9, 0, Math.PI * 2);
    g.fillStyle = '#ffd84a';
    g.fill();
    // 針
    g.beginPath();
    g.moveTo(cx, cy + 6 - R + 12);
    g.lineTo(cx - 9, cy + 6 - R - 8);
    g.lineTo(cx + 9, cy + 6 - R - 8);
    g.closePath();
    g.fillStyle = '#ff3d6e';
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.stroke();
    g.font = 'bold 20px system-ui, sans-serif';
    g.fillStyle = on ? '#ffd84a' : '#ff5c8a';
    const label = slot.mode === 'rouletteResult' && slot.lastRoulette
      ? `+${slot.lastRoulette.payout}`
      : 'JP CHANCE';
    g.fillText(label, cx - 120, cy + 6);
    g.fillText(label, cx + 120, cy + 6);
  }

  // ------------------------------------------------------------------ 下段：スロット

  private drawBottom(slot: SlotMachine, board: Sugoroku, on: boolean): void {
    const g = this.g;
    const top = BOTTOM_TOP;
    const h = H - top - 6;
    const cell = h / 3;
    const ww = 76;
    const gap = 6;
    const x0 = 8;
    const win = slot.mode === 'result' && slot.lastWin !== null;
    slot.reels.forEach((r, i) => {
      const x = x0 + i * (ww + gap);
      g.save();
      g.beginPath();
      g.rect(x, top, ww, h);
      g.clip();
      const grad = g.createLinearGradient(0, top, 0, top + h);
      grad.addColorStop(0, '#8a8a8a');
      grad.addColorStop(0.5, '#ffffff');
      grad.addColorStop(1, '#8a8a8a');
      g.fillStyle = grad;
      g.fillRect(x, top, ww, h);
      const center = top + h / 2;
      const base = Math.floor(r.pos);
      for (let k = -2; k <= 2; k++) {
        const idx = base + k;
        const cy = center + (r.pos - idx) * cell;
        drawSymbol(g, SlotMachine.symbolAt(idx), x + ww / 2, cy, cell * 0.8, !r.stopped && !r.stopping);
      }
      g.restore();
      g.strokeStyle = win ? '#ffd84a' : '#000';
      g.lineWidth = 3;
      g.strokeRect(x, top, ww, h);
    });
    const reelsRight = x0 + 3 * ww + 2 * gap;
    g.strokeStyle = slot.reach ? '#ff3d6e' : 'rgba(255,60,90,0.6)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0 - 4, top + h / 2);
    g.lineTo(reelsRight + 4, top + h / 2);
    g.stroke();

    // 右側：保留・メッセージ
    const rx = reelsRight + 14;
    const cxr = (rx + W - 8) / 2;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = 'bold 13px system-ui, sans-serif';
    g.fillStyle = '#9fb3ff';
    g.fillText('保留', rx, top + 14);
    for (let i = 0; i < SLOT_MAX_STOCK; i++) {
      g.beginPath();
      g.arc(rx + 44 + i * 20, top + 14, 7, 0, Math.PI * 2);
      g.fillStyle = i < slot.stock ? '#ffe14a' : '#2a2f55';
      g.fill();
      g.strokeStyle = '#000';
      g.lineWidth = 1.5;
      g.stroke();
    }
    g.font = '12px system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.65)';
    g.fillText('★★★ でサイコロボール', rx, top + 40);

    if (slot.fever) {
      // フィーバー中：残り秒数を虹色で
      const hue = (this.time * 240) % 360;
      g.textAlign = 'center';
      g.font = 'italic 900 30px system-ui, sans-serif';
      g.fillStyle = `hsl(${hue},100%,62%)`;
      g.shadowColor = `hsl(${(hue + 180) % 360},100%,50%)`;
      g.shadowBlur = 12;
      g.fillText('FEVER', cxr, top + 64);
      g.font = 'bold 18px system-ui, sans-serif';
      g.fillStyle = '#ffffff';
      g.fillText(`残り ${Math.ceil(slot.feverTime)} 秒・当たり2倍`, cxr, top + 94);
      g.shadowBlur = 0;
      if (slot.mode === 'result' && slot.lastWin && slot.lastWin.payout > 0) {
        g.font = 'bold 16px system-ui, sans-serif';
        g.fillStyle = '#7dffb0';
        g.fillText(`WIN +${slot.lastWin.payout}`, cxr, top + 36);
      }
      return;
    }
    let msg = '';
    let color = '#ffffff';
    if (slot.mode === 'result' && slot.lastWin?.symbol === 'STAR') {
      msg = 'BALL GET!';
      color = '#ffd84a';
    } else if (slot.mode === 'result' && slot.lastWin && slot.lastWin.payout > 0) {
      msg = `WIN +${slot.lastWin.payout}`;
      color = '#7dffb0';
    } else if (slot.reach) {
      msg = on ? 'リーチ!' : '';
      color = '#ff5c8a';
    } else if (board.turbo) {
      msg = 'ターボ準備中';
      color = '#9fd8ff';
    }
    if (msg) {
      g.textAlign = 'center';
      g.font = 'bold 24px system-ui, sans-serif';
      g.fillStyle = color;
      g.shadowColor = color;
      g.shadowBlur = 8;
      g.fillText(msg, cxr, top + 80);
      g.shadowBlur = 0;
    }
  }
}

// -------------------------------------------------------------------- 描画部品

const TIER_COLOR: Record<JackpotTier, string> = {
  GRAND: '#ffd84a',
  MAJOR: '#ff6b9a',
  MINI: '#6bd0ff',
};

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** 長い文字は幅に収まるよう縮める */
function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number): void {
  const w = g.measureText(text).width;
  if (w <= maxW) {
    g.fillText(text, x, y);
    return;
  }
  g.save();
  g.translate(x, y);
  g.scale(maxW / w, 1);
  g.fillText(text, 0, 0);
  g.restore();
}

function drawRocket(g: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  // 炎
  g.beginPath();
  g.moveTo(-10, -4);
  g.lineTo(-18 - Math.random() * 4, 0);
  g.lineTo(-10, 4);
  g.closePath();
  g.fillStyle = '#ff9a1a';
  g.fill();
  // 胴体
  g.beginPath();
  g.moveTo(14, 0);
  g.quadraticCurveTo(6, -8, -10, -6);
  g.lineTo(-10, 6);
  g.quadraticCurveTo(6, 8, 14, 0);
  g.closePath();
  g.fillStyle = '#f2f4ff';
  g.fill();
  g.strokeStyle = '#30365a';
  g.lineWidth = 1.5;
  g.stroke();
  // 窓と羽
  g.beginPath();
  g.arc(3, 0, 3, 0, Math.PI * 2);
  g.fillStyle = '#4ab8ff';
  g.fill();
  g.fillStyle = '#ff3d6e';
  g.beginPath();
  g.moveTo(-6, -6);
  g.lineTo(-12, -11);
  g.lineTo(-11, -5);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(-6, 6);
  g.lineTo(-12, 11);
  g.lineTo(-11, 5);
  g.closePath();
  g.fill();
  g.restore();
}

/** サイコロ（白地に目） */
function drawDie(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, v: number, rolling: boolean): void {
  g.save();
  g.translate(cx, cy);
  if (rolling) g.rotate((Math.random() - 0.5) * 0.5);
  roundRect(g, -size / 2, -size / 2, size, size, size * 0.18);
  g.fillStyle = '#ffffff';
  g.fill();
  g.strokeStyle = '#30365a';
  g.lineWidth = 2;
  g.stroke();
  const p = size * 0.26;
  const pips: Record<number, [number, number][]> = {
    1: [[0, 0]],
    2: [[-p, -p], [p, p]],
    3: [[-p, -p], [0, 0], [p, p]],
    4: [[-p, -p], [p, -p], [-p, p], [p, p]],
    5: [[-p, -p], [p, -p], [0, 0], [-p, p], [p, p]],
    6: [[-p, -p], [p, -p], [-p, 0], [p, 0], [-p, p], [p, p]],
  };
  for (const [x, y] of pips[v] ?? []) {
    g.beginPath();
    g.arc(x, y, size * (v === 1 ? 0.12 : 0.085), 0, Math.PI * 2);
    g.fillStyle = v === 1 ? '#e8102e' : '#1a1a2a';
    g.fill();
  }
  g.restore();
}

function drawSymbol(g: CanvasRenderingContext2D, s: SlotSymbol, cx: number, cy: number, size: number, blur: boolean): void {
  g.save();
  g.translate(cx, cy);
  if (blur) g.scale(1, 1.25);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  switch (s) {
    case '7':
      g.font = `italic 900 ${size}px system-ui, sans-serif`;
      g.fillStyle = '#e8102e';
      g.strokeStyle = '#4a0008';
      g.lineWidth = 3;
      g.strokeText('7', 0, 2);
      g.fillText('7', 0, 2);
      break;
    case 'BAR':
      g.fillStyle = '#111';
      g.fillRect(-size * 0.75, -size * 0.28, size * 1.5, size * 0.56);
      g.fillStyle = '#fff';
      g.font = `900 ${size * 0.42}px system-ui, sans-serif`;
      g.fillText('BAR', 0, 1);
      break;
    case 'STAR':
      starPath(g, 0, 0, size * 0.48);
      g.fillStyle = '#ffd400';
      g.fill();
      g.strokeStyle = '#a06a00';
      g.lineWidth = 2.5;
      g.stroke();
      break;
    case 'BELL': {
      const r = size * 0.36;
      g.beginPath();
      g.moveTo(-r * 1.15, r * 0.7);
      g.quadraticCurveTo(-r * 0.9, -r * 1.2, 0, -r * 1.1);
      g.quadraticCurveTo(r * 0.9, -r * 1.2, r * 1.15, r * 0.7);
      g.closePath();
      g.fillStyle = '#f2b51d';
      g.fill();
      g.strokeStyle = '#7a4e00';
      g.lineWidth = 2;
      g.stroke();
      g.beginPath();
      g.arc(0, r * 0.85, r * 0.25, 0, Math.PI * 2);
      g.fillStyle = '#7a4e00';
      g.fill();
      break;
    }
    case 'CHERRY': {
      const r = size * 0.2;
      g.strokeStyle = '#1f7a1f';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(-r * 1.1, r * 0.6);
      g.quadraticCurveTo(-r * 0.3, -r * 2, r * 0.8, -r * 2.2);
      g.moveTo(r * 1.1, r * 0.4);
      g.quadraticCurveTo(r * 0.6, -r * 1.2, r * 0.8, -r * 2.2);
      g.stroke();
      for (const [x, y] of [
        [-r * 1.1, r * 1.0],
        [r * 1.1, r * 0.8],
      ]) {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fillStyle = '#d4102f';
        g.fill();
        g.beginPath();
        g.arc(x - r * 0.35, y - r * 0.35, r * 0.3, 0, Math.PI * 2);
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.fill();
      }
      break;
    }
  }
  g.restore();
}
