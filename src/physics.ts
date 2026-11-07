import RAPIER from '@dimforge/rapier3d-compat';
import {
  BACK_Z,
  BOUNDS,
  CURTAIN_FRONT_Z,
  CURTAIN_GAP,
  DROP_SOFT_CCD,
  FIXED_DT,
  FLOOR_X,
  FRONT_Z,
  GUTTER_START_Z,
  KILL_Y,
  MAX_MEDALS,
  MEDAL_BORDER,
  MEDAL_RADIUS,
  MEDAL_THICKNESS,
  PUSHER_FRONT_RETRACTED,
  PUSHER_HEIGHT,
  PUSHER_LENGTH,
  PUSHER_SIDE_GAP,
  PUSHER_STROKE_MAX,
  PUSHER_STROKE_MIN,
  CHUCKER_BAR,
  CHUCKER_BAR_HEIGHT,
  CHUCKER_DEPTH,
  CHUCKER_WIDTH,
  CHUCKER_Y,
  CHUCKER_Z,
  GUTTER_WIDTH,
  WALL_HEIGHT,
  WALL_THICKNESS,
  WALL_X,
  type PhysicsParams,
} from './config';

/** これ以上の速度変化（ユニット/秒、1ステップあたり）を衝突として効果音を鳴らす。重力だけなら 0.5 */
const IMPACT_DV = 2.5;

/** 仕切り板の厚さ */
export const CURTAIN_T = 0.4;
/** 仕切り板の上端（この上に液晶パネルが奥へ傾いて載る） */
export const CURTAIN_TOP = PUSHER_HEIGHT + 1.2;

/** 1枚あたりの姿勢データ: x y z qx qy qz qw */
export const POSE_STRIDE = 7;

export interface StepResult {
  /** 手前から落ちた（獲得） */
  won: number;
  /** 溝・盤外へ落ちた（没収） */
  lost: number;
  /** 入賞口を通り抜けた */
  chucker: number;
  /** このステップで起きた衝突の数と最大の強さ（効果音用。速度変化量 ユニット/秒） */
  impacts: number;
  impactMax: number;
  /** 衝突の x 位置の平均（-1..1 に正規化。効果音の左右定位用） */
  impactPan: number;
}

/** 静的な盤面パーツ（描画側でも同じ寸法を使う） */
export interface BoxPart {
  name: 'floor' | 'side' | 'wall' | 'curtain' | 'back' | 'chucker' | 'lid';
  half: [number, number, number];
  pos: [number, number, number];
}

/** 盤面の静的コライダー定義。物理と描画で共有する。配置図は config.ts を参照 */
export function boardParts(): BoxPart[] {
  const floorT = 0.5;
  const floorLen = FRONT_Z - BACK_Z;
  const sideLen = GUTTER_START_Z - BACK_Z;
  const curtainBottom = PUSHER_HEIGHT + CURTAIN_GAP;
  const curtainTop = CURTAIN_TOP;
  const sides = [-1, 1] as const;
  return [
    // 床（プッシャーと同じ幅。左右は溝）
    {
      name: 'floor',
      half: [FLOOR_X, floorT / 2, floorLen / 2],
      pos: [0, -floorT / 2, BACK_Z + floorLen / 2],
    },
    // プッシャー可動域の横を塞ぐブロック（ここから溝に直接落ちないように）
    ...sides.map(
      (s): BoxPart => ({
        name: 'side',
        half: [GUTTER_WIDTH / 2, (CURTAIN_TOP + floorT) / 2, sideLen / 2],
        pos: [s * (FLOOR_X + GUTTER_WIDTH / 2), (CURTAIN_TOP - floorT) / 2, BACK_Z + sideLen / 2],
      }),
    ),
    // 外壁
    ...sides.map(
      (s): BoxPart => ({
        name: 'wall',
        half: [WALL_THICKNESS / 2, WALL_HEIGHT / 2, floorLen / 2],
        pos: [s * (WALL_X + WALL_THICKNESS / 2), WALL_HEIGHT / 2 - floorT, BACK_Z + floorLen / 2],
      }),
    ),
    // 仕切り板：プッシャーの上に浮いていて、引いたときに上のメダルを掻き落とす
    {
      name: 'curtain',
      half: [FLOOR_X, (curtainTop - curtainBottom) / 2, CURTAIN_T / 2],
      pos: [0, (curtainTop + curtainBottom) / 2, CURTAIN_FRONT_Z - CURTAIN_T / 2],
    },
    // 入賞口の枠（左右と前後の4本）。投入メダルの落下途中に浮いている
    ...sides.map(
      (s): BoxPart => ({
        name: 'chucker',
        half: [CHUCKER_BAR / 2, CHUCKER_BAR_HEIGHT / 2, CHUCKER_DEPTH / 2 + CHUCKER_BAR],
        pos: [s * (CHUCKER_WIDTH / 2 + CHUCKER_BAR / 2), CHUCKER_Y, CHUCKER_Z],
      }),
    ),
    ...sides.map(
      (s): BoxPart => ({
        name: 'chucker',
        half: [CHUCKER_WIDTH / 2, CHUCKER_BAR_HEIGHT / 2, CHUCKER_BAR / 2],
        pos: [0, CHUCKER_Y, CHUCKER_Z + s * (CHUCKER_DEPTH / 2 + CHUCKER_BAR / 2)],
      }),
    ),
    // 仕切り板より奥のふた（見えない。メダルが仕切りを越えて奥へ入らないように）。上に液晶パネルが載る
    {
      name: 'lid',
      half: [WALL_X, 0.1, (CURTAIN_FRONT_Z - CURTAIN_T - BACK_Z) / 2],
      pos: [0, curtainTop - 0.1, (CURTAIN_FRONT_Z - CURTAIN_T + BACK_Z) / 2],
    },
    // 一番奥の壁（念のため）
    {
      name: 'back',
      half: [WALL_X, curtainTop / 2, 0.2],
      pos: [0, curtainTop / 2, BACK_Z - 0.2],
    },
  ];
}

export class Machine {
  readonly world: RAPIER.World;
  readonly params: PhysicsParams;
  readonly pusher: RAPIER.RigidBody;

  /** index = InstancedMesh のインスタンス番号 */
  readonly medals: RAPIER.RigidBody[] = [];
  /** 前ステップと現ステップの姿勢（描画で補間する） */
  readonly prevPose = new Float32Array(MAX_MEDALS * POSE_STRIDE);
  readonly currPose = new Float32Array(MAX_MEDALS * POSE_STRIDE);

  pusherZPrev: number;
  pusherZCurr: number;
  /** 直近 world.step() にかかった時間（ms） */
  lastStepMs = 0;

  /** 各メダルの前ステップの速度（衝突検出用） */
  private readonly vel = new Float32Array(MAX_MEDALS * 3);
  private readonly result: StepResult = { won: 0, lost: 0, chucker: 0, impacts: 0, impactMax: 0, impactPan: 0 };
  private readonly boardColliders: RAPIER.Collider[] = [];
  private readonly pusherCollider: RAPIER.Collider;
  private pusherPhase = 0;
  private pusherRunning = true;

  constructor(params: PhysicsParams) {
    this.params = params;
    this.world = new RAPIER.World({ x: 0, y: -params.gravity, z: 0 });
    this.world.timestep = FIXED_DT;

    const ground = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    for (const part of boardParts()) {
      const desc = RAPIER.ColliderDesc.cuboid(...part.half).setTranslation(...part.pos);
      this.boardColliders.push(this.world.createCollider(desc, ground));
    }

    const z = this.pusherCenterZ(0);
    this.pusher = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, PUSHER_HEIGHT / 2, z),
    );
    this.pusherCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(FLOOR_X - PUSHER_SIDE_GAP, PUSHER_HEIGHT / 2, PUSHER_LENGTH / 2),
      this.pusher,
    );
    this.boardColliders.push(this.pusherCollider);
    this.pusherZPrev = this.pusherZCurr = z;

    this.applyParams();
  }

  get count(): number {
    return this.medals.length;
  }

  /** params の変更を物理ワールドへ反映する（調整パネルから呼ぶ） */
  applyParams(): void {
    const p = this.params;
    const tilt = (p.tiltDeg * Math.PI) / 180;
    // 筐体を手前に tilt だけ傾けるのと等価な重力（筐体ローカル空間）
    this.world.gravity = { x: 0, y: -p.gravity * Math.cos(tilt), z: p.gravity * Math.sin(tilt) };
    this.world.numSolverIterations = Math.max(1, Math.round(p.solverIterations));
    p.pusherStroke = clamp(p.pusherStroke, PUSHER_STROKE_MIN, PUSHER_STROKE_MAX);

    for (const c of this.boardColliders) {
      c.setFriction(p.boardFriction);
      c.setRestitution(p.restitution);
    }
    for (const body of this.medals) {
      this.applyMedalParams(body);
      body.wakeUp();
    }
  }

  /** プッシャーの位相（0..1。0 が最も引いた位置） */
  get pusherPhaseValue(): number {
    return this.pusherPhase;
  }

  setPusherRunning(running: boolean): void {
    this.pusherRunning = running;
  }

  /**
   * メダルを1枚生成する。上限に達していたら false。
   * @param drop プレイヤー投入（高所から落ちる）ならソフトCCDを有効にする
   */
  spawnMedal(x: number, y: number, z: number, rot?: RAPIER.Rotation, drop = false): boolean {
    if (this.medals.length >= MAX_MEDALS) return false;
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCanSleep(true);
    if (rot) desc.setRotation(rot);
    if (drop) desc.setSoftCcdPrediction(DROP_SOFT_CCD);
    const body = this.world.createRigidBody(desc);
    // 見た目の円柱（半径R・厚さT）と外形が一致するよう、丸み分だけ内側を縮める
    const collider = RAPIER.ColliderDesc.roundCylinder(
      MEDAL_THICKNESS / 2 - MEDAL_BORDER,
      MEDAL_RADIUS - MEDAL_BORDER,
      MEDAL_BORDER,
    );
    this.world.createCollider(collider, body);
    this.applyMedalParams(body);

    const i = this.medals.length;
    this.medals.push(body);
    this.readPose(i, this.currPose);
    this.prevPose.set(this.currPose.subarray(i * POSE_STRIDE, (i + 1) * POSE_STRIDE), i * POSE_STRIDE);
    this.vel.fill(0, i * 3, i * 3 + 3);
    return true;
  }

  /** 1ステップ進める。盤外へ出たメダルは判定して必ず削除する。入賞口の通過もここで判定する。 */
  step(): StepResult {
    const p = this.params;
    if (this.pusherRunning) this.pusherPhase = (this.pusherPhase + p.pusherSpeed * FIXED_DT) % 1;
    this.pusherZPrev = this.pusherZCurr;
    this.pusherZCurr = this.pusherCenterZ(this.pusherPhase);
    this.pusher.setNextKinematicTranslation({ x: 0, y: PUSHER_HEIGHT / 2, z: this.pusherZCurr });

    const t0 = performance.now();
    this.world.step();
    this.lastStepMs = performance.now() - t0;

    // 前回姿勢を退避してから現在姿勢を読む
    const n = this.medals.length;
    this.prevPose.set(this.currPose.subarray(0, n * POSE_STRIDE));

    const result = this.result;
    result.won = result.lost = result.chucker = result.impacts = 0;
    result.impactMax = 0;
    let panSum = 0;
    const inv = 1 / FIXED_DT;
    const vel = this.vel;
    for (let i = n - 1; i >= 0; i--) {
      const body = this.medals[i];
      const o = i * POSE_STRIDE;
      const vo = i * 3;
      if (!body.isSleeping()) {
        this.readPose(i, this.currPose);
        // 姿勢の差から速度を出し、前ステップからの速度変化が大きければ「衝突」とみなす（効果音用）。
        // 物理エンジンの接触イベントを使うより安く、押されて動くだけの穏やかな変化は拾わない。
        const vx = (this.currPose[o] - this.prevPose[o]) * inv;
        const vy = (this.currPose[o + 1] - this.prevPose[o + 1]) * inv;
        const vz = (this.currPose[o + 2] - this.prevPose[o + 2]) * inv;
        const dvx = vx - vel[vo];
        const dvy = vy - vel[vo + 1];
        const dvz = vz - vel[vo + 2];
        const dv = Math.sqrt(dvx * dvx + dvy * dvy + dvz * dvz);
        if (dv > IMPACT_DV) {
          result.impacts++;
          if (dv > result.impactMax) result.impactMax = dv;
          panSum += this.currPose[o];
        }
        vel[vo] = vx;
        vel[vo + 1] = vy;
        vel[vo + 2] = vz;
      } else {
        vel[vo] = vel[vo + 1] = vel[vo + 2] = 0;
      }
      const x = this.currPose[o];
      const y = this.currPose[o + 1];
      const z = this.currPose[o + 2];
      const outOfBounds =
        !Number.isFinite(x + y + z) ||
        Math.abs(x) > BOUNDS.x ||
        y > BOUNDS.yMax ||
        z < BOUNDS.zMin ||
        z > BOUNDS.zMax;
      if (y < KILL_Y || outOfBounds) {
        // 手前端（z > FRONT_Z）から落ちたものだけが獲得。溝（z < FRONT_Z で |x| > FLOOR_X）・異常値は没収。
        // 手前端を越えて落ちるメダルは傾いた時点で中心が端より前に出ているので z で区別できる。
        const won = !outOfBounds && z > FRONT_Z - 0.1 && Math.abs(x) < FLOOR_X + MEDAL_RADIUS;
        if (won) result.won++;
        else result.lost++;
        this.removeAt(i);
      } else if (z < CURTAIN_FRONT_Z - 0.15 && y > PUSHER_HEIGHT - 0.2) {
        // 仕切り板より奥には本来行けない。万一回り込んだメダルは没収扱いで削除
        result.lost++;
        this.removeAt(i);
      } else if (
        y < CHUCKER_Y &&
        this.prevPose[o + 1] >= CHUCKER_Y &&
        Math.abs(x) < CHUCKER_WIDTH / 2 &&
        Math.abs(z - CHUCKER_Z) < CHUCKER_DEPTH / 2
      ) {
        // 入賞口の穴を上から下へ通り抜けた。メダルは消さずにそのまま落とす
        result.chucker++;
      }
    }
    result.impactPan = result.impacts > 0 ? clamp(panSum / result.impacts / WALL_X, -1, 1) : 0;
    return result;
  }

  /** 盤上のメダルを全て消す */
  clearMedals(): void {
    for (const body of this.medals) this.world.removeRigidBody(body);
    this.medals.length = 0;
  }

  /**
   * 開始時の敷き詰め。六方格子で床とプッシャー上に並べ、少し回して馴染ませる。
   * 位置は乱数で少し揺らす（毎回まったく同じ山にならないように）。
   */
  fillInitial(total: number, settleSteps = 90): void {
    const d = MEDAL_RADIUS * 2 + 0.03;
    const rowZ = d * 0.866;
    const T = MEDAL_THICKNESS;
    const jitter = () => (Math.random() - 0.5) * 0.04;
    let placed = 0;

    const fillRect = (y: number, z0: number, z1: number, xHalf: () => number, shift: number) => {
      let row = 0;
      for (let z = z1; z >= z0 && placed < total; z -= rowZ, row++) {
        const half = xHalf();
        const off = ((row + shift) % 2) * (d / 2);
        for (let x = -half + off; x <= half && placed < total; x += d) {
          this.spawnMedal(x + jitter(), y, z + jitter());
          placed++;
        }
      }
    };

    const margin = MEDAL_RADIUS + 0.06;
    const floorHalf = () => FLOOR_X - margin;
    const floorZ0 = PUSHER_FRONT_RETRACTED + margin;
    const floorZ1 = FRONT_Z - 1.4; // 手前端ぎりぎりには置かない
    const pusherZ0 = CURTAIN_FRONT_Z + margin;
    const pusherZ1 = PUSHER_FRONT_RETRACTED - margin;

    // 1段目：床、2段目：プッシャー上、3段目以降：床に積む
    fillRect(T / 2 + 0.005, floorZ0, floorZ1, floorHalf, 0);
    fillRect(PUSHER_HEIGHT + T / 2 + 0.005, pusherZ0, pusherZ1, floorHalf, 0);
    for (let layer = 1; placed < total && layer < 6; layer++) {
      fillRect(T / 2 + 0.005 + layer * (T + 0.01), floorZ0, floorZ1 - layer * 0.6, floorHalf, layer);
    }

    // プッシャーを止めたまま少し回して落ち着かせる
    const running = this.pusherRunning;
    this.pusherRunning = false;
    for (let s = 0; s < settleSteps; s++) this.step();
    this.pusherRunning = running;
  }

  private pusherCenterZ(phase: number): number {
    const stroke = this.params.pusherStroke;
    const front = PUSHER_FRONT_RETRACTED + stroke * 0.5 * (1 - Math.cos(phase * Math.PI * 2));
    return front - PUSHER_LENGTH / 2;
  }

  private applyMedalParams(body: RAPIER.RigidBody): void {
    const p = this.params;
    body.setLinearDamping(p.linearDamping);
    body.setAngularDamping(p.angularDamping);
    const c = body.collider(0);
    c.setFriction(p.medalFriction);
    c.setRestitution(p.restitution);
    c.setMass(p.medalMass);
  }

  private readPose(i: number, out: Float32Array): void {
    const body = this.medals[i];
    const t = body.translation();
    const r = body.rotation();
    const o = i * POSE_STRIDE;
    out[o] = t.x;
    out[o + 1] = t.y;
    out[o + 2] = t.z;
    out[o + 3] = r.x;
    out[o + 4] = r.y;
    out[o + 5] = r.z;
    out[o + 6] = r.w;
  }

  /** swap-remove。末尾のメダルを i に移して配列を詰める */
  private removeAt(i: number): void {
    const last = this.medals.length - 1;
    this.world.removeRigidBody(this.medals[i]);
    if (i !== last) {
      this.medals[i] = this.medals[last];
      const src = last * POSE_STRIDE;
      const dst = i * POSE_STRIDE;
      this.currPose.copyWithin(dst, src, src + POSE_STRIDE);
      this.prevPose.copyWithin(dst, src, src + POSE_STRIDE);
      this.vel.copyWithin(i * 3, last * 3, last * 3 + 3);
    }
    this.medals.pop();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
