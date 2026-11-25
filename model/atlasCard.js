import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripTags } from './obcEntry.js'

/**
 * Atlas 款式的「图鉴卡」：角色 / 武器 / 圣遗物。
 *
 * 为什么要自己画：Atlas 原插件（图鉴 + 材料图）2023 年后就不维护了，
 * 新角色/新武器/新圣遗物永远不会有官方图。所以统一改成
 * 「扒米游社观测枢词条页 + 本地 miao 元数据 → 自己按 Atlas 的版式渲染」。
 *
 * 版式和材料卡同一套语言：米白底 + 紫色分节条 + 金色星级 + 圆角卡片。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(__dirname, '..')
const ICON_CACHE = path.join(PLUGIN_ROOT, 'resources', 'obc', 'material-icons')

/** 元素 → 展示名 + 主色 + 图标（图标借 genshin 插件里那份七元素 PNG） */
const ELEM_ICON_DIR = path.resolve(__dirname, '..', '..', 'genshin', 'resources', 'img', 'gacha', 'items')

export const ELEM = {
  pyro: { cn: '火', color: '#e8604c' },
  hydro: { cn: '水', color: '#4c9fe8' },
  anemo: { cn: '风', color: '#5fc9a8' },
  electro: { cn: '雷', color: '#9a72d8' },
  dendro: { cn: '草', color: '#7cb342' },
  cryo: { cn: '冰', color: '#6fc3e0' },
  geo: { cn: '岩', color: '#d9a441' }
}

/** 元素图标文件（genshin 插件里的 冰/火/水/雷/草/岩/风.png），没有返回空串 */
export function elemIconPath (elem) {
  const info = ELEM[elem]
  if (!info) return ''
  const file = path.join(ELEM_ICON_DIR, `${info.cn}.png`)
  return fs.existsSync(file) ? file : ''
}

export function elemBadge (elem) {
  const info = ELEM[elem] || { cn: '？', color: '#8e7cc3' }
  return { text: info.cn, color: info.color, icon: elemIconPath(elem) }
}

async function download (url, name) {
  if (!url) return ''
  try {
    fs.mkdirSync(ICON_CACHE, { recursive: true })
    const ext = (url.match(/\.(png|jpg|jpeg|webp)(\?|$)/i) || [])[1] || 'png'
    const safe = String(name).replace(/[\\/:*?"<>|]/g, '_')
    const file = path.join(ICON_CACHE, `${safe}.${ext}`)
    if (fs.existsSync(file) && fs.statSync(file).size > 800) return file
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return ''
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 400) return ''
    fs.writeFileSync(file, buf)
    return file
  } catch (e) {
    return ''
  }
}

function fileUrl (p) {
  if (!p) return ''
  return 'file:///' + p.replace(/\\/g, '/').replace(/^\//, '')
}

function moduleOf (page, name) {
  return (page?.modules || []).find((m) => m?.name === name)
}

function componentData (page, moduleName, index = 0) {
  const mod = moduleOf(page, moduleName)
  const comp = (mod?.components || [])[index]
  if (!comp) return null
  try {
    return typeof comp.data === 'string' ? JSON.parse(comp.data) : comp.data
  } catch (e) {
    return null
  }
}

/** 清洗观测枢富文本：去标签、压空白、截断 */
function plain (html, max = 300) {
  const text = stripTags(String(html || '')).replace(/\s+/g, ' ').trim()
  return text.length > max ? text.slice(0, max) + '…' : text
}

/** 从 base_info 里取某个 key 的纯文本 */
function baseInfoValue (page, keyWord) {
  const payload = componentData(page, '基础信息')
  for (const row of payload?.list || []) {
    if (String(row.key || '').includes(keyWord)) {
      const val = Array.isArray(row.value) ? row.value.join(' ') : String(row.value || '')
      return plain(val, 400)
    }
  }
  return ''
}

/** 观测枢 recommendation tables：角色推荐 / 武器推荐 / 圣遗物推荐 */
function recommendRows (page, moduleName = '搭配推荐') {
  const payload = componentData(page, moduleName)
  const rows = []
  for (const table of payload?.tables || []) {
    for (const row of table.row || []) {
      const cells = Array.isArray(row) ? row : []
      const nameHtml = cells[0] || ''
      const nameMatch = String(nameHtml).match(/>([^<>]{2,20})</g)
      const lastName = nameMatch ? nameMatch[nameMatch.length - 1].replace(/[<>]/g, '') : plain(nameHtml, 20)
      const iconMatch = String(nameHtml).match(/data-entry-img="([^"]+)"/)
      rows.push({
        tab: table.tab_name || '',
        name: lastName,
        icon: iconMatch ? iconMatch[1] : '',
        reason: plain(cells[cells.length - 1] || '', 120)
      })
    }
  }
  return rows.filter((r) => r.name)
}

// ============================================================ 圣遗物
export async function buildArtifactCard (entry, page) {
  if (!entry || !page) return null
  const pieces = []
  for (const slot of ['生之花', '死之羽', '时之沙', '空之杯', '理之冠']) {
    const payload = componentData(page, slot)
    if (!payload) continue
    const name = payload.name?.value?.[0] || payload.name || slot
    pieces.push({
      slot,
      name: typeof name === 'string' ? name : String(name),
      icon: await download(payload.icon_url, `${slot}_${entry.name}`),
      desc: plain(payload.desc?.value?.[0] || payload.desc || '', 90)
    })
  }
  const twoSet = baseInfoValue(page, '2件套') || baseInfoValue(page, '套装效果')
  const fourSet = baseInfoValue(page, '4件套')
  const rarity = baseInfoValue(page, '稀有度') || `${entry.star || 4}星`
  const recs = recommendRows(page).slice(0, 8)
  for (const rec of recs) {
    if (rec.icon) rec.iconFile = await download(rec.icon, `char_${rec.name}`)
  }
  return {
    kind: 'artifact',
    name: entry.name,
    star: Number(entry.star || 5),
    icon: await download(entry.icon, `artifact_${entry.name}`),
    rarity,
    twoSet,
    fourSet,
    pieces,
    recs
  }
}

// ============================================================ 武器
export async function buildWeaponCard (entry, page) {
  if (!entry || !page) return null
  const base = componentData(page, '') || {}
  const desc = componentData(page, '装备描述') || {}
  const growth = componentData(page, '成长数值') || {}
  const first = (growth.list || [])[0] || {}
  const attrs = []
  for (const row of first.attr || []) {
    const text = plain(Array.isArray(row.value) ? row.value.join(' ') : row.value, 120)
    if (text) attrs.push({ label: String(row.key || '').replace(/[:：]/g, '').trim(), text })
  }
  const recs = recommendRows(page, '推荐角色').slice(0, 8)
  for (const rec of recs) rec.iconFile = await download(rec.icon, `char_${rec.name}`)
  return {
    kind: 'weapon',
    name: entry.name,
    star: Number(base.star || entry.star || 4),
    category: base.category || '',
    image: await download(base.image || entry.icon, `weapon_${entry.name}`),
    attrs,
    effect: plain(desc.rich_text, 320),
    recs
  }
}

// ============================================================ 角色
export async function buildCharacterCard (entry, page, meta) {
  if (!entry || !page) return null
  const base = componentData(page, '基础信息') || {}
  const talent = componentData(page, '天赋') || {}
  const talents = []
  for (const tab of (talent.list || []).slice(0, 3)) {
    talents.push({
      name: tab.title || tab.tab_name || '',
      type: tab.tab_name || '',
      desc: plain(tab.desc, 120),
      icon: await download(tab.icon, `talent_${entry.name}_${tab.title || talents.length}`)
    })
  }
  const recWeapons = recommendRows(page, '推荐装备').filter((r) => r.tab.includes('武器')).slice(0, 4)
  const recArtifacts = recommendRows(page, '推荐装备').filter((r) => r.tab.includes('圣遗物')).slice(0, 4)
  for (const rec of [...recWeapons, ...recArtifacts]) {
    if (rec.icon) rec.iconFile = await download(rec.icon, `item_${rec.name}`)
  }
  const elem = elemBadge(meta?.elem || '')
  return {
    kind: 'character',
    name: entry.name,
    title: meta?.title || '',
    star: Number(meta?.star || base.star || 5),
    elem: meta?.elem || '',
    elemCn: elem.text,
    elemColor: elem.color,
    elemIcon: elem.icon,
    weaponType: ({ sword: '单手剑', claymore: '双手剑', polearm: '长柄武器', bow: '弓', catalyst: '法器' })[meta?.weapon] || '',
    splash: meta?.splash && fs.existsSync(meta.splash) ? meta.splash : '',
    face: await download(base.avatar_pc || entry.icon, `face_${entry.name}`),
    region: meta?.allegiance || '',
    desc: meta?.desc || '',
    talents,
    recWeapons,
    recArtifacts
  }
}

// ============================================================ 渲染
const CSS = `
* { margin:0; padding:0; box-sizing:border-box; }
body { width:1200px; font-family:"Microsoft YaHei","PingFang SC",sans-serif; background:#f1e7d3; color:#463823; }
.sheet { width:1200px; padding:26px 34px 34px; position:relative;
  background:#fbf6e8 radial-gradient(circle at 50% 0%, rgba(255,241,206,.55), rgba(255,255,255,0) 55%) no-repeat;
  border:3px solid #d9b96a;
  box-shadow:inset 0 0 0 6px #fbf6e8, inset 0 0 0 8px #e7cf94;
  overflow:hidden; }
.watermark { position:absolute; left:8px; top:150px; writing-mode:vertical-rl; font-size:62px; font-weight:800;
  letter-spacing:14px; color:rgba(190,150,70,.13); pointer-events:none; }
.logo { position:absolute; right:18px; top:10px; width:86px; opacity:.92; }
.head { text-align:center; padding:4px 96px 16px; border-bottom:3px double #d9b96a; margin-bottom:20px;
  position:relative; }
.head.head-left { text-align:left; padding-left:104px; padding-right:120px; }
.head .elem-ico { position:absolute; left:0; top:26px; width:78px; height:78px; border-radius:50%;
  background:#fffdf6; border:3px solid #d9b96a; display:flex; align-items:center; justify-content:center;
  box-shadow:0 2px 8px rgba(150,110,40,.18); }
.head .elem-ico img { width:54px; height:54px; }
.head .t .stars { color:#e0a92a; font-size:24px; letter-spacing:6px; line-height:1;
  text-shadow:0 1px 0 #fff8e0; }
.head .t .title { font-family:"STZhongsong","SimSun",serif; font-size:47px; font-weight:700; color:#4d3d24;
  letter-spacing:3px; margin-top:8px; }
.head .t .sub { font-size:16px; color:#9a8660; margin-top:6px; letter-spacing:1px; }
.sec { margin-top:18px; border:2px solid #e2cd9c; border-radius:10px; background:rgba(255,253,246,.94);
  box-shadow:0 2px 6px rgba(150,110,40,.08); }
.sec-h { background:linear-gradient(90deg,#d8b25e,#b8892f); color:#fff; font-size:22px; font-weight:700;
  letter-spacing:4px; padding:8px 20px; display:flex; justify-content:space-between; align-items:center;
  border-radius:8px 8px 0 0; position:relative; text-shadow:0 1px 2px rgba(90,60,10,.25); }
.sec-h::after { content:''; position:absolute; left:0; bottom:-9px; border:9px solid transparent;
  border-top-color:#9c7024; border-left-color:#9c7026; }
.sec-h span.r { font-size:16px; font-weight:600; opacity:.95; letter-spacing:1px; }
.sec-b { padding:16px 18px; font-size:19px; line-height:1.6; }
.kv { display:flex; gap:12px; font-size:19px; padding:7px 0; border-bottom:1px dashed #e8d7b0; }
.kv:last-child { border-bottom:none; }
.kv b { color:#a6792a; min-width:104px; display:inline-block; font-weight:700; }
.row { display:flex; gap:14px; align-items:flex-start; padding:11px 0; border-bottom:1px dashed #e8d7b0; }
.row:last-child { border-bottom:none; }
.row .ico { width:68px; height:68px; flex:0 0 auto; border-radius:50%; background:#fffdf6;
  border:2px solid #d9b96a; display:flex; align-items:center; justify-content:center; overflow:hidden; }
.row .ico img { max-width:58px; max-height:58px; }
.row .txt { flex:1; }
.row .n { font-size:20px; font-weight:700; color:#4d3d24; }
.row .n em { font-style:normal; color:#b8892f; font-size:15px; margin-left:10px; }
.row .d { font-size:17px; color:#5c4d34; line-height:1.55; margin-top:4px; }
.chips { display:flex; flex-wrap:wrap; gap:12px; }
.chip { display:flex; align-items:center; gap:9px; background:#fffdf6; border:2px solid #e2cd9c;
  border-radius:30px; padding:4px 16px 4px 5px; font-size:17px; color:#4d3d24; }
.chip img { width:38px; height:38px; border-radius:50%; object-fit:cover; border:2px solid #d9b96a; }
.hero { display:flex; gap:20px; }
.hero .art { width:380px; flex:0 0 auto; border-radius:12px; overflow:hidden; border:3px solid #d9b96a;
  background:radial-gradient(circle at 50% 40%, #fffdf6, #efe0bd); display:flex; align-items:flex-end;
  justify-content:center; box-shadow:inset 0 0 22px rgba(190,150,70,.25); }
.hero .art img { width:100%; }
.hero .side { flex:1; }
.weapon-art { display:flex; gap:22px; align-items:flex-start; }
.weapon-art .box { width:230px; height:230px; flex:0 0 auto; border-radius:50%;
  background:radial-gradient(circle at 50% 45%, #fffdf6, #efe0bd); border:3px solid #d9b96a;
  display:flex; align-items:center; justify-content:center; box-shadow:inset 0 0 26px rgba(190,150,70,.28); }
.weapon-art .box img { max-width:200px; max-height:200px; }

.art2 { width:1080px; margin:0; position:relative; background:#fdfaf3; overflow:hidden; border:2px solid #e6d7bd; }
.art2-body { width:1080px !important; margin:0 !important; padding:0 !important; }
.art2 .band { height:206px; background:linear-gradient(180deg,#d3b26a,#c39f52); position:relative;
  display:flex; align-items:flex-start; justify-content:center; }
.art2 .band img.gl { width:290px; margin-top:16px; }
.art2 .band::after { content:''; position:absolute; left:0; right:0; bottom:0; height:26px;
  background:#fdfaf3; border-radius:50% 50% 0 0 / 100% 100% 0 0; }
.art2 .starline { position:relative; margin:-46px auto 0; width:640px; background:#fbf6ea;
  border:3px solid #e6d7bd; border-radius:40px; padding:8px 0; text-align:center;
  box-shadow:0 2px 8px rgba(150,110,40,.12); z-index:2; }
.art2 .starline .s { font-size:34px; letter-spacing:7px; }
.art2 .starline .s.gold { color:#ffc23c; }
.art2 .starline .s.violet { color:#b9a7ea; }
.art2 .starline .div { color:#c9b98f; font-size:26px; margin:0 8px; }
.art2 .name { text-align:center; font-family:"Source Han Serif SC","Noto Serif CJK SC","STZhongsong","SimSun",serif; font-size:60px; color:#5b4a33;
  letter-spacing:4px; margin-top:22px; }
.art2 .by { text-align:center; font-size:16px; color:#b3a07c; letter-spacing:6px; margin:8px 0 26px; }
.art2 .body { padding:0 26px 26px;
  background-image:repeating-linear-gradient(45deg, rgba(214,196,160,.18) 0 2px, transparent 2px 26px),
                   repeating-linear-gradient(-45deg, rgba(214,196,160,.18) 0 2px, transparent 2px 26px); }
.art2 .set { display:flex; align-items:flex-start; gap:14px; margin-bottom:18px; }
.art2 .pill { flex:0 0 auto; min-width:170px; text-align:center; color:#fff; font-size:32px; font-weight:800;
  border-radius:10px; padding:6px 16px; letter-spacing:1px; box-shadow:0 2px 6px rgba(120,90,30,.2); }
.art2 .pill.p2 { background:linear-gradient(90deg,#8d80c9,#7364bd); }
.art2 .pill.p4 { background:linear-gradient(90deg,#f3c74f,#e0a92a); }
.art2 .set .txt { flex:1; font-size:30px; line-height:1.5; color:#4a3a24; padding-top:4px; }
.art2 .piece { display:flex; align-items:center; gap:18px; margin-bottom:16px; padding:14px 18px;
  background:rgba(255,249,226,.92); border:2px solid #f0dfae; border-radius:8px; }
.art2 .piece.rev { flex-direction:row-reverse; }
.art2 .diamond { width:106px; height:106px; flex:0 0 auto; position:relative; display:flex;
  align-items:center; justify-content:center; }
.art2 .diamond::before { content:''; position:absolute; inset:6px; transform:rotate(45deg);
  border:3px solid #d9b96a; background:#fffdf6; border-radius:8px; }
.art2 .diamond img { width:82px; height:82px; position:relative; z-index:1; }
.art2 .piece .info { flex:1; text-align:left; }
.art2 .piece.rev .info { text-align:right; }
.art2 .piece .pn { font-size:30px; font-weight:700; color:#4a3a24; }
.art2 .piece .pd { font-size:25px; color:#6b5a40; margin-top:6px; line-height:1.5; }
.art2 .roles { margin-top:24px; text-align:center; }
.art2 .roles .rt { font-size:34px; color:#6b5a40; letter-spacing:6px; font-weight:700; }
.art2 .roles .rt i { font-style:normal; color:#c9a45a; margin:0 12px; }
.art2 .rgrid { display:flex; flex-wrap:wrap; justify-content:center; gap:22px; margin-top:20px; }
.art2 .rc { width:160px; text-align:center; }
.art2 .rc .cir { width:140px; height:140px; margin:0 auto; border-radius:50%; overflow:hidden;
  border:4px solid #dbe6f5; background:#eef3fb; box-shadow:0 2px 8px rgba(80,110,160,.15); }
.art2 .rc .cir img { width:100%; height:100%; object-fit:cover; }
.art2 .rc .nm { margin-top:-14px; position:relative; background:linear-gradient(90deg,#a99ae0,#8d80c9);
  color:#fff; font-size:20px; border-radius:6px; padding:4px 0; }
.art2 .foot2 { text-align:center; font-size:15px; color:#b3a07c; letter-spacing:3px; padding:14px 0 18px; }
.foot { margin-top:20px; text-align:center; font-size:14px; color:#a89268; letter-spacing:2px;
  border-top:1px solid #e2cd9c; padding-top:10px; }

`

/**
 * 抬头：Atlas 官方图那套——顶部「原神」标 + 居中金色星级 + 衬线大标题。
 * 角色卡额外带元素图标（genshin 插件里的七元素 PNG）。
 */
function headHtml (card, subtitle, elemIcon = '') {
  const stars = '★'.repeat(card.star || 4)
  return `<div class="head${elemIcon ? ' head-left' : ''}">
    ${elemIcon ? `<div class="elem-ico"><img src="${fileUrl(elemIcon)}" alt=""></div>` : ''}
    <div class="t">
      <div class="stars">${stars}</div>
      <div class="title">${card.name}</div>
      <div class="sub">${subtitle}</div>
    </div>
  </div>`
}

function section (title, body, right = '') {
  return `<div class="sec"><div class="sec-h"><span>${title}</span>${right ? `<span class="r">${right}</span>` : ''}</div>
    <div class="sec-b">${body}</div></div>`
}

function rowsHtml (items, render) {
  return items.map((it) => `<div class="row">
    <div class="ico">${it.icon ? `<img src="${fileUrl(it.icon)}">` : ''}</div>
    <div class="txt">${render(it)}</div>
  </div>`).join('')
}

function chipsHtml (items) {
  if (!items?.length) return '<div class="d">观测枢暂未给出推荐</div>'
  return `<div class="chips">${items.map((it) => `<div class="chip">
    ${it.iconFile ? `<img src="${fileUrl(it.iconFile)}">` : ''}<span>${it.name}</span></div>`).join('')}</div>`
}

export function cardHtml (card) {
  let body = ''
  if (card.kind === 'artifact') {
    body += headHtml(card, `${card.rarity} · 圣遗物套装`)
    body += section('套装效果', [
      card.twoSet ? `<div class="kv"><b>2 件套</b><span>${card.twoSet}</span></div>` : '',
      card.fourSet ? `<div class="kv"><b>4 件套</b><span>${card.fourSet}</span></div>` : ''
    ].join(''))
    body += section('套装部件', rowsHtml(card.pieces, (p) => `<div class="n">${p.name}<em>${p.slot}</em></div><div class="d">${p.desc}</div>`))
    body += section('可用角色', chipsHtml(card.recs))
  } else if (card.kind === 'weapon') {
    body += headHtml(card, card.category)
    body += `<div class="sec"><div class="sec-b" style="display:flex;gap:18px;align-items:flex-start">
      <div class="ico" style="width:150px;height:150px"><img src="${fileUrl(card.image)}" style="max-width:140px;max-height:140px"></div>
      <div style="flex:1">${card.attrs.map((a) => `<div class="kv"><b>${a.label}</b><span>${a.text}</span></div>`).join('')}</div>
    </div></div>`
    if (card.effect) body += section('武器效果', `<div style="font-size:18px;line-height:1.6">${card.effect}</div>`)
    body += section('推荐角色', chipsHtml(card.recs))
  } else {
    body += headHtml(card, [card.title, card.region].filter(Boolean).join(' · '), card.elemIcon || '')
    body += `<div class="sec"><div class="sec-b"><div class="hero">
      <div class="art">${card.splash ? `<img src="${fileUrl(card.splash)}">` : ''}</div>
      <div class="side">
        <div class="kv"><b>元素</b><span>${card.elemCn || '—'}</span></div>
        <div class="kv"><b>武器</b><span>${card.weaponType || '—'}</span></div>
        <div class="kv"><b>阵营</b><span>${card.region || '—'}</span></div>
        <div class="kv"><b>称号</b><span>${card.title || '—'}</span></div>
        <div style="font-size:17px;color:#5c4d3a;line-height:1.6;margin-top:10px">${card.desc || ''}</div>
      </div></div></div></div>`
    if (card.talents?.length) {
      body += section('天赋', rowsHtml(card.talents, (t) => `<div class="n">${t.name}<em>${t.type.replace(/（.*?）/, '')}</em></div><div class="d">${t.desc}</div>`))
    }
    if (card.recWeapons?.length) body += section('推荐武器', chipsHtml(card.recWeapons))
    if (card.recArtifacts?.length) body += section('推荐圣遗物', chipsHtml(card.recArtifacts))
  }
  // __OBC__ → resources/obc 的 file:// 前缀（纹理、logo 这些装饰件）
  const resUri = 'file:///' + path.join(PLUGIN_ROOT, 'resources', 'obc').replace(/\\/g, '/').replace(/^\//, '')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body><div class="sheet"><img class="logo" src="__OBC__/atlas-logo.png" alt=""><div class="watermark">${card.kind === 'character' ? '角色图鉴' : (card.kind === 'weapon' ? '武器图鉴' : '圣遗物图鉴')}</div>${body}<div class="foot">米游社观测枢</div></div></body></html>`
  return html.replace(/__OBC__/g, resUri)
}


/** 圣遗物海报（自绘，版式照 Atlas 的 artifact 长图） */
export function artifactPosterHtml (card) {
  const resUri = 'file:///' + path.join(PLUGIN_ROOT, 'resources', 'obc').replace(/\\/g, '/').replace(/^\//, '')
  const star = Number(card.star || 5)
  const stars = `<span class="s violet">${'★'.repeat(Math.max(0, star - 1))}${'☆'.repeat(Math.max(0, 5 - star))}</span>`
    + `<span class="div">/</span><span class="s gold">${'★'.repeat(star)}</span>`
  const sets = []
  if (card.twoSet) sets.push(`<div class="set"><div class="pill p2">2 件套</div><div class="txt">${card.twoSet}</div></div>`)
  if (card.fourSet) sets.push(`<div class="set"><div class="pill p4">4 件套</div><div class="txt">${card.fourSet}</div></div>`)
  const pieces = (card.pieces || []).map((p, i) => `<div class="piece${i % 2 ? ' rev' : ''}">
      <div class="diamond">${p.icon ? `<img src="${fileUrl(p.icon)}" alt="">` : ''}</div>
      <div class="info"><div class="pn">${p.name}</div><div class="pd">${p.desc}</div></div>
    </div>`).join('')
  const roles = (card.recs || []).map((r) => `<div class="rc">
      <div class="cir">${r.iconFile ? `<img src="${fileUrl(r.iconFile)}" alt="">` : ''}</div>
      <div class="nm">${r.name}</div>
    </div>`).join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body class="art2-body"><div class="art2">
  <div class="band"><img class="gl" src="__OBC__/atlas-genshin.png" alt=""></div>
  <div class="starline">${stars}</div>
  <div class="name">「${card.name}」</div>
  <div class="by">米游社观测枢 · ${card.rarity || ''}</div>
  <div class="body">
    ${sets.join('')}
    ${pieces}
    ${roles ? `<div class="roles"><div class="rt"><i>◆</i>可用角色<i>◆</i></div><div class="rgrid">${roles}</div></div>` : ''}
  </div>
  <div class="foot2">米游社观测枢</div>
</div></body></html>`.replace(/__OBC__/g, resUri)
}

export const ATLAS_ICON_CACHE = ICON_CACHE







