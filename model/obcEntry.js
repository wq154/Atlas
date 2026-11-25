import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data', 'entry')

/**
 * 米游社观测枢 · 词条详情（hoyowiki entry_page）
 * 列表接口只给名称/图标/星级/属性关键词，词条页里才有：
 *   · 角色：推荐装备（武器推荐 / 圣遗物推荐 + 推荐理由）、角色突破材料（含数量）
 *   · 武器：推荐角色（含一句话说明）
 *   · 圣遗物：搭配推荐
 */
const HOST = 'https://act-api-takumi-static.mihoyo.com/hoyowiki/genshin/wapi'

function cacheFile (id) {
  return path.join(DATA_DIR, `${id}.json`)
}

function readCache (id, cacheHours) {
  try {
    const raw = fs.readFileSync(cacheFile(id), 'utf8')
    const obj = JSON.parse(raw)
    const age = (Date.now() - (obj.at || 0)) / 3600000
    if (cacheHours > 0 && age > cacheHours) return null
    return obj
  } catch (e) {
    return null
  }
}

function writeCache (id, data) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(cacheFile(id), JSON.stringify({ at: Date.now(), data }))
  } catch (e) { /* 缓存失败不影响出图 */ }
}

/** 拉取词条页原始数据（带本地缓存） */
export async function getEntryPage (id, { cacheHours = 12, force = false } = {}) {
  if (!id) return null
  if (!force) {
    const hit = readCache(id, cacheHours)
    if (hit) return hit.data
  }
  const url = `${HOST}/entry_page?app_sn=ys_obc&entry_page_id=${id}&lang=zh-cn`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`entry_page ${res.status}`)
  const json = await res.json()
  const page = json?.data?.page
  if (!page) throw new Error('entry_page 无 page 数据')
  writeCache(id, page)
  return page
}

/** 去掉 HTML 标签，保留纯文本 */
export function stripTags (html = '') {
  return String(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 解析单元格：可能带 custom-entry-wrapper（词条名/图标），也可能就是普通文本 */
function parseCell (html = '') {
  const name = (html.match(/data-entry-name="([^"]*)"/) || [])[1] || ''
  const icon = (html.match(/data-entry-img="([^"]*)"/) || html.match(/<img[^>]*src="([^"]*)"/) || [])[1] || ''
  const entryId = Number((html.match(/data-entry-id="([^"]*)"/) || [])[1]) || 0
  const text = stripTags(html)
  return { name: name || text, icon, entryId, text }
}

function parseComponentData (comp) {
  if (!comp) return null
  try {
    return typeof comp.data === 'string' ? JSON.parse(comp.data) : comp.data
  } catch (e) {
    return null
  }
}

function findModule (page, names = [], componentId = '') {
  return (page?.modules || []).find((m) => {
    const comps = m.components || []
    if (componentId && comps.some((c) => c.component_id === componentId)) return true
    return names.includes(m.name)
  })
}

/**
 * 把词条页整理成海报要用的结构
 * @returns {{
 *   tables: Array<{tabName:string, kind:'weapon'|'artifact'|'character'|'other', headers:string[], items:Array<{name,icon,reason}>}>,
 *   ascension: Array<{tabName:string, materials:Array<{name,amount,icon}>}>,
 *   fullMaterials: Array<{name,amount,icon}>
 * }}
 */
export function parseEntryPage (page) {
  const out = { tables: [], ascension: [], fullMaterials: [], name: page?.name || '' }

  // 1) 推荐装备（角色）/ 推荐角色（武器）/ 搭配推荐（圣遗物）
  const recMod = findModule(page, ['推荐装备', '推荐角色', '搭配推荐'], 'recommend')
  for (const comp of recMod?.components || []) {
    const data = parseComponentData(comp)
    if (!data) continue
    if (Array.isArray(data.tables)) {
      for (const t of data.tables) {
        const tabName = t.tab_name || ''
        const kind = /武器/.test(tabName) ? 'weapon' : (/圣遗物/.test(tabName) ? 'artifact' : (/角色/.test(tabName) ? 'character' : 'other'))
        const headers = t.header || []
        const items = []
        for (const row of t.row || []) {
          if (!Array.isArray(row) || !row.length) continue
          const head = parseCell(row[0])
          const reason = row.slice(1).map((c) => stripTags(c)).filter(Boolean).join(' ')
          items.push({ name: head.name, icon: head.icon, entryId: head.entryId, reason })
        }
        if (items.length) out.tables.push({ tabName, kind, headers, items })
      }
    } else if (Array.isArray(data.list)) {
      // 少数词条把推荐写在 list 里（tab + 内容 HTML）
      for (const t of data.list) {
        const tabName = t.tab_name || ''
        const html = (t.content || t.title || '')
        const head = parseCell(html)
        const reason = stripTags(html)
        if (head.name) out.tables.push({ tabName, kind: 'other', headers: [], items: [{ name: head.name, icon: head.icon, entryId: head.entryId, reason }] })
      }
    }
  }

  // 推荐角色也可能单独放在 multi_table 模块里
  const multiMod = findModule(page, ['推荐角色'])
  if (!out.tables.some((t) => t.kind === 'character')) {
    for (const comp of multiMod?.components || []) {
      const data = parseComponentData(comp)
      if (!data?.tables) continue
      for (const t of data.tables) {
        const items = (t.row || []).map((row) => {
          const head = parseCell(row?.[0])
          const reason = (row || []).slice(1).map((c) => stripTags(c)).filter(Boolean).join(' ')
          return { name: head.name, icon: head.icon, entryId: head.entryId, reason }
        }).filter((i) => i.name)
        if (items.length) out.tables.push({ tabName: t.tab_name || '推荐角色', kind: 'character', headers: t.header || [], items })
      }
    }
  }

  // 2) 突破材料（含数量）
  const ascMod = findModule(page, ['角色突破'], 'role_ascension')
  for (const comp of ascMod?.components || []) {
    const data = parseComponentData(comp)
    for (const t of data?.list || []) {
      const materials = (t.materials || []).map((m) => ({
        name: m.nickname || m.name || '',
        amount: Number(m.amount) || 0,
        icon: m.img || ''
      })).filter((m) => m.name)
      if (materials.length) out.ascension.push({ tabName: t.tab_name || '', materials })
    }
  }
  // 第一个 tab 是 1→90 的合计
  const totalTab = out.ascension.find((t) => /所需材料|合计|总计/.test(t.tabName)) || out.ascension[0]
  out.fullMaterials = totalTab ? totalTab.materials : []

  // 3) 圣遗物部件（各部位独立模块，字段：name.value[0] / icon_url）
  const pieces = []
  for (const m of page?.modules || []) {
    for (const comp of m.components || []) {
      if (comp.component_id !== 'artifact_list_v2') continue
      const data = parseComponentData(comp)
      const list = data?.list || []
      for (const it of list) {
        const icon = it.icon_url || it.icon || it.img || ''
        let nm = ''
        if (it.name && Array.isArray(it.name.value)) nm = it.name.value[0] || ''
        else if (typeof it.name === 'string') nm = it.name
        if (!nm) nm = it.nickname || it.title || ''
        nm = String(nm).replace(/[:：]\s*$/, '').trim()
        if (nm) pieces.push({ pos: String(m.name || '').replace(/[:：]\s*$/, ''), name: nm, icon })
      }
    }
  }
  out.pieces = pieces

  return out
}
