import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { elemBadge } from './atlasCard.js'

/**
 * Atlas 款式「角色材料卡」（1920×1080，四栏：突破 / 天赋 / Lv80 / A1-E8-Q8）。
 *
 * 为什么需要它：Atlas 原插件的材料图是**官方攻略图**，但上游 2023 年就停更，
 * 新角色（奥黛塔、沃雅妮莎…）没有图 → `#XXX材料` 静默无反应。
 * 这里按 Atlas 的排版自己画一张，等上游出图后会自动让位（见 materialFallback）。
 *
 * 数据来源：
 *   · 突破材料（含每一级明细）= 米游社观测枢词条页 `role_ascension`（本地有缓存）
 *   · 材料正名/称号/星级/元素/立绘 = 本地 miao-plugin `meta-gs/character/<名>/`
 *   · 材料图标 = miao `meta-gs/material/<类>/<名>.webp`，缺的按观测枢图标 URL 下载一次
 *   · 天赋书周几 = miao `meta-gs/material/daily.js`
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(__dirname, '..')
const MIAO = path.resolve(__dirname, '..', '..', 'miao-plugin', 'resources', 'meta-gs')
const MIAO_COMMON = path.resolve(__dirname, '..', '..', 'miao-plugin', 'resources', 'common')
const ICON_CACHE = path.join(PLUGIN_ROOT, 'resources', 'obc', 'material-icons')

/** 五星角色的天赋材料标准量（官方一致，与 Atlas 材料图相同） */
const TALENT_5 = {
  mora: 4957500,
  weekly: 18,
  crown: 3,
  books: [9, 63, 114],
  normal: [18, 66, 93],
  lv80Weekly: 4,
  lv80Books: [6, 42, 20],
  lv80Normal: [12, 44, 20]
}

const DAY_LABEL = { 1: '周一四日', 2: '周二五日', 3: '周三六日' }

function readJson (file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    return null
  }
}

/** 读 miao 的角色元数据（没有就返回 null） */
export function loadCharMeta (name) {
  const file = path.join(MIAO, 'character', name, 'data.json')
  const data = readJson(file)
  if (!data || !data.materials) return null
  return {
    ...data,
    splash: path.join(MIAO, 'character', name, 'imgs', 'splash.webp'),
    card: path.join(MIAO, 'character', name, 'imgs', 'card.webp')
  }
}

/** 天赋书属于哪一组（1=周一四日） */
export function talentDayGroup (talentName) {
  const raw = String(talentName || '')
  const matched = raw.match(/「(.+?)」/)
  const key = matched ? matched[1] : raw
  const daily = path.join(MIAO, 'material', 'daily.js')
  try {
    const text = fs.readFileSync(daily, 'utf8')
    const groups = [...text.matchAll(/(\d):\s*\[([^\]]+)\]/g)]
    for (const [, day, body] of groups) {
      if (body.includes(`"${key}"`)) return Number(day)
    }
  } catch (e) { /* 读不到就不标 */ }
  return 0
}

/** 找本地 miao 材料图标；找不到返回 '' */
function miaoIcon (kind, name) {
  const file = path.join(MIAO, 'material', kind, `${name}.webp`)
  return fs.existsSync(file) ? file : ''
}

async function download (url, name) {
  try {
    fs.mkdirSync(ICON_CACHE, { recursive: true })
    const ext = (url.match(/\.(png|jpg|jpeg|webp)(\?|$)/i) || [])[1] || 'png'
    const file = path.join(ICON_CACHE, `${name}.${ext}`)
    if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    if (!res.ok) return ''
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 500) return ''
    fs.writeFileSync(file, buf)
    return file
  } catch (e) {
    return ''
  }
}

/** 解析观测枢 role_ascension：total=1→90 汇总，lv80=20~80 各级相加 */
export function parseAscension (entryPage) {
  const modules = entryPage?.modules || []
  const mod = modules.find((m) => m?.name === '角色突破')
  if (!mod) return null
  const comp = (mod.components || [])[0]
  if (!comp) return null
  let payload
  try {
    payload = JSON.parse(comp.data)
  } catch (e) {
    return null
  }
  const tabs = payload?.list || []
  const total = tabs.find((t) => String(t.tab_name || '').includes('1级'))?.materials || []
  const lv80 = {}
  for (const tab of tabs) {
    // 「Lv80」= 升到 80 级为止，所以只累加 20/40/50/60/70 五档，
    // 不含 80级突破那一档（那是 80→90 的部分，算进去就变成满级总量了）
    if (!/^(20|40|50|60|70)级/.test(String(tab.tab_name || ''))) continue
    for (const m of tab.materials || []) {
      const key = m.nickname
      lv80[key] = (lv80[key] || 0) + Number(m.amount || 0)
    }
  }
  return {
    total: total.map((m) => ({ name: m.nickname, count: m.amount, url: m.img })),
    lv80
  }
}

function cell (name, countOrText, iconPath, { dayLabel = '', sub = '' } = {}) {
  return { name, count: countOrText, icon: iconPath, dayLabel, sub }
}

/** 把本地文件转成浏览器可读的 file:// URL */
function fileUrl (p) {
  if (!p) return ''
  return 'file:///' + p.replace(/\\/g, '/').replace(/^\//, '')
}

/**
 * 组装四栏数据。
 * @param {object} entry 观测枢索引条目（name/star/icon/desc）
 * @param {object} meta miao 角色元数据（loadCharMeta 的结果）
 * @param {object} asc parseAscension 的结果
 */
export async function buildMaterialCard (entry, meta, asc) {
  if (!meta || !asc || !asc.total?.length) return null
  // 三星/四星角色也出卡：天赋材料量与五星完全相同（书 9-63-114 / 掉落 18-66-93 / 周本 18 / 皇冠 3），
  // 只有「突破」随星级不同，而突破数量取的是观测枢逐级明细，本来就是准的
  if (Number(meta.star || entry?.star || 0) < 3) return null

  const mats = meta.materials || {}
  const t = TALENT_5

  // 图标缓存：先用 miao 本地，再按观测枢 URL 下
  const iconOf = async (name, kind, url) => {
    const local = miaoIcon(kind, name)
    if (local) return local
    if (url) return await download(url, name)
    return ''
  }

  const byName = new Map(asc.total.map((m) => [m.name, m]))
  // 三档怪物掉落：观测枢里数量正好是 18/30/36 的那三条（比按名字猜前缀稳）
  const normalNames = [18, 30, 36]
    .map((n) => (asc.total.find((m) => Number(m.count) === n) || {}).name)
    .filter(Boolean)

  // ---- 第一栏：突破材料（含摩拉与经验书，按观测枢真实数量）----
  const colBreak = []
  for (const item of asc.total) {
    const kind = item.name === '摩拉' ? 'other' : (mats.gem && item.name.startsWith(mats.gem) ? 'gem' : '')
    colBreak.push(cell(item.name, Number(item.count).toLocaleString('en-US'), await iconOf(item.name, kind, item.url)))
  }
  const heroExp = byName.get('大英雄的经验')
  if (!heroExp) {
    const url = 'https://uploadstatic.mihoyo.com/ys-obc/2020/07/20/15568211/d50fb37e3954b2b7105c61cf8f442c6e_7679619291811796065.png'
    colBreak.push(cell('大英雄的经验', '419', await iconOf('大英雄的经验', 'other', url)))
  }

  // ---- 第二栏：天赋材料 A10-E10-Q10（五星标准量 + miao 正名）----
  const talentBook = mats.talent || ''
  const bookBase = talentBook.replace(/的(教导|指引|哲学)$/, '')
  const dayGroup = talentDayGroup(talentBook)
  const dayLabel = DAY_LABEL[dayGroup] || ''
  const moraIcon = await iconOf('摩拉', 'other', byName.get('摩拉')?.url || '')
  const crownIcon = await iconOf('智识之冕', 'other',
    'https://uploadstatic.mihoyo.com/ys-obc/2020/11/11/4820086/0a91dd656723e2e6ff33ef0942720a8c_2163581096002798300.jpg')
  const weeklyIcon = await iconOf(mats.weekly || '', 'weekly', '')
  const normalIcon = await iconOf(mats.normal || '', 'normal', '')

  const colTalent = [
    cell('摩拉', t.mora.toLocaleString('en-US'), moraIcon),
    cell(mats.weekly || '周本材料', String(t.weekly), weeklyIcon),
    cell('智识之冕', String(t.crown), crownIcon),
    cell(`${bookBase}的教导`, String(t.books[0]), await iconOf(`${bookBase}的教导`, 'talent', ''), { dayLabel }),
    cell(`${bookBase}的指引`, String(t.books[1]), await iconOf(`${bookBase}的指引`, 'talent', ''), { dayLabel }),
    cell(`${bookBase}的哲学`, String(t.books[2]), await iconOf(`${bookBase}的哲学`, 'talent', ''), { dayLabel }),
    cell(normalNames[0] || mats.normal || '怪物掉落', String(t.normal[0]),
      await iconOf(normalNames[0] || mats.normal || '', 'normal', '')),
    cell(normalNames[1] || mats.normal || '怪物掉落', String(t.normal[1]),
      await iconOf(normalNames[1] || mats.normal || '', 'normal', '')),
    cell(normalNames[2] || mats.normal || '怪物掉落', String(t.normal[2]),
      await iconOf(normalNames[2] || mats.normal || '', 'normal', ''))
  ]

  // ---- 第三栏：Lv80（观测枢 20~80 级相加）----
  const colLv80 = []
  const gem = mats.gem || ''
  const lv80Gem = ['碎屑', '断片', '块', ''].map((suf) => {
    const key = gem + suf
    return asc.lv80[key] || 0
  })
  colLv80.push(cell(mats.specialty || '特产', String(asc.lv80[mats.specialty] || 0),
    await iconOf(mats.specialty || '', 'specialty', byName.get(mats.specialty)?.url || '')))
  colLv80.push(cell(mats.boss || 'BOSS材料', String(asc.lv80[mats.boss] || 0),
    await iconOf(mats.boss || '', 'boss', byName.get(mats.boss)?.url || '')))
  if (normalNames.length === 3) {
    colLv80.push(cell('掉落系列', normalNames.map((n) => {
      const hit = asc.total.find((m) => m.name === n)
      return hit ? asc.lv80[n] : 0
    }).join('/'), await iconOf(normalNames[2], 'normal', '')))
  }
  colLv80.push(cell('晶石系列', lv80Gem.join('/'), await iconOf(gem + '断片', 'gem', '')))

  // ---- 第四栏：A1-E8-Q8 ----
  const colTalent80 = [
    cell(mats.weekly || '周本材料', String(t.lv80Weekly), weeklyIcon),
    cell(bookBase, t.lv80Books.join('/'), await iconOf(`${bookBase}的指引`, 'talent', ''), { dayLabel }),
    cell('掉落系列', t.lv80Normal.join('/'), normalIcon)
  ]

  return {
    name: meta.name || entry?.name || '',
    title: meta.title || '',
    star: Number(meta.star || 5),
    elem: meta.elem || '',
    splash: meta.splash,
    cardImg: meta.card,
    elemIcon: path.join(MIAO_COMMON, 'bg', `talent-${meta.elem || 'cryo'}.webp`),
    elemBg: path.join(MIAO_COMMON, 'bg', `bg-${meta.elem || 'cryo'}.webp`),
    talentBg: path.join(MIAO_COMMON, 'bg', `talent-${meta.elem || 'cryo'}.webp`),
    cols: {
      break: colBreak,
      talent: colTalent,
      lv80: colLv80,
      talent80: colTalent80
    }
  }
}

function renderCell (c, small = false) {
  const icon = fileUrl(c.icon)
  return `<div class="cell${small ? ' cell-s' : ''}">
  <div class="cell-name">${c.name}${c.dayLabel ? `<span class="day">${c.dayLabel}</span>` : ''}</div>
  ${icon ? `<div class="cell-icon"><img src="${icon}" alt=""></div>` : '<div class="cell-icon cell-icon-empty"></div>'}
  <div class="cell-count">${c.count}</div>
</div>`
}

/** 生成完整 HTML（自绘 Atlas 款式，1920×1080） */
export function materialHtml (data) {
  const stars = '★'.repeat(data.star)
  const bg = fileUrl(data.elemBg)
  const splash = fileUrl(data.splash)
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
body { width:1920px; height:1080px; font-family:"Microsoft YaHei","PingFang SC",sans-serif;
  background:#fbf6ec; overflow:hidden; position:relative; }
.art { position:absolute; left:0; top:0; width:520px; height:1080px; overflow:hidden;
  background:url("${bg}") center/cover no-repeat; }
.art::after { content:""; position:absolute; inset:0; background:linear-gradient(90deg, rgba(255,255,255,0) 62%, rgba(251,246,236,0.92) 100%); }
.art img { position:absolute; left:50%; bottom:-30px; height:1010px; transform:translateX(-50%); }
.right { position:absolute; left:520px; top:0; width:1400px; height:1080px; padding:30px 26px 20px 22px; }
.head { display:flex; align-items:center; gap:18px; margin-bottom:14px; }
.elem-icon { width:74px; height:74px; border-radius:14px; background:#fff; border:2px solid #d9cfe6; display:flex; align-items:center; justify-content:center; }
.elem-icon img { width:54px; height:54px; }
.title-wrap { flex:1; }
.stars { color:#ffb300; font-size:26px; letter-spacing:6px; line-height:1; margin-bottom:6px; }
.name { font-size:56px; font-weight:800; color:#4a3a25; letter-spacing:2px; }
.by { font-size:15px; color:#9a8a72; text-align:right; align-self:flex-end; padding-bottom:6px; }
.cols { display:flex; gap:14px; align-items:stretch; height:940px; }
.col { background:#fffdf8; border:2px solid #e6d7bd; border-radius:14px; padding:10px; overflow:hidden; display:flex; flex-direction:column; }
.col-break, .col-talent { width:470px; }
.col-lv80 { width:150px; }
.col-t80 { width:200px; }
.col-head { background:linear-gradient(90deg,#7d5fae,#9b7dc9); color:#fff; border-radius:9px;
  padding:9px 12px; display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
.col-head .h1 { font-size:25px; font-weight:700; letter-spacing:2px; }
.col-head .h2 { font-size:22px; font-weight:700; opacity:.95; }
.col-body { flex:1; display:flex; flex-wrap:wrap; gap:10px; align-content:flex-start; }
.col-lv80 .col-body, .col-t80 .col-body { justify-content:center; }
.cell { width:138px; }
.col-lv80 .cell, .col-t80 .cell { width:120px; }
.cell-name { font-size:18px; color:#3f3325; text-align:center; line-height:1.2; height:44px;
  display:flex; flex-direction:column; align-items:center; justify-content:center; font-weight:600; }
.cell-name .day { font-size:12px; color:#b07d2b; font-weight:400; margin-top:1px; }
.cell-icon { height:120px; display:flex; align-items:center; justify-content:center;
  background:#fff; border:1px dashed #d8c8e8; border-radius:8px; }
.cell-icon img { max-width:106px; max-height:106px; }
.cell-icon-empty { background:#f4eefb; }
.cell-count { background:linear-gradient(90deg,#8b6fbf,#a68bcf); color:#fff; font-size:21px; font-weight:700;
  text-align:center; border-radius:7px; padding:3px 0; margin-top:4px; }
</style></head>
<body>
  <div class="art">${splash ? `<img src="${splash}" alt="">` : ''}</div>
  <div class="right">
    <div class="head">
      <div class="elem-icon" style="border-color:${elemBadge(data.elem).color}">${elemBadge(data.elem).icon ? `<img src="${fileUrl(elemBadge(data.elem).icon)}" alt="">` : ''}</div>
      <div class="title-wrap">
        <div class="stars">${stars}</div>
        <div class="name">${data.title ? data.title + ' · ' : ''}${data.name}</div>
      </div>
      <div class="by">米游社观测枢</div>
    </div>
    <div class="cols">
      <div class="col col-break">
        <div class="col-head"><span class="h1">突破材料</span><span class="h2">Lv1&nbsp;→&nbsp;Lv90</span></div>
        <div class="col-body">${data.cols.break.map((c) => renderCell(c)).join('')}</div>
      </div>
      <div class="col col-talent">
        <div class="col-head"><span class="h1">天赋材料</span><span class="h2">A10-E10-Q10</span></div>
        <div class="col-body">${data.cols.talent.map((c) => renderCell(c)).join('')}</div>
      </div>
      <div class="col col-lv80">
        <div class="col-head"><span class="h1">Lv80</span></div>
        <div class="col-body">${data.cols.lv80.map((c) => renderCell(c, true)).join('')}</div>
      </div>
      <div class="col col-t80">
        <div class="col-head"><span class="h1">A1-E8-Q8</span></div>
        <div class="col-body">${data.cols.talent80.map((c) => renderCell(c, true)).join('')}</div>
      </div>
    </div>
  </div>
</body></html>`
}

/** 元素图标（走 Atlas 已有的元素图；没有就留空） */
export function elemIconPath (elem) {
  const file = path.join(MIAO_COMMON, 'bg', `talent-${elem || 'cryo'}.webp`)
  return fs.existsSync(file) ? file : ''
}

export const MATERIAL_ICON_CACHE = ICON_CACHE











