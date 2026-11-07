import {
  CHUCKER_BAR_HEIGHT,
  CHUCKER_Y,
  DROP_X_MAX,
  DROP_Z,
  FLOOR_X,
  FRONT_Z,
  JACKPOT_PAYOUT_RATE,
  MEDAL_THICKNESS,
  PAYOUT_MAX_ACTIVE,
  PAYOUT_RATE,
  PUSHER_FRONT_RETRACTED,
} from './config';
import type { Machine } from './physics';

/**
 * 当たりの払い出し。所持メダルに直接足すのではなく、盤面にメダルを降らせる（ゲーセンの筐体と同じ）。
 * 通常はプッシャーの上へ（入賞口の枠より下から）、ジャックポットは盤面全体へ降らせる。
 * 盤上の枚数が PAYOUT_MAX_ACTIVE 以上のときは待つ（処理落ち防止）。
 */
export class Payout {
  /** 残り枚数 */
  normal = 0;
  jackpot = 0;
  private normalAcc = 0;
  private jackpotAcc = 0;

  constructor(private readonly machine: Machine) {}

  get active(): boolean {
    return this.normal > 0 || this.jackpot > 0;
  }

  get jackpotActive(): boolean {
    return this.jackpot > 0;
  }

  add(n: number, jackpot = false): void {
    if (jackpot) this.jackpot += n;
    else this.normal += n;
  }

  update(dt: number): void {
    const m = this.machine;
    if (this.jackpot > 0) {
      this.jackpotAcc += dt * JACKPOT_PAYOUT_RATE;
      while (this.jackpotAcc >= 1 && this.jackpot > 0 && m.count < PAYOUT_MAX_ACTIVE) {
        this.jackpotAcc--;
        const x = (Math.random() * 2 - 1) * (FLOOR_X - 0.6);
        const z = PUSHER_FRONT_RETRACTED + 0.6 + Math.random() * (FRONT_Z - PUSHER_FRONT_RETRACTED - 2.2);
        if (m.spawnMedal(x, 4 + Math.random() * 2, z, randomTilt(), true)) this.jackpot--;
      }
      this.jackpotAcc = Math.min(this.jackpotAcc, 2);
    }
    if (this.normal > 0) {
      this.normalAcc += dt * PAYOUT_RATE;
      while (this.normalAcc >= 1 && this.normal > 0 && m.count < PAYOUT_MAX_ACTIVE) {
        this.normalAcc--;
        const x = (Math.random() * 2 - 1) * DROP_X_MAX;
        // 入賞口の枠より下から出す（払い出しのメダルで入賞しないように）
        const y = CHUCKER_Y - CHUCKER_BAR_HEIGHT - MEDAL_THICKNESS;
        if (m.spawnMedal(x, y, DROP_Z + (Math.random() - 0.5) * 0.8, randomTilt(), true)) this.normal--;
      }
      this.normalAcc = Math.min(this.normalAcc, 2);
    }
  }
}

function randomTilt(): { x: number; y: number; z: number; w: number } {
  const a = (Math.random() - 0.5) * 0.6;
  return { x: Math.sin(a / 2), y: 0, z: 0, w: Math.cos(a / 2) };
}
