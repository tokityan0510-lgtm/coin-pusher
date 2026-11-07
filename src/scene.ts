import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  DROP_X_MAX,
  DROP_Y,
  DROP_Z,
  FLOOR_X,
  FRONT_Z,
  GUTTER_START_Z,
  MAX_MEDALS,
  MEDAL_RADIUS,
  MEDAL_THICKNESS,
  PUSHER_HEIGHT,
  PUSHER_LENGTH,
  PUSHER_SIDE_GAP,
  WALL_THICKNESS,
  WALL_X,
} from './config';
import { boardParts, POSE_STRIDE, type Machine } from './physics';

/** 筐体を手前から見下ろすカメラの仰角（度） */
const CAMERA_ELEVATION_DEG = 60;
/** 注視点（筐体ローカル空間） */
const LOOK_AT = new THREE.Vector3(0, 0.6, -3.6);
/** 画面に収めたい横幅（壁の外側＋少し余白） */
const FIT_WIDTH = (WALL_X + WALL_THICKNESS) * 2;

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  /** 筐体ローカル空間。傾き（tilt）はこのグループの回転で見せる */
  readonly cabinet = new THREE.Group();

  private readonly medalMesh: THREE.InstancedMesh;
  private readonly pusherMesh: THREE.Mesh;
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpQuatB = new THREE.Quaternion();
  private readonly tmpScale = new THREE.Vector3(1, 1, 1);
  private readonly tmpMat = new THREE.Matrix4();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;

    this.scene.background = new THREE.Color(0x0b0f1a);
    // 金属メダルの映り込み用。RoomEnvironment は手続き生成なので外部ファイル不要
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.scene.add(new THREE.HemisphereLight(0xdde6ff, 0x202030, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 12, 8);
    this.scene.add(key);

    this.scene.add(this.cabinet);
    this.buildBoard();

    // プッシャー
    const pusherMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.8, roughness: 0.3 });
    this.pusherMesh = new THREE.Mesh(
      new THREE.BoxGeometry((FLOOR_X - PUSHER_SIDE_GAP) * 2, PUSHER_HEIGHT, PUSHER_LENGTH),
      pusherMat,
    );
    this.cabinet.add(this.pusherMesh);

    // メダル（InstancedMesh 1つで全枚数を描く）
    const medalGeo = new THREE.CylinderGeometry(MEDAL_RADIUS, MEDAL_RADIUS, MEDAL_THICKNESS, 32, 1);
    const medalMat = new THREE.MeshStandardMaterial({ color: 0xd8b04a, metalness: 0.9, roughness: 0.32 });
    this.medalMesh = new THREE.InstancedMesh(medalGeo, medalMat, MAX_MEDALS);
    this.medalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.medalMesh.count = 0;
    // 全メダルが常に盤面付近にあるので、インスタンス単位の視錐台カリングは不要
    this.medalMesh.frustumCulled = false;
    this.cabinet.add(this.medalMesh);

    this.resize();
  }

  setTilt(deg: number): void {
    this.cabinet.rotation.x = (deg * Math.PI) / 180;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 縦長画面でも筐体の横幅が収まる距離にカメラを引く
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const dist = Math.max(FIT_WIDTH / 2 / Math.tan(hFov / 2), 14);
    const el = (CAMERA_ELEVATION_DEG * Math.PI) / 180;
    this.camera.position.set(0, LOOK_AT.y + Math.sin(el) * dist, LOOK_AT.z + Math.cos(el) * dist);
    this.camera.lookAt(LOOK_AT);
    this.camera.updateProjectionMatrix();
  }

  /**
   * 画面上の x 座標（CSSピクセル）を投入位置の x（筐体ローカル）に変換する。
   * 投入口の左右端を画面に投影し、その間を線形補間するので「指の真下に落ちる」。
   */
  screenXToDropX(clientX: number): number {
    const w = window.innerWidth;
    const left = this.projectToScreenX(-DROP_X_MAX);
    const right = this.projectToScreenX(DROP_X_MAX);
    // 投入口が画面より狭く見える場合は画面幅いっぱいに割り当てる（端までタップしやすく）
    const l = Math.max(0, Math.min(left, w * 0.08));
    const r = Math.min(w, Math.max(right, w * 0.92));
    const t = (clientX - l) / (r - l);
    return THREE.MathUtils.clamp(-DROP_X_MAX + t * DROP_X_MAX * 2, -DROP_X_MAX, DROP_X_MAX);
  }

  render(machine: Machine, alpha: number): void {
    // プッシャー（前ステップと現ステップの間を補間）
    const pz = machine.pusherZPrev + (machine.pusherZCurr - machine.pusherZPrev) * alpha;
    this.pusherMesh.position.set(0, PUSHER_HEIGHT / 2, pz);

    // メダル
    const n = machine.count;
    const prev = machine.prevPose;
    const curr = machine.currPose;
    const pos = this.tmpPos;
    const q = this.tmpQuat;
    const qb = this.tmpQuatB;
    for (let i = 0; i < n; i++) {
      const o = i * POSE_STRIDE;
      pos.set(
        prev[o] + (curr[o] - prev[o]) * alpha,
        prev[o + 1] + (curr[o + 1] - prev[o + 1]) * alpha,
        prev[o + 2] + (curr[o + 2] - prev[o + 2]) * alpha,
      );
      q.set(prev[o + 3], prev[o + 4], prev[o + 5], prev[o + 6]);
      qb.set(curr[o + 3], curr[o + 4], curr[o + 5], curr[o + 6]);
      q.slerp(qb, alpha);
      this.tmpMat.compose(pos, q, this.tmpScale);
      this.medalMesh.setMatrixAt(i, this.tmpMat);
    }
    this.medalMesh.count = n;
    this.medalMesh.instanceMatrix.needsUpdate = true;

    this.renderer.render(this.scene, this.camera);
  }

  private projectToScreenX(x: number): number {
    const v = new THREE.Vector3(x, DROP_Y, DROP_Z);
    this.cabinet.updateMatrixWorld();
    v.applyMatrix4(this.cabinet.matrixWorld).project(this.camera);
    return (v.x * 0.5 + 0.5) * window.innerWidth;
  }

  private buildBoard(): void {
    const mats = {
      floor: new THREE.MeshStandardMaterial({ color: 0x1d3a6b, metalness: 0.1, roughness: 0.55 }),
      wall: new THREE.MeshStandardMaterial({
        color: 0x9fc4ff,
        metalness: 0.0,
        roughness: 0.1,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
      side: new THREE.MeshStandardMaterial({ color: 0x232838, metalness: 0.3, roughness: 0.6 }),
      curtain: new THREE.MeshStandardMaterial({ color: 0x2b2f3a, metalness: 0.4, roughness: 0.5 }),
      back: new THREE.MeshStandardMaterial({ color: 0x14171f, metalness: 0.2, roughness: 0.7 }),
    };
    for (const part of boardParts()) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(part.half[0] * 2, part.half[1] * 2, part.half[2] * 2),
        mats[part.name],
      );
      mesh.position.set(...part.pos);
      if (part.name === 'wall') mesh.renderOrder = 2;
      this.cabinet.add(mesh);
    }

    // 左右の溝（見た目だけ。没収エリアなので暗い赤）
    const gutterMat = new THREE.MeshBasicMaterial({ color: 0x3a0a12 });
    const gutterW = WALL_X - FLOOR_X;
    const gutterLen = FRONT_Z - GUTTER_START_Z;
    for (const s of [-1, 1]) {
      const g = new THREE.Mesh(new THREE.BoxGeometry(gutterW, 0.05, gutterLen), gutterMat);
      g.position.set(s * (FLOOR_X + gutterW / 2), -0.9, GUTTER_START_Z + gutterLen / 2);
      this.cabinet.add(g);
    }

    // 手前の獲得口（見た目だけ）
    const trayMat = new THREE.MeshStandardMaterial({ color: 0x0f5132, metalness: 0.2, roughness: 0.6 });
    const tray = new THREE.Mesh(new THREE.BoxGeometry(FLOOR_X * 2, 0.05, 1.6), trayMat);
    tray.position.set(0, -1.2, FRONT_Z + 0.9);
    this.cabinet.add(tray);

    // 手前端のライン
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(FLOOR_X * 2, 0.02, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xffd36b }),
    );
    edge.position.set(0, 0.011, FRONT_Z - 0.03);
    this.cabinet.add(edge);
  }
}
