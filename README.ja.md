<div align="center">

<img src="public/halo.svg" alt="Kivotos Rig Studio ヘイローアイコン" width="64" height="64" />

# KIVOTOS RIG STUDIO

**ブルーアーカイブ 3D SD生徒 クロスリターゲット（モーション換装）・小物／家具連動・合同勝利キャスト入替・原寸透過 GIF 出力スタジオ**

<p>
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <strong>日本語</strong> ·
  <a href="README.ko.md">한국어</a>
</p>

<p>
  <a href="https://ryujou.github.io/kivotos-rig-studio/"><img src="https://img.shields.io/badge/Live_Demo-GitHub_Pages-00A2FF?style=flat-square&logo=githubpages&logoColor=white" alt="オンラインデモ" /></a>
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=0F1B2D" alt="React 19" />
  <img src="https://img.shields.io/badge/Three.js-WebGL2-000000?style=flat-square&logo=threedotjs&logoColor=white" alt="Three.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Zero_Model_Storage-Wiki_%E3%83%AA%E3%82%A2%E3%83%AB%E3%82%BF%E3%82%A4%E3%83%A0%E5%8F%96%E5%BE%97-0FA968?style=flat-square" alt="Zero Model Storage" />
  <img src="https://img.shields.io/badge/i18n-%E6%97%A5_%7C_%E4%B8%AD_%7C_%ED%95%9C_%7C_EN-6366F1?style=flat-square" alt="4言語対応" />
  <img src="https://img.shields.io/badge/License-MIT-334155?style=flat-square" alt="MIT License" />
</p>

<p>
  <strong>👉 <a href="https://ryujou.github.io/kivotos-rig-studio/">ブラウザで今すぐ試す（GitHub Pages）</a></strong>
</p>

<br />

<img src="docs/media/hero-light.png" alt="Kivotos Rig Studio — シンプル化された SCHALE ライトワークベンチ" width="960" />

</div>

---

## ✨ 主な特徴

- **モデル非同梱・Wiki リアルタイム同期（リポジトリ内 `.glb` ゼロ）** — [`bluearchive.wiki`](https://bluearchive.wiki/wiki/Models) の `Module:ModelViewer/data.json` から最新 145 生徒・289 モデル一覧を直接取得し、jsDelivr CDN からオンデマンド読み込み（IndexedDB LRU キャッシュ対応）。
- **直感的な「対象選択 → カード単クリック」＆高速生徒フィルタ** — 上部で **`役者 A（見た目）`** または **`モーション B`** を選び、生徒カード全体をクリックするだけ。`/` キーで 4 言語検索、**全 145 生徒の学園フィルタ**、衣装・小物タグ、**最近使った生徒**バーで目的の生徒に一瞬で到達できます。
- **デュアルリグ・ワールド空間リターゲットエンジン** — 任意の生徒 A に任意の生徒 B のモーションを自然適用。バインドポーズ正規化回転転送、`CUBICSPLINE` 補間、多階層戦車砲塔リグ、目ボーン差分転送、`Mouth_XXX` 自動フォールバックを完全実装。
- **段階開示の調整インスペクター & Verlet 揺れもの物理** — 日常使う設定（`身長補正 / 小物固定`、`表情同期`、`揺れもの物理`、`左右反転`）のみ常時表示し、**7 部位ミックス**・**カスタムボーン割当＋スケルトン表示**・**3D ギズモ**は折りたたみ内に美しく整理。
- **217 モデルの内蔵小物／乗物連動 & カフェ家具パック対応** — キーボード、戦車、屋台バイク、ビーチチェア、楽譜などを自動分解。**A / B / C 武器切替**および外部 **カフェ家具インタラクションパック**（`.glb` / `.zip` + `pack.json`）のドラッグ＆ドロップに対応。
- **公式 16 種の 2〜4 人合同勝利ポーズ & ワンクリック配役入替** — 全 16 合同勝利フォーメーション（および虎丸戦車・メイド双子 EX・スイーツ部バンド）を再現し、全スロットの生徒を自由に入れ替え可能。
- **フレーム厳密・原寸透過 GIF / PNG ZIP / WebM 出力** — `1:1` 正方形ファインダーがクリップ全体の動き（ヘイロー・長尺武器含む）を自動フレーミング。デフォルトは **原寸（1:1 DPR 解像度）**・繊細な 25% 輪郭線・ヘイロー縁取りなしの透過 GIF 出力。
- **洗練された SCHALE UI & 日中韓英 4 言語切替** — スロット操作を統合した 1 段トップバー、精密アラインメントの独自ポインタータイムライン、**SCHALE ライト／Studio ダーク**、完全 **日本語 / 简体中文 / 한국어 / English** 対応。

---

## 🎬 ショーケース

<table>
  <tr>
    <td width="50%" align="center">
      <img src="docs/media/showcase-keyboard.png" alt="学園フィルタでアイリを即検索しドレスヒナがキーボードを演奏" /><br />
      <sub><strong>学園高速フィルタ + 楽器連動</strong> · ヒナ(ドレス) ← アイリ(バンド) <code>NonWeapon_Keyboard</code></sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/media/showcase-tank.png" alt="ユウカとノアが虎丸戦車に同乗" /><br />
      <sub><strong>2 スロット戦車キャスト入替</strong> · ユウカ＆ノアが虎丸に搭乗（砲塔ソケット追従）</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="docs/media/showcase-duo-victory.png" alt="アルとムツキの合同勝利ポーズと 1:1 原寸ファインダー" /><br />
      <sub><strong>合同勝利 + 自動 1:1 原寸ファインダー</strong> · アル＆ムツキ · <code>1468×1468</code></sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/media/showcase-dark-ja.png" alt="Studio ダークモード・日本語 UI" /><br />
      <sub><strong>Studio ダークテーマ + 日本語 UI</strong> · 日 / 中 / 한 / EN ワンクリック切替</sub>
    </td>
  </tr>
</table>

<div align="center">
  <img src="docs/media/demo-duo-transparent.gif" alt="実際に出力されたアル＆ムツキ合同勝利の透過 GIF" width="320" /><br />
  <sub><strong>実機出力した透過アニメーション GIF</strong> · アル＆ムツキ合同勝利（繊細な 25% 輪郭線・ヘイロー縁取りなし・クリーン透過）</sub>
</div>

---

## 🚀 クイックスタート

```bash
git clone https://github.com/ryujou/kivotos-rig-studio.git
cd kivotos-rig-studio
npm install
npm run dev
```

ブラウザで **`http://localhost:5173`** を開くだけです。ショートカット：`/` 検索フォーカス · `Space` 再生／停止 · `←` / `→` 1 フレーム送り · 左ドラッグ回転 · 右ドラッグ移動 · ホイールズーム。

---

## 🪑 カフェ家具パック & ☁️ GitHub Pages デプロイ

- **家具パック仕様:** [tools/README-furniture-extract.md](tools/README-furniture-extract.md)
- **GitHub Pages 自動公開:** [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) により `main` へのプッシュで **`https://ryujou.github.io/kivotos-rig-studio/`** へ自動デプロイされます。静的公開環境で公式 16 種の `.joint.br` 合同勝利を使う場合は、**「合同 → オフラインファイル / プロキシ」** からファイルドロップまたは同梱の [deploy/cloudflare-worker.js](deploy/cloudflare-worker.js) の URL を設定してください。

---

## 🙏 クレジット & 免責事項

- **3D モデルソース:** [`bluearchive.wiki`](https://bluearchive.wiki/wiki/Models)、[`lihaohong6/BlueArchiveModels`](https://github.com/lihaohong6/BlueArchiveModels)、[`lihaohong6/MirahezeDevScripts`](https://github.com/lihaohong6/MirahezeDevScripts)
- **合同勝利・動作調査参考:** [`dxsworks/SD_archive`](https://github.com/dxsworks/SD_archive)

> **免責事項:** 本プロジェクトは非公式・非営利のファンメイドツールであり、NEXON Games および Yostar とは一切関係ありません。本リポジトリにはゲーム由来のモデルバイナリを一切含みません。

## 📄 ライセンス

[MIT License](LICENSE)
