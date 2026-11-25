import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { normName } from './obcIndex.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const yunzaiRoot = path.resolve(pluginRoot, '..', '..')

/**
 * 别名解析（对齐停更版 Atlas 的做法，但多接了几路数据源）
 * 来源与优先级：
 *   1. 本插件自己的 data/alias.yaml（用户手工维护，正名: [别名...]）
 *   2. miao-plugin 的预设别名 resources/meta-gs/{character,weapon,artifact}/alias.js
 *   3. miao-plugin 的自定义别名 config/alias_gs.cfg（每行「正名：别名1，别名2」）
 *   4. 停更版 Atlas 的 plugins/Atlas/Genshin-Atlas/othername/*.yaml（武器/圣遗物/材料/特产）
 */
const SOURCES = {
  self: () => {
    // 自己的自定义别名：优先 config/alias.yaml（随仓库走），其次 data/alias.yaml
    const cfgFile = path.join(pluginRoot, 'config', 'alias.yaml')
    if (fs.existsSync(cfgFile)) return cfgFile
    return path.join(pluginRoot, 'data', 'alias.yaml')
  },
  miaoCharacter: () => path.join(yunzaiRoot, 'plugins', 'miao-plugin', 'resources', 'meta-gs', 'character', 'alias.js'),
  miaoWeapon: () => path.join(yunzaiRoot, 'plugins', 'miao-plugin', 'resources', 'meta-gs', 'weapon', 'alias.js'),
  miaoArtifact: () => path.join(yunzaiRoot, 'plugins', 'miao-plugin', 'resources', 'meta-gs', 'artifact', 'alias.js'),
  miaoCfg: () => path.join(yunzaiRoot, 'plugins', 'miao-plugin', 'config', 'alias_gs.cfg'),
  atlasDir: () => path.join(yunzaiRoot, 'plugins', 'Atlas', 'Genshin-Atlas', 'othername')
}

let cache = null

/** miao 的 alias.js 形如：  琴: 'Jean,团长,代理团长',  —— 按文本解析，避免执行别人的模块 */
function parseMiaoAliasJs (file) {
  const out = {}
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (e) {
    return out
  }
  const re = /^\s*([^\s:'"{}][^:'"]{0,30}?)\s*:\s*'([^']*)'/gm
  let m
  while ((m = re.exec(text))) {
    const real = m[1].replace(/^\/\/.*/, '').trim()
    if (!real) continue
    for (const a of String(m[2]).split(/[,，]/)) {
      const alias = a.trim()
      if (alias) out[alias] = real
    }
  }
  return out
}

/** 每行「正名：别名1，别名2，别名3」 */
function parseCfg (file) {
  const out = {}
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (e) {
    return out
  }
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#') || s.startsWith('//')) continue
    const m = s.split(/[:：]/)
    if (m.length < 2) continue
    const real = m[0].trim()
    for (const a of m.slice(1).join(':').split(/[,，]/)) {
      const alias = a.trim()
      if (alias) out[alias] = real
    }
  }
  return out
}

function parseYamlAlias (file) {
  const out = {}
  try {
    const obj = YAML.parse(fs.readFileSync(file, 'utf8'))
    for (const [real, list] of Object.entries(obj || {})) {
      if (!Array.isArray(list)) continue
      for (const a of list) {
        if (typeof a === 'string' && a.trim()) out[a.trim()] = real
      }
    }
  } catch (e) { /* 单个文件坏掉不影响其它来源 */ }
  return out
}

function build () {
  const map = new Map()
  const put = (alias, real) => {
    const k = normName(alias)
    if (!k || !real) return
    if (!map.has(k)) map.set(k, String(real))
  }

  // 先放的优先级更高（put 不覆盖已有键）：自己的 > miao 的 > 停更 Atlas 的
  const order = [
    () => parseYamlAlias(SOURCES.self()),
    () => parseCfg(SOURCES.miaoCfg()),
    () => parseMiaoAliasJs(SOURCES.miaoCharacter()),
    () => parseMiaoAliasJs(SOURCES.miaoWeapon()),
    () => parseMiaoAliasJs(SOURCES.miaoArtifact()),
    () => {
      const dir = SOURCES.atlasDir()
      const out = {}
      for (const f of ['weapon.yaml', 'artifact.yaml', 'material.yaml', 'specialty.yaml']) {
        Object.assign(out, parseYamlAlias(path.join(dir, f)))
      }
      return out
    }
  ]

  const sources = []
  for (const load of order) {
    const obj = load()
    if (!Object.keys(obj).length) continue
    for (const [alias, real] of Object.entries(obj)) {
      put(alias, real)
      sources.push(`${alias}=${real}`)
    }
  }
  return { map, count: map.size }
}

/** 别名 -> 正名（找不到返回 null），结果缓存在内存，restart 或改文件后 #图鉴更新 可刷新 */
export function resolveAlias (name = '') {
  const key = normName(name)
  if (!key) return null
  if (!cache) cache = build()
  const hit = cache.map.get(key)
  if (hit && normName(hit) !== key) return hit
  return null
}

export function aliasCount () {
  if (!cache) cache = build()
  return cache.count
}

/** 清掉内存缓存（#图鉴更新 时调用） */
export function clearAliasCache () {
  cache = null
}
