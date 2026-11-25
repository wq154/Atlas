import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { normName } from './obcIndex.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const yunzaiRoot = path.resolve(pluginRoot, '..', '..')

/** 星铁图鉴数据源：默认读 miao-plugin 的 meta-sr（米游社星铁资料镜像），只读不写 */
const CONFIG_FILE = path.join(pluginRoot, 'config.yaml')

let metaDirCache = null
/**
 * 解析星铁数据目录，按顺序找第一个能用的：
 *   1. config.yaml 里的 srMetaPath（用户自己备份/自建的 meta-sr 副本）
 *   2. plugins/miao-plugin/resources/meta-sr（默认）
 *   3. 本插件 data/meta-sr（兜底，可把副本丢这里，完全脱离 miao）
 */
export function srMetaDir () {
  if (metaDirCache) return metaDirCache
  const candidates = []
  try {
    const cfg = YAML.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {}
    if (cfg.srMetaPath) candidates.push(path.resolve(String(cfg.srMetaPath)))
  } catch (err) { /* 配置读不了就跳 */ }
  candidates.push(path.join(yunzaiRoot, 'plugins', 'miao-plugin', 'resources', 'meta-sr'))
  candidates.push(path.join(pluginRoot, 'data', 'meta-sr'))
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'character')) && fs.existsSync(path.join(dir, 'weapon'))) {
      metaDirCache = dir
      logger.debug(`[观测枢图鉴] 星铁数据源：${dir}`)
      return dir
    }
  }
  metaDirCache = candidates[1]
  logger.error(`[观测枢图鉴] 没找到可用的星铁数据目录（试过：${candidates.join(' / ')}）`)
  return metaDirCache
}

/** 改了 srMetaPath 后（#星铁图鉴更新）重新解析一次 */
export function clearSrMetaDirCache () {
  metaDirCache = null
}
const cacheFile = path.join(pluginRoot, 'data', 'sr-index.json')

export const SR_CHANNELS = [
  { key: 'character', label: '角色' },
  { key: 'weapon', label: '光锥' },
  { key: 'artifact', label: '遗器' }
]

export const SR_TYPE_CN = { character: '角色', weapon: '光锥', artifact: '遗器' }
/** 星铁属性 / 命途（meta 里已是中文，这里做展示兜底与排序） */
export const SR_ELEM = ['物理', '火', '冰', '雷', '风', '量子', '虚数']
export const SR_PATH = ['毁灭', '存护', '巡猎', '丰饶', '智识', '同谐', '虚无', '记忆', '欢愉']

let memory = null

function readJson (file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    return null
  }
}

function dirs (p) {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch (err) {
    return []
  }
}

function imgs (p) {
  try {
    return fs.readdirSync(p).filter((f) => /\.(webp|png|jpe?g)$/i.test(f))
  } catch (err) {
    return []
  }
}

/** 按候选名找图，找不到就退回目录里第一张 */
function pickImg (dir, names = []) {
  for (const name of names) {
    const file = path.join(dir, name)
    if (fs.existsSync(file)) return file
  }
  const all = imgs(dir).sort()
  return all.length ? path.join(dir, all[0]) : ''
}

/** 清掉 miao 描述里的 HTML 标记 */
export function cleanText (s = '') {
  return String(s)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function scanCharacters () {
  const root = path.join(srMetaDir(), 'character')
  const out = []
  for (const name of dirs(root)) {
    if (name === 'common') continue
    const dir = path.join(root, name)
    const d = readJson(path.join(dir, 'data.json'))
    if (!d?.name) continue
    const imgDir = fs.existsSync(path.join(dir, 'imgs')) ? path.join(dir, 'imgs') : dir
    out.push({
      type: 'character',
      id: String(d.id || name),
      name: String(d.name),
      star: Number(d.star) || 0,
      elem: String(d.elem || ''),
      path: String(d.weapon || ''),
      allegiance: String(d.allegiance || ''),
      desc: cleanText(d.desc || ''),
      cncv: String(d.cncv || ''),
      jpcv: String(d.jpcv || ''),
      dir,
      // splash 是 2408x904 的宽幅动作图，放进方形立绘框会缩得很小；preview 是竖版立绘，优先用
      imgPath: pickImg(imgDir, ['preview.webp', 'splash.webp', 'face.webp', 'face-b.png']),
      facePath: pickImg(imgDir, ['face.webp', 'face-b.png', 'preview.webp'])
    })
  }
  return out
}

function scanWeapons () {
  const root = path.join(srMetaDir(), 'weapon')
  const out = []
  for (const typeDir of dirs(root)) {
    for (const nameDir of dirs(path.join(root, typeDir))) {
      const dir = path.join(root, typeDir, nameDir)
      const d = readJson(path.join(dir, 'data.json'))
      if (!d?.name) continue
      const imgDir = fs.existsSync(path.join(dir, 'imgs')) ? path.join(dir, 'imgs') : dir
      out.push({
        type: 'weapon',
        id: String(d.id || nameDir),
        name: String(d.name),
        star: Number(d.star) || 0,
        path: String(d.type || typeDir),
        desc: cleanText(d.desc || ''),
        dir,
        imgPath: pickImg(imgDir, ['splash.webp', 'icon.webp', 'icon-s.webp']),
        iconPath: pickImg(imgDir, ['icon.webp', 'icon-s.webp', 'splash.webp'])
      })
    }
  }
  return out
}

function scanArtifacts () {
  const root = path.join(srMetaDir(), 'artifact')
  const all = readJson(path.join(root, 'data.json')) || {}
  const out = []
  for (const name of dirs(root)) {
    const dir = path.join(root, name)
    const imgDir = fs.existsSync(path.join(dir, 'imgs')) ? path.join(dir, 'imgs') : dir
    const files = imgs(imgDir).sort()
    const hit = Object.values(all).find((a) => a && a.name === name)
    out.push({
      type: 'artifact',
      id: String(hit?.id || name),
      name,
      star: Number(hit?.star) || 5,
      skills: hit?.skills || {},
      idxs: hit?.idxs || {},
      dir,
      imgPath: files.find((f) => /^arti-0/i.test(f)) ? path.join(imgDir, files.find((f) => /^arti-0/i.test(f))) : (files[0] ? path.join(imgDir, files[0]) : ''),
      piecePaths: files.filter((f) => /^arti-\d/i.test(f)).slice(0, 5).map((f) => path.join(imgDir, f))
    })
  }
  return out
}

/** 扫一遍本地 meta-sr，建索引（纯本地，无网络请求） */
export function scanSrIndex () {
  const data = {
    updatedAt: Date.now(),
    source: 'miao meta-sr（米游社星铁资料镜像）',
    channels: { character: [], weapon: [], artifact: [] }
  }
  if (!fs.existsSync(srMetaDir())) {
    logger.error(`[观测枢图鉴] 找不到星铁数据目录：${srMetaDir()}`)
    return data
  }
  data.channels.character = scanCharacters()
  data.channels.weapon = scanWeapons()
  data.channels.artifact = scanArtifacts()
  return data
}

function writeCache (data) {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true })
    // 只落轻量字段，图片按需从 imgPath 读
    fs.writeFileSync(cacheFile, JSON.stringify(data), 'utf8')
  } catch (err) {
    logger.error(`[观测枢图鉴] 星铁索引写缓存失败：${err.message}`)
  }
}

function readCache () {
  try {
    if (!fs.existsSync(cacheFile)) return null
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    if (!data?.channels?.character?.length) return null
    return data
  } catch (err) {
    return null
  }
}

function withLookup (data) {
  const map = new Map()
  for (const { key } of SR_CHANNELS) {
    for (const entry of data.channels[key] || []) {
      const n = normName(entry.name)
      if (n && !map.has(n)) map.set(n, entry)
    }
  }
  data.lookup = map
  data.updatedAt = Number(data.updatedAt) || Date.now()
  return data
}

/**
 * 星铁图鉴索引：内存 → 磁盘缓存 → 本地扫描
 * @param {{cacheHours?: number, force?: boolean}} opt
 */
export async function getSrIndex (opt = {}) {
  const cacheHours = Number(opt.cacheHours) || 12
  const ttl = cacheHours * 3600 * 1000

  if (!opt.force && memory && Date.now() - memory.updatedAt < ttl) return memory

  if (!opt.force) {
    const cached = readCache()
    if (cached && Date.now() - Number(cached.updatedAt) < ttl) {
      memory = withLookup(cached)
      return memory
    }
  }

  try {
    const fresh = scanSrIndex()
    const counts = SR_CHANNELS.map((c) => `${c.label}${fresh.channels[c.key].length}`).join(' / ')
    logger.mark(`[观测枢图鉴] 星铁索引已更新：${counts}`)
    writeCache(fresh)
    memory = withLookup(fresh)
    return memory
  } catch (err) {
    logger.error(`[观测枢图鉴] 星铁索引扫描失败：${err.message}`)
    const cached = readCache()
    if (cached) return (memory = withLookup(cached))
    return withLookup({ updatedAt: 0, channels: { character: [], weapon: [], artifact: [] } })
  }
}

/**
 * 星铁按名查条目：**只认完整名字**（别名由 srAlias 表解析）
 * 同样不做前缀/包含匹配，避免 `*希儿面板`、`*希儿图片` 这类指令被整条吃掉。
 */
export function findSrEntry (index, name = '') {
  const key = normName(name)
  if (!key) return null
  return index.lookup?.get(key) || null
}

export function srIndexCounts (index) {
  return SR_CHANNELS.map((c) => `${c.label} ${index.channels?.[c.key]?.length || 0} 条`).join('，')
}
