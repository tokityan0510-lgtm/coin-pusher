// ゲーム全体の定数と、調整パネルで変えられるパラメータの既定値。
//
// 単位系: 1ユニット ≒ メダル直径。理由は CLAUDE.md「物理スケール」を参照。
// 座標系（筐体ローカル空間）:
//   x = 左右（右が +）
//   y = 上
//   z = 奥→手前（手前が +）。盤面の手前端が z = FRONT_Z。
// 盤面の傾きはジオメトリを傾けず「重力ベクトルを傾ける＋描画用グループを回す」ことで表現する。

/** 調整パネルで変更できる値。?debug=1 の「JSONコピー」はこの形で出力される。 */
export interface PhysicsParams {
  /** メダルの摩擦係数 */
  medalFriction: number;
  /** 盤面・壁・プッシャーの摩擦係数 */
  boardFriction: number;
  /** 反発係数（メダル） */
  restitution: number;
  /** メダル1枚の質量 */
  medalMass: number;
  /** メダルの直線減衰 */
  linearDamping: number;
  /** メダルの回転減衰 */
  angularDamping: number;
  /** 盤面の傾き（度）。奥が高く手前が低い */
  tiltDeg: number;
  /** 重力加速度（ユニット/秒²） */
  gravity: number;
  /** ソルバー反復回数 */
  solverIterations: number;
  /** プッシャー往復速度（往復/秒） */
  pusherSpeed: number;
  /** プッシャーのストローク（ユニット） */
  pusherStroke: number;
}

export const DEFAULT_PARAMS: PhysicsParams = {
  medalFriction: 0.3,
  boardFriction: 0.25,
  restitution: 0.05,
  medalMass: 1.0,
  linearDamping: 0.1,
  angularDamping: 0.4,
  tiltDeg: 4,
  gravity: 30,
  solverIterations: 4,
  pusherSpeed: 0.3,
  pusherStroke: 2.5,
};

/** 物理の固定タイムステップ */
export const FIXED_DT = 1 / 60;
/** 1フレームで回す最大ステップ数（これを超えた分は捨ててスロー再生にする） */
export const MAX_STEPS_PER_FRAME = 2;

// ---- メダル ----
export const MEDAL_RADIUS = 0.5;
export const MEDAL_THICKNESS = 0.2;
/** roundCylinder の角の丸み。見た目の円柱と同じ外形になるよう内側を縮めて使う */
export const MEDAL_BORDER = 0.03;
/** InstancedMesh の確保数＝同時に存在できるメダルの上限 */
export const MAX_MEDALS = 800;
/** 開始時に敷き詰める枚数 */
export const INITIAL_MEDALS = 200;
/** 投入メダルのソフトCCD予測距離（高所から落ちたときのすり抜け防止） */
export const DROP_SOFT_CCD = 0.4;

// ---- 盤面 ----
// 上から見た配置（x は左右対称）:
//
//   z=BACK_Z  ┌─┬───────────┬─┐
//             │■│ プッシャー │■│  ■ = サイドブロック（プッシャー域の横を塞ぐ）
//             │■│  可動域    │■│
//  GUTTER_    ├─┼───────────┼─┤
//  START_Z    │溝│   床       │溝│  溝 = 没収（左右の溝）
//             │  │            │  │
//  z=FRONT_Z  └─┴───────────┴─┘  手前端から落ちたら獲得
//            WALL_X  FLOOR_X
//
/** 床（＝プッシャー）の半幅 */
export const FLOOR_X = 3.6;
/** 左右の溝の幅。メダル直径より広くないと落ちない */
export const GUTTER_WIDTH = 1.2;
/** 外壁の内側 x */
export const WALL_X = FLOOR_X + GUTTER_WIDTH;
export const WALL_THICKNESS = 0.4;
export const WALL_HEIGHT = 4.5;
/** 盤面手前端 */
export const FRONT_Z = 3.0;
/** 筐体の一番奥 */
export const BACK_Z = -13.0;
/** これより手前で左右の溝が始まる（＝既定ストローク時のプッシャー最前位置） */
export const GUTTER_START_Z = -2.5;

// ---- プッシャー ----
export const PUSHER_HEIGHT = 1.4;
export const PUSHER_LENGTH = 7.0;
/** 最も引いたときのプッシャー前面 z */
export const PUSHER_FRONT_RETRACTED = -5.0;
/** プッシャーと左右壁のすき間 */
export const PUSHER_SIDE_GAP = 0.02;
export const PUSHER_STROKE_MIN = 0.5;
export const PUSHER_STROKE_MAX = 3.5;

// ---- 奥の仕切り板（プッシャー上のメダルを掻き落とす壁） ----
/** 仕切り板の前面 z */
export const CURTAIN_FRONT_Z = -8.0;
/** プッシャー上面と仕切り板下端のすき間（メダル厚より小さくして潜り込みを防ぐ） */
export const CURTAIN_GAP = 0.12;

// ---- 投入 ----
export const DROP_Y = PUSHER_HEIGHT + 2.2;
export const DROP_Z = -6.6;
export const DROP_X_MAX = FLOOR_X - MEDAL_RADIUS - 0.1;
/** 連打の最短間隔（秒） */
export const DROP_COOLDOWN = 0.08;

// ---- 盤外判定 ----
/** メダル中心がこの高さを下回ったら盤外として判定・削除 */
export const KILL_Y = -0.6;
/** 万一の暴走対策。この範囲外に出たメダルは没収扱いで削除 */
export const BOUNDS = { x: 12, yMax: 40, zMin: -30, zMax: 30 };

// ---- 所持メダル ----
export const STORAGE_KEY = 'coinPusher.credits.v1';
export const INITIAL_CREDITS = 100;
/** 所持0枚のときの補充ボタンで増える枚数（フェーズ1の検証用） */
export const REFILL_CREDITS = 50;
