import plugin from '../../../lib/plugins/plugin.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { getSrIndex, findSrEntry, srIndexCounts, srMetaDir, clearSrMetaDirCache } from '../model/srIndex.js'
import { resolveSrAlias, srAliasCount, clearSrAliasCache } from '../model/srAlias.js'
import { buildSrData, renderSrImg, buildSrText } from '../model/srRender.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const configFile = path.join(pluginRoot, 'config.yaml')

const DEFAULT_CONFIG = { priority: 1, cacheHours: 12 }

function loadConfig () {
  try {
    if (!fs.existsSync(configFile)) fs.writeFileSync(configFile, YAML.stringify(DEFAULT_CONFIG), 'utf8')
    const userCfg = YAML.parse(fs.readFileSync(configFile, 'utf8')) || {}
    return { ...DEFAULT_CONFIG, ...userCfg }
  } catch (err) {
    return { ...DEFAULT_CONFIG }
  }
}

const cfg = loadConfig()

/**
 * 星铁图鉴（*希儿 / *于夜色中 / *云无留迹的过客）
 *
 * 数据说明：米游社的星铁 wiki（开拓者笔记）没有像原神观测枢那样可公开访问的接口
 * （app_sn=hkrpg_obc 之类的路径全部 404，wiki.miyoushe.com 也不通），
 * 所以星铁这张图走本地 miao-plugin/resources/meta-sr —— 它就是米游社星铁资料的镜像
 * （角色属性/技能/星魂/行迹、光锥数值/被动、遗器套装效果与部件图，全是本地文件，不联网不风控）。
 * 别名同样是本地三路：本插件 config/alias-sr.yaml + miao 预设别名/简称 + 停更 Atlas 的星铁别名表。
 */
export class ObcSr extends plugin {
  constructor () {
    super({
      name: '星铁图鉴',
      dsc: '星穹铁道 角色/光锥/遗器 图鉴（*希儿），数据取自本地星铁资料库',
      event: 'message',
      priority: cfg.priority,
      rule: [
        { reg: '^[#*/]\\s*(?:星铁|星穹|星轨|星穹铁道|sr)\\s*(?:观测枢|图鉴)?\\s*(?:更新|刷新|升级)$', fnc: 'update' },
        { reg: '^[#*/]\\s*(?:星铁|星穹|星轨|星穹铁道|sr)\\s*(?:观测枢|图鉴)?\\s*(?:帮助|说明|指令|菜单)$', fnc: 'help' },
        { reg: '^\\*\\s*(?:帮助|说明|指令|菜单)$', fnc: 'help' },
        // 严格指令：整条只能是「*名字」，名字必须是正名或别名
        // `*希儿面板`、`*希儿图片` 这类带后缀的一律放行给别的插件
        { reg: '^\\*\\s*([^\\s#*+＋/]{1,14})\\s*$', fnc: 'sr' }
      ]
    })
  }

  /** 抢一份原始指令快照（miao 的 accept 会改写 e.msg） */
  accept (e) {
    if (e && !e.obc_sr_msg) e.obc_sr_msg = e.original_msg || e.msg
    return false
  }

  rawMsg (e) {
    return String(e?.obc_sr_msg || e?.obc_msg || e?.original_msg || e?.msg || '')
  }

  async update (e) {
    clearSrAliasCache()
    clearSrMetaDirCache()
    const index = await getSrIndex({ cacheHours: cfg.cacheHours, force: true })
    await e.reply([
      `星铁图鉴索引已刷新：${srIndexCounts(index)}`,
      `别名表已重载：${srAliasCount()} 条（miao 预设别名/简称 + Atlas + 自定义）`,
      `数据目录：${srMetaDir()}`,
      `数据来源：${index.source}`
    ].join('\n'))
    return true
  }

  async help (e) {
    await e.reply([
      '【星铁图鉴】星穹铁道 角色 / 光锥 / 遗器',
      '· *角色名　例：*希儿、*三月七（别名也行：*蝴蝶、*火主）',
      '· *光锥名　例：*于夜色中（*夜色、*纯粹思维 这类简称也认）',
      '· *遗器名　例：*云无留迹的过客（*过客、*莳者 等别名）',
      '· 严格指令：整条只能有「*名字」，带后缀的（*希儿面板 / *希儿图片）一律放行给别的插件',
      '· #星铁图鉴更新　重建星铁索引与别名表',
      '数据来源：本地星铁资料库（miao meta-sr，米游社星铁资料镜像）；别名来自 miao 预设 + 停更 Atlas + 插件 config/alias-sr.yaml'
    ].join('\n'))
    return true
  }

  /** 从指令里取名字：*希儿（严格：只剥 * 前缀） */
  extractName (msg) {
    const text = String(msg || '').trim()
      .replace(/^\*+/, '')
      .replace(/[\s\u3000]+/g, '')
    return text.slice(0, 14)
  }

  async sr (e) {
    const raw = this.rawMsg(e)
    // 规则已限定成「*名字 整条」，这里再兜一层底
    if (!/^\*\s*[^\s#*+＋/]{1,14}\s*$/.test(raw.trim())) return false
    const name = this.extractName(raw)
    if (!name) return false

    let index
    try {
      index = await getSrIndex({ cacheHours: cfg.cacheHours })
    } catch (err) {
      logger.error(`[星铁图鉴] 索引获取异常：${err}`)
      return false
    }

    const lookup = (idx) => {
      const hit = findSrEntry(idx, name)
      if (hit) return hit
      const real = resolveSrAlias(name)
      if (!real) return null
      const byAlias = findSrEntry(idx, real)
      if (byAlias) logger.debug(`[星铁图鉴] 别名「${name}」→「${real}」`)
      return byAlias
    }

    let entry = lookup(index)
    if (!entry) {
      // 可能是新角色/新光锥，或别名表刚改过：强制重扫一次
      try {
        clearSrAliasCache()
        index = await getSrIndex({ cacheHours: cfg.cacheHours, force: true })
        entry = lookup(index)
      } catch (err) {
        logger.error(`[星铁图鉴] 索引重建失败：${err.message}`)
      }
    }

    if (!entry) {
      logger.mark(`[星铁图鉴] 未收录「${name}」（${srIndexCounts(index)}）—— 放行给后面的插件`)
      // 严格模式：查不到就静默放行
      return false
    }

    logger.debug(`[星铁图鉴] 命中「${name}」→ ${entry.type}：${entry.name}`)
    const data = buildSrData(entry, index)
    if (!data) {
      await e.reply(`星铁图鉴数据读取失败：「${entry.name}」`)
      return true
    }

    const img = await renderSrImg(e, data).catch((err) => {
      logger.error(`[星铁图鉴] 渲染异常：${err}`)
      return false
    })
    if (img) {
      await e.reply(img)
      return true
    }
    await e.reply(buildSrText(data))
    return true
  }
}
