import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')

/**
 * 可选补全源：本地 miao-plugin 的元数据（resources/meta-gs）。
 * 观测枢公开接口只给「名称/图标/星级/属性关键词」，武器属性数值、被动全文、
 * 圣遗物五个部件、角色基础属性这些长文本观测枢列表接口不给，
 * 所以有 miao 就从本地补，没有就省略对应区块，绝不影响出图。
 */
const MIAO_ROOT = process.env.OBC_MIAO_ROOT || path.resolve(pluginRoot, '..', 'miao-plugin')
const META = path.join(MIAO_ROOT, 'resources', 'meta-gs')

export const ELEM_CN = { anemo: '风', geo: '岩', electro: '雷', dendro: '草', hydro: '水', pyro: '火', cryo: '冰' }
export const WEAPON_CN = { sword: '单手剑', bow: '弓', catalyst: '法器', claymore: '双手剑', polearm: '长柄武器' }
const WEAPON_DIRS = ['sword', 'bow', 'catalyst', 'claymore', 'polearm']
const ARTIFACT_POS = ['生之花', '死之羽', '时之沙', '空之杯', '理之冠']
const MATERIAL_CN = { gem: '突破宝石', boss: '首领材料', specialty: '区域特产', normal: '普通材料', talent: '天赋书', weekly: '周本材料', weapon: '武器材料', monster: '怪物掉落' }

export function miaoAvailable () {
  return fs.existsSync(META)
}

function readJson (file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    return null
  }
}

/** 本地文件路径转成渲染页可直接引用的绝对路径（正斜杠） */
export function localPath (file) {
  return file.replace(/\\/g, '/')
}

function pickNumber (obj, key) {
  if (!obj) return null
  const val = obj[key] ?? obj['90'] ?? obj['1']
  return val === undefined || val === null || val === '' ? null : Number(val)
}

/** 把 miao 的武器数据转成海报需要的字段 */
export function getWeaponMeta (name) {
  if (!name || !miaoAvailable()) return null
  for (const dir of WEAPON_DIRS) {
    const file = path.join(META, 'weapon', dir, name, 'data.json')
    const data = readJson(file)
    if (!data) continue
    const iconPath = path.join(META, 'weapon', dir, name, 'icon.webp')
    return {
      ...data,
      typeCn: WEAPON_CN[dir] || dir,
      baseAtk: pickNumber(data.attr?.atk, '90'),
      subKey: data.attr?.bonusKey || '',
      subValue: pickNumber(data.attr?.bonusData, '90'),
      subCn: BONUS_CN[data.attr?.bonusKey] || data.attr?.bonusKey || '',
      affixTexts: refineTexts(data.affixData),
      affixTextRich: refineTextRich(data.affixData),
      icon: fs.existsSync(iconPath) ? localPath(iconPath) : '',
      materials: materialList(data.materials),
      matPlan: materialPlan(data.materials, 'weapon')
    }
  }
  return null
}

export function getCharacterMeta (name) {
  if (!name || !miaoAvailable()) return null
  const dir = path.join(META, 'character', name)
  const data = readJson(path.join(dir, 'data.json'))
  if (!data) return null
  return {
    ...data,
    elemCn: ELEM_CN[data.elem] || data.elem || '',
    weaponCn: WEAPON_CN[data.weapon] || data.weapon || '',
    growCn: BONUS_CN[data.growAttr?.key] || data.growAttr?.key || '',
    growValue: data.growAttr?.value ?? null,
    materials: materialList(data.materials),
    matPlan: materialPlan(data.materials, 'character')
  }
}

let artifactMap = null

/** miao 的圣遗物 data.json 是按套装 ID 索引的，这里建一份 名字 -> 套装 的映射 */
function getArtifactMap () {
  if (artifactMap) return artifactMap
  artifactMap = new Map()
  const all = readJson(path.join(META, 'artifact', 'data.json')) || {}
  for (const [id, set] of Object.entries(all)) {
    if (!set) continue
    artifactMap.set(String(id), set)
    if (set.name) artifactMap.set(set.name, set)
  }
  return artifactMap
}

export function getArtifactMeta (name) {
  if (!name || !miaoAvailable()) return null
  const set = getArtifactMap().get(name)
  if (!set) return null
  const dir = path.join(META, 'artifact', 'imgs', set.name || name)
  const pieces = []
  ARTIFACT_POS.forEach((pos, i) => {
    const idx = i + 1
    const piece = set.idxs?.[idx]
    if (!piece) return
    const iconFile = path.join(dir, `${idx}.webp`)
    pieces.push({
      pos,
      name: piece.name || '',
      icon: fs.existsSync(iconFile) ? localPath(iconFile) : ''
    })
  })
  return { ...set, pieces, skills: set.skills || {} }
}

const BONUS_CN = {
  atk: '攻击力', atkPct: '攻击力', hp: '生命值', hpPct: '生命值', def: '防御力', defPct: '防御力',
  cpct: '暴击率', cdmg: '暴击伤害', em: '元素精通', mastery: '元素精通',
  rea: '元素充能效率', er: '元素充能效率', recharge: '元素充能效率',
  phy: '物理伤害加成', heal: '治疗加成'
}

/** 把 affixData 的 $[n] 占位替换成各精炼档位文本 */
function refineTexts (affixData) {
  if (!affixData?.text) return []
  const out = []
  for (let refine = 1; refine <= 5; refine++) {
    const text = String(affixData.text).replace(/\$\[(\d+)\]/g, (m, idx) => {
      const arr = affixData.datas?.[idx] || affixData.datas?.[Number(idx)]
      if (!Array.isArray(arr)) return m
      return String(arr[refine - 1] ?? arr[0] ?? '')
    })
    out.push(text)
  }
  return out
}

/** 精炼 1~5 的数值用斜杠并列（和游戏内/图鉴一致的写法：12%/15%/18%/21%/24%） */
function refineTextRich (affixData) {
  if (!affixData?.text) return ''
  return String(affixData.text).replace(/\$\[(\d+)\]/g, (m, idx) => {
    const arr = affixData.datas?.[idx] || affixData.datas?.[Number(idx)]
    if (!Array.isArray(arr) || !arr.length) return m
    return arr.join('/')
  })
}

function materialIcon (kind, name) {
  const dirs = ['gem', 'boss', 'specialty', 'normal', 'talent', 'weekly', 'weapon', 'monster']
  const tries = dirs.includes(kind) ? [kind, ...dirs.filter((d) => d !== kind)] : dirs
  for (const dir of tries) {
    const file = path.join(META, 'material', dir, `${name}.webp`)
    if (fs.existsSync(file)) return localPath(file)
  }
  return ''
}

function materialList (materials) {
  if (!materials || typeof materials !== 'object') return []
  const out = []
  for (const [key, val] of Object.entries(materials)) {
    if (!val) continue
    const names = Array.isArray(val) ? val : [val]
    for (const nm of names) {
      if (nm) out.push({ kind: MATERIAL_CN[key] || key, kindKey: key, name: String(nm), icon: materialIcon(key, String(nm)) })
    }
  }
  return out
}

// ===== 养成材料数量：都是游戏内固定消耗（1→90 突破 / 天赋 10-10-10 / 武器 1→90），
// 数量取自 Atlas 图鉴里印的标准值，与角色个体无关。
// 表按「系列从低到高」排列，映射时从最高档对齐（系列缺档也不会错位） =====
const MAT_COUNT = {
  specialty: [168],
  boss: [46],
  weekly: [18],
  gem: [1, 9, 9, 6],
  talent: [9, 63, 114],
  weapon: [5, 14, 14, 6],
  normalAsc: [18, 30, 36],
  normalTalent: [18, 66, 93],
  normalWeapon: [15, 23, 27],
  monsterWeapon: [23, 27, 41]
}

const GROUP_CN = {
  gem: '元素宝石', boss: '世界首领', specialty: '区域特产', normal: '怪物掉落',
  monster: '精英掉落', talent: '天赋书', weekly: '周本材料', weapon: '武器突破素材'
}

const DAY_CN = { 1: '周一/四', 2: '周二/五', 3: '周三/六' }

let matDb = null
function getMatDb () {
  if (!matDb) matDb = readJson(path.join(META, 'material', 'data.json')) || {}
  return matDb
}

let dayDb = null
/** 从 miao 的 daily.js 里解析 材料系列 -> 可刷的天（天赋书 / 武器素材） */
function getDayDb () {
  if (dayDb) return dayDb
  dayDb = { talent: {}, weapon: {} }
  try {
    const txt = fs.readFileSync(path.join(META, 'material', 'daily.js'), 'utf8')
    const parse = (part) => {
      const map = {}
      const re = /(\d+)\s*:\s*\[([^\]]*)\]/g
      let m
      while ((m = re.exec(part))) {
        const names = m[2].match(/"([^"]+)"/g) || []
        for (const raw of names) map[raw.replace(/"/g, '')] = Number(m[1])
      }
      return map
    }
    dayDb.talent = parse(txt.split('talent:')[1]?.split('weapon:')[0] || '')
    dayDb.weapon = parse(txt.split('weapon:')[1] || '')
  } catch (e) {
    // 解析失败就只是不显示日期标签
  }
  return dayDb
}

/** 数量表按系列长度从最高档对齐，避免 miao 里星级（2★起）与档位不一致 */
function matCount (type, idx, total, role) {
  let table
  if (type === 'normal') {
    table = role === 'weapon'
      ? MAT_COUNT.normalWeapon
      : (role === 'talent' ? MAT_COUNT.normalTalent : MAT_COUNT.normalAsc)
  } else if (type === 'monster') {
    table = MAT_COUNT.monsterWeapon
  } else {
    table = MAT_COUNT[type]
  }
  if (!table || !table.length) return 0
  const offset = Math.max(0, table.length - total)
  return table[offset + idx] ?? table[table.length - 1] ?? 0
}

function dayOf (type, name) {
  if (type !== 'talent' && type !== 'weapon') return ''
  const base = String(name).replace(/[「」]/g, '').split('的')[0]
  const db = getDayDb()
  const day = (db[type] || {})[base]
  return day ? DAY_CN[day] || '' : ''
}

/** 一条材料 -> 它的整个系列（1★→N★）以及各自数量 */
function matSeries (name, kindKey, role) {
  const rec = getMatDb()[name]
  const type = rec?.type || kindKey
  let list = rec?.items && Object.keys(rec.items).length ? Object.values(rec.items) : (rec ? [rec] : [{ name, star: 1 }])
  list = list.filter((x) => x && x.name).sort((a, b) => (a.star || 1) - (b.star || 1))
  if (!list.length) list = [{ name, star: 1 }]
  return {
    kindKey,
    kindCn: GROUP_CN[type] || MATERIAL_CN[type] || type,
    day: dayOf(type, name),
    items: list.map((it, i) => ({
      name: it.name,
      star: it.star || 1,
      count: matCount(type, i, list.length, role),
      icon: materialIcon(type, it.name)
    }))
  }
}

/**
 * 养成材料总方案
 * @param {object} materials miao data.json 里的 materials
 * @param {'character'|'weapon'} role
 */
export function materialPlan (materials, role = 'character') {
  const out = { ascension: [], talent: [], weaponGroups: [] }
  if (!materials || typeof materials !== 'object') return out
  const push = (target, kindKey, countRole) => {
    const val = materials[kindKey]
    if (!val) return
    const names = Array.isArray(val) ? val : [val]
    for (const nm of names) if (nm) target.push(matSeries(String(nm), kindKey, countRole || role))
  }

  if (role === 'weapon') {
    push(out.weaponGroups, 'weapon')
    push(out.weaponGroups, 'monster')
    push(out.weaponGroups, 'normal')
    out.weaponGroups.push({
      kindKey: 'mora', kindCn: '通用', day: '',
      items: [{ name: '摩拉', star: 0, count: 906445, icon: '' }]
    })
  } else {
    push(out.ascension, 'gem')
    push(out.ascension, 'boss')
    push(out.ascension, 'specialty')
    push(out.ascension, 'normal')
    out.ascension.push({
      kindKey: 'ext', kindCn: '通用', day: '',
      items: [
        { name: '摩拉', star: 0, count: 2092530, icon: '' },
        { name: '大英雄的经验', star: 0, count: 419, icon: '' }
      ]
    })
    push(out.talent, 'talent')
    push(out.talent, 'weekly')
    push(out.talent, 'normal', 'talent')
    out.talent.push({
      kindKey: 'ext', kindCn: '通用', day: '',
      items: [
        { name: '智识之冕', star: 0, count: 3, icon: '' },
        { name: '摩拉', star: 0, count: 4957500, icon: '' }
      ]
    })
  }
  return out
}
