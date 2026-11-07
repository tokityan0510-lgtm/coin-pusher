import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  BACK_Z,
  BALL_RADIUS,
  MAX_BALLS,
  CURTAIN_FRONT_Z,
  DROP_X_MAX,
  DROP_Y,
  DROP_Z,
  FLOOR_X,
  FRONT_Z,
  GUTTER_START_Z,
  MAX_MEDALS,
  MEDAL_RADIUS,
  MEDAL_THICKNESS,
  CHUCKER_BAR,
  CHUCKER_DEPTH,
  CHUCKER_WIDTH,
  CHUCKER_Y,
  CHUCKER_Z,
  PUSHER_HEIGHT,
  PUSHER_LENGTH,
  PUSHER_SIDE_GAP,
  WALL_HEIGHT,
  WALL_THICKNESS,
  WALL_X,
} from './config';
import { LCD_PX_H, LCD_PX_W, type Lcd } from './lcd';
import { boardParts, CURTAIN_TOP, POSE_STRIDE, type Machine } from './physics';
import {
  ballTexture,
  brushedMetalTexture,
  chanceSignTexture,
  floorTexture,
  glowTexture,
  medalEdgeBump,
  medalFaceTextures,
} from './textures';

/** 筐体を手前から見下ろすカメラの仰角（度） */
const CAMERA_ELEVATION_DEG = 58;
/** 注視点（筐体ローカル空間） */
const LOOK_AT = new THREE.Vector3(0, 1.2, -4.0);

/** 液晶パネル：仕切り板の上に、奥へ倒して載せる（見下ろす視点から読みやすいように） */
const LCD_W = 8.6;
/** 画面に収めたい横幅。いちばん幅の広い液晶パネルが収まるようにする */
const FIT_WIDTH = LCD_W + 1.8;
const LCD_H = (LCD_W * LCD_PX_H) / LCD_PX_W;
const LCD_LEAN_DEG = 30;

/** 電飾の点灯パターン */
export type LightMode = 'idle' | 'spin' | 'win' | 'chance' | 'jackpot';

export class GameScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  /** 筐体ローカル空間。傾き（tilt）はこのグループの回転で見せる */
  readonly cabinet = new THREE.Group();

  private readonly medalMesh: THREE.InstancedMesh;
  private readonly ballMeshes: THREE.Mesh[] = [];
  private readonly pusherMesh: THREE.Mesh;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly frontStrip: THREE.MeshBasicMaterial;
  private readonly chuckerMat: THREE.MeshStandardMaterial;
  private readonly bulbs: THREE.InstancedMesh;
  private readonly glow: THREE.Points;
  private readonly bulbGroup: number[] = [];
  private readonly bulbColor = new THREE.Color();
  private lightMode: LightMode = 'idle';
  private lightModeTime = 0;
  private time = 0;
  private frontFlash = 0;
  private chuckerFlash = 0;

  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpQuatB = new THREE.Quaternion();
  private readonly tmpScale = new THREE.Vector3(1, 1, 1);
  private readonly tmpMat = new THREE.Matrix4();
  private readonly tmpVec = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, lcd: Lcd) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color(0x07060f);
    // 金属メダルの映り込み用。RoomEnvironment は手続き生成なので外部ファイル不要
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.8;
    pmrem.dispose();

    this.scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x301830, 0.5));
    this.keyLight = new THREE.DirectionalLight(0xfff4e0, 2.0);
    this.keyLight.position.set(3, 16, 6);
    this.keyLight.target.position.set(0, 0, -3);
    this.keyLight.castShadow = true;
    const sc = this.keyLight.shadow.camera;
    sc.left = -7;
    sc.right = 7;
    sc.top = 9;
    sc.bottom = -9;
    sc.near = 4;
    sc.far = 30;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.bias = -0.0006;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight, this.keyLight.target);

    this.scene.add(this.cabinet);
    // 入賞口の枠（通ると光る）
    this.chuckerMat = new THREE.MeshStandardMaterial({
      color: 0xd0103a,
      metalness: 0.4,
      roughness: 0.3,
      emissive: 0xff2050,
      emissiveIntensity: 0.6,
    });
    this.buildBoard();

    // 前面の発光ライン（獲得時に光る）
    this.frontStrip = new THREE.MeshBasicMaterial({ color: 0xffb020 });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(FLOOR_X * 2, 0.08, 0.12), this.frontStrip);
    strip.position.set(0, -0.06, FRONT_Z + 0.06);
    this.cabinet.add(strip);

    this.buildChuckerSign();

    // 液晶
    this.buildLcd(lcd);

    // プッシャー：上面はヘアライン金属、前面は赤い化粧板
    const metal = brushedMetalTexture();
    metal.wrapS = metal.wrapT = THREE.RepeatWrapping;
    metal.repeat.set(2, 2);
    const pusherTop = new THREE.MeshStandardMaterial({ map: metal, metalness: 0.85, roughness: 0.35 });
    const pusherSide = new THREE.MeshStandardMaterial({ color: 0x9aa3b0, metalness: 0.8, roughness: 0.3 });
    const pusherFront = new THREE.MeshStandardMaterial({
      color: 0xc0102e,
      metalness: 0.3,
      roughness: 0.25,
      emissive: 0x400010,
    });
    this.pusherMesh = new THREE.Mesh(
      new THREE.BoxGeometry((FLOOR_X - PUSHER_SIDE_GAP) * 2, PUSHER_HEIGHT, PUSHER_LENGTH),
      // BoxGeometry の面の順番: +x, -x, +y, -y, +z(前), -z
      [pusherSide, pusherSide, pusherTop, pusherSide, pusherFront, pusherSide],
    );
    this.pusherMesh.castShadow = true;
    this.pusherMesh.receiveShadow = true;
    this.cabinet.add(this.pusherMesh);

    // メダル（InstancedMesh 1つで全枚数を描く）。側面はギザギザ、表裏は刻印
    const medalGeo = new THREE.CylinderGeometry(MEDAL_RADIUS, MEDAL_RADIUS, MEDAL_THICKNESS, 32, 1);
    const face = medalFaceTextures();
    const edgeBump = medalEdgeBump();
    edgeBump.repeat.set(1, 1);
    const faceMat = new THREE.MeshStandardMaterial({
      map: face.map,
      bumpMap: face.bump,
      bumpScale: 2.5,
      metalness: 0.85,
      roughness: 0.3,
    });
    const edgeMat = new THREE.MeshStandardMaterial({
      color: 0xd9ad48,
      bumpMap: edgeBump,
      bumpScale: 1.5,
      metalness: 0.9,
      roughness: 0.3,
    });
    // CylinderGeometry のグループ: 0=側面, 1=上面, 2=下面
    this.medalMesh = new THREE.InstancedMesh(medalGeo, [edgeMat, faceMat, faceMat], MAX_MEDALS);
    this.medalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.medalMesh.count = 0;
    this.medalMesh.castShadow = true;
    this.medalMesh.receiveShadow = true;
    // 全メダルが常に盤面付近にあるので、インスタンス単位の視錐台カリングは不要
    this.medalMesh.frustumCulled = false;
    this.cabinet.add(this.medalMesh);

    // サイコロボール（最大 MAX_BALLS 個。使わないものは隠す）
    const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 32, 20);
    const ballMat = new THREE.MeshStandardMaterial({
      map: ballTexture(),
      metalness: 0.1,
      roughness: 0.2,
    });
    for (let i = 0; i < MAX_BALLS; i++) {
      const m = new THREE.Mesh(ballGeo, ballMat);
      m.castShadow = true;
      m.visible = false;
      this.ballMeshes.push(m);
      this.cabinet.add(m);
    }

    // 電飾（電球の玉＋加算合成の光のにじみ）
    const positions = this.bulbPositions();
    this.bulbs = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.09, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      positions.length,
    );
    const glowGeo = new THREE.BufferGeometry();
    const posArr = new Float32Array(positions.length * 3);
    positions.forEach((p, i) => {
      this.tmpMat.makeTranslation(p.x, p.y, p.z);
      this.bulbs.setMatrixAt(i, this.tmpMat);
      this.bulbs.setColorAt(i, this.bulbColor.set(0xffffff));
      p.toArray(posArr, i * 3);
    });
    glowGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    glowGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(positions.length * 3), 3));
    this.glow = new THREE.Points(
      glowGeo,
      new THREE.PointsMaterial({
        size: 0.75,
        map: glowTexture(),
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glow.frustumCulled = false;
    this.cabinet.add(this.bulbs, this.glow);

    this.resize();
  }

  setTilt(deg: number): void {
    this.cabinet.rotation.x = (deg * Math.PI) / 180;
  }

  setShadows(on: boolean): void {
    this.keyLight.castShadow = on;
    this.renderer.shadowMap.enabled = on;
    // シェーダーの作り直しが必要
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
  }

  setLightMode(mode: LightMode): void {
    if (mode === this.lightMode) return;
    this.lightMode = mode;
    this.lightModeTime = 0;
  }

  /** 手前の発光ラインを光らせる（獲得） */
  flashFront(): void {
    this.frontFlash = 1;
  }

  /** 入賞口の枠を光らせる */
  flashChucker(): void {
    this.chuckerFlash = 1;
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // 縦長画面でも筐体の横幅が収まる距離にカメラを引く
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const dist = Math.max(FIT_WIDTH / 2 / Math.tan(hFov / 2), 15);
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

  render(machine: Machine, alpha: number, dt: number): void {
    this.time += dt;
    this.lightModeTime += dt;

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

    // サイコロボール
    const bp = machine.ballPrev;
    const bc = machine.ballCurr;
    for (let i = 0; i < this.ballMeshes.length; i++) {
      const mesh = this.ballMeshes[i];
      mesh.visible = i < machine.ballCount;
      if (!mesh.visible) continue;
      const o = i * POSE_STRIDE;
      mesh.position.set(
        bp[o] + (bc[o] - bp[o]) * alpha,
        bp[o + 1] + (bc[o + 1] - bp[o + 1]) * alpha,
        bp[o + 2] + (bc[o + 2] - bp[o + 2]) * alpha,
      );
      q.set(bp[o + 3], bp[o + 4], bp[o + 5], bp[o + 6]);
      qb.set(bc[o + 3], bc[o + 4], bc[o + 5], bc[o + 6]);
      mesh.quaternion.copy(q.slerp(qb, alpha));
    }

    this.updateLights(dt);
    this.renderer.render(this.scene, this.camera);
  }

  // ------------------------------------------------------------------ 電飾

  private updateLights(dt: number): void {
    this.frontFlash = Math.max(0, this.frontFlash - dt * 2.5);
    this.chuckerFlash = Math.max(0, this.chuckerFlash - dt * 2);
    const ff = this.frontFlash;
    this.frontStrip.color.setRGB(1, 0.55 + ff * 0.45, 0.1 + ff * 0.9).multiplyScalar(0.6 + ff * 1.4);
    const cf = this.chuckerFlash;
    this.chuckerMat.emissive.setRGB(1, 0.13 + cf * 0.87, 0.31 + cf * 0.69);
    this.chuckerMat.emissiveIntensity = 0.6 + cf * 1.6;

    const t = this.time;
    const mode = this.lightMode;
    const colors = this.glow.geometry.getAttribute('color') as THREE.BufferAttribute;
    const c = this.bulbColor;
    const n = this.bulbs.count;
    for (let i = 0; i < n; i++) {
      const group = this.bulbGroup[i];
      let on: number;
      switch (mode) {
        case 'idle':
          // ゆっくり流れる
          on = (i + Math.floor(t * 6)) % 4 === 0 ? 1 : 0.18;
          c.setHSL(group === 0 ? 0.12 : group === 1 ? 0.58 : 0.95, 1, 0.55);
          if (group === 2) on = Math.max(on, 0.6); // 入賞口はいつも目立たせる
          break;
        case 'spin':
          on = (i + Math.floor(t * 18)) % 3 === 0 ? 1 : 0.25;
          c.setHSL(0.12, 1, 0.55);
          break;
        case 'win':
          on = Math.floor(t * 10) % 2 === (i % 2) ? 1 : 0.15;
          c.setHSL(0.13, 1, 0.6);
          break;
        case 'chance':
          on = Math.floor(t * 14) % 2 === 0 ? 1 : 0.1;
          c.setHSL(0.97, 1, 0.55);
          break;
        case 'jackpot':
          on = 0.6 + 0.4 * Math.sin(t * 20 + i);
          c.setHSL((i / n + t * 0.8) % 1, 1, 0.55);
          break;
      }
      c.multiplyScalar(on);
      this.bulbs.setColorAt(i, c);
      colors.setXYZ(i, c.r, c.g, c.b);
    }
    this.bulbs.instanceColor!.needsUpdate = true;
    colors.needsUpdate = true;
  }

  // ------------------------------------------------------------------ 組み立て

  private projectToScreenX(x: number): number {
    const v = this.tmpVec.set(x, DROP_Y, DROP_Z);
    this.cabinet.updateMatrixWorld();
    v.applyMatrix4(this.cabinet.matrixWorld).project(this.camera);
    return (v.x * 0.5 + 0.5) * window.innerWidth;
  }

  private buildBoard(): void {
    const floorTex = floorTexture(FLOOR_X * 2, FRONT_Z - BACK_Z);
    const mats = {
      floor: new THREE.MeshStandardMaterial({ map: floorTex, metalness: 0.2, roughness: 0.45 }),
      side: new THREE.MeshStandardMaterial({ color: 0x2a1e4a, metalness: 0.5, roughness: 0.35 }),
      wall: new THREE.MeshStandardMaterial({
        color: 0xbfd6ff,
        metalness: 0.0,
        roughness: 0.05,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
      }),
      curtain: new THREE.MeshStandardMaterial({ color: 0x1c1430, metalness: 0.6, roughness: 0.35 }),
      back: new THREE.MeshStandardMaterial({ color: 0x0c0a14, metalness: 0.2, roughness: 0.7 }),
      chucker: this.chuckerMat,
      // 溝の上のカバー：クロームの手すり
      lip: new THREE.MeshStandardMaterial({ color: 0xd8dce8, metalness: 1, roughness: 0.18 }),
    };
    for (const part of boardParts()) {
      if (part.name === 'lid') continue; // 見えないふた
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(part.half[0] * 2, part.half[1] * 2, part.half[2] * 2),
        mats[part.name],
      );
      mesh.position.set(...part.pos);
      if (part.name === 'wall') {
        mesh.renderOrder = 2;
      } else {
        mesh.receiveShadow = true;
        mesh.castShadow = part.name !== 'floor';
      }
      this.cabinet.add(mesh);
    }

    // 外壁の上のクロームの手すり
    const chrome = new THREE.MeshStandardMaterial({ color: 0xe8e8f0, metalness: 1, roughness: 0.15 });
    const wallLen = FRONT_Z - BACK_Z;
    for (const s of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, wallLen, 12), chrome);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(s * (WALL_X + WALL_THICKNESS / 2), WALL_HEIGHT - 0.5, BACK_Z + wallLen / 2);
      this.cabinet.add(rail);
    }

    // 左右の溝の底（真っ暗にして、のぞき込んでも穴が目立たないように）
    const gutterMat = new THREE.MeshBasicMaterial({ color: 0x020104 });
    const gutterW = WALL_X - FLOOR_X;
    const gutterLen = FRONT_Z - GUTTER_START_Z;
    for (const s of [-1, 1]) {
      const g = new THREE.Mesh(new THREE.BoxGeometry(gutterW, 0.05, gutterLen), gutterMat);
      g.position.set(s * (FLOOR_X + gutterW / 2), -0.6, GUTTER_START_Z + gutterLen / 2);
      this.cabinet.add(g);
    }

    // 手前の受け皿（見た目だけ）
    const trayMat = new THREE.MeshStandardMaterial({ color: 0x3a2a08, metalness: 0.8, roughness: 0.3 });
    const tray = new THREE.Mesh(new THREE.BoxGeometry(FLOOR_X * 2 + 0.4, 0.1, 1.8), trayMat);
    tray.position.set(0, -1.3, FRONT_Z + 1.0);
    this.cabinet.add(tray);
  }

  /** 入賞口の枠の手前に立てる「CHANCE」看板（見た目だけ。当たり判定なし） */
  private buildChuckerSign(): void {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 0.5),
      new THREE.MeshBasicMaterial({ map: chanceSignTexture() }),
    );
    sign.position.set(0, CHUCKER_Y + 0.36, CHUCKER_Z + CHUCKER_DEPTH / 2 + CHUCKER_BAR + 0.05);
    sign.rotation.x = -0.35; // 見下ろすカメラの方へ少し倒す
    this.cabinet.add(sign);
  }

  private lcdFrame(): THREE.Matrix4 {
    // 仕切り板の上端を下辺として、奥へ LCD_LEAN_DEG 倒した面
    const a = -(LCD_LEAN_DEG * Math.PI) / 180;
    const up = new THREE.Vector3(0, Math.cos(a), Math.sin(a));
    const center = new THREE.Vector3(0, CURTAIN_TOP + 0.15, CURTAIN_FRONT_Z - 0.1).addScaledVector(up, LCD_H / 2 + 0.2);
    return new THREE.Matrix4().compose(center, new THREE.Quaternion().setFromEuler(new THREE.Euler(a, 0, 0)), new THREE.Vector3(1, 1, 1));
  }

  private buildLcd(lcd: Lcd): void {
    const frame = this.lcdFrame();
    const group = new THREE.Group();
    frame.decompose(group.position, group.quaternion, group.scale);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(LCD_W, LCD_H), new THREE.MeshBasicMaterial({ map: lcd.texture }));
    screen.position.z = 0.03;
    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(LCD_W + 0.7, LCD_H + 0.7, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x241a3e, metalness: 0.7, roughness: 0.3 }),
    );
    bezel.position.z = -0.08;
    bezel.castShadow = true;
    group.add(bezel, screen);
    this.cabinet.add(group);
  }

  /** 電球の位置（液晶の枠・左右の壁の上・入賞口の看板の横）。bulbGroup に系統番号を入れる */
  private bulbPositions(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    // 0: 液晶の枠
    const frame = this.lcdFrame();
    const hw = LCD_W / 2 + 0.22;
    const hh = LCD_H / 2 + 0.22;
    const per = 2 * (hw + hh) * 2;
    const count = 44;
    for (let i = 0; i < count; i++) {
      let d = (i / count) * per;
      let x: number;
      let y: number;
      if (d < hw * 2) [x, y] = [-hw + d, hh];
      else if ((d -= hw * 2) < hh * 2) [x, y] = [hw, hh - d];
      else if ((d -= hh * 2) < hw * 2) [x, y] = [hw - d, -hh];
      else [x, y] = [-hw, -hh + (d - hw * 2)];
      out.push(new THREE.Vector3(x, y, 0.05).applyMatrix4(frame));
      this.bulbGroup.push(0);
    }
    // 1: 左右の壁の上
    for (const s of [-1, 1]) {
      for (let z = CURTAIN_FRONT_Z; z <= FRONT_Z + 0.01; z += 0.85) {
        out.push(new THREE.Vector3(s * (WALL_X + WALL_THICKNESS / 2), WALL_HEIGHT - 0.32, z));
        this.bulbGroup.push(1);
      }
    }
    // 2: 入賞口の枠の四隅と各辺の中央
    const hx = CHUCKER_WIDTH / 2 + CHUCKER_BAR / 2;
    const hz = CHUCKER_DEPTH / 2 + CHUCKER_BAR / 2;
    for (const [x, z] of [
      [-hx, -hz],
      [0, -hz],
      [hx, -hz],
      [hx, 0],
      [hx, hz],
      [0, hz],
      [-hx, hz],
      [-hx, 0],
    ]) {
      out.push(new THREE.Vector3(x, CHUCKER_Y + 0.13, CHUCKER_Z + z));
      this.bulbGroup.push(2);
    }
    return out;
  }
}
