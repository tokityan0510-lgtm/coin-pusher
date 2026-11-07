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
/**
 * 左右の溝（壁ぎわのすき間）の幅。実機と同じく細いすき間にする。
 * メダル（直径1・厚さ0.2）は縁から傾いて縦になって落ちるが、ボール（直径1.4）は通れない。
 */
export const GUTTER_WIDTH = 0.8;
/** 溝の上にかぶせる手すり状のカバーの高さ（下端）。メダル3枚重ねまでは下をくぐって溝に落ちる */
export const GUTTER_LIP_Y = 0.6;
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

// ---- 入賞口（チャッカー） ----
// 投入したメダルが落ちる途中、中央に固定された枠。枠の穴を通り抜けたら入賞（スロットの保留+1）。
// 実機のチャッカーと同じく、通り抜けたメダルはそのままプッシャーの上に落ちる（盤面からは減らない）。
// 穴はメダル直径よりわずかに広いだけなので、中央を狙わないと枠に当たってはじかれる。
/** 穴の幅（x） */
export const CHUCKER_WIDTH = 1.1;
/** 穴の奥行き（z） */
export const CHUCKER_DEPTH = 1.2;
/** 枠の中心の高さ。メダル中心がこの高さを上から下へ、穴の中で通過したら入賞 */
export const CHUCKER_Y = PUSHER_HEIGHT + 1.6;
/** 枠の太さ・高さ */
export const CHUCKER_BAR = 0.16;
export const CHUCKER_BAR_HEIGHT = 0.2;

// ---- 投入 ----
export const DROP_Y = CHUCKER_Y + 1.0;
export const DROP_Z = -6.6;
/** 入賞口は投入位置の真下（中央） */
export const CHUCKER_Z = DROP_Z;
export const DROP_X_MAX = FLOOR_X - MEDAL_RADIUS - 0.1;
/**
 * 投入位置の左右のばらつき（±ユニット）。実機のシューターのように毎回少しずれる。
 * 入賞口は「メダル中心が穴の上にあれば入る」ので、ばらつきが無いと中央を狙えば必ず入ってしまう。
 * 0.8 で中央狙い約 80%、適当に落とすと約 20% が入賞（シミュレーション）。
 */
export const DROP_SCATTER = 0.8;
/** 連打の最短間隔（秒） */
export const DROP_COOLDOWN = 0.08;
/** オート投入の間隔（秒）。実機のシューターの連射くらい */
export const AUTO_FIRE_INTERVAL = 0.45;

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

// ---- スロット ----
/** 保留の最大数（入賞口に入っても、これ以上は貯まらない） */
export const SLOT_MAX_STOCK = 4;
/** スロットの図柄。リール帯はこの並びの繰り返し */
export type SlotSymbol = '7' | 'BAR' | 'STAR' | 'BELL' | 'CHERRY';
export const REEL_STRIP: SlotSymbol[] = [
  '7', 'CHERRY', 'BELL', 'BAR', 'CHERRY', 'STAR', 'BELL', 'CHERRY', 'BAR', 'BELL', 'CHERRY', 'STAR',
];
/**
 * 1回転ごとの抽選表（上から順に判定。確率の合計が 1 未満の残りはハズレ）。
 * payout は払い出し枚数。STAR がそろうとサイコロボールが盤面に出る（すごろくを進める）。
 */
export const SLOT_TABLE: { symbol: SlotSymbol; prob: number; payout: number }[] = [
  { symbol: '7', prob: 1 / 150, payout: 20 },
  { symbol: 'BAR', prob: 1 / 80, payout: 8 },
  { symbol: 'STAR', prob: 1 / 10, payout: 0 },
  { symbol: 'BELL', prob: 1 / 25, payout: 3 },
  { symbol: 'CHERRY', prob: 1 / 15, payout: 2 },
];
/** ハズレのうちリーチ（左2つがそろう）を見せる割合 */
export const SLOT_FAKE_REACH_RATE = 0.2;

// ---- ジャックポット ----
/** ジャックポットの初期枚数（当たったらここに戻る） */
export const JACKPOT_BASE = 100;
/** 入賞1回ごとにジャックポットに積み増す枚数（小数で貯めて、表示は切り捨て） */
export const JACKPOT_ADD_PER_CHUCKER = 0.2;
/** ジャックポットチャンスのルーレット。'JP' に止まるとジャックポット */
export const JP_ROULETTE: (number | 'JP')[] = ['JP', 5, 10, 5, 20, 5, 10, 30];
/** ルーレットで 'JP' に止まる確率 */
export const JP_WIN_PROB = 1 / 8;
export const JACKPOT_STORAGE_KEY = 'coinPusher.jackpot.v1';

// ---- 払い出し（当たりのメダルを盤面に降らせる） ----
/** 通常の払い出し速度（枚/秒）。プッシャーの上に降る */
export const PAYOUT_RATE = 8;
/** ジャックポットの払い出し速度（枚/秒）。盤面全体に降る */
export const JACKPOT_PAYOUT_RATE = 14;
/** 盤上のメダルがこの枚数以上のときは払い出しを待つ（処理落ち防止） */
export const PAYOUT_MAX_ACTIVE = 400;

// ---- 音 ----
export const MUTE_STORAGE_KEY = 'coinPusher.mute.v1';

// ---- サイコロボール ----
// スロットで ★ がそろうとボールが盤面に出てくる。手前から落とせたらサイコロを振ってすごろくが進む。溝に落ちたら何もなし。
/** ボールの半径（メダルより大きく、メダルの山に乗って押される） */
export const BALL_RADIUS = 0.7;
/** ボールの質量（メダル1枚 = medalMass）。重いほどメダルを押しのけて進む */
export const BALL_MASS = 4;
export const BALL_FRICTION = 0.4;
/**
 * 回転減衰。Rapier には転がり抵抗が無いので、これが無いと傾いた盤面をすぐ転がり落ちてしまう。
 * 強めにして「メダルに押されてじわじわ進む」ようにする。
 */
export const BALL_ANGULAR_DAMPING = 4;
export const BALL_LINEAR_DAMPING = 0.6;
/** 盤面に同時に出せるボールの数。超えるときはその場でサイコロを振る */
export const MAX_BALLS = 3;

// ---- すごろく（宇宙旅行） ----
// サイコロボールを落とすとサイコロを振り、ロケットが液晶のすごろくを進む。
// 止まったマスで メダル獲得 / 基地獲得 / カード獲得。目的地に着くと、持っている基地の配当＋ジャックポットチャンス。
export type SquareType = 'medal' | 'base' | 'card';
export interface Square {
  type: SquareType;
  /** 表示名（星・基地の名前） */
  name: string;
  /** medal: 獲得枚数 / base: 目的地に着くたびの配当 */
  value: number;
}
/** すごろくのマス（一周 24 マス。液晶の外周に並べる） */
export const BOARD: Square[] = [
  { type: 'medal', name: '発射場', value: 5 },
  { type: 'base', name: '月面ドーム', value: 4 },
  { type: 'medal', name: 'シリウス', value: 8 },
  { type: 'card', name: '流れ星', value: 0 },
  { type: 'base', name: '火星コロニー', value: 6 },
  { type: 'medal', name: 'ベガ', value: 5 },
  { type: 'medal', name: 'アルタイル', value: 12 },
  { type: 'base', name: '小惑星鉱山', value: 8 },
  { type: 'card', name: '流れ星', value: 0 },
  { type: 'medal', name: 'デネブ', value: 5 },
  { type: 'base', name: '氷の衛星ラボ', value: 5 },
  { type: 'medal', name: 'リゲル', value: 15 },
  { type: 'medal', name: 'スピカ', value: 5 },
  { type: 'base', name: '木星ガス工場', value: 10 },
  { type: 'card', name: '流れ星', value: 0 },
  { type: 'medal', name: 'カペラ', value: 8 },
  { type: 'base', name: '土星リング港', value: 12 },
  { type: 'medal', name: 'アンタレス', value: 5 },
  { type: 'medal', name: 'ポラリス', value: 20 },
  { type: 'base', name: '彗星ステーション', value: 7 },
  { type: 'card', name: '流れ星', value: 0 },
  { type: 'medal', name: 'プロキオン', value: 5 },
  { type: 'base', name: '星雲ホテル', value: 15 },
  { type: 'medal', name: 'すばる', value: 10 },
];
/** 次の目的地は、今の位置からこのマス数以上先から選ぶ */
export const DEST_MIN_DISTANCE = 7;
export const DEST_MAX_DISTANCE = 16;
/** 目的地に着いたときのボーナス（基地の配当とは別） */
export const GOAL_BONUS = 10;

/** カード（最大 MAX_CARDS 枚まで持てる。HUD のボタンで使う） */
export type CardType = 'turbo' | 'shower' | 'ball' | 'warp';
export const CARD_INFO: Record<CardType, { name: string; desc: string; weight: number }> = {
  turbo: { name: 'ターボ', desc: '次のサイコロを2個振る', weight: 4 },
  shower: { name: '流星群', desc: 'メダル20枚が降ってくる', weight: 4 },
  ball: { name: '召喚', desc: 'サイコロボールを出す', weight: 3 },
  warp: { name: 'ワープ', desc: '目的地まで一気に移動', weight: 1 },
};
export const MAX_CARDS = 3;
export const SHOWER_CARD_MEDALS = 20;
export const SUGOROKU_STORAGE_KEY = 'coinPusher.sugoroku.v1';
