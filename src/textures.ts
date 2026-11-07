import * as THREE from 'three';

// 画像ファイルを持たないよう、テクスチャはすべて Canvas で生成する（外部取得なし・相対パス不要）。

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, inner = 0.45): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * inner : r;
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  g.closePath();
}

/** メダル表面：縁・内側の溝・中央の星・文字。色と凹凸（bump）を返す */
export function medalFaceTextures(): { map: THREE.Texture; bump: THREE.Texture } {
  const S = 256;
  const c = S / 2;
  const [cc, g] = canvas(S, S);
  const [bc, b] = canvas(S, S);

  // 色
  const grad = g.createRadialGradient(c * 0.8, c * 0.7, 10, c, c, c);
  grad.addColorStop(0, '#f6d77a');
  grad.addColorStop(0.5, '#d9a83a');
  grad.addColorStop(1, '#a8761c');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = 'rgba(120,80,10,0.55)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(c, c, c * 0.84, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  g.arc(c, c, c * 0.62, 0, Math.PI * 2);
  g.stroke();
  starPath(g, c, c, c * 0.42);
  g.fillStyle = 'rgba(255,230,150,0.9)';
  g.fill();
  g.strokeStyle = 'rgba(120,80,10,0.7)';
  g.lineWidth = 3;
  g.stroke();
  // 縁の文字（円周に沿って）
  g.fillStyle = 'rgba(110,70,10,0.75)';
  g.font = `bold ${Math.round(S * 0.075)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const text = '★ GAME MEDAL ★ GAME MEDAL ';
  for (let i = 0; i < text.length; i++) {
    const a = (i / text.length) * Math.PI * 2;
    g.save();
    g.translate(c + Math.sin(a) * c * 0.73, c - Math.cos(a) * c * 0.73);
    g.rotate(a);
    g.fillText(text[i], 0, 0);
    g.restore();
  }

  // 凹凸（白が高い）
  b.fillStyle = '#808080';
  b.fillRect(0, 0, S, S);
  b.fillStyle = '#ffffff';
  b.beginPath();
  b.arc(c, c, c, 0, Math.PI * 2);
  b.arc(c, c, c * 0.88, 0, Math.PI * 2, true);
  b.fill();
  b.strokeStyle = '#404040';
  b.lineWidth = 3;
  b.beginPath();
  b.arc(c, c, c * 0.62, 0, Math.PI * 2);
  b.stroke();
  starPath(b, c, c, c * 0.42);
  b.fillStyle = '#e0e0e0';
  b.fill();

  const map = new THREE.CanvasTexture(cc);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  const bump = new THREE.CanvasTexture(bc);
  return { map, bump };
}

/** メダル側面のギザギザ（縦縞） */
export function medalEdgeBump(): THREE.Texture {
  const [c, g] = canvas(256, 8);
  for (let x = 0; x < 256; x += 4) {
    g.fillStyle = '#ffffff';
    g.fillRect(x, 0, 2, 8);
    g.fillStyle = '#303030';
    g.fillRect(x + 2, 0, 2, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** 盤面の床：濃い青に放射状の模様と六角形のパターン */
export function floorTexture(widthUnits: number, depthUnits: number): THREE.Texture {
  const W = 512;
  const H = Math.round((W * depthUnits) / widthUnits);
  const [c, g] = canvas(W, H);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#101a44');
  grad.addColorStop(0.6, '#1b2f78');
  grad.addColorStop(1, '#2a1a6e');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // 六角形
  const r = 22;
  g.strokeStyle = 'rgba(140,180,255,0.12)';
  g.lineWidth = 1.5;
  for (let row = 0, y = 0; y < H + r; row++, y += r * 1.5) {
    for (let x = row % 2 ? r * 0.866 : 0; x < W + r; x += r * 1.732) {
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      g.closePath();
      g.stroke();
    }
  }
  // 手前の星と文字
  g.save();
  g.globalAlpha = 0.18;
  starPath(g, W / 2, H * 0.86, W * 0.18);
  g.fillStyle = '#ffd36b';
  g.fill();
  g.restore();
  g.fillStyle = 'rgba(255,220,140,0.22)';
  g.font = `bold ${Math.round(W * 0.09)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.fillText('MEDAL PUSHER', W / 2, H * 0.72);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** プッシャー上面：ヘアライン加工の金属 */
export function brushedMetalTexture(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#b8bec8';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 400; i++) {
    const y = Math.random() * 256;
    const v = 160 + Math.random() * 80;
    g.strokeStyle = `rgba(${v},${v},${v + 8},0.35)`;
    g.lineWidth = Math.random() * 1.2 + 0.3;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y + (Math.random() - 0.5) * 2);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 入賞口の上の「CHANCE」看板 */
export function chanceSignTexture(): THREE.Texture {
  const [c, g] = canvas(256, 64);
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, '#ff3d6e');
  grad.addColorStop(1, '#a3002f');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 64);
  g.strokeStyle = '#ffe08a';
  g.lineWidth = 4;
  g.strokeRect(3, 3, 250, 58);
  g.fillStyle = '#fff6d0';
  g.font = 'bold 38px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('▼ CHANCE ▼', 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** 電球の光のにじみ（加算合成のスプライト用） */
export function glowTexture(): THREE.Texture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * サイコロボール：白い球に赤と黒の目（球に巻きつける正距円筒図法のテクスチャ）。
 * 赤道に4面、両極に2面を置いて、どこから見てもサイコロとわかるようにする。
 */
export function ballTexture(): THREE.Texture {
  const [c, g] = canvas(512, 256);
  g.fillStyle = '#f7f5ee';
  g.fillRect(0, 0, 512, 256);
  const pip = (x: number, y: number, r: number, color: string, sx = 1) => {
    g.beginPath();
    g.ellipse(x, y, r * sx, r, 0, 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
  };
  const p = 22;
  // 赤道の4面（1, 2, 6, 5）
  const faces: [number, [number, number][]][] = [
    [64, [[0, 0]]],
    [192, [[-p, -p], [p, p]]],
    [320, [[-p, -p], [p, -p], [-p, 0], [p, 0], [-p, p], [p, p]]],
    [448, [[-p, -p], [p, -p], [0, 0], [-p, p], [p, p]]],
  ];
  faces.forEach(([x, pts], k) => {
    for (const [dx, dy] of pts) pip(x + dx, 128 + dy, k === 0 ? 20 : 11, k === 0 ? '#d4102f' : '#1a1a2a');
  });
  // 極の2面（3, 4）。極付近は横に引き伸ばされるので横長の楕円で描く
  for (const [dx] of [[-1], [0], [1]]) pip(256 + dx * 120, 24, 9, '#1a1a2a', 3);
  for (const [dx] of [[-1.5], [-0.5], [0.5], [1.5]]) pip(256 + dx * 100, 232, 9, '#1a1a2a', 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export { starPath };
