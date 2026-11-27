<div align="center">

<img src="public/halo.svg" alt="Kivotos Rig Studio 헤일로 엠블럼" width="64" height="64" />

# KIVOTOS RIG STUDIO

**블루 아카이브 3D SD 학생 크로스 리타게팅(본 스왑) · 소품 및 가구 상호작용 · 멀티 슬롯 합동 승리 캐스트 교체 · 원본 해상도 투명 GIF 스튜디오**

<p>
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <strong>한국어</strong>
</p>

<p>
  <a href="https://ryujou.github.io/kivotos-rig-studio/"><img src="https://img.shields.io/badge/Live_Demo-GitHub_Pages-00A2FF?style=flat-square&logo=githubpages&logoColor=white" alt="라이브 데모" /></a>
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=0F1B2D" alt="React 19" />
  <img src="https://img.shields.io/badge/Three.js-WebGL2-000000?style=flat-square&logo=threedotjs&logoColor=white" alt="Three.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Zero_Model_Storage-Wiki_%EC%8B%A4%EC%8B%9C%EA%B0%84_%EC%97%B0%EB%8F%99-0FA968?style=flat-square" alt="Zero Model Storage" />
  <img src="https://img.shields.io/badge/i18n-%ED%95%9C_%7C_%E4%B8%AD_%7C_%E6%97%A5_%7C_EN-6366F1?style=flat-square" alt="4개 국어 지원" />
  <img src="https://img.shields.io/badge/License-MIT-334155?style=flat-square" alt="MIT License" />
</p>

<p>
  <strong>👉 <a href="https://ryujou.github.io/kivotos-rig-studio/">브라우저에서 바로 체험하기 (GitHub Pages)</a></strong>
</p>

<br />

<img src="docs/media/hero-light.png" alt="Kivotos Rig Studio — 간결해진 SCHALE 라이트 워크벤치" width="960" />

</div>

---

## ✨ 주요 기능

- **모델 무저장 · 위키 실시간 연동 (저장소 내 `.glb` 0개)** — [`bluearchive.wiki`](https://bluearchive.wiki/wiki/Models)의 `Module:ModelViewer/data.json`에서 최신 145명 학생 / 289개 모델 카탈로그를 직접 스트리밍하며 브라우저 IndexedDB LRU 캐시에 자동 보관합니다.
- **직관적인 「대상 선택 → 카드 클릭」 및 초고속 학생 필터링** — 상단에서 **`액터 A`** 또는 **`모션 B`** 를 선택한 뒤 학생 카드 전체를 한 번만 클릭하면 즉시 적용됩니다. `/` 키로 4개 국어 즉시 검색, **145명 전체 공식 학원 필터**, 의상·소품 태그, **최근 선택** 바를 지원합니다.
- **듀얼 리그 월드 공간 스켈레톤 리타게팅** — 어떤 학생 A에게도 어떤 학생 B의 모션을 자연스럽게 적용합니다. 바인드 포즈 정규화 월드 쿼터니언 전송, `CUBICSPLINE` 보간, 6단계 전차 포탑 계층, 눈 델타 전송 및 `Mouth_XXX` 모프 폴백을 완벽 지원합니다.
- **단계적 공개(Progressive Disclosure) 조정 패널 & Verlet 스프링 물리** — 자주 쓰는 핵심 토글(`신장 비례 / 소품 잠금`, `표정 동기화`, `머리카락·치마 물리`, `좌우 반전`)은 바로 보이고, **7부위 믹서**·**커스텀 본 매핑＋스켈레톤**·**3D 기즈모**는 접이식 섹션에 깔끔히 정돈되어 있습니다.
- **217개 모델 내장 소품·탈것 연동 & 카페 가구 팩 프로토콜** — 키보드·전차·푸드바이크·비치체어·악보 등 217개 모델의 내장 소품을 개별 제어하며 **A / B / C 무기 매트릭스**와 외부 **카페 가구 상호작용 팩**(`.glb` / `.zip` + `pack.json`) 드래그 앤 드롭을 지원합니다.
- **공식 16종 2~4인 합동 승리 포즈 & 원클릭 배역 교체** — 16개 공식 합동 승리 조합(및 토라마루 전차·메이드 쌍둥이 EX·방과후 디저트부 4인 밴드)을 정확한 좌표와 `시작 → 종료` 연결로 재생하며 모든 슬롯을 원하는 학생으로 즉시 교체할 수 있습니다.
- **프레임 정밀 · 원본 해상도 투명 GIF / PNG ZIP / WebM 내보내기** — `1:1` 정사각형 뷰파인더가 클립 전체 구간(헤일로·긴 무기 포함)을 자동 프레이밍하며 기본 **원본 해상도(1:1 DPR)**와 섬세한 25% 외곽선, 깔끔한 투명 GIF를 출력합니다.
- **모던 SCHALE UI & 한/중/일/영 4개 국어** — 슬롯 바를 통합한 단일 상단 바, 픽셀 정밀 커스텀 포인터 타임라인, **SCHALE 라이트 / Studio 다크** 테마, 4개 국어 완전 현지화.

---

## 🎬 쇼케이스

<table>
  <tr>
    <td width="50%" align="center">
      <img src="docs/media/showcase-keyboard.png" alt="학원 필터로 아이리를 검색하고 드레스 히나가 키보드를 연주하는 장면" /><br />
      <sub><strong>학원 빠른 필터 + 악기 연동</strong> · 히나(드레스) ← 아이리(밴드) <code>NonWeapon_Keyboard</code></sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/media/showcase-tank.png" alt="유우카와 노아가 토라마루 전차에 탑승한 장면" /><br />
      <sub><strong>2슬롯 전차 배역 교체</strong> · 유우카 &amp; 노아 토라마루 탑승 (포탑 소켓 추적)</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="docs/media/showcase-duo-victory.png" alt="아루와 무츠키 합동 승리 포즈와 1:1 원본 뷰파인더" /><br />
      <sub><strong>합동 승리 + 자동 1:1 원본 뷰파인더</strong> · 아루 &amp; 무츠키 · <code>1468×1468</code></sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/media/showcase-dark-ja.png" alt="Studio 다크 테마와 다국어 인터페이스" /><br />
      <sub><strong>Studio 다크 모드 + 4개 국어 UI</strong> · 한 / 中 / 日 / EN 원클릭 전환</sub>
    </td>
  </tr>
</table>

<div align="center">
  <img src="docs/media/demo-duo-transparent.gif" alt="실제 내보낸 아루와 무츠키 합동 승리 투명 GIF" width="320" /><br />
  <sub><strong>실제 프레임 정밀 투명 GIF 결과물</strong> · 아루 &amp; 무츠키 합동 승리 (25% 외곽선, 헤일로 테두리 제거, 깔끔한 투명 매트)</sub>
</div>

---

## 🚀 빠른 시작

```bash
git clone https://github.com/ryujou/kivotos-rig-studio.git
cd kivotos-rig-studio
npm install
npm run dev
```

브라우저에서 **`http://localhost:5173`** 에 접속하면 바로 시작됩니다. 단축키: `/` 검색 포커스 · `Space` 재생/일시정지 · `←` / `→` 1프레임 이동 · 좌클릭 회전 · 우클릭 이동 · 스크롤 줌.

---

## 🪑 카페 가구 팩 & ☁️ GitHub Pages 자동 배포

- **가구 팩 규격:** [tools/README-furniture-extract.md](tools/README-furniture-extract.md)
- **GitHub Pages 배포:** [.github/workflows/deploy-pages.yml](.github/workflows/deploy-pages.yml) 를 통해 `main` 푸시 시 **`https://ryujou.github.io/kivotos-rig-studio/`** 에 자동 빌드·배포됩니다. 정적 사이트에서 공식 16종 `.joint.br` 합동 승리를 사용하려면 **「합동 → 오프라인 파일 / 프록시」** 에 파일을 드롭하거나 동봉된 [deploy/cloudflare-worker.js](deploy/cloudflare-worker.js) URL을 입력하세요.

---

## 🙏 크레딧 & 면책 조항

- **3D 모델 소스:** [`bluearchive.wiki`](https://bluearchive.wiki/wiki/Models), [`lihaohong6/BlueArchiveModels`](https://github.com/lihaohong6/BlueArchiveModels), [`lihaohong6/MirahezeDevScripts`](https://github.com/lihaohong6/MirahezeDevScripts)
- **합동 승리·애니메이션 조사 참고:** [`dxsworks/SD_archive`](https://github.com/dxsworks/SD_archive)

> **면책 조항:** 본 프로젝트는 비공식·비영리 팬 메이드 웹 도구이며 NEXON Games 및 Yostar와 관련이 없습니다. 본 저장소에는 게임 모델 바이너리가 전혀 포함되어 있지 않습니다.

## 📄 라이선스

[MIT License](LICENSE)
