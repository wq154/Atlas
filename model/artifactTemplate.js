import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 圣遗物图鉴卡：按 Gemini 给的技术文档（750px 基准画布）1:1 还原配色与结构。
 *
 * 与文档的差异（都是必要的本地化）：
 *   · Google Fonts 引不了 → 换成 Windows 自带字体回退链（思源 → 华文中宋 → 宋体 / 雅黑）
 *   · Logo 用从 Atlas 官方图里抠出来的白色「原神」标（透明底）
 *   · 页脚走文档里的 SVG 弧形路径，文字改成「米游社观测枢」
 *   · body 宽度必须钉成 750，否则 Yunzai 截的是 body 元素，右侧会多出白边
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(__dirname, '..')
const RES_DIR = path.join(PLUGIN_ROOT, 'resources', 'obc')

function fileUrl (p) {
  if (!p) return ''
  return 'file:///' + String(p).replace(/\\/g, '/').replace(/^\//, '')
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@500;700;900&family=Noto+Serif+SC:wght@600;700;900&display=swap');
* { box-sizing:border-box; margin:0; padding:0; }
body { width:750px !important; margin:0 !important; padding:0 !important; background:#222;
  display:flex; justify-content:center;
  font-family:'Noto Sans SC','Source Han Sans SC','PingFang SC','Microsoft YaHei',sans-serif;
  -webkit-font-smoothing:antialiased; }
.card-container { width:750px; min-height:1230px; position:relative; overflow:hidden; padding-bottom:42px;
  background-color:#f4f4f6;
  background-image:
    linear-gradient(45deg, rgba(226,227,232,.45) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(226,227,232,.45) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(226,227,232,.45) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(226,227,232,.45) 75%);
  background-size:96px 96px;
  background-position:0 0, 0 48px, 48px -48px, -48px 0; }
.header-bg { position:absolute; top:-120px; left:-80px; right:-80px; height:390px;
  background:linear-gradient(180deg,#b89848 0%,#9c7e34 100%);
  border-bottom-left-radius:50% 130px; border-bottom-right-radius:50% 130px; z-index:1; }
.header-section { position:relative; z-index:2; padding-top:22px; display:flex; flex-direction:column;
  align-items:center; }
.genshin-logo { height:76px; margin-bottom:14px; display:flex; align-items:center; justify-content:center; }
.genshin-logo img { height:100%; object-fit:contain; filter:drop-shadow(0 2px 4px rgba(0,0,0,.15)); }
.title-banner { width:580px; height:158px; background:linear-gradient(180deg,#e7e4e2 0%,#dcd8d5 100%);
  border:5px solid #fff; border-radius:42px 42px 0 0; box-shadow:0 6px 18px rgba(0,0,0,.08);
  display:flex; flex-direction:column; align-items:center; padding-top:16px; position:relative;
  clip-path:path('M 0 42 Q 0 0 42 0 L 538 0 Q 580 0 580 42 L 580 132 Q 290 165 0 132 Z'); }
.rarity-pill { background:#fff; border-radius:999px; padding:4px 28px; display:inline-flex; align-items:center;
  gap:10px; box-shadow:0 2px 6px rgba(0,0,0,.04); margin-bottom:10px; }
.stars-group { display:flex; gap:5px; font-size:23px; line-height:1; }
.stars-purple { color:#8c7cd8; }
.stars-gold { color:#f6c33e; }
.rarity-slash { font-size:24px; font-weight:700; color:#6b635b; margin:0 2px; }
.set-title { font-family:'Noto Serif SC','Source Han Serif SC','STZhongsong','SimSun',serif; font-size:46px;
  font-weight:900; color:#5b5149; letter-spacing:2px; line-height:1.15; }
.designer-credit { margin-top:10px; width:340px; height:44px; }
.designer-credit text { dominant-baseline:middle; font-family:'Noto Serif SC','STZhongsong','SimSun',serif; font-size:16px; font-weight:700;
  fill:#5c534b; letter-spacing:2.2px; }
.effects-section { position:relative; z-index:2; padding:18px 40px 24px; display:flex; flex-direction:column; gap:20px; }
.effect-row { display:flex; align-items:flex-start; gap:16px; }
.piece-badge { flex-shrink:0; width:118px; height:46px; border-radius:6px; display:flex; align-items:center;
  justify-content:center; color:#fff; font-weight:700; box-shadow:0 2px 6px rgba(0,0,0,.08); }
.piece-badge.badge-2 { background-color:#9388d8; }
.piece-badge.badge-4 { background-color:#eed062; }
.piece-badge .num { font-family:'Noto Serif SC','STZhongsong','SimSun',serif; font-size:38px; line-height:1;
  margin-right:4px; margin-top:-2px; }
.piece-badge .label { font-size:21px; letter-spacing:1px; }
.effect-text { font-size:22px; font-weight:700; color:#4f463f; line-height:1.5; padding-top:5px; }
.pieces-section { position:relative; z-index:2; padding:0 38px; display:flex; flex-direction:column; gap:16px; }
.piece-item { display:flex; align-items:center; position:relative; height:88px; }
.piece-item.reverse { flex-direction:row-reverse; }
.piece-icon-wrapper { width:82px; height:82px; flex-shrink:0; position:relative; display:flex;
  align-items:center; justify-content:center; z-index:3; }
.diamond-frame { position:absolute; width:60px; height:60px;
  background:linear-gradient(135deg,#f3e4b2 0%,#d4b973 100%); border:2px solid #e9d69b;
  transform:rotate(45deg); box-shadow:0 2px 6px rgba(168,138,68,.25); }
.diamond-frame::after { content:''; position:absolute; inset:3px; border:1px solid rgba(255,255,255,.75); }
.piece-icon-wrapper img { position:relative; z-index:2; width:76px; height:76px; object-fit:contain;
  filter:drop-shadow(0 3px 4px rgba(0,0,0,.22)); }
.piece-desc-box { flex:1; height:76px; background:rgba(255,253,247,.92); border:1.5px solid #dec378;
  position:relative; display:flex; flex-direction:column; justify-content:center; padding:0 26px;
  margin-left:-14px; }
.piece-item.reverse .piece-desc-box { margin-left:0; margin-right:-14px; text-align:right; }
.piece-desc-box::after { content:''; position:absolute; inset:3px; border:1px solid #ead8a1; pointer-events:none; }
.piece-name { font-family:'Noto Serif SC','STZhongsong','SimSun',serif; font-size:20px; font-weight:900;
  color:#53483f; margin-bottom:4px; }
.piece-lore { font-size:16px; font-weight:700; color:#6a5e54; white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis; }
.characters-section { position:relative; z-index:2; margin-top:22px; padding:0 38px; }
.section-header { display:flex; align-items:center; justify-content:center; gap:24px; margin-bottom:20px; }
.section-title { font-family:'Noto Serif SC','STZhongsong','SimSun',serif; font-size:24px; font-weight:900;
  color:#6f665f; letter-spacing:2px; }
.ornament { width:24px; height:24px; position:relative; display:flex; align-items:center; justify-content:center; }
.ornament::before { content:''; width:16px; height:16px; border:2.5px solid #8c827a; transform:rotate(45deg); }
.ornament::after { content:''; position:absolute; width:7px; height:7px; background:#8c827a;
  transform:rotate(45deg); }
.ornament.left { border-right:2px solid #8c827a; padding-right:6px; }
.ornament.right { border-left:2px solid #8c827a; padding-left:6px; }
.char-grid { display:grid; grid-template-columns:repeat(5,1fr); gap:18px 16px; }
.char-card { display:flex; flex-direction:column; align-items:center; }
.char-avatar-ring { width:112px; height:112px; border-radius:50%; padding:3px; background:#fff;
  box-shadow:0 3px 8px rgba(0,0,0,.12); position:relative; z-index:2; }
.char-avatar-inner { width:100%; height:100%; border-radius:50%; overflow:hidden; background:#d8c8b8; }
.char-avatar-inner img { width:100%; height:100%; object-fit:cover; }
.char-name-tag { width:116px; height:30px; margin-top:-10px; background:linear-gradient(180deg,#9c92d8 0%,#867bc7 100%);
  border-radius:4px; color:#fff; font-size:17px; font-weight:700; letter-spacing:1px; display:flex;
  align-items:center; justify-content:center; position:relative; z-index:3; box-shadow:0 2px 5px rgba(0,0,0,.14); }
`

/** 把 obc 的卡数据渲染成 750px 圣遗物图鉴 HTML */
export function artifactCardHtml (card) {
  const logo = path.join(RES_DIR, 'atlas-genshin.png')
  const logoUrl = fs.existsSync(logo) ? fileUrl(logo) : ''
  const star = Number(card.star || 5)
  // 和 Atlas 一样显示「4★ / 5★」两档（圣遗物套装基本都有 4/5 星两种）
  const purple = Math.max(0, star - 1) || 4
  const gold = star || 5
  const effects = []
  if (card.twoSet) effects.push({ count: 2, cls: 'badge-2', desc: card.twoSet })
  if (card.fourSet) effects.push({ count: 4, cls: 'badge-4', desc: card.fourSet })
  const pieces = (card.pieces || []).map((p) => ({
    name: p.name,
    lore: p.desc || '',
    icon: fileUrl(p.icon)
  }))
  const chars = (card.recs || []).map((r) => ({ name: r.name, avatar: fileUrl(r.iconFile) }))

  const effHtml = effects.map((e) => `<div class="effect-row">
      <div class="piece-badge ${e.cls}"><span class="num">${e.count}</span><span class="label">件套</span></div>
      <div class="effect-text">${e.desc}</div>
    </div>`).join('')

  const pieceHtml = pieces.map((it, i) => `<div class="piece-item${i % 2 === 1 ? ' reverse' : ''}">
      <div class="piece-icon-wrapper"><div class="diamond-frame"></div>
        ${it.icon ? `<img src="${it.icon}" alt="">` : ''}</div>
      <div class="piece-desc-box"><div class="piece-name">${it.name}</div>
        <div class="piece-lore">${it.lore}</div></div>
    </div>`).join('')

  const charHtml = chars.map((c) => `<div class="char-card">
      <div class="char-avatar-ring"><div class="char-avatar-inner">
        ${c.avatar ? `<img src="${c.avatar}" alt="">` : ''}</div></div>
      <div class="char-name-tag">${c.name}</div>
    </div>`).join('')

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>${CSS}</style></head>
<body>
<div class="card-container">
  <div class="header-bg"></div>
  <header class="header-section">
    <div class="genshin-logo">${logoUrl ? `<img src="${logoUrl}" alt="GENSHIN IMPACT">` : ''}</div>
    <div class="title-banner">
      <div class="rarity-pill">
        <span class="stars-group stars-purple">${'★'.repeat(purple).split('').join(' ')}</span>
        <span class="rarity-slash">/</span>
        <span class="stars-group stars-gold">${'★'.repeat(gold).split('').join(' ')}</span>
      </div>
      <h1 class="set-title">「${card.name}」</h1>
    </div>
    <svg class="designer-credit" viewBox="0 0 340 40">
      <defs><path id="curvePath" d="M 15,12 Q 170,38 325,12" fill="transparent"/></defs>
      <text><textPath href="#curvePath" startOffset="50%" text-anchor="middle">米游社观测枢</textPath></text>
    </svg>
  </header>
  <section class="effects-section">${effHtml}</section>
  <section class="pieces-section">${pieceHtml}</section>
  <section class="characters-section">
    <div class="section-header"><div class="ornament left"></div>
      <h2 class="section-title">可用角色</h2><div class="ornament right"></div></div>
    <div class="char-grid">${charHtml}</div>
  </section>
</div>
</body></html>`
}

