# coin-pusher

スマホ縦画面向けのコインプッシャーゲーム（フェーズ1：物理の叩き台）。

- 画面上部をタップ → その横位置からメダル投入
- 手前から落ちたメダルは獲得、左右の溝は没収
- `?debug=1` を付けると物理の調整パネルが出る

```bash
npm ci
npm run dev      # http://<PCのIP>:5173/?debug=1 をスマホで開く
npm run build    # dist/ に出力（相対パス）
```

開発ルール・物理設定の理由・ロードマップは [CLAUDE.md](./CLAUDE.md) を参照。
