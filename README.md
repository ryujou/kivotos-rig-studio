<div align="center">

<img src="public/halo.svg" alt="Kivotos Rig Studio Halo Emblem" width="64" height="64" />

# KIVOTOS RIG STUDIO

**Blue Archive 3D Chibi Cross-Character Skeleton Retargeting, Interactive Props & Furniture, Multi-Slot Joint Victory Cast-Swap & Native Transparent GIF Studio**

<p>
  <strong>English</strong> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

<p>
  <a href="https://ryujou.github.io/kivotos-rig-studio/"><img src="https://img.shields.io/badge/Live_Demo-GitHub_Pages-00A2FF?style=flat-square&logo=githubpages&logoColor=white" alt="Live Demo" /></a>
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=0F1B2D" alt="React 19" />
  <img src="https://img.shields.io/badge/Three.js-WebGL2-000000?style=flat-square&logo=threedotjs&logoColor=white" alt="Three.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Zero_Model_Storage-Live_Wiki_Sync-0FA968?style=flat-square" alt="Zero Model Storage" />
  <img src="https://img.shields.io/badge/i18n-EN_%7C_%E4%B8%AD_%7C_%E6%97%A5_%7C_%ED%95%9C-6366F1?style=flat-square" alt="4 Languages" />
  <img src="https://img.shields.io/badge/License-MIT-334155?style=flat-square" alt="MIT License" />
</p>

<p>
  <strong>👉 <a href="https://ryujou.github.io/kivotos-rig-studio/">Try Live in Browser (GitHub Pages)</a></strong>
</p>

<br />

<img src="docs/media/hero-light.png" alt="Kivotos Rig Studio — Simplified SCHALE Light Workbench" width="960" />

</div>

---

## ✨ Highlights

- **Zero-Storage Live Wiki Sync (`0` `.glb` files in repo)** — Streams the live 145-student / 289-model catalog directly from [`bluearchive.wiki`](https://bluearchive.wiki/wiki/Models) (`Module:ModelViewer/data.json`) and fetches `.glb` binaries on demand from jsDelivr CDN with an automatic IndexedDB LRU cache. New wiki models appear automatically.
- **Effortless Target-First Workflow & Fast Character Filtering** — Pick **`Actor A`** or **`Motion B`** once at the top of the drawer and click any entire character card directly. Press `/` for instant multi-language search, filter all 145 students by **official Academy / School**, outfit, or embedded props, and jump between your **Recent Picks** in one click.
- **Dual-Rig World-Space Skeleton Retargeting** — Let **any Character A perform any Character B's animation** cleanly. Rest-pose normalized world-space quaternion transfer preserves target bone lengths, handles `CUBICSPLINE` tracks natively, survives deep vehicle/turret hierarchies (e.g. Cherino/Iroha tanks), transfers eye-bone deltas without pop-out, and maps `Mouth_XXX` morph targets with hundred-series fallback.
- **Progressive-Disclosure Rig Lab & Verlet Spring Physics** — Core switches (`Ground-Scaled / Prop-Locked`, `Expression Sync`, `Hair/Skirt Physics`, `Mirror L ↔ R`) stay front and center, while **7-part Body Mixer**, **Custom Bone Remapper + 3D Skeleton Overlay**, **Root/Spring Tuning**, and **3D Gizmo** expand cleanly on demand.
- **Universal Prop, Weapon & Cafe Furniture Interaction** — Auto-dissects all **217 Wiki models with embedded props/instruments/furniture/vehicles** (keyboards, tanks, food bikes, beach chairs, tables, sheet music) for per-part toggling; provides an **A / B / C Three-Way Weapon Matrix**; supports drag-and-drop **Cafe Furniture Interaction Packs** (`.glb` / `.zip` + `pack.json`) and remote pack indices.
- **16 Official 2–4 Character Joint Victory Combos + 1-Click Cast Swap** — Load all 16 in-game duo/trio/quartet victory formations (plus Wiki-native duos like Toramaru Tank Tandem & Maid Twin EX) with exact `(x, z, yaw)` placements, `Start → End` chaining, and **replace any slot with any of the 289 students**.
- **Deterministic Native-Resolution Transparent GIF / PNG ZIP / WebM Export** — Auto-fitting `1:1` square viewfinder encloses full character height, unlined glowing halos, tall weapons, and props across the clip; defaults to **Original (1:1 DPR native precision)** with clean `25%` Wiki-authentic outlines and alpha-matte transparency (`gifenc` Web Worker, disposal mode 2).
- **Modern SCHALE Studio UI & Full 4-Language i18n** — Single-layer floating TopBar with merged cast/slot strip, pixel-aligned custom Pointer-Events timeline rail, **SCHALE Light** & **Studio Dark** themes, and complete **English / 简体中文 / 日本語 / 한국어** localization (all UI controls + all 145 students, academies, and costume variants).

---

## 🎬 Showcase Gallery

<table>
  <tr>
    <td width="50%" align="center">
      <img src="docs/media/showcase-keyboard.png" alt="Hina (Dress) playing Airi (Band) keyboard with Academy filter & simplified Adjust panel" /><br />
      <sub><strong>Fast Academy Filter + Cross-Rig Prop</strong> · Hina (Dress) ← Airi (Band) <code>NonWeapon_Keyboard</code></sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/media/showcase-tank.png" alt="Yuuka & Noa riding Iroha & Ibuki Toramaru Tank" /><br />
      <sub><strong>2-Slot Tank Cast Swap</strong> · Yuuka &amp; Noa riding Toramaru (live moving turret socket)</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="docs/media/showcase-duo-victory.png" alt="Aru & Mutsuki Duo Victory in 1:1 native viewfinder" /><br />
      <sub><strong>Duo Joint Victory + Auto 1:1 Native Viewfinder</strong> · Aru &amp; Mutsuki · <code>1468×1468</code> Original</sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/media/showcase-dark-ja.png" alt="Studio Dark theme in Japanese" /><br />
      <sub><strong>Studio Dark Mode + 4-Language UI</strong> · Seamless switch between EN / 中 / 日 / 한</sub>
    </td>
  </tr>
</table>

<div align="center">
  <img src="docs/media/demo-duo-transparent.gif" alt="Exported transparent animated GIF of Aru & Mutsuki Duo Victory" width="320" /><br />
  <sub><strong>Actual Deterministic Transparent GIF Output</strong> · Aru &amp; Mutsuki Duo Victory (delicate 25% outline, unlined glowing halos, zero matte fringe)</sub>
</div>

---

## 🧠 Architecture

```mermaid
flowchart LR
    subgraph Sources["Zero-Storage Live Sources"]
        WIKI["bluearchive.wiki API<br/>Module:ModelViewer/data.json"]
        CDN["jsDelivr CDN<br/>289 Student GLBs"]
        JOINT["SD_archive Releases<br/>16 Joint Victory .joint.br"]
        FURN["Local / Remote<br/>Cafe Furniture Packs"]
    end

    subgraph Engine["Three.js Multi-Slot Dual-Rig Engine (1–4 Slots)"]
        CACHE["IndexedDB LRU Cache<br/>+ GLB Dissector"]
        DRIVER["Driver Rig B<br/>Native CUBICSPLINE Mixer<br/>+ Scene Props / Vehicles"]
        SOLVER["World-Space RetargetEngine<br/>Rest-Pose Delta · Part Mixer<br/>Eye Delta · Mouth Fallback"]
        ACTOR["Actor Rig A<br/>Body + Halo + Mouth<br/>+ Verlet Spring Physics"]
        PROPS["PropManager + Gizmo<br/>A/B/C Weapon Matrix<br/>Furniture Sync"]
    end

    subgraph Export["Rendering & Deterministic Export"]
        LOOK["Authentic Unlit / Soft-Lit<br/>25% Smooth-Normal Outline"]
        WORKER["Web Worker (gifenc / fflate)<br/>Native-Res Transparent GIF<br/>PNG ZIP · WebM"]
    end

    WIKI --> CDN --> CACHE
    JOINT --> CACHE
    FURN --> CACHE
    CACHE --> DRIVER --> SOLVER --> ACTOR
    DRIVER --> PROPS
    ACTOR --> LOOK --> WORKER
    PROPS --> LOOK
```

---

## 🚀 Quick Start

**Prerequisites:** Node.js `>= 20` and npm.

```bash
git clone https://github.com/ryujou/kivotos-rig-studio.git
cd kivotos-rig-studio
npm install
npm run dev
```

Open **`http://localhost:5173`** in your browser. No local `.glb` download or backend setup is required—characters stream directly from the Wiki CDN on demand.

> **Production Build & Preview:**
> ```bash
> npm run build
> npm run preview
> ```

---

## 🎮 Studio Workflow & Controls

1. **Swap Any Character & Motion** — Choose **`Actor A`** or **`Motion B`** at the top of the **Characters** tab, press `/` to search across EN/ZH/JA/KO or filter by **Academy / Outfit**, then click any character card directly. Click `⇄` in the top bar to swap A/B or `+` to add up to 4 slots.
2. **Interact with Props & Furniture** — Open **Props** to load any of the 217 embedded instruments/vehicles/furniture, switch weapons in **Adjust**, or drag-and-drop local `.glb` / `.zip` **Cafe Furniture Interaction Packs** directly onto the 3D canvas.
3. **Duo & Group Joint Victories** — Open **Joint** to load Wiki-native duos/band or any of the 16 official 2–4 character victory poses, then replace any slot's student with anyone in the catalog.
4. **Export Native Transparent GIF** — Click **`Export GIF`** in the top bar to auto-frame the `1:1` square viewfinder at **Original** precision, drag the timeline In/Out trim grips (or click `Trim 3s`), and render in a Web Worker.

**Shortcuts & Viewport:** `/` Focus Search · `Space` Play/Pause · `←` / `→` Step 1 Frame · `Left Drag` Orbit · `Right Drag` Pan · `Scroll` Zoom · Expand **Adjust → Scene Slots & Mounted Props** for the 3D Gizmo (`Move` / `Rotate` / `Scale`).

---

## 🪑 Interactive Cafe Furniture Packs

All **217 Wiki models with embedded props/instruments/vehicles** work out of the box. For standalone Blue Archive Cafe furniture extracted from game bundles (e.g. via [`ZM-Kimu/Blue-Archive-Asset-Downloader`](https://github.com/ZM-Kimu/Blue-Archive-Asset-Downloader) or AssetStudio), drag-and-drop a `.glb`, multi-file selection, or `.zip` archive directly into the viewport or **Props → Import Local Furniture / Borrow Any Prop**.

See **[tools/README-furniture-extract.md](tools/README-furniture-extract.md)** for the `pack.json` manifest specification and extraction workflow.

---

## ☁️ GitHub Pages & Static Deployment

This repository includes an automated GitHub Actions Pages workflow at **[.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml)** deploying directly to **`https://ryujou.github.io/kivotos-rig-studio/`** on every push to `main`.

- All 289 Wiki models, 217 embedded prop setups, and 3 Wiki-native duo/band combos stream directly via CORS on GitHub Pages with zero backend.
- For the 16 official `.joint.br` victory packs on static hosting, open **Joint → Offline Files / Proxy** to drop local `.joint.br` files or paste the URL of your deployed **[deploy/cloudflare-worker.js](deploy/cloudflare-worker.js)** (local `vite dev` / `vite preview` proxies `/api/joint/*` automatically).

---

<details>
<summary><strong>📁 Project Structure</strong></summary>

```text
kivotos-rig-studio/
├── .github/workflows/
│   └── deploy-pages.yml            # Automated GitHub Pages build & deployment
├── deploy/
│   └── cloudflare-worker.js        # Optional static-host CORS proxy for .joint.br packs
├── docs/media/                     # README showcase screenshots & transparent GIF demo
├── public/                         # Halo favicon, portrait atlas, Brotli license
├── src/
│   ├── components/                 # TopBar, LeftDrawer, RightInspector, AdjustInspector, TimelineDock, CropOverlay, ExportModal
│   ├── data/                       # Fallback Wiki catalog metadata, 217 prop index, 16 joint combos
│   ├── engine/                     # SceneManager, ModelLoader, OutlineEffect, RetargetEngine, SpringBoneSolver, PropManager, GifExporter
│   ├── i18n/                       # Full EN / ZH / JA / KO UI dictionary + 145 student, academy & variant names
│   ├── services/                   # Live Wiki API loader, IndexedDB LRU cache, jointLoader, furniturePack
│   ├── store/                      # Zustand multi-slot studio state & export session
│   └── workers/                    # Off-thread gifenc GIF encoder & fflate PNG ZIP bundler
├── tools/
│   └── README-furniture-extract.md # Cafe Furniture Interaction Pack format & extraction guide
└── vite.config.ts                  # Vite + Tailwind v4 + BASE_PATH + /api/joint/* Brotli proxy
```

</details>

---

## 🙏 Credits & Disclaimer

- **3D Student Models & Wiki Viewer Reference:** [`bluearchive.wiki`](https://bluearchive.wiki/wiki/Models), [`lihaohong6/BlueArchiveModels`](https://github.com/lihaohong6/BlueArchiveModels), and [`lihaohong6/MirahezeDevScripts`](https://github.com/lihaohong6/MirahezeDevScripts)
- **Joint Victory Formations & Animation Survey Reference:** [`dxsworks/SD_archive`](https://github.com/dxsworks/SD_archive)
- **Core Libraries:** [Three.js](https://threejs.org/), [React](https://react.dev/), [Zustand](https://zustand-demo.pmnd.rs/), [gifenc](https://github.com/mattdesl/gifenc), [fflate](https://github.com/101arrowz/fflate), [Lucide](https://lucide.dev/)

> **Disclaimer:** This is an unofficial, non-commercial fan-made web tool and is not affiliated with NEXON Games or Yostar. All *Blue Archive* characters, 3D models, and animations belong to their respective copyright holders. No copyrighted game model binaries are stored in this repository.

## 📄 License

Released under the [MIT License](LICENSE).
