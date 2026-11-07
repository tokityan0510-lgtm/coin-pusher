import * as THREE from 'three';
import { JP_ROULETTE, SLOT_MAX_STOCK, type SlotSymbol } from './config';
import { SlotMachine } from './slot';
import { starPath } from './textures';

const W = 512;
const H = 224;

/**
 * 筐体奥の液晶。スロット・保留・ジャックポット枚数・ルーレットを Canvas に描いてテクスチャにする。
 * 変化があるときだけ描き直す（毎フレームのテクスチャ転送を避ける）。
 */
export class Lcd {
  readonly texture: THREE.CanvasTexture;
  private readonly g: CanvasRenderingContext2D;
  private flashTime = 0;
  private blink = 0;

  constructor() {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    this.g = c.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }

  /** 当たり時などに背景を点滅させる */
  flash(seconds: number): void {
    this.flashTime = Math.max(this.flashTime, seconds);
  }

  update(slot: SlotMachine, dt: number): void {
    this.blink += dt;
    const flashing = this.flashTime > 0;
    if (flashing) this.flashTime -= dt;
    // 点滅・リーチ中は常に、それ以外は状態が変わったときだけ描く
    if (!slot.dirty && !flashing && !slot.reach && slot.mode !== 'chance') return;
    slot.dirty = false;
    this.draw(slot, flashing);
    this.texture.needsUpdate = true;
  }

  private draw(slot: SlotMachine, flashing: boolean): void {
    const g = this.g;
    const on = Math.floor(this.blink * 8) % 2 === 0;

    // 背景
    const bg = g.createLinearGradient(0, 0, 0, H);
    if (flashing && on) {
      bg.addColorStop(0, '#5a3b00');
      bg.addColorStop(1, '#a8125a');
    } else {
      bg.addColorStop(0, '#0a0f2e');
      bg.addColorStop(1, '#22114a');
    }
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    // ジャックポット表示
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, 0, W, 40);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = 'bold 20px system-ui, sans-serif';
    g.fillStyle = '#ff6b9a';
    g.fillText('JACKPOT', 16, 21);
    g.textAlign = 'right';
    g.font = 'bold 30px system-ui, sans-serif';
    g.fillStyle = '#ffd84a';
    g.shadowColor = '#ff9a00';
    g.shadowBlur = 10;
    g.fillText(String(slot.jackpotDisplay), W - 16, 22);
    g.shadowBlur = 0;

    if (slot.mode === 'roulette' || slot.mode === 'rouletteResult' || slot.mode === 'chance') {
      this.drawRoulette(slot, on);
    } else {
      this.drawReels(slot);
    }

    // 保留ランプ
    const y = H - 18;
    g.textAlign = 'left';
    g.font = 'bold 14px system-ui, sans-serif';
    g.fillStyle = '#9fb3ff';
    g.fillText('保留', 14, y);
    for (let i = 0; i < SLOT_MAX_STOCK; i++) {
      g.beginPath();
      g.arc(62 + i * 22, y, 7, 0, Math.PI * 2);
      g.fillStyle = i < slot.stock ? '#ffe14a' : '#2a2f55';
      g.fill();
      g.strokeStyle = '#000';
      g.lineWidth = 1.5;
      g.stroke();
    }

    // メッセージ
    let msg = '';
    let color = '#ffffff';
    if (slot.mode === 'chance') {
      msg = on ? 'JACKPOT CHANCE!!' : '';
      color = '#ff5c8a';
    } else if (slot.mode === 'rouletteResult' && slot.lastRoulette) {
      msg = slot.lastRoulette.jackpot ? `JACKPOT!! +${slot.lastRoulette.payout}` : `+${slot.lastRoulette.payout} 枚`;
      color = slot.lastRoulette.jackpot ? '#ffd84a' : '#7dffb0';
    } else if (slot.mode === 'result' && slot.lastWin && slot.lastWin.payout > 0) {
      msg = `WIN +${slot.lastWin.payout} 枚`;
      color = '#7dffb0';
    } else if (slot.reach) {
      msg = on ? 'リーチ!' : '';
      color = '#ff5c8a';
    }
    if (msg) {
      g.textAlign = 'right';
      g.font = 'bold 22px system-ui, sans-serif';
      g.fillStyle = color;
      g.shadowColor = color;
      g.shadowBlur = 8;
      g.fillText(msg, W - 14, y);
      g.shadowBlur = 0;
    }
  }

  private drawReels(slot: SlotMachine): void {
    const g = this.g;
    const top = 48;
    const h = 140;
    const cell = h / 3;
    const ww = 138;
    const gap = 14;
    const x0 = (W - (ww * 3 + gap * 2)) / 2;
    const win = slot.mode === 'result' && slot.lastWin && slot.lastWin.payout > 0;
    slot.reels.forEach((r, i) => {
      const x = x0 + i * (ww + gap);
      g.save();
      g.beginPath();
      g.rect(x, top, ww, h);
      g.clip();
      const grad = g.createLinearGradient(0, top, 0, top + h);
      grad.addColorStop(0, '#9a9a9a');
      grad.addColorStop(0.5, '#ffffff');
      grad.addColorStop(1, '#9a9a9a');
      g.fillStyle = grad;
      g.fillRect(x, top, ww, h);
      const center = top + h / 2;
      const base = Math.floor(r.pos);
      for (let k = -2; k <= 2; k++) {
        const idx = base + k;
        const cy = center + (r.pos - idx) * cell;
        // 回転中は少しぼかす代わりに縦に伸ばす
        const blur = !r.stopped && !r.stopping;
        drawSymbol(g, SlotMachine.symbolAt(idx), x + ww / 2, cy, cell * 0.8, blur);
      }
      g.restore();
      g.strokeStyle = win ? '#ffd84a' : '#000';
      g.lineWidth = 3;
      g.strokeRect(x, top, ww, h);
    });
    // 中段ライン
    g.strokeStyle = slot.reach ? '#ff3d6e' : 'rgba(255,60,90,0.6)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x0 - 6, top + h / 2);
    g.lineTo(W - x0 + 6, top + h / 2);
    g.stroke();
  }

  private drawRoulette(slot: SlotMachine, on: boolean): void {
    const g = this.g;
    const cx = W / 2;
    const cy = 48 + 72;
    const R = 70;
    const n = JP_ROULETTE.length;
    const seg = (Math.PI * 2) / n;
    for (let i = 0; i < n; i++) {
      // 区画 i の中心が角度 (i*seg - angle) にある。針は真上
      const a = -Math.PI / 2 + i * seg - slot.rouletteAngle;
      const v = JP_ROULETTE[i];
      const hit = slot.mode === 'rouletteResult' && slot.rouletteIndex === i;
      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, R, a - seg / 2, a + seg / 2);
      g.closePath();
      g.fillStyle = v === 'JP' ? (hit && on ? '#fff3a0' : '#e8b400') : hit && on ? '#ffffff' : i % 2 ? '#2b4cd6' : '#1a2f8f';
      g.fill();
      g.strokeStyle = '#000';
      g.lineWidth = 2;
      g.stroke();
      g.save();
      g.translate(cx + Math.cos(a) * R * 0.66, cy + Math.sin(a) * R * 0.66);
      g.rotate(a + Math.PI / 2);
      g.fillStyle = v === 'JP' ? '#a3002f' : '#ffffff';
      g.font = `bold ${v === 'JP' ? 18 : 15}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(v), 0, 0);
      g.restore();
    }
    g.beginPath();
    g.arc(cx, cy, 12, 0, Math.PI * 2);
    g.fillStyle = '#ffd84a';
    g.fill();
    // 針
    g.beginPath();
    g.moveTo(cx, cy - R + 14);
    g.lineTo(cx - 10, cy - R - 8);
    g.lineTo(cx + 10, cy - R - 8);
    g.closePath();
    g.fillStyle = '#ff3d6e';
    g.fill();
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.stroke();
    // 左右に大きく JP の文字
    g.font = 'bold 28px system-ui, sans-serif';
    g.fillStyle = on ? '#ffd84a' : '#ff5c8a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('JP', 70, cy);
    g.fillText('JP', W - 70, cy);
  }
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
