import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const cacheFile = path.join(pluginRoot, 'data', 'obc-index.json')

/** 米游社观测枢（原神图鉴）静态接口：一次拿一个频道的完整条目表 */
const API_HOST = 'https://act-api-takumi-static.mihoyo.com'
const API_PATH = '/common/blackboard/ys_obc/v1/home/content/list'

/** 角色 / 武器 / 圣遗物 三个频道 */
export const CHANNELS = [
  { key: 'character', channelId: 25, label: '角色' },
  { key: 'weapon', channelId: 5, label: '武器' },
  { key: 'artifact', channelId: 218, label: '圣遗物' }
]

const STAR_MAP = { 一星: 1, 二星: 2, 三星: 3, 四星: 4, 五星: 5 }

let memory = null

/** 把观测枢条目的 ext 拆成 { 前缀: [值...] }，圣遗物还会带 __table（2/4 件套效果） */
function parseExt (extStr) {
  const groups = {}
  let table = null
  try {
    const ext = JSON.parse(extStr || '{}')
    const first = ext[Object.keys(ext)[0]] || {}
    const raw = first?.filter?.text
    if (raw) {
      for (const item of JSON.parse(raw)) {
        const idx = String(item).indexOf('/')
        if (idx < 0) continue
        const key = String(item).slice(0, idx)
        const val = String(item).slice(idx + 1)
        if (!key || !val) continue
        groups[key] = groups[key] || []
        if (!groups[key].includes(val)) groups[key].push(val)
      }
    }
    if (Array.isArray(first?.table?.list) && first.table.list.length) {
      table = first.table.list.filter((row) => row && row.key)
    }
  } catch (err) {
    logger.error(`[观测枢图鉴] ext 解析失败：${err.message}`)
  }
  return { groups, table }
}

const starOf = (list = []) => {
  for (const item of list) {
    if (STAR_MAP[item]) return STAR_MAP[item]
  }
  return 0
}
const pick = (groups, ...keys) => {
  for (const key of keys) {
    if (groups[key]?.length) return groups[key]
  }
  return []
}

function formatEntry (type, raw) {
  const { groups, table } = parseExt(raw.ext)
  const base = {
    type,
    id: String(raw.content_id || ''),
    name: String(raw.title || '').trim(),
    icon: raw.icon || '',
    summary: String(raw.summary || '').trim(),
    groups,
    updatedAt: Date.now()
  }

  if (type === 'character') {
    const starValues = pick(groups, '星级')
    return {
      ...base,
      star: starOf(starValues),
      stars: starValues,
      elem: pick(groups, '元素')[0] || '',
      weaponType: pick(groups, '武器')[0] || '',
      region: pick(groups, '地区')[0] || '',
      tags: pick(groups, '特殊机制')
    }
  }

  if (type === 'weapon') {
    const starValues = pick(groups, '武器星级', '星级')
    return {
      ...base,
      star: starOf(starValues),
      stars: starValues,
      weaponType: pick(groups, '武器类型', '类型')[0] || '',
      subAttrs: pick(groups, '属性加成'),
      sources: pick(groups, '获取途径', '获取方式')
    }
  }

  // artifact
  const starValues = pick(groups, '星级')
  return {
    ...base,
    star: starOf(starValues),
    stars: starValues,
    effects: table || [],
    effectTags: pick(groups, '套装效果'),
    sources: pick(groups, '获取方式', '获取途径')
  }
}

async function fetchChannel (channelId) {
  const url = `${API_HOST}${API_PATH}?app_sn=ys_obc&channel_id=${channelId}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Yunzai/obc-atlas' },
    signal: AbortSignal.timeout(30000)
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()
  if (json?.retcode !== 0) throw new Error(`retcode ${json?.retcode} ${json?.message || ''}`)
  return json?.data?.list?.[0]?.list || []
}

/** 拉取三个频道的实时图鉴索引 */
export async function fetchIndex () {
  const out = { updatedAt: Date.now(), source: 'miyoushe-obc', channels: {} }
  for (const { key, channelId } of CHANNELS) {
    const list = await fetchChannel(channelId)
    out.channels[key] = list.map((raw) => formatEntry(key, raw)).filter((item) => item.name)
  }
  return out
}

function readCacheFile () {
  try {
    if (!fs.existsSync(cacheFile)) return null
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    if (!data?.channels) return null
    return data
  } catch (err) {
    logger.error(`[观测枢图鉴] 读取缓存失败：${err.message}`)
    return null
  }
}

function writeCacheFile (data) {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
    fs.writeFileSync(cacheFile, JSON.stringify(data), 'utf8')
  } catch (err) {
    logger.error(`[观测枢图鉴] 写入缓存失败：${err.message}`)
  }
}

/**
 * 拿图鉴索引：内存 → 文件缓存 → 实时拉取（失败则退回旧缓存）
 * @param {object} opt
 * @param {number} opt.cacheHours 缓存有效期（小时）
 * @param {boolean} opt.force 强制刷新
 */
export async function getIndex (opt = {}) {
  const cacheHours = Number(opt.cacheHours) || 12
  const ttl = cacheHours * 3600 * 1000

  const cached = readCacheFile()
  const cachedTs = Number(cached?.updatedAt || 0)

  // 磁盘缓存比内存新（例如索引被手动/外部刷新过）时，优先用磁盘的
  if (cached && cachedTs > Number(memory?.updatedAt || 0)) {
    memory = withLookup(cached)
    if (!opt.force && Date.now() - cachedTs < ttl) return memory
  }

  if (!opt.force && memory && Date.now() - memory.updatedAt < ttl) return memory

  if (!opt.force && cached && Date.now() - cachedTs < ttl) {
    memory = withLookup(cached)
    return memory
  }

  try {
    const fresh = await fetchIndex()
    // 防御：接口抖动导致某个频道返回空时，不能把索引写坏（否则该频道整类查不到）
    const prev = cached?.channels || {}
    for (const c of CHANNELS) {
      const list = fresh.channels[c.key] || []
      const old = prev[c.key] || []
      if (!list.length && old.length) {
        logger.error(`[观测枢图鉴] ${c.label}频道返回空，沿用上一次索引（${old.length} 条）`)
        fresh.channels[c.key] = old
      }
    }
    writeCacheFile(fresh)
    memory = withLookup(fresh)
    const counts = CHANNELS.map((c) => `${c.label}${fresh.channels[c.key]?.length || 0}`).join(' / ')
    logger.mark(`[观测枢图鉴] 索引已更新：${counts}`)
    return memory
  } catch (err) {
    logger.error(`[观测枢图鉴] 索引拉取失败：${err.message}`)
    if (cached) {
      memory = withLookup(cached)
      logger.mark('[观测枢图鉴] 使用上一次缓存继续服务')
      return memory
    }
    return withLookup({ updatedAt: 0, channels: { character: [], weapon: [], artifact: [] } })
  }
}

/** 归一化名称：去空白、去括号、去间隔号，便于模糊匹配 */
export function normName (name = '') {
  return String(name)
    .replace(/[\s\u3000]/g, '')
    .replace(/[「」『』【】\[\]()（）·・.。,'"“”]/g, '')
    .toLowerCase()
}

function withLookup (data) {
  const map = new Map()
  const put = (key, entry) => {
    if (!key) return
    if (!map.has(key)) map.set(key, entry)
  }
  for (const { key: type } of CHANNELS) {
    for (const entry of data.channels[type] || []) {
      put(normName(entry.name), entry)
    }
  }
  data.lookup = map
  data.updatedAt = Number(data.updatedAt) || Date.now()
  return data
}

/**
 * 按名字查条目（角色/武器/圣遗物）
 *
 * **严格指令**：只认「完整名字」（归一化后全等），别名由上层 alias 表解析。
 * 不做前缀匹配、也不做包含匹配 —— 否则 `#刻晴图片`、`#刻晴面板`、`#刻晴图鉴`
 * 这类「名字+后缀」的指令会被整条吃掉（这些后缀属于别的插件）。
 * 想用简称就写进别名表（miao 预设里已有 雾切/绝缘/静水/帝君/玉衡星…）。
 */
export function findEntry (index, name = '') {
  const key = normName(name)
  if (!key) return null
  return index.lookup?.get(key) || null
}
