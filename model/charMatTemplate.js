import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 角色培养材料图（1280×720）：照 Gemini 的《角色培养材料图鉴（七元素换肤版）》文档实现。
 *
 * 七元素主题由 `element`（pyro/hydro/anemo/electro/dendro/cryo/geo）驱动，
 * 左侧立绘底色、元素方块、四栏标题、数量胶囊、天赋书星期标签全部联动。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(__dirname, '..')

function fileUrl (p) {
  if (!p) return ''
  return 'file:///' + String(p).replace(/\\/g, '/').replace(/^\//, '')
}

/** 七元素图标（genshin 插件抽卡资源里的官方符号），模板里用 filter 染白 */
const ELEM_ICON_DIR = path.resolve(__dirname, '..', '..', 'genshin', 'resources', 'img', 'gacha', 'items')
const ELEM_CN = { pyro: '火', hydro: '水', anemo: '风', electro: '雷', dendro: '草', cryo: '冰', geo: '岩' }

function elemIcon (element) {
  const cn = ELEM_CN[element]
  if (!cn) return ''
  const file = path.join(ELEM_ICON_DIR, `${cn}.png`)
  return fs.existsSync(file) ? file : ''
}

const CSS = `
* { box-sizing:border-box; margin:0; padding:0; }
body { width:1280px !important; margin:0 !important; padding:0 !important; background:#1c1c1c;
  font-family:'Noto Sans SC','Source Han Sans SC','PingFang SC','Microsoft YaHei',sans-serif; }
.char-mat-card.el-dendro { --el-primary:#63a843; --el-dark:#4f8c33; --el-light:#7cc05c;
  --el-bg-grad:linear-gradient(180deg,#5da13e 0%,#6cb24b 50%,#549437 100%); --frame-line:#b6c4a4; --col-tint:#eef2e8; }
.char-mat-card.el-cryo { --el-primary:#5aa9c7; --el-dark:#458ea9; --el-light:#78c2de;
  --el-bg-grad:linear-gradient(180deg,#55a3c2 0%,#6eb8d4 50%,#4892b0 100%); --frame-line:#a7c5cf; --col-tint:#eaf2f5; }
.char-mat-card.el-hydro { --el-primary:#3b82c4; --el-dark:#2c68a3; --el-light:#589cdb;
  --el-bg-grad:linear-gradient(180deg,#377dbf 0%,#4d94d6 50%,#2d6ca8 100%); --frame-line:#a4bdd4; --col-tint:#e8eff6; }
.char-mat-card.el-pyro { --el-primary:#c95842; --el-dark:#a6412e; --el-light:#e0725c;
  --el-bg-grad:linear-gradient(180deg,#c4523d 0%,#d96955 50%,#ab4330 100%); --frame-line:#d4b0a8; --col-tint:#f5ecea; }
.char-mat-card.el-electro { --el-primary:#8c64b8; --el-dark:#704c99; --el-light:#a67fd1;
  --el-bg-grad:linear-gradient(180deg,#865eb3 0%,#9d75c9 50%,#6f4999 100%); --frame-line:#bfb2cf; --col-tint:#f0ecf5; }
.char-mat-card.el-anemo { --el-primary:#45a889; --el-dark:#32876c; --el-light:#61c4a5;
  --el-bg-grad:linear-gradient(180deg,#41a183 0%,#57ba9b 50%,#348a6f 100%); --frame-line:#a5c9be; --col-tint:#e8f3f0; }
.char-mat-card.el-geo { --el-primary:#c4983b; --el-dark:#a17927; --el-light:#deb254;
  --el-bg-grad:linear-gradient(180deg,#bf9336 0%,#d4a84c 50%,#a37b29 100%); --frame-line:#d4c5a3; --col-tint:#f5f1e6; }
.char-mat-card { width:1280px; height:720px; position:relative; overflow:hidden; display:flex; background-color:#f7f5ee; }
.left-hero-zone { width:422px; height:100%; position:relative; background:var(--el-bg-grad);
  flex-shrink:0; overflow:hidden; display:flex; align-items:center; justify-content:center; }
.hero-portrait { position:relative; z-index:2; width:108%; height:104%; object-fit:cover;
  object-position:center bottom; filter:drop-shadow(0 8px 18px rgba(0,0,0,.22)); }
.right-content-zone { flex:1; height:100%; position:relative; padding:16px 20px; display:flex;
  flex-direction:column; background:#f8f6ef; }
.decorative-border-outer { flex:1; border:2px solid var(--frame-line); border-radius:6px; padding:4px;
  display:flex; flex-direction:column; position:relative; }
.decorative-border-inner { flex:1; border:1.5px solid var(--frame-line); border-radius:4px;
  padding:14px 18px; display:flex; flex-direction:column; position:relative; }
.corner-gem { position:absolute; width:10px; height:10px; background:#f8f6ef;
  border:2px solid var(--frame-line); transform:rotate(45deg); z-index:5; }
.corner-gem.tl { top:-5px; left:-5px; } .corner-gem.tr { top:-5px; right:-5px; }
.corner-gem.bl { bottom:-5px; left:-5px; } .corner-gem.br { bottom:-5px; right:-5px; }
.hero-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; }
.hero-title-left { display:flex; align-items:center; gap:16px; }
.element-badge-box { width:82px; height:82px; margin-left:-24px; background:var(--el-primary);
  border-radius:0 14px 14px 0; display:flex; align-items:center; justify-content:center;
  box-shadow:0 4px 10px rgba(0,0,0,.14); flex-shrink:0; }
.element-badge-box img { width:56px; height:56px; object-fit:contain;
  filter:brightness(0) invert(1) drop-shadow(0 2px 3px rgba(0,0,0,.15)); }
.name-and-stars { display:flex; flex-direction:column; justify-content:center; }
.star-row { display:flex; gap:4px; color:#f4c030; font-size:24px; line-height:1; margin-bottom:4px; }
.hero-full-name { font-size:42px; font-weight:900; color:#2d2926; letter-spacing:1px; line-height:1.1; }
.columns-container { flex:1; display:grid; grid-template-columns:256px 256px 118px 118px; gap:11px; min-height:0; }
.mat-column { background:var(--col-tint); border-radius:8px; overflow:hidden; display:flex;
  flex-direction:column; border:1px solid rgba(0,0,0,.05); }
.col-top-bar { background:var(--el-primary); color:#fff; height:36px; padding:0 11px; display:flex;
  align-items:center; justify-content:space-between; font-size:16.5px; font-weight:900;
  letter-spacing:.5px; flex-shrink:0; }
.col-top-bar.center-only { justify-content:center; }
.col-sub-label { font-size:14.5px; font-weight:700; opacity:.96; }
.col-items-grid { flex:1; padding:9px; display:grid; gap:8px; align-content:stretch; grid-auto-rows:1fr; }
.col-items-grid.grid-3 { grid-template-columns:repeat(3,1fr); }
.col-items-grid.grid-1 { grid-template-columns:1fr; }
.item-card { background:#fff; border-radius:6px; padding:5px 4px; display:flex; flex-direction:column;
  align-items:center; justify-content:space-between; box-shadow:0 1px 3px rgba(0,0,0,.05); position:relative; }
.item-title { font-size:11.5px; font-weight:700; color:#2f2c28; text-align:center; line-height:1.15; word-break:break-all;
  display:flex; align-items:center; justify-content:center; min-height:27px; }
.item-icon-wrap { position:relative; width:46px; height:46px; display:flex; align-items:center; justify-content:center; }
.item-icon-wrap img { width:44px; height:44px; object-fit:contain; }
.book-day-badge { position:absolute; bottom:-2px; left:50%; transform:translateX(-50%); background:#d99b38;
  color:#fff; font-size:9.5px; font-weight:900; padding:0 4px; border-radius:2px; white-space:nowrap;
  line-height:1.25; box-shadow:0 1px 2px rgba(0,0,0,.25); }
.item-count-pill { width:96%; height:20px; background:var(--el-primary); color:#fff; border-radius:3px;
  font-size:12px; font-weight:900; display:flex; align-items:center; justify-content:center; letter-spacing:.2px;
  white-space:nowrap; overflow:hidden; }
.item-count-pill.long { font-size:9.5px; letter-spacing:0; padding:0 2px; }
`

function itemCard (it) {
  const name = String(it.name || '').replace(/^(.+?)(碎屑|断片|块)?$/, (m, a, b) => (b ? `${a}<br>${b}` : m))
  return `<div class="item-card">
    <div class="item-title">${name}</div>
    <div class="item-icon-wrap">${it.icon ? `<img src="${fileUrl(it.icon)}" alt="">` : ''}
      ${it.dayLabel ? `<span class="book-day-badge">${it.dayLabel}</span>` : ''}</div>
    <div class="item-count-pill${String(it.count).length >= 7 ? ' long' : ''}">${it.count}</div>
  </div>`
}

export function charMatHtml (data) {
  const el = ['pyro', 'hydro', 'anemo', 'electro', 'dendro', 'cryo', 'geo'].includes(data.element) ? data.element : 'dendro'
  const icon = elemIcon(el)
  const stars = '★'.repeat(Number(data.stars) >= 5 ? 5 : 4)
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>${CSS}</style></head>
<body>
  <div class="char-mat-card el-${el}">
    <aside class="left-hero-zone">
      ${data.portrait ? `<img class="hero-portrait" src="${fileUrl(data.portrait)}" alt="">` : ''}
    </aside>
    <main class="right-content-zone">
      <div class="decorative-border-outer">
        <div class="corner-gem tl"></div><div class="corner-gem tr"></div>
        <div class="corner-gem bl"></div><div class="corner-gem br"></div>
        <div class="decorative-border-inner">
          <header class="hero-header">
            <div class="hero-title-left">
              <div class="element-badge-box">${icon ? `<img src="${fileUrl(icon)}" alt="">` : ''}</div>
              <div class="name-and-stars">
                <div class="star-row">${stars}</div>
                <h1 class="hero-full-name">${data.fullName}</h1>
              </div>
            </div>
          </header>
          <section class="columns-container">
            <div class="mat-column">
              <div class="col-top-bar"><span>突破材料</span><span class="col-sub-label">Lv1→Lv90</span></div>
              <div class="col-items-grid grid-3">${(data.asc || []).map(itemCard).join('')}</div>
            </div>
            <div class="mat-column">
              <div class="col-top-bar"><span>天赋材料</span><span class="col-sub-label">A10-E10-Q10</span></div>
              <div class="col-items-grid grid-3">${(data.talent || []).map(itemCard).join('')}</div>
            </div>
            <div class="mat-column">
              <div class="col-top-bar center-only"><span>Lv80</span></div>
              <div class="col-items-grid grid-1">${(data.lv80 || []).map(itemCard).join('')}</div>
            </div>
            <div class="mat-column">
              <div class="col-top-bar center-only"><span>A1-E8-Q8</span></div>
              <div class="col-items-grid grid-1">${(data.tal8 || []).map(itemCard).join('')}</div>
            </div>
          </section>
        </div>
      </div>
    </main>
  </div>
</body></html>`
}



