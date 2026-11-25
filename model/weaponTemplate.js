import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 武器图鉴卡（1280×720）：照 Gemini 的《武器图鉴渲染模板》文档实现。
 *
 * 本地化：Google Fonts 换成 Windows 自带字体回退；图片全部走本地 miao / 观测枢 缓存。
 * 数据：miao `meta-gs/weapon/<类型>/<名>/data.json`（星级/基础攻击/副属性/被动文案）
 *      + 观测枢词条页（突破素材的数量与图标、推荐角色）。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = path.resolve(__dirname, '..')
const MIAO = path.resolve(__dirname, '..', '..', 'miao-plugin', 'resources', 'meta-gs')
const ICON_CACHE = path.join(PLUGIN_ROOT, 'resources', 'obc', 'material-icons')
const WEAPON_TYPES = { sword: '单手剑', claymore: '双手剑', polearm: '长柄武器', bow: '弓', catalyst: '法器' }

function fileUrl (p) {
  if (!p) return ''
  return 'file:///' + String(p).replace(/\\/g, '/').replace(/^\//, '')
}

function findWeaponDir (name) {
  try {
    for (const type of fs.readdirSync(path.join(MIAO, 'weapon'))) {
      const dir = path.join(MIAO, 'weapon', type, name)
      if (fs.existsSync(path.join(dir, 'data.json'))) return { type, dir }
    }
  } catch (e) { /* 忽略 */ }
  return null
}

async function download (url, name) {
  if (!url) return ''
  try {
    fs.mkdirSync(ICON_CACHE, { recursive: true })
    const ext = (url.match(/\.(png|jpg|jpeg|webp)(\?|$)/i) || [])[1] || 'png'
    const safe = String(name).replace(/[\\/:*?"<>|]/g, '_')
    const file = path.join(ICON_CACHE, `wp_${safe}.${ext}`)
    if (fs.existsSync(file) && fs.statSync(file).size > 500) return file
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

/** 只保留整数/一位小数 */
function num (v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

const BONUS_LABEL = {
  cdmg: '暴击伤害', cpct: '暴击率', atkPct: '攻击力', hpPct: '生命值', defPct: '防御力',
  recharge: '元素充能效率', mastery: '元素精通', phy: '物理伤害加成', er: '元素充能效率'
}

/** 精炼阶数文案：把 $[0] 换成 12%/15%/… 并用 gold 高亮 */
function fillAffix (affixData) {
  const text = String(affixData?.text || '')
  const datas = affixData?.datas || {}
  const replaced = text.replace(/\$\[(\d+)\]/g, (_, idx) => {
    const list = datas[String(idx)] || []
    return list.join('/')
  })
  // 把 形如 12%/15%/18% 或 (8/16/28%)/(...) 的串高亮
  const pattern = /(\([0-9.%]+(?:\/[0-9.%]+)+\)(?:\/\([0-9.%]+(?:\/[0-9.%]+)+\))+|[0-9.]+%(?:\/[0-9.]+%)+)/g
  return replaced.replace(pattern, '<span class="hl">$1</span>')
}

/** 组装武器卡数据 */
export async function buildWeaponCard (entry, page) {
  const found = findWeaponDir(entry.name)
  if (!found) return null
  let meta = null
  try {
    meta = JSON.parse(fs.readFileSync(path.join(found.dir, 'data.json'), 'utf8'))
  } catch (e) { return null }
  const attr = meta.attr || {}
  const art = ['gacha.webp', 'icon.webp'].map((f) => path.join(found.dir, f)).find((p) => fs.existsSync(p)) || ''
  // 文档要求：基础攻击取整（674.3 → 674）
  const baseAtk = String(Math.round(Number((attr.atk || {})['90']) || 0))
  const bonus = num((attr.bonusData || {})['90'])
  const subLabel = BONUS_LABEL[String(attr.bonusKey || '')] || '副属性'

  // 武器类型图标（genshin 插件里那套，禁止输出文字）
  const typeIconFile = path.join(__dirname, '..', '..', 'genshin', 'resources', 'img', 'gacha', 'items', `${WEAPON_TYPES[found.type] || ''}.png`)
  const typeIcon = fs.existsSync(typeIconFile) ? typeIconFile : ''

  // 观测枢：突破素材 + 推荐角色
  const modules = page?.modules || []
  const growth = modules.find((m) => m?.name === '成长数值')
  let mats = []
  try {
    const payload = JSON.parse((growth?.components || [])[0]?.data || '{}')
    mats = (payload.list?.[0]?.materials || []).slice(0, 12)
  } catch (e) { /* 忽略 */ }

  // 突破素材：观测枢给「每级消耗」的顺序固定为 武器突破 4 档 → 精英掉落 3 档 → 怪物掉落 3 档，
  // 名字取 miao 的 materials.weapon / monster / normal（更规范），数量用观测枢的。
  const materials = []
  const named = []
  for (const m of mats) {
    if (!m?.nickname) continue
    named.push({ name: m.nickname, amount: m.amount, icon: await download(m.img, `wpmat_${m.nickname}`) })
  }
  const amountItems = named.filter((m) => m.name !== '精锻用魔矿' && m.name !== '摩拉')
  const wm = meta.materials || {}
  const seriesLabel = (raw, kind) => {
    if (!raw) return kind
    if (kind === 'weapon') return String(raw).replace(/的.*$/, '') + '系列'
    if (kind === 'elite') return String(raw).slice(0, 2) + '系列'
    return String(raw).slice(-2) + '系列'
  }
  const pushGroup = (items, label) => {
    if (!items.length) return
    materials.push({
      nameHtml: label,
      icon: items[items.length - 1]?.icon || '',
      counts: items.map((it) => it.amount).join('/')
    })
  }
  const miaoMat = (kind, name) => {
    if (!name) return ''
    const f = path.join(MIAO, 'material', kind, `${name}.webp`)
    return fs.existsSync(f) ? f : ''
  }
  pushGroup(amountItems.slice(0, 4), seriesLabel(wm.weapon, 'weapon'))
  pushGroup(amountItems.slice(4, 7), seriesLabel(wm.monster, 'elite'))
  for (const [i, k] of [[0, 'weapon'], [1, 'monster'], [2, 'normal']]) {
    if (!materials[i]) continue
    const transparent = miaoMat(k, wm[k])
    if (transparent) materials[i].icon = transparent
  }
  pushGroup(amountItems.slice(7, 10), seriesLabel(wm.normal, 'normal'))
  for (const [i, k] of [[0, 'weapon'], [1, 'monster'], [2, 'normal']]) {
    if (!materials[i]) continue
    const transparent = miaoMat(k, wm[k])
    if (transparent) materials[i].icon = transparent
  }

  // 推荐角色（观测枢「推荐角色」表）
  const rec = modules.find((m) => m?.name === '推荐角色')
  const characters = []
  let otherFit = ''
  try {
    const payload = JSON.parse((rec?.components || [])[0]?.data || '{}')
    for (const table of payload.tables || []) {
      for (const row of table.row || []) {
        const html = String(row?.[0] || '')
        const nameMatch = html.match(/>([^<>]{2,12})</g)
        const name = nameMatch ? nameMatch[nameMatch.length - 1].replace(/[<>]/g, '') : ''
        const img = (html.match(/data-entry-img="([^"]+)"/) || [])[1]
        if (!name) continue
        if (img) characters.push({ name, avatar: await download(img, `wpchar_${name}`) })
        else if (!otherFit && name.length <= 20) otherFit = name
        if (characters.length >= 8) break
      }
      if (characters.length >= 8) break
    }
  } catch (e) { /* 忽略 */ }

  const analysis = characters.length
    ? `观测枢推荐：${characters.slice(0, 6).map((c) => c.name).join('、')}。武器基础攻击 ${baseAtk}，${subLabel} ${bonus}${bonus.includes('%') ? '' : '%'}，${meta.affixTitle || ''}吃满精炼后收益更高。`
    : (meta.desc || '')

  const extras = {}
  for (const m of named) {
    if (m.name === '摩拉') extras.mora = Number(m.amount).toLocaleString('en-US')
    if (m.name === '精锻用魔矿') extras.ore = m.amount
  }

  return {
    typeIcon,
    extras,
    name: `「${entry.name}」`,
    stars: Number(meta.star || entry.star || 4),
    typeCn: WEAPON_TYPES[found.type] || '',
    art,
    subtitle: meta.desc || '',
    baseAtk,
    subLabel,
    subValue: bonus ? `${bonus}%` : '',
    passiveName: meta.affixTitle || '',
    passiveDescHtml: fillAffix(meta.affixData),
    analysis,
    characters,
    materials
  }
}

const CSS = `
* { box-sizing:border-box; margin:0; padding:0; }
body { width:1280px !important; margin:0 !important; padding:0 !important; background:#1e1e1e;
  font-family:'Noto Sans SC','Source Han Sans SC','PingFang SC','Microsoft YaHei',sans-serif;
  -webkit-font-smoothing:antialiased; }

/* ===== 设计 token ===== */
.weapon-card {
  --ink:#2a2521; --ink2:#6d6459; --ink3:#8b8177;
  --card:#fffdf7; --card2:#faf6ea;
  --line:rgba(122,96,48,.15);
  --r-lg:18px; --r-md:12px; --r-sm:8px;
  --sh-1:0 2px 6px rgba(86,62,18,.10);
  --sh-2:0 10px 26px rgba(86,62,18,.16);
  --sh-inset:inset 0 1px 0 rgba(255,255,255,.92);
}
.weapon-card { width:1280px; height:720px; position:relative; overflow:hidden; display:flex;
  padding:18px 20px 18px 0; background:var(--bg); }
/* 斜向暗纹 + 细噪点，去掉塑料感 */
.weapon-card::before { content:''; position:absolute; inset:0; z-index:1; pointer-events:none;
  background-image:
    repeating-linear-gradient(-45deg, rgba(255,255,255,.075) 0 2px, transparent 2px 30px),
    radial-gradient(1200px 520px at 22% 40%, rgba(255,255,255,.16), transparent 70%),
    radial-gradient(700px 300px at 82% 8%, rgba(255,255,255,.10), transparent 70%);
  mix-blend-mode:soft-light; }
.weapon-card::after { content:''; position:absolute; inset:0; z-index:1; pointer-events:none; opacity:.05;
  background-image:repeating-conic-gradient(rgba(255,255,255,.9) 0% 25%, transparent 0% 50%);
  background-size:3px 3px; }
.bg-watermark-text { position:absolute; left:138px; bottom:-10px; writing-mode:vertical-rl;
  font-family:'Noto Serif SC','STZhongsong','SimSun',serif; font-size:100px; font-weight:900; letter-spacing:6px;
  color:rgba(255,255,255,.22); z-index:1; }

/* ===== 左栏 ===== */
.left-panel { width:318px; height:100%; position:relative; z-index:4; flex-shrink:0; }
.genshin-cn-logo { position:absolute; top:12px; left:18px; height:62px; }
.genshin-cn-logo img { height:100%; width:auto; object-fit:contain;
  filter:drop-shadow(0 2px 4px rgba(70,50,15,.35)); }
.weapon-pedestal { position:absolute; top:66px; left:22px; width:348px; height:348px; border-radius:50%;
  background:conic-gradient(from 140deg, #fffefb, #f1e9d6 25%, #fffefb 50%, #efe6d1 75%, #fffefb);
  border:1px solid rgba(255,255,255,.9);
  box-shadow:0 0 0 4px rgba(255,255,255,.45), 0 24px 48px rgba(80,56,14,.26), inset 0 0 30px rgba(190,160,105,.18); }
.weapon-pedestal-inner { position:absolute; inset:13px; border-radius:50%;
  background:radial-gradient(circle at 50% 42%, #ffffff 32%, #f0ead9 72%, #e6dcc4 100%);
  border:1px solid rgba(214,196,160,.55);
  box-shadow:inset 0 2px 10px rgba(255,255,255,.9), inset 0 -8px 18px rgba(180,152,100,.18);
  display:flex; align-items:center; justify-content:center; }
.pedestal-bg-icon { width:192px; height:192px; opacity:.07; object-fit:contain; transform:rotate(22deg); }
.weapon-art { position:absolute; left:50%; top:50%; margin-left:-217px; margin-top:-217px; width:435px; height:435px; max-width:none; object-fit:contain; transform:rotate(24deg);
  filter:drop-shadow(6px 16px 18px rgba(48,34,12,.34)) drop-shadow(0 2px 4px rgba(30,20,5,.25)); z-index:4; }

/* ===== 右栏 ===== */
.right-panel { flex:1; min-width:0; height:100%; position:relative; z-index:2; border-radius:var(--r-lg); overflow:hidden;
  padding:20px 26px 20px 68px; display:flex; flex-direction:column;
  background:linear-gradient(180deg,#fbf8f0 0%, #f6f1e4 68%, #f2ebdc 100%);
  border:1px solid rgba(255,255,255,.72);
  box-shadow:var(--sh-inset), 0 14px 34px rgba(86,62,18,.20), 0 2px 0 rgba(255,255,255,.5); }
.top-header-row { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; }
.title-block { display:flex; flex-direction:column; min-width:0; flex:1; }
.meta-stars-row { display:flex; align-items:center; gap:10px; margin-bottom:2px; }
.weapon-type-cn { font-size:15px; font-weight:800; color:#6f5423; letter-spacing:.5px;
  background:linear-gradient(180deg,#fbeec6,#efd79a); border:1px solid rgba(190,150,80,.35); border-radius:5px;
  padding:2px 9px; box-shadow:var(--sh-inset), 0 2px 4px rgba(120,90,30,.14); }
.star-list { display:flex; gap:5px; font-size:28px; line-height:1; letter-spacing:1px;
  background:linear-gradient(180deg,#ffe08a 0%, #f2b93c 55%, #d99a22 100%);
  -webkit-background-clip:text; background-clip:text; color:transparent;
  filter:drop-shadow(0 1px 1px rgba(150,110,20,.45)); }
.weapon-name { font-size:46px; font-weight:900; color:var(--ink); letter-spacing:.5px; line-height:1.15; margin-top:6px;
  margin-left:-14px; text-shadow:0 1px 0 rgba(255,255,255,.75), 0 3px 10px rgba(90,64,20,.14); }
.weapon-subtitle { font-size:14px; font-weight:500; color:#5e584f; margin-top:4px; max-width:520px;
  line-height:1.5; }

.stats-group { display:flex; gap:32px; padding-top:12px; margin-right:32px; flex:0 0 auto; }
.stat-box { display:flex; flex-direction:column; align-items:center; background:transparent;
  border:none; padding:0; min-width:118px; }
.stat-label-pill { background:linear-gradient(180deg, rgba(255,255,255,.42), rgba(0,0,0,.05)), var(--pill);
  color:#4a3c22; font-size:13.5px; font-weight:900; padding:2px 16px; border-radius:20px; letter-spacing:1px;
  margin-bottom:6px; box-shadow:0 1px 2px rgba(120,90,30,.18); white-space:nowrap; }
.stat-value { font-size:50px; font-weight:900; color:#2b2628; line-height:1.05; margin-top:2px; letter-spacing:-.5px;
  white-space:nowrap; font-variant-numeric:tabular-nums;
  text-shadow:0 1px 0 rgba(255,255,255,.9), 0 2px 6px rgba(90,64,20,.12); }

/* 武器效果 */
.passive-section { margin-top:6px; margin-bottom:12px; }
.passive-header { display:flex; align-items:center; margin-bottom:9px; }
.triangle-pointer { width:0; height:0; border-top:9px solid transparent; border-bottom:9px solid transparent;
  border-left:13px solid var(--acc); margin-right:8px; filter:drop-shadow(0 1px 1px rgba(90,60,20,.3)); }
.passive-badge { background:linear-gradient(180deg, rgba(255,255,255,.30), rgba(0,0,0,.06)), var(--acc);
  color:#fff; font-size:17px; font-weight:900; padding:3px 13px; letter-spacing:1.5px;
  border-radius:4px 0 0 4px; box-shadow:0 2px 5px rgba(110,80,25,.22); text-shadow:0 1px 1px rgba(80,55,10,.28); }
.passive-name-bar { background:linear-gradient(90deg,var(--accSoft) 0%, rgba(255,255,255,0) 88%);
  border-right:3px solid var(--acc); color:#3a332c; font-size:18.5px; font-weight:900;
  padding:3px 26px 3px 14px; letter-spacing:.5px; }
.passive-desc-box { background:linear-gradient(180deg,#fffdf7,#fbf6ea); border:1px solid var(--line);
  border-radius:var(--r-md); padding:14px 18px; font-size:17px; font-weight:500; color:#39332c;
  line-height:1.58; max-height:166px; overflow:hidden;
  box-shadow:var(--sh-inset), inset 0 -6px 14px rgba(190,168,120,.10); }
.passive-desc-box .hl { color:var(--hl); font-weight:800; background:linear-gradient(180deg,transparent 62%, rgba(240,210,140,.55) 62%);
  padding:0 1px; border-radius:2px; }

/* 底部三栏 */
.bottom-columns { flex:1; display:grid; grid-template-columns:240px 258px minmax(0,1fr); gap:14px;
  min-height:0; min-width:0; }
.col-wrapper { display:flex; flex-direction:column; height:100%; min-width:0; }
.col-header { display:inline-flex; align-items:center; align-self:flex-start; margin-bottom:9px;
  background:linear-gradient(90deg,var(--accSoft) 0%, rgba(255,255,255,0) 100%);
  padding:3px 26px 3px 0; border-left:4px solid var(--acc); }
.col-header-corner { width:0; height:0; border-top:14px solid var(--acc); border-right:14px solid transparent;
  margin-right:7px; filter:drop-shadow(0 1px 1px rgba(90,60,20,.25)); }
.col-header span { font-size:18px; font-weight:900; color:#3b332b; letter-spacing:1px; }
.col-card { flex:1; min-width:0; border-radius:var(--r-md); padding:14px 16px; display:flex; flex-direction:column; overflow:hidden;
  background:linear-gradient(180deg,#fffdf7,#f9f4e7); border:1px solid var(--line);
  box-shadow:var(--sh-inset), var(--sh-1); }
.analysis-text { font-size:15.5px; font-weight:500; color:#332e26; line-height:1.65; padding:2px 4px; }
.char-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px 8px; align-content:start; padding-top:2px; }
.char-item { display:flex; flex-direction:column; align-items:center; position:relative; }
.char-avatar-box { width:62px; height:62px; border-radius:50%; padding:2px; overflow:hidden; background:#fff;
  border:1.5px solid var(--accSoft); box-shadow:0 0 0 2px #fff, 1px 1px 6px rgba(0,0,0,.12); }
.char-avatar-box img { width:100%; height:100%; border-radius:50%; object-fit:cover; background:#e3d8c6; }
.char-name { margin-top:-6px; position:relative; z-index:5; font-size:13px; font-weight:900; color:#2d2822;
  white-space:nowrap; text-shadow:0 0 3px #fff, 0 0 3px #fff; }
.materials-list { display:flex; flex-direction:column; justify-content:space-between; height:100%; padding:2px 0; }
.material-row { display:flex; align-items:center; gap:10px; }
.mat-icon-circle { width:58px; height:58px; border-radius:50%; flex-shrink:0;
  display:flex; align-items:center; justify-content:center;
  background:radial-gradient(circle at 50% 40%, #fffdf8, #f2ecdd);
  border:1px solid rgba(214,196,160,.8);
  box-shadow:inset 0 1px 4px rgba(255,255,255,.9), 0 0 0 2px rgba(255,255,255,.55), 0 3px 8px rgba(90,64,20,.12); }
.mat-icon-circle img { width:46px; height:46px; object-fit:contain;
  filter:drop-shadow(0 2px 3px rgba(60,45,20,.22)); }
.mat-info { flex:1; min-width:0; overflow:hidden; }
.mat-top-line { display:flex; align-items:center; gap:6px; margin-bottom:4px; }
.mat-name { font-size:14px; font-weight:900; color:#2f2924; white-space:normal; word-break:break-all;
  line-height:1.15; }
.mat-dashed-line { flex:1; border-bottom:1.5px dashed rgba(170,148,108,.55); min-width:8px; }
.mat-count-pill { color:#fff; font-size:12.5px; font-weight:900; padding:2px 8px; border-radius:4px;
  letter-spacing:.3px; flex-shrink:0; white-space:nowrap;
  background:linear-gradient(180deg, rgba(255,255,255,.28), rgba(0,0,0,.06)), var(--acc);
  box-shadow:0 1px 2px rgba(90,64,20,.22); }


/* ===== 第二遍：加强装饰感（暗角 / 双线框 / 四角菱形 / 标题金线 / 立绘光晕） ===== */
.weapon-card { isolation:isolate; }
.weapon-card > .vignette { position:absolute; inset:0; z-index:2; pointer-events:none;
  background:radial-gradient(140% 100% at 30% 30%, transparent 45%, rgba(60,40,10,.22) 100%); }
.right-panel::before { content:''; position:absolute; inset:7px; border-radius:14px; pointer-events:none;
  border:1px solid rgba(255,255,255,.55); }
.right-panel::after { content:''; position:absolute; inset:0; border-radius:var(--r-lg); pointer-events:none;
  background:
    linear-gradient(90deg, rgba(255,255,255,.5), transparent 12%, transparent 88%, rgba(120,95,50,.10)),
    linear-gradient(180deg, rgba(255,255,255,.6), transparent 18%, transparent 84%, rgba(120,95,50,.10)); }
.corner-mark { position:absolute; width:13px; height:13px; pointer-events:none; z-index:5;
  background:linear-gradient(135deg, var(--acc), rgba(255,255,255,.9)); transform:rotate(45deg);
  box-shadow:0 0 0 1px rgba(255,255,255,.7), 0 2px 4px rgba(90,64,20,.25); opacity:.95; }
.corner-mark.tl { left:13px; top:13px; } .corner-mark.tr { right:13px; top:13px; }
.corner-mark.bl { left:13px; bottom:13px; } .corner-mark.br { right:13px; bottom:13px; }
.title-block::after { content:''; display:block; width:min(430px, 70%); height:3px; margin:7px 0 0 -14px;
  background:linear-gradient(90deg, var(--acc) 0%, rgba(255,255,255,0) 100%); border-radius:2px; opacity:.85; }
.star-list { filter:drop-shadow(0 1px 1px rgba(150,110,20,.45)) drop-shadow(0 0 6px rgba(255,210,110,.35)); }
.weapon-pedestal::after { content:''; position:absolute; inset:-26px; border-radius:50%; pointer-events:none;
  background:radial-gradient(circle, rgba(255,246,214,.55) 30%, transparent 66%); z-index:-1; }
.weapon-art { filter:drop-shadow(6px 18px 20px rgba(48,34,12,.36)) drop-shadow(0 0 18px rgba(255,238,190,.28)); }
.col-card { position:relative; overflow:hidden; border-radius:14px;
  box-shadow:var(--sh-inset), 0 6px 16px rgba(86,62,18,.10), 0 1px 0 rgba(255,255,255,.85); }
.col-card::after { content:''; position:absolute; left:0; right:0; top:0; height:1px;
  background:linear-gradient(90deg, transparent, rgba(255,255,255,.95), transparent); }
.passive-desc-box { box-shadow:var(--sh-inset), inset 0 -10px 20px rgba(190,168,120,.10), 0 4px 12px rgba(86,62,18,.08); }
.analysis-text { position:relative; padding-left:0; }
.analysis-text::first-letter { font-size:1.15em; font-weight:800; color:var(--hl); }

.quick-facts { display:flex; gap:8px; margin-bottom:10px; }
.quick-facts .qf { flex:1; min-width:0; text-align:center; border-radius:10px; padding:7px 4px 6px;
  background:linear-gradient(180deg, rgba(255,255,255,.95), rgba(255,252,244,.7));
  border:1px solid var(--line); box-shadow:var(--sh-inset), 0 2px 5px rgba(86,62,18,.08); }
.quick-facts .qf b { display:block; font-size:17px; font-weight:900; color:var(--ink2); line-height:1.15;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.quick-facts .qf i { display:block; margin-top:2px; font-style:normal; font-size:12px; color:var(--ink3);
  letter-spacing:.3px; }
.other-fit { margin-top:12px; border-radius:10px; padding:9px 13px; font-size:13.5px; font-weight:700;
  color:#6a5c46; line-height:1.4;
  background:linear-gradient(90deg, rgba(240,230,205,.9), rgba(255,255,255,.55));
  border:1px dashed rgba(170,148,108,.55); }
.other-fit::before { content:'其他适用：'; color:var(--ink3); font-weight:600; }
.mat-foot { margin-top:8px; padding-top:7px; border-top:1px dashed rgba(170,148,108,.5);
  font-size:12.5px; color:var(--ink3); text-align:right; letter-spacing:.3px; }


/* 圆盘同心细环（Gemini：加精密刻度感） */
.weapon-pedestal-inner::after { content:''; position:absolute; inset:22px; border-radius:50%;
  border:1px solid rgba(214,196,160,.55); pointer-events:none;
  box-shadow:0 0 0 1px rgba(255,255,255,.55) inset; }
.weapon-pedestal-inner::before { content:''; position:absolute; inset:44px; border-radius:50%;
  border:1px dashed rgba(206,186,146,.45); pointer-events:none; }
/* 卡片顶部亮金微光 */
.col-card { background-image:linear-gradient(180deg, rgba(255,252,240,.95), rgba(250,244,228,.9)); }

/* 展台装饰：刻度环 + 双金环 + 左上高光（盖在右面板上，形成"搭框"效果） */
.weapon-pedestal { z-index:2; }
.weapon-pedestal::before { content:''; position:absolute; inset:-16px; border-radius:50%; pointer-events:none;
  /* 分段缺口环：右 0°、左 180° 各留 26° 大缺口（圈口），上 90°/下 270° 各留 12° 小缺口 */
  background:conic-gradient(from -13deg,
    transparent 0deg 26deg,
    #c9a86c 26deg 84deg,
    transparent 84deg 96deg,
    #c9a86c 96deg 154deg,
    transparent 154deg 180deg,
    transparent 180deg 206deg,
    #c9a86c 206deg 264deg,
    transparent 264deg 276deg,
    #c9a86c 276deg 334deg,
    transparent 334deg 360deg);
  -webkit-mask:radial-gradient(circle, transparent 0 84.5%, #000 85% 88%, transparent 88.6%);
  mask:radial-gradient(circle, transparent 0 84.5%, #000 85% 88%, transparent 88.6%);
  filter:drop-shadow(0 1px 2px rgba(90,64,20,.22)); opacity:.92; }
/* 圈口：环在面板交界处断开的两个小端点 */
.weapon-pedestal .notch { position:absolute; right:-6px; width:26px; height:4px; border-radius:2px;
  background:linear-gradient(90deg, #c9a86c, rgba(255,255,255,.9)); box-shadow:0 1px 2px rgba(90,64,20,.28); }
.weapon-pedestal .notch.top { top:64px; transform:rotate(-18deg); }
.weapon-pedestal .notch.bot { bottom:64px; transform:rotate(18deg); }
.weapon-pedestal-inner { box-shadow:0 0 0 1.5px rgba(214,184,124,.55), inset 0 2px 10px rgba(255,255,255,.95),
  inset 0 -10px 22px rgba(176,146,92,.20), 0 0 0 1px rgba(255,255,255,.8); }
.weapon-pedestal-inner::after { box-shadow:inset 0 0 0 1px rgba(255,255,255,.7), inset 0 0 12px rgba(200,172,120,.18); }
.weapon-pedestal .sheen { position:absolute; inset:8px; border-radius:50%; pointer-events:none;
  background:radial-gradient(120% 90% at 32% 26%, rgba(255,255,255,.85), rgba(255,255,255,0) 58%); }
.weapon-pedestal { box-shadow:0 0 0 2px rgba(200,168,110,.75), 0 0 0 8px rgba(255,255,255,.55), 0 22px 44px rgba(70,48,10,.26),
  0 26px 54px rgba(74,52,12,.30), inset 0 0 32px rgba(190,160,105,.20); }
.weapon-pedestal .ring { position:absolute; inset:-17px; width:calc(100% + 34px); height:calc(100% + 34px);
  overflow:visible; pointer-events:none; filter:drop-shadow(0 1px 2px rgba(90,64,20,.25)); }

/* 圆盘质感：玻璃透镜 + 斜向高光条（照官方） */
.weapon-pedestal-inner { background:
  linear-gradient(135deg, rgba(255,255,255,.95) 0%, rgba(255,255,255,.35) 26%, rgba(246,240,226,.9) 52%, rgba(232,222,200,.95) 100%),
  radial-gradient(circle at 50% 45%, #ffffff 30%, #efe7d6 78%); }
.weapon-pedestal::after { content:''; position:absolute; inset:-22px; border-radius:50%; pointer-events:none;
  background:conic-gradient(from 210deg, rgba(255,255,255,0) 0deg 34deg, rgba(255,255,255,.55) 46deg 58deg, rgba(255,255,255,0) 70deg 360deg);
  -webkit-mask:radial-gradient(circle, transparent 0 74%, #000 76% 98%, transparent 100%);
  mask:radial-gradient(circle, transparent 0 74%, #000 76% 98%, transparent 100%); }
/* 斜向玻璃高光（斜杠） */
.weapon-pedestal-inner .gloss { position:absolute; inset:0; border-radius:50%; pointer-events:none; overflow:hidden; }
.weapon-pedestal-inner .gloss::before { content:''; position:absolute; left:-30%; top:-60%; width:52%; height:220%;
  background:linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,.55) 45%, rgba(255,255,255,0));
  transform:rotate(22deg); }

.weapon-type-ico { width:22px; height:22px; object-fit:contain; padding:5px; box-sizing:content-box; border-radius:50%; background:linear-gradient(180deg,#a97f36,#7d5a1f); box-shadow:0 1px 3px rgba(90,64,20,.45), inset 0 1px 0 rgba(255,255,255,.25);
  filter:drop-shadow(0 1px 2px rgba(90,64,20,.25)); }
/* ===== 星级配色 ===== */
.weapon-card.r5 { --acc:#e2be68; --accSoft:rgba(235,211,148,.68); --pill:#e9c97f; --hl:#a9781f;
  --bg:linear-gradient(135deg,#eccd85 0%,#e2c478 42%,#d3b165 100%); }
.weapon-card.r4 { --acc:#a98bd0; --accSoft:rgba(213,198,235,.75); --pill:#c9b6e6; --hl:#7a56a6;
  --bg:linear-gradient(135deg,#dbcdec 0%,#cdb9e6 42%,#bfa7da 100%); }
.weapon-card.r3 { --acc:#7fa5cc; --accSoft:rgba(198,218,236,.75); --pill:#aecae2; --hl:#4f7ba6;
  --bg:linear-gradient(135deg,#c2d6e8 0%,#adc3da 42%,#9ab2ca 100%); }

`

export function weaponCardHtml (data) {
  const logo = path.join(PLUGIN_ROOT, 'resources', 'obc', 'logo-white.png')
  const stars = '★'.repeat(data.stars || 5)
  const chars = (data.characters || []).map((c) => `<div class="char-item">
      <div class="char-avatar-box">${c.avatar ? `<img src="${fileUrl(c.avatar)}" alt="">` : ''}</div>
      <div class="char-name">${c.name}</div>
    </div>`).join('')
  const mats = (data.materials || []).map((m) => `<div class="material-row">
      <div class="mat-icon-circle">${m.icon ? `<img src="${fileUrl(m.icon)}" alt="">` : ''}</div>
      <div class="mat-info">
        <div class="mat-top-line"><div class="mat-name">${m.nameHtml}</div>
          <div class="mat-dashed-line"></div><div class="mat-count-pill">${m.counts}</div></div>
      </div>
    </div>`).join('')
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>${CSS}</style></head>
<body>
  <div class="weapon-card r${data.stars || 5}">
    <div class="bg-watermark-text">武器图鉴</div>
    <aside class="left-panel">
      <div class="genshin-cn-logo">${fs.existsSync(logo) ? `<img src="${fileUrl(logo)}" alt="">` : ''}</div>
      <div class="weapon-pedestal"><i class="sheen"></i><i class="notch top"></i><i class="notch bot"></i><svg class="ring" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><circle cx="50" cy="50" r="48.4" fill="none" stroke="rgba(201,168,108,.95)" stroke-width="0.85" stroke-dasharray="54 22" transform="rotate(-64 50 50)"/><circle cx="50" cy="50" r="45.8" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="0.6" stroke-dasharray="58 18" transform="rotate(-64 50 50)"/></svg>
        <div class="weapon-pedestal-inner">${data.art ? `<img class="pedestal-bg-icon" src="${fileUrl(data.art)}" alt="">` : ''}</div>
        ${data.art ? `<img class="weapon-art" src="${fileUrl(data.art)}" alt="">` : ''}
      </div>
    </aside>
    <main class="right-panel">
      <i class="corner-mark tl"></i><i class="corner-mark tr"></i><i class="corner-mark bl"></i><i class="corner-mark br"></i>
      <div class="top-header-row">
        <div class="title-block">
          <div class="meta-stars-row">${data.typeIcon ? `<img class="weapon-type-ico" src="${fileUrl(data.typeIcon)}" alt="">` : ''}
            <div class="star-list">${stars}</div></div>
          <h1 class="weapon-name">${data.name}</h1>
          <p class="weapon-subtitle">${data.subtitle}</p>
        </div>
        <div class="stats-group">
          <div class="stat-box"><div class="stat-label-pill">基础攻击</div>
            <div class="stat-value">${data.baseAtk}</div></div>
          <div class="stat-box"><div class="stat-label-pill">${data.subLabel}</div>
            <div class="stat-value">${data.subValue}</div></div>
        </div>
      </div>
      <section class="passive-section">
        <div class="passive-header"><div class="triangle-pointer"></div>
          <div class="passive-badge">武器效果</div>
          <div class="passive-name-bar">${data.passiveName}</div></div>
        <div class="passive-desc-box">${data.passiveDescHtml}</div>
      </section>
      <section class="bottom-columns">
        <div class="col-wrapper"><div class="col-header"><div class="col-header-corner"></div><span>实战分析</span></div>
          <div class="col-card"><p class="analysis-text">${data.analysis}</p></div></div>
        <div class="col-wrapper"><div class="col-header"><div class="col-header-corner"></div><span>适用角色</span></div>
          <div class="col-card"><div class="char-grid">${chars}</div>
            </div></div>
        <div class="col-wrapper"><div class="col-header"><div class="col-header-corner"></div><span>突破素材</span></div>
          <div class="col-card"><div class="materials-list">${mats}</div>
            </div></div>
      </section>
    </main>
  </div>
</body></html>`
}






























