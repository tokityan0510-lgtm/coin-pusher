import GUI from 'lil-gui';
import { DEFAULT_PARAMS, PUSHER_STROKE_MAX, PUSHER_STROKE_MIN, type CardType, type PhysicsParams } from './config';

export interface DebugStats {
  fps: number;
  medals: number;
  awake: number;
  stepMs: number;
  /** このセッションの獲得・没収・入賞の枚数 */
  won: number;
  lost: number;
  chucker: number;
}

export interface DebugHooks {
  params: PhysicsParams;
  stats: DebugStats;
  /** 物理パラメータが変わったとき */
  onParamsChange: () => void;
  /** 盤面を初期状態に並べ直す */
  onResetBoard: () => void;
  /** 所持メダルを増やす */
  onAddCredits: (n: number) => void;
  /** 負荷テスト用にメダルを盤面へ降らせる */
  onStress: (n: number) => void;
  /** プッシャーの停止・再開 */
  onPusherToggle: (running: boolean) => void;
  /** スロットの確認用 */
  onSlotStock: () => void;
  onSlotForce: (symbol: '7' | 'STAR') => void;
  /** サイコロボールを出す */
  onSpawnBall: () => void;
  /** すごろく：サイコロを振る / カードをもらう / 最初から */
  onRoll: () => void;
  onCard: (card: CardType) => void;
  onBoardReset: () => void;
  /** 影の有無 */
  onShadows: (on: boolean) => void;
}

/** ?debug=1 のときだけ表示する調整パネル */
export function createDebugPanel(hooks: DebugHooks): GUI {
  const { params, stats } = hooks;
  const gui = new GUI({ title: '調整パネル' });
  gui.domElement.style.setProperty('--width', '260px');
  // スマホ縦画面では盤面が隠れるので最初は畳んでおく
  if (window.innerWidth < 700) gui.close();
  const changed = () => hooks.onParamsChange();

  const info = gui.addFolder('情報');
  info.add(stats, 'fps').name('FPS').listen().disable().decimals(0);
  info.add(stats, 'medals').name('メダル枚数').listen().disable();
  info.add(stats, 'awake').name('動いている枚数').listen().disable();
  info.add(stats, 'stepMs').name('物理ms/step').listen().disable().decimals(2);
  info.add(stats, 'won').name('獲得').listen().disable();
  info.add(stats, 'lost').name('没収').listen().disable();
  info.add(stats, 'chucker').name('入賞').listen().disable();

  const medal = gui.addFolder('メダル');
  medal.add(params, 'medalFriction', 0, 1.5, 0.01).name('摩擦').onChange(changed);
  medal.add(params, 'restitution', 0, 0.8, 0.01).name('反発').onChange(changed);
  medal.add(params, 'medalMass', 0.1, 10, 0.1).name('重さ').onChange(changed);
  medal.add(params, 'linearDamping', 0, 2, 0.01).name('直線減衰').onChange(changed);
  medal.add(params, 'angularDamping', 0, 3, 0.01).name('回転減衰').onChange(changed);

  const board = gui.addFolder('盤面・ワールド');
  board.add(params, 'boardFriction', 0, 1.5, 0.01).name('盤面の摩擦').onChange(changed);
  board.add(params, 'tiltDeg', 0, 15, 0.1).name('傾き(度)').onChange(changed);
  board.add(params, 'gravity', 5, 120, 0.5).name('重力').onChange(changed);
  board.add(params, 'solverIterations', 1, 16, 1).name('ソルバー反復').onChange(changed);

  const pusher = gui.addFolder('プッシャー');
  pusher.add(params, 'pusherSpeed', 0.05, 1.5, 0.01).name('速度(往復/秒)').onChange(changed);
  pusher
    .add(params, 'pusherStroke', PUSHER_STROKE_MIN, PUSHER_STROKE_MAX, 0.05)
    .name('ストローク')
    .onChange(changed);
  const pusherState = { running: true };
  pusher
    .add(pusherState, 'running')
    .name('動かす')
    .onChange((v: boolean) => hooks.onPusherToggle(v));

  const slot = gui.addFolder('スロット・すごろく確認');
  const slotActions = {
    stock: () => hooks.onSlotStock(),
    seven: () => hooks.onSlotForce('7'),
    chance: () => hooks.onSlotForce('STAR'),
    ball: () => hooks.onSpawnBall(),
    roll: () => hooks.onRoll(),
    warp: () => hooks.onCard('warp'),
    turbo: () => hooks.onCard('turbo'),
    reset: () => hooks.onBoardReset(),
  };
  slot.add(slotActions, 'stock').name('保留 +1');
  slot.add(slotActions, 'seven').name('次を 7 揃いにする');
  slot.add(slotActions, 'chance').name('次を ★（サイコロボール）にする');
  slot.add(slotActions, 'ball').name('サイコロボールを出す');
  slot.add(slotActions, 'roll').name('すごろく：サイコロを振る');
  slot.add(slotActions, 'warp').name('すごろく：ワープカード');
  slot.add(slotActions, 'turbo').name('すごろく：ターボカード');
  slot.add(slotActions, 'reset').name('すごろくを最初から');
  slot.close();

  const view = gui.addFolder('表示');
  const viewState = { shadows: true };
  view
    .add(viewState, 'shadows')
    .name('影')
    .onChange((v: boolean) => hooks.onShadows(v));
  view.close();

  const actions = {
    copyJson: () => copyJson(params, copyCtrl),
    resetParams: () => {
      Object.assign(params, DEFAULT_PARAMS);
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      changed();
    },
    resetBoard: () => hooks.onResetBoard(),
    add100: () => hooks.onAddCredits(100),
    stress: () => hooks.onStress(100),
  };
  const copyCtrl = gui.add(actions, 'copyJson').name('値をJSONでコピー');
  gui.add(actions, 'resetParams').name('既定値に戻す');
  gui.add(actions, 'resetBoard').name('盤面を並べ直す');
  gui.add(actions, 'add100').name('所持メダル +100');
  gui.add(actions, 'stress').name('負荷テスト：盤面に+100枚');

  return gui;
}

async function copyJson(params: PhysicsParams, ctrl: { name(n: string): unknown }): Promise<void> {
  const rounded = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, Math.round((v as number) * 1000) / 1000]),
  );
  const json = JSON.stringify(rounded, null, 2);
  let ok = false;
  // Clipboard API は https / localhost でしか使えないので、LAN の http 確認時はフォールバック
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(json);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) ok = legacyCopy(json);
  if (!ok) window.prompt('コピーしてください', json);
  console.info('[debug] params JSON\n' + json);
  ctrl.name(ok ? 'コピーしました ✓' : '値をJSONでコピー');
  window.setTimeout(() => ctrl.name('値をJSONでコピー'), 1500);
}

function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}
