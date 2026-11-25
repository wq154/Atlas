import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { normName } from './obcIndex.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const yunzaiRoot = path.resolve(pluginRoot, '..', '..')

/**
 * 星铁别名（对齐停更的 Atlas 星铁图鉴的做法）：
 *   1. 本插件 config/alias-sr.yaml（用户手工维护）
 *   2. miao-plugin resources/meta-sr/{character,weapon,artifact}/alias.js（官方预设别名 + 简称 abbr）
 *   3. 停更 Atlas 的 plugins/Atlas/star-rail-atlas/othername.json
 */
const SOURCES = {
  self: () => path.join(pluginRoot, 'config', 'alias-sr.yaml'),
  miaoCharacter: () => path.join(yunzaiRoot, 'plugins', 'miao-plugin', 'resources', 'meta-sr', 'character', 'alias.js'),
  miaoWeapon: () => path.join(yunzaiRoot, 'plugins', 'miao-plugin', 'resources', 'meta-sr', 'weapon', 'alias.js'),
  miaoArtifact: () => path.join(yunzaiRoot, 'plugins', 'miao-plugin', 'resources', 'meta-sr', 'artifact', 'alias.js'),
  atlasJson: () => path.join(yunzaiRoot, 'plugins', 'Atlas', 'star-rail-atlas', 'othername.json')
}

let cache = null

/**
 * miao 的 alias.js 长这样（键可能带引号，且一个文件里可能有 alias / abbr 多个对象）：
 *   export const alias = { '穹·毁灭': '穹毁灭,毁灭穹', 希儿: '蝴蝶,赛博蝴蝶' }
 * 这里按文本解析，不执行别人的模块。
 */
function parseAliasJs (file) {
  const out = {}
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    return out
  }
  const re = /(?:^|[\s,{])(?:'([^']+)'|"([^"]+)"|([^\s'":,{}]+))\s*:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/gm
  let m
  while ((m = re.exec(text))) {
    const real = (m[1] || m[2] || m[3] || '').trim()
    const value = (m[4] ?? m[5] ?? m[6] ?? '').trim()
    if (!real || !value) continue
    if (/^(import|export|const|let|var|return|function)$/.test(real)) continue
    for (const a of value.split(/[,，]/)) {
      const alias = a.trim()
      if (alias && alias !== real) out[alias] = real
    }
  }
  return out
}

/** 「正名：别名1，别名2」 文本 */
function parseCfg (file) {
  const out = {}
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    return out
  }
  for (const line of String(text).split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#') || s.startsWith('//')) continue
    const parts = s.split(/[:：]/)
    if (parts.length < 2) continue
    const real = parts[0].trim()
    for (const a of parts.slice(1).join(':').split(/[,，]/)) {
      const alias = a.trim()
      if (alias && alias !== real) out[alias] = real
    }
  }
  return out
}

function parseYamlAlias (file) {
  const out = {}
  try {
    const obj = YAML.parse(fs.readFileSync(file, 'utf8'))
    for (const [real, list] of Object.entries(obj || {})) {
      if (Array.isArray(list)) {
        for (const a of list) if (typeof a === 'string' && a.trim()) out[a.trim()] = real
      } else if (typeof list === 'string') {
        for (const a of list.split(/[,，]/)) if (a.trim()) out[a.trim()] = real
      }
    }
  } catch (err) { /* 单文件坏掉不影响别的 */ }
  return out
}

function parseAtlasJson (file) {
  const out = {}
  const obj = (() => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (err) {
      return null
    }
  })()
  if (!obj) return out
  for (const [real, list] of Object.entries(obj)) {
    if (Array.isArray(list)) {
      for (const a of list) if (typeof a === 'string' && a.trim()) out[a.trim()] = real
    } else if (typeof list === 'string') {
      for (const a of list.split(/[,，]/)) if (a.trim()) out[a.trim()] = real
    }
  }
  return out
}

function build () {
  const map = new Map()
  const put = (alias, real) => {
    const k = normName(alias)
    if (!k || !real) return
    if (!map.has(k)) map.set(k, String(real))
  }
  const order = [
    () => parseYamlAlias(SOURCES.self()),
    () => parseCfg(SOURCES.self()),
    () => parseAliasJs(SOURCES.miaoCharacter()),
    () => parseAliasJs(SOURCES.miaoWeapon()),
    () => parseAliasJs(SOURCES.miaoArtifact()),
    () => parseAtlasJson(SOURCES.atlasJson())
  ]
  for (const load of order) {
    const obj = load()
    for (const [alias, real] of Object.entries(obj)) put(alias, real)
  }
  return { map, count: map.size }
}

/** 星铁别名 → 正名（找不到返回 null） */
export function resolveSrAlias (name = '') {
  const key = normName(name)
  if (!key) return null
  if (!cache) cache = build()
  const hit = cache.map.get(key)
  if (hit && normName(hit) !== key) return hit
  return null
}

export function srAliasCount () {
  if (!cache) cache = build()
  return cache.count
}

export function clearSrAliasCache () {
  cache = null
}
