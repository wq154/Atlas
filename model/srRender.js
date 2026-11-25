import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { detailOf } from './srMeta.js'
import { SR_TYPE_CN, SR_ELEM, SR_PATH } from './srIndex.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')

const STAR_CN = { 1: '一星', 2: '二星', 3: '三星', 4: '四星', 5: '五星' }
const TYPE_EN = { character: 'CHARACTER', weapon: 'LIGHT CONE', artifact: 'RELIC SET' }

function fmtTime (ts = Date.now()) {
  const d = new Date(Number(ts) || Date.now())
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 组装星铁图鉴渲染数据（本地 meta-sr 详情 + 索引元信息） */
export function buildSrData (entry, index) {
  const detail = detailOf(entry)
  if (!detail) return null
  const star = detail.star || entry.star || 4
  return {
    ...detail,
    typeCn: SR_TYPE_CN[entry.type] || entry.type,
    typeEn: TYPE_EN[entry.type] || '',
    rarity: star,
    rarityClass: `r${star}`,
    starText: star ? new Array(star).fill('★').join('') : '',
    starCn: STAR_CN[star] || '',
    elemCn: SR_ELEM.includes(entry.elem) ? entry.elem : (entry.elem || ''),
    pathCn: entry.path || '',
    updatedText: fmtTime(index?.updatedAt),
    dataSource: '米游社星铁资料（miao meta-sr 本地镜像）'
  }
}

export async function renderSrImg (e, data) {
  const renderer = (await import('../../../lib/puppeteer/puppeteer.js')).default
  const dir = path.join(pluginRoot, 'resources', 'obc-sr')
  const base = dir.replace(/\\/g, '/') + '/'
  return await renderer.screenshot('obc-sr', {
    tplFile: `${base}index.html`,
    saveId: `obc-sr-${data.type}-${Date.now()}`,
    imgType: 'png',
    _res_path: base,
    pluResPath: base,
    ...data,
    sys: { scale: 'style="transform-origin:0 0;"' }
  })
}

/** 渲染失败时的纯文本兜底 */
export function buildSrText (data) {
  const lines = [`【星铁${data.typeCn}】${data.name}${data.starText ? ` ${data.starText}` : ''}`]
  if (data.type === 'character') {
    lines.push([data.pathCn && `${data.pathCn}命途`, data.elemCn, data.allegiance].filter(Boolean).join(' · '))
    if (data.baseAttr?.length) lines.push(data.baseAttr.map((i) => `${i.k} ${i.v}`).join(' / '))
    if (data.desc) lines.push(data.desc)
    for (const t of data.talents || []) lines.push(`【${t.type}】${t.name}：${t.desc}`)
  }
  if (data.type === 'weapon') {
    lines.push([data.pathCn && `${data.pathCn}命途`, data.starText].filter(Boolean).join(' · '))
    if (data.baseAttr?.length) lines.push(data.baseAttr.map((i) => `${i.k} ${i.v}`).join(' / '))
    if (data.affixTitle) lines.push(`【${data.affixTitle}】${data.affixText}`)
  }
  if (data.type === 'artifact') {
    for (const eff of data.effects || []) lines.push(`${eff.key}：${eff.text}`)
    if (data.pieces?.length) lines.push(`部件：${data.pieces.map((p) => p.name).join(' / ')}`)
  }
  lines.push(`数据来源：${data.dataSource} · ${data.updatedText}`)
  return lines.join('\n')
}
