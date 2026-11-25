import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { srMetaDir, cleanText } from './srIndex.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const imgCache = new Map()
const MAX_INLINE = 3 * 1024 * 1024

/**
 * 把本地图片读成 data:URL —— 渲染用的 HTML 是 setContent 出来的，
 * 直接用 file:// 或相对路径在部分环境下会被拦，内联最稳。
 * 太大的图（splash 立绘有时好几 MB）跳过，让模板退回首字/占位。
 */
export function dataUrl (file) {
  if (!file) return ''
  if (imgCache.has(file)) return imgCache.get(file)
  let out = ''
  try {
    const stat = fs.statSync(file)
    if (stat.size <= MAX_INLINE) {
      const ext = (path.extname(file).toLowerCase().replace('.', '') || 'webp')
      const mime = ext === 'jpg' ? 'jpeg' : ext
      out = `data:image/${mime};base64,${fs.readFileSync(file).toString('base64')}`
    }
  } catch (err) {
    out = ''
  }
  imgCache.set(file, out)
  return out
}

function readJson (file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    return null
  }
}

/* ================= 材料名 / 图标 ================= */

let matMap = null
function materials () {
  if (matMap) return matMap
  matMap = new Map()
  const all = readJson(path.join(srMetaDir(), 'material', 'data.json')) || {}
  const walk = (obj, cat) => {
    for (const [k, v] of Object.entries(obj || {})) {
      if (v && typeof v === 'object' && v.id && v.name) {
        const icon = findMatIcon(v.id, cat, v.name)
        matMap.set(String(v.id), { id: String(v.id), name: v.name, star: Number(v.star) || 0, cat, icon })
      } else if (v && typeof v === 'object') {
        walk(v, k)
      }
    }
  }
  walk(all, '')
  return matMap
}

function findMatIcon (id, cat, name) {
  const fileNames = []
  if (name) fileNames.push(name)
  fileNames.push(String(id))
  const dirs = []
  if (cat) dirs.push(path.join(srMetaDir(), 'material', cat))
  for (const d of ['normal', 'char', 'material', 'exp']) dirs.push(path.join(srMetaDir(), 'material', d))
  for (const dir of dirs) {
    for (const base of fileNames) {
      for (const ext of ['webp', 'png']) {
        const f = path.join(dir, `${base}.${ext}`)
        if (fs.existsSync(f)) return f
      }
    }
  }
  return ''
}

export function matOf (id) {
  return materials().get(String(id)) || { id: String(id), name: '', star: 0, icon: '' }
}

/** 把 cost:{材料id: 数量} 变成 [{name,count,icon}]，数量降序、信用点排最后 */
export function costList (cost = {}) {
  const list = []
  for (const [id, count] of Object.entries(cost || {})) {
    if (id === '0' || !count) continue
    const m = matOf(id)
    list.push({ id: String(id), name: m.name || `材料${id}`, count: Number(count) || 0, icon: dataUrl(m.icon), star: m.star })
  }
  list.sort((a, b) => (b.count || 0) - (a.count || 0))
  const credit = list.filter((i) => i.name === '信用点')
  return [...list.filter((i) => i.name !== '信用点'), ...credit]
}

/** 把多阶 cost 汇总（例如 Lv1→80 的总消耗） */
export function sumCost (stages = {}) {
  const total = {}
  for (const stage of Object.values(stages || {})) {
    for (const [id, count] of Object.entries(stage?.cost || {})) {
      total[id] = (total[id] || 0) + (Number(count) || 0)
    }
  }
  return costList(total)
}

/* ================= 技能/被动 参数填充 ================= */

/**
 * miao 的描述里用 <nobr>$1[i]%</nobr> 占位，tables 里是对应档位数值。
 * 这里按 S1 填一版（并在末尾附上满级数值），没有表就清掉占位符。
 */
export function fillParams (desc = '', tables = {}, level = 0, opt = {}) {
  let text = String(desc).replace(/<nobr>/g, '').replace(/<\/nobr>/g, '')
  // 占位符有两种写法：$1[i]%（技能表）和 $1[f1]%（光锥被动），方括号里只是格式说明。
  // 角色的技能表存的是倍率（0.5 = 50%），所以后面跟 % 时要 ×100；光锥表本来就是百分数，不用动。
  text = text.replace(/\$(\d+)\[[^\]]*\](%?)/g, (all, idx, pct) => {
    const raw = tables?.[idx]
    // 技能表可能是 [18,21,...]，也可能是 { name, values:[...] }
    const arr = Array.isArray(raw) ? raw : (Array.isArray(raw?.values) ? raw.values : null)
    if (!Array.isArray(arr) || !arr.length) return ''
    let v = Number(arr[Math.min(level, arr.length - 1)])
    if (!Number.isFinite(v)) return ''
    if (opt.percentScale && pct) v *= 100
    const num = Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10)
    return `${num}${pct}`
  })
  return cleanText(text)
}

/** 同一段描述里的 `$N[i]` 全部换成 tables 的最后一档（满级数值） */
export function maxParams (desc = '', tables = {}) {
  const out = {}
  for (const [k, arr] of Object.entries(tables || {})) {
    if (Array.isArray(arr) && arr.length) {
      const v = Number(arr[arr.length - 1])
      out[k] = Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10)
    }
  }
  return out
}

/* ================= 角色 / 光锥 / 遗器 详情 ================= */

const TALENT_ORDER = ['a', 'e', 'q', 't', 'z']
const TALENT_CN = { a: '普攻', e: '战技', q: '终结技', t: '天赋', z: '秘技' }
const ATTR_CN = { hp: '生命值', atk: '攻击力', def: '防御力', speed: '速度', cpct: '暴击率', cdmg: '暴击伤害', aggro: '仇恨值' }

const num1 = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10)
}

export function characterDetail (entry) {
  const d = readJson(path.join(entry.dir, 'data.json'))
  if (!d) return null

  const talents = TALENT_ORDER
    .filter((k) => d.talent?.[k])
    .map((k) => {
      const t = d.talent[k]
      return {
        key: k,
        type: t.type || TALENT_CN[k] || k,
        name: t.name || '',
        tag: t.tag || '',
        desc: fillParams(t.desc, t.tables, 0, { percentScale: true }),
        maxDesc: fillParams(t.desc, t.tables, 14, { percentScale: true })
      }
    })

  const cons = Object.keys(d.cons || {})
    .sort((a, b) => Number(a) - Number(b))
    .map((i) => ({ i, name: d.cons[i]?.name || '', desc: cleanText(d.cons[i]?.desc || '') }))

  const traces = Object.entries(d.treeData || {})
    .filter(([, v]) => v?.root)
    .map(([, v]) => ({ name: v.name || '', desc: fillParams(v.desc, {}, 0) }))

  const ba = d.baseAttr || {}
  // 培养总消耗 = 等级突破（d.attr）+ 行迹（d.treeData）里每一档的材料
  const total = {}
  for (const src of [d.attr, d.treeData]) {
    for (const stage of Object.values(src || {})) {
      for (const [id, count] of Object.entries(stage?.cost || {})) {
        total[id] = (total[id] || 0) + (Number(count) || 0)
      }
    }
  }
  return {
    type: 'character',
    name: entry.name,
    star: entry.star,
    elem: entry.elem,
    pathName: entry.path,
    allegiance: entry.allegiance,
    sp: Number(d.sp) || 0,
    desc: cleanText(d.desc || ''),
    cncv: d.cncv || '',
    jpcv: d.jpcv || '',
    art: dataUrl(entry.imgPath),
    face: dataUrl(entry.facePath),
    baseAttr: [
      { k: '生命值', v: num1(ba.hp) },
      { k: '攻击力', v: num1(ba.atk) },
      { k: '防御力', v: num1(ba.def) },
      { k: '速度', v: num1(ba.speed) },
      { k: '暴击率', v: `${num1(ba.cpct)}%` },
      { k: '暴击伤害', v: `${num1(ba.cdmg)}%` }
    ].filter((i) => i.v),
    talents,
    cons,
    traces,
    materials: costList(total),
    matTitle: '突破 + 行迹 总消耗',
    matNote: 'MATERIALS'
  }
}

export function weaponDetail (entry) {
  const d = readJson(path.join(entry.dir, 'data.json'))
  if (!d) return null
  const ba = d.baseAttr || {}
  const skill = d.skill || {}
  return {
    type: 'weapon',
    name: entry.name,
    star: entry.star,
    pathName: entry.path,
    desc: cleanText(d.desc || ''),
    art: dataUrl(entry.imgPath),
    icon: dataUrl(entry.iconPath),
    baseAttr: [
      { k: '生命值', v: num1(ba.hp) },
      { k: '攻击力', v: num1(ba.atk) },
      { k: '防御力', v: num1(ba.def) }
    ].filter((i) => i.v),
    affixTitle: skill.name || '',
    affixText: fillParams(skill.desc, skill.tables, 0),
    affixMax: Object.keys(maxParams(skill.desc, skill.tables)).length
      ? fillParams(skill.desc, skill.tables, 4)
      : '',
    materials: sumCost(d.attr),
    matTitle: '光锥 1→80 总消耗',
    matNote: 'MATERIALS · 1→80'
  }
}

export function artifactDetail (entry) {
  const idxs = entry.idxs || {}
  const piecePos = ['头部', '手部', '躯干', '脚部']
  const pieces = Object.keys(idxs)
    .sort((a, b) => Number(a) - Number(b))
    .map((k, i) => ({
      pos: piecePos[i] || `部件${k}`,
      name: idxs[k]?.name || '',
      desc: cleanText(idxs[k]?.desc || '').split('\n')[0].slice(0, 60),
      img: dataUrl(entry.piecePaths?.[i])
    }))
  return {
    type: 'artifact',
    name: entry.name,
    star: entry.star || 5,
    art: dataUrl(entry.imgPath),
    effects: Object.keys(entry.skills || {})
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => ({ key: `${k} 件套`, text: fillParams(entry.skills[k], {}) })),
    pieces
  }
}

export function detailOf (entry) {
  const map = { character: characterDetail, weapon: weaponDetail, artifact: artifactDetail }
  return (map[entry.type] || (() => null))(entry)
}

export { ATTR_CN, num1 }
