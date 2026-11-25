import plugin from '../../../lib/plugins/plugin.js'
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'
import { getIndex, findEntry, CHANNELS } from '../model/obcIndex.js'
import { getWeaponMeta, getCharacterMeta, getArtifactMeta, ELEM_CN, WEAPON_CN } from '../model/miaoMeta.js'
import { getEntryPage, parseEntryPage } from '../model/obcEntry.js'
import { resolveAlias, aliasCount, clearAliasCache } from '../model/alias.js'
import { getSrIndex, findSrEntry, srIndexCounts } from '../model/srIndex.js'
import { resolveSrAlias } from '../model/srAlias.js'
import { buildSrData, renderSrImg, buildSrText } from '../model/srRender.js'
import { loadCharMeta, parseAscension, buildMaterialCard, materialHtml } from '../model/materialCard.js'
import { buildArtifactCard, buildWeaponCard, buildCharacterCard, cardHtml } from '../model/atlasCard.js'
import { artifactCardHtml } from '../model/artifactTemplate.js'
import { buildWeaponCard as buildWeaponCardData, weaponCardHtml } from '../model/weaponTemplate.js'
import { charMatHtml } from '../model/charMatTemplate.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(__dirname, '..')
const configFile = path.join(pluginRoot, 'config.yaml')

const DEFAULT_CONFIG = {
  /** 优先级：比 Atlas 图鉴（10）小一点，先接管角色/武器/圣遗物图鉴指令 */
  priority: 9,
  /** 观测枢索引缓存时长（小时） */
  cacheHours: 12,
  /** 用本地 miao-plugin 元数据补全武器属性/被动、圣遗物部件、角色属性 */
  useLocalMeta: true
}

function loadConfig () {
  try {
    if (!fs.existsSync(configFile)) {
      fs.writeFileSync(configFile, YAML.stringify(DEFAULT_CONFIG), 'utf8')
    }
    const userCfg = YAML.parse(fs.readFileSync(configFile, 'utf8')) || {}
    return { ...DEFAULT_CONFIG, ...userCfg }
  } catch (err) {
    logger.error(`[观测枢图鉴] 配置读取失败：${err.message}`)
    return { ...DEFAULT_CONFIG }
  }
}

const cfg = loadConfig()
const TYPE_CN = { character: '角色', weapon: '武器', artifact: '圣遗物' }
const STAR_CN = { 1: '一星', 2: '二星', 3: '三星', 4: '四星', 5: '五星' }

/** 观测枢里同名条目会重复（例如旅行者的多种形态），按名字去重 */
function dedupeByName (list = []) {
  const seen = new Set()
  return list.filter((item) => {
    const key = String(item?.name || '')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * 米游社观测枢图鉴（原神）
 * - 索引/属性/圣遗物套装效果：实时取自米游社观测枢接口
 * - 武器属性数值与被动、圣遗物五个部件、角色基础属性：本地 miao-plugin 元数据补全（可选）
 * - 优先级比停更的 Atlas 图鉴小 1，先接管角色 / 武器 / 圣遗物 三个分类
 */
export class ObcAtlas extends plugin {
  constructor () {
    super({
      name: '观测枢图鉴',
      dsc: '原神 角色/武器/圣遗物 图鉴（米游社观测枢实时数据，排版仿 Atlas）',
      event: 'message',
      priority: cfg.priority,
      rule: [
        { reg: '^[#*/]\\s*(?:观测枢|图鉴)\\s*(?:更新|刷新|升级)$', fnc: 'update' },
        { reg: '^\\s*(?:观测枢|图鉴)\\s*(?:更新|刷新|升级)$', fnc: 'update' },
        { reg: '^[#*/]\\s*(?:观测枢|图鉴)\\s*(?:帮助|说明|指令)$', fnc: 'help' },
        { reg: '^\\s*(?:观测枢|图鉴)\\s*(?:帮助|说明|指令)$', fnc: 'help' },
        // 严格指令：整条只能是「#名字」/「/名字」，名字必须是正名或别名（别名由 alias 表解析）
        // `#刻晴图片`、`#刻晴面板`、`#刻晴图鉴` 这类「名字+后缀」一律放行给别的插件
        // 「名字+材料/素材/突破」：Atlas 有官方材料图就让给它（原插件美术），没有才自己出图
        { reg: '^[#/]\\s*([^\\s#*+＋/]{1,12}?)\\s*(?:材料|素材|突破)$', fnc: 'materialFallback' },
        { reg: '^[#/]\\s*([^\\s#*+＋/]{1,14})\\s*$', fnc: 'atlas' }
      ]
    })
  }

  /**
   * accept 会在「规则匹配之前」执行（按插件优先级）。
   * miao-plugin 的 AvatarCard.check 在 accept 阶段只要认出消息里有角色名，
   * 就会把 e.msg 整个改写成 '#喵喵角色卡片'，之后规则匹配拿到的就不是用户原话了。
   * 这里先抢一份原始指令，出图时用这份。
   */
  accept (e) {
    if (e && !e.obc_msg) e.obc_msg = e.original_msg || e.msg
    return false
  }

  /** 用户真正发的指令：优先 accept 阶段留下的快照 */
  rawMsg (e) {
    return String(e?.obc_msg || e?.original_msg || e?.msg || '')
  }

  /** 拉取/刷新观测枢索引 */
  async update (e) {
    clearAliasCache()
    const index = await getIndex({ cacheHours: cfg.cacheHours, force: true })
    const detail = CHANNELS.map((c) => `${c.label} ${index.channels[c.key]?.length || 0} 条`).join('，')
    await e.reply(`观测枢图鉴索引已刷新：${detail}\n别名表已重载：${aliasCount()} 条（miao 预设 + 自定义 + Atlas）\n数据来源：米游社观测枢 · ${this.fmtTime(index.updatedAt)}`)
    return true
  }

  async help (e) {
    await e.reply([
      '【观测枢图鉴】原神 角色 / 武器 / 圣遗物 图鉴',
      '· #角色名　例：#芙宁娜（别名也行：#芙芙、#帝君、#岩王爷…）',
      '· #武器名　例：#雾切之回光（#雾切、#静水）',
      '· #圣遗物名　例：#绝缘之旗印（#绝缘套、#充能套）',
      '· 严格指令：整条只能有「#名字」，带后缀的（#刻晴图片 / #刻晴图鉴 / #刻晴面板）一律放行给别的插件',
      `· #图鉴更新　强制刷新观测枢索引与别名表（缓存 ${cfg.cacheHours} 小时）`,
      '· 星铁请用 * 前缀：*希儿、*于夜色中、*云无留迹的过客（详见 #星铁图鉴帮助）',
      '数据来源：米游社观测枢；别名来自 miao 预设 + 自定义 + Atlas；武器数值/圣遗物部件/角色属性用本地 miao 数据补全'
    ].join('\n'))
    return true
  }

  /** 主入口：按名字出图鉴图（严格指令：#名字 / /名字，整条） */
  async atlas (e, forcedName = '') {
    const raw = this.rawMsg(e)
    // 规则已限定成「#名字 整条」，这里再兜一层底，群聊/带后缀的一律放行
    if (!/^[#/]\s*[^\s#*+＋/]{1,14}\s*$/.test(raw.trim())) return false

    const name = forcedName || this.extractName(raw)
    if (!name) return false

    let index
    try {
      index = await getIndex({ cacheHours: cfg.cacheHours })
    } catch (err) {
      logger.error(`[观测枢图鉴] 索引获取异常：${err}`)
      return false
    }

    // 先查正名，再查别名（miao / 停更 Atlas / 自定义别名表），最后才考虑刷索引
    const lookup = () => {
      const hit = findEntry(index, name)
      if (hit) return hit
      const real = resolveAlias(name)
      if (!real) return null
      const byAlias = findEntry(index, real)
      if (byAlias) logger.debug(`[观测枢图鉴] 别名「${name}」→「${real}」`)
      return byAlias
    }

    let entry = lookup()
    if (!entry && Date.now() - Number(index.updatedAt || 0) > 10 * 60 * 1000) {
      // 索引里没有 → 可能是新角色/新武器，强制刷一次再找（10 分钟内不重复刷）
      try {
        index = await getIndex({ cacheHours: cfg.cacheHours, force: true })
        entry = lookup()
      } catch (err) {
        logger.error(`[观测枢图鉴] 索引刷新失败：${err.message}`)
      }
    }

    if (!entry) {
      // 原神图鉴里没有 → 可能是星铁的角色/光锥/遗器（例：#希儿），转星铁图鉴出图
      const srEntry = await this.lookupSr(name).catch((err) => {
        logger.error(`[观测枢图鉴] 星铁索引查询失败：${err.message}`)
        return null
      })
      if (srEntry) return await this.renderSr(e, srEntry)

      const counts = CHANNELS.map((c) => `${c.label}${index.channels?.[c.key]?.length || 0}`).join('/')
      logger.mark(`[观测枢图鉴] 未收录「${name}」（索引 ${counts}）—— 放行给后面的插件`)
      // 严格模式：查不到就静默放行（面板/图片/图鉴这些指令可能是别的插件的）
      return false
    }
    logger.debug(`[观测枢图鉴] 命中「${name}」→ ${entry.type}：${entry.name}`)

    // 词条页：推荐装备（武器/圣遗物推荐+理由）、推荐角色、突破材料数量 —— 拿不到就退回本地补全
    let rec = null
    // ⚠ 必须在 try 外面声明：图鉴卡也要用这份词条页，写在 try 里会变成块作用域
    let page = null
    try {
      page = await getEntryPage(entry.id, { cacheHours: cfg.cacheHours })
      rec = parseEntryPage(page)
    } catch (err) {
      logger.error(`[观测枢图鉴] 词条详情获取失败：${err.message}`)
    }

    let data
    try {
      data = this.buildRenderData(entry, index, rec)
    } catch (err) {
      logger.error(`[观测枢图鉴] 组装数据失败：${err}`)
      return false
    }

    // 角色：走原来那版「超长详细」的 HTML 图鉴页（数据最全），
    // 不自绘材料卡（材料卡只属于 `#角色名材料`），也不套用武器/圣遗物的海报版式。
    if (entry.type === 'character') {
      const legacy = await this.renderImg(e, data)
      if (legacy) {
        await e.reply(legacy)
        return true
      }
      await e.reply(this.buildText(data))
      return true
    }

    // 武器 / 圣遗物：先自绘（Gemini 那两版模板），画不出来才退回 Atlas 官方图 / 老 HTML 页
    let img = false
    try {
      const cardHtmlText = await this.buildAtlasCardHtml(entry, page)
      if (cardHtmlText) img = await this.renderHtmlImg(e, cardHtmlText, `card-${entry.type}-${entry.id}`)
    } catch (err) {
      logger.error(`[观测枢图鉴] 图鉴卡渲染失败：${err}`)
    }
    if (!img) {
      try {
        const atlasFile = this.atlasImageFor(entry)
        if (atlasFile) {
          const seg = globalThis.segment?.image?.(`file://${atlasFile}`)
          if (seg) {
            logger.debug(`[观测枢图鉴] ${entry.name} 退回 Atlas 官方图：${atlasFile}`)
            await e.reply(seg)
            return true
          }
        }
      } catch (err) {
        logger.error(`[观测枢图鉴] 取 Atlas 官方图失败：${err}`)
      }
    }
    if (!img) img = await this.renderImg(e, data)
    if (img) {
      await e.reply(img)
      return true
    }

    await e.reply(this.buildText(data))
    return true
  }

  /**
   * 「#名字材料 / #名字素材 / #名字突破」的兜底。
   *
   * Atlas 的材料图是官方攻略图（原插件那种美术），
   * 所以**只要它库里有这张图就一律放行**；只有新角色（上游还没出图，比如奥黛塔）
   * 才由观测枢出一页图鉴（页面里带「角色突破」材料）。
   */
  async materialFallback (e) {
    const raw = this.rawMsg(e)
    const m = raw.trim().match(/^[#/]\s*([^\s#*+＋/]{1,12}?)\s*(?:材料|素材|突破)$/)
    if (!m) return false
    const name = m[1]
    const real = resolveAlias(name) || name
    if (this.atlasHasMaterial(name) || this.atlasHasMaterial(real)) {
      logger.debug(`[观测枢图鉴] ${name} 的材料图交给 Atlas 出官方图`)
      return false
    }
    logger.mark(`[观测枢图鉴] ${name} 没有官方材料图 → 自绘 Atlas 款式材料卡`)
    // 走观测枢索引拿条目 → 词条页拿「角色突破」明细 → 用 miao 的材料正名/立绘画卡
    let index
    try {
      index = await getIndex({ cacheHours: cfg.cacheHours })
    } catch (err) {
      logger.error(`[观测枢图鉴] 材料卡取索引失败：${err.message}`)
      return await this.atlas(e, real)
    }
    const hit = findEntry(index, real) || findEntry(index, name)
    if (!hit || hit.type !== 'character') return await this.atlas(e, real)
    const meta = loadCharMeta(hit.name)
    if (!meta) return await this.atlas(e, real)
    let page = null
    try {
      page = await getEntryPage(hit.id, { cacheHours: cfg.cacheHours })
    } catch (err) {
      logger.error(`[观测枢图鉴] 材料卡取词条页失败：${err.message}`)
    }
    let card = null
    try {
      card = await buildMaterialCard(hit, meta, parseAscension(page))
    } catch (err) {
      logger.error(`[观测枢图鉴] 材料卡组装失败：${err}`)
    }
    if (card) {
      const img = await this.renderMaterialImg(e, card)
      if (img) {
        await e.reply(img)
        return true
      }
    }
    // 材料卡画不出来（四星 / 数据不全 / 渲染异常）→ 退回图鉴页
    logger.mark(`[观测枢图鉴] ${name} 材料卡降级为图鉴页`)
    return await this.atlas(e, real)
  }

  /** Atlas 官方图（角色 / 武器 / 圣遗物）：有就返回绝对路径，没有返回空串 */
  atlasImageFor (entry) {
    // 角色在 Atlas 里对应的就是 `material for role`（材料卡，唯一现成的角色图）
    // 只有武器继续用 Atlas 官方图；圣遗物/角色按用户要求改成自绘（Atlas 版式）
    const syncOf = { weapon: 'weapon' }[entry?.type]
    if (!entry || !syncOf) return ''
    try {
      const lib = path.resolve(pluginRoot, '..', 'Atlas', 'Genshin-Atlas')
      const mapFile = path.join(lib, 'path.json')
      if (!fs.existsSync(mapFile)) return ''
      const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'))
      const rel = (map[syncOf] || {})[entry.name]
      if (!rel) return ''
      const abs = path.join(lib, rel.replace(/^\//, '').replace(/\//g, path.sep))
      return fs.existsSync(abs) ? abs : ''
    } catch (err) {
      logger.error(`[观测枢图鉴] 读 Atlas path.json 失败：${err.message}`)
      return ''
    }
  }

  /** 按 entry 类型组装 Atlas 款式图鉴卡 HTML（角色 / 武器 / 圣遗物） */
  async buildAtlasCardHtml (entry, page) {
    if (!entry || !page) return ''
    if (entry.type === 'character') {
      const card = await buildCharacterCard(entry, page, loadCharMeta(entry.name))
      return card ? cardHtml(card) : ''
    }
    if (entry.type === 'weapon') {
      const weaponData = await buildWeaponCardData(entry, page)
      return weaponData ? weaponCardHtml(weaponData) : ''
    }
    if (entry.type === 'artifact') {
      const card = await buildArtifactCard(entry, page)
      return card ? artifactCardHtml(card) : ''
    }
    return ''
  }

  /** 缓存文件路径：HTML 内容 hash（数据没变就不会重渲染） */
  cacheFileFor (htmlText, tag) {
    const h = crypto.createHash('sha1').update(tag).update(htmlText).digest('hex').slice(0, 16)
    const dir = path.join(pluginRoot, 'resources', 'obc', 'cache')
    fs.mkdirSync(dir, { recursive: true })
    return path.join(dir, `${tag}-${h}.webp`)
  }

  /** 缓存命中就直接返回图片段；没有返回 null */
  cachedReply (file) {
    try {
      if (!fs.existsSync(file) || fs.statSync(file).size < 3000) return null
      const seg = globalThis.segment?.image?.(`file://${file}`)
      return seg || fs.readFileSync(file)
    } catch (err) {
      return null
    }
  }

  /** 只留最近 400 张缓存，别把磁盘塞满 */
  pruneCache (dir, keep = 400) {
    try {
      const files = fs.readdirSync(dir)
        .filter((f) => f.endsWith('.webp'))
        .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      if (files.length <= keep) return
      files.sort((a, b) => a.t - b.t)
      for (const it of files.slice(0, files.length - keep)) {
        try { fs.unlinkSync(path.join(dir, it.f)) } catch (err) { /* 忽略 */ }
      }
    } catch (err) { /* 忽略 */ }
  }

  /**
   * 统一的出图：先查缓存 → 没命中就写临时 HTML 截图 → 存成 webp → 返回图片段。
   * @param {string} htmlText 完整 HTML
   * @param {string} tag 缓存前缀（card / material / legacy）
   */
  async renderAndCache (e, htmlText, tag) {
    // 默认实时渲染（config.yaml 的 renderCache 默认 false）；开了才走本地缓存
    const useCache = cfg.renderCache === true
    const cache = useCache ? this.cacheFileFor(htmlText, tag) : ''
    if (useCache) {
      const hit = this.cachedReply(cache)
      if (hit) {
        logger.debug(`[观测枢图鉴] ${tag} 命中本地缓存`)
        return hit
      }
    }
    const tmp = path.join(pluginRoot, 'resources', 'obc', `_${tag}_${Date.now()}.html`)
    try {
      fs.writeFileSync(tmp, htmlText, 'utf8')
      const renderer = (await import('../../../lib/puppeteer/puppeteer.js')).default
      const base = (path.join(pluginRoot, 'resources', 'obc') + '/').replace(/\\/g, '/')
      const buf = await renderer.render('obc-atlas', {
        tplFile: tmp.replace(/\\/g, '/'),
        saveId: `obc-${tag}-${Date.now()}`,
        imgType: 'webp',
        quality: 92,
        deviceScaleFactor: 2,
        _res_path: base,
        pluResPath: base,
        sys: { scale: 'style="transform-origin:0 0;"' }
      })
      const buffer = Array.isArray(buf) ? buf[0] : buf
      if (!buffer || !buffer.length) return false
      if (useCache) {
        fs.writeFileSync(cache, buffer)
        this.pruneCache(path.dirname(cache))
        logger.debug(`[观测枢图鉴] ${tag} 出图并缓存：${(buffer.length / 1024).toFixed(0)}KB`)
        return this.cachedReply(cache) || segment.image(buffer)
      }
      logger.debug(`[观测枢图鉴] ${tag} 实时出图：${(buffer.length / 1024).toFixed(0)}KB`)
      return segment.image(buffer)
    } catch (err) {
      logger.error(`[观测枢图鉴] ${tag} 截图异常：${err}`)
      return false
    } finally {
      try { fs.unlinkSync(tmp) } catch (err) { /* 删不掉就算了 */ }
    }
  }

  /** 通用：把一段 HTML 写临时文件 → puppeteer 截图 → 删临时文件 */
  async renderHtmlImg (e, htmlText, tag = 'card') {
    return await this.renderAndCache(e, htmlText, tag)
  }

  /** 渲染自绘材料卡：写临时 HTML → puppeteer 截图 1920×1080 → 删临时文件 */
  async renderMaterialImg (e, card) {
    // Gemini 那版「角色培养材料（七元素换肤）」模板：1280×720，四栏
    const html = charMatHtml({
      element: card.elem,
      stars: card.star,
      fullName: `${card.title ? card.title + ' · ' : ''}${card.name}`,
      portrait: card.splash,
      asc: (card.cols || {}).break || [],
      talent: (card.cols || {}).talent || [],
      lv80: (card.cols || {}).lv80 || [],
      tal8: (card.cols || {}).talent80 || []
    })
    return await this.renderAndCache(e, html, 'material')
  }

  /** Atlas 图库里有没有这张角色材料图（只读 path.json 与别名表，不碰图片） */
  atlasHasMaterial (name) {
    try {
      const lib = path.resolve(pluginRoot, '..', 'Atlas', 'Genshin-Atlas')
      const p = path.join(lib, 'path.json')
      if (!fs.existsSync(p)) return false
      const map = JSON.parse(fs.readFileSync(p, 'utf8'))['material for role'] || {}
      if (Object.prototype.hasOwnProperty.call(map, name)) return true
      const aliasFile = path.join(lib, 'othername', 'material for role.yaml')
      if (fs.existsSync(aliasFile)) {
        const obj = YAML.parse(fs.readFileSync(aliasFile, 'utf8')) || {}
        for (const key in obj) {
          const arr = (obj[key] || []).map(String)
          if ((key === name || arr.includes(name)) && Object.prototype.hasOwnProperty.call(map, key)) {
            return true
          }
        }
      }
    } catch (err) {
      logger.error(`[观测枢图鉴] 检查 Atlas 材料图失败：${err.message}`)
    }
    return false
  }

  /** 星铁索引里找名字（正名 → 别名），找不到返回 null */
  async lookupSr (name) {
    const index = await getSrIndex({ cacheHours: cfg.cacheHours })
    const hit = findSrEntry(index, name)
    if (hit) return hit
    const real = resolveSrAlias(name)
    if (!real) return null
    return findSrEntry(index, real)
  }

  /** 命中星铁条目：用星铁模板出图（#希儿 也能出） */
  async renderSr (e, srEntry) {
    const index = await getSrIndex({ cacheHours: cfg.cacheHours })
    const data = buildSrData(srEntry, index)
    if (!data) return false
    logger.mark(`[观测枢图鉴] 「${srEntry.name}」是星铁条目（${srIndexCounts(index)}），转星铁图鉴出图`)
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

  /** 从指令里取名字：#芙宁娜 / /芙宁娜（严格：只剥前缀，不剥任何后缀词） */
  extractName (msg) {
    const text = String(msg || '').trim()
      .replace(/^[#/]+/, '')        // 只剥掉指令前缀
      .replace(/[\s\u3000]+/g, '')  // 去掉内部空白
    // 严格模式：**不**剥「图鉴 / 观测枢 / 面板 / 图片」这些词
    // —— 剥了就变成 #刻晴图鉴 → 刻晴，会把别人的指令抢过来
    return text.slice(0, 14)
  }

  /** 合并观测枢条目 + 本地 miao 元数据 */
  buildRenderData (entry, index, rec = null) {
    const starText = entry.star ? new Array(entry.star).fill('★').join('') : ''
    const rar = entry.star || 3
    const base = {
      type: entry.type,
      typeCn: TYPE_CN[entry.type] || entry.type,
      name: entry.name,
      icon: entry.icon,
      star: entry.star || 0,
      rarity: rar,
      rarityClass: `r${rar}`,
      starText,
      starCn: STAR_CN[entry.star] || '',
      summary: entry.summary || '',
      tags: entry.tags || [],
      sources: entry.sources || entry.effectTags || [],
      effects: entry.effects || [],
      updatedAt: index.updatedAt,
      updatedText: this.fmtTime(index.updatedAt),
      dataSource: '米游社观测枢'
    }

    const useMiao = cfg.useLocalMeta !== false
    if (base.type === 'character') {
      const meta = useMiao ? getCharacterMeta(entry.name) : null
      if (meta) {
        base.meta = meta
        base.title = meta.title || ''
        base.elemCn = meta.elemCn
        base.weaponCn = meta.weaponCn
        base.regionCn = meta.allegiance || entry.region || ''
        base.birth = meta.birth || ''
        base.astro = meta.astro || ''
        base.cncv = meta.cncv || ''
        base.jpcv = meta.jpcv || ''
        base.desc = meta.desc || ''
        base.baseAttr = [
          { k: '生命值', v: this.num(meta.baseAttr?.hp) },
          { k: '攻击力', v: this.num(meta.baseAttr?.atk) },
          { k: '防御力', v: this.num(meta.baseAttr?.def) }
        ].filter((i) => i.v)
        base.growAttr = meta.growValue ? { k: meta.growCn, v: `${meta.growValue}%` } : null
        base.materials = meta.materials || []
        base.matAsc = meta.matPlan?.ascension || []
        base.matTalent = meta.matPlan?.talent || []
      }
      base.elemCn = base.elemCn || ELEM_CN[entry.elem] || entry.elem || ''
      base.weaponCn = base.weaponCn || WEAPON_CN[entry.weaponType] || entry.weaponType || ''
      base.regionCn = base.regionCn || entry.region || ''
      // 同类型武器（观测枢武器频道按武器类型筛，五星优先），横向参考用
      base.weapons = dedupeByName((index.channels.weapon || [])
        .filter((w) => w.weaponType && base.weaponCn && w.weaponType === base.weaponCn)
        .sort((a, b) => (b.star || 0) - (a.star || 0)))
        .slice(0, 6)
        .map((w) => ({ name: w.name, icon: w.icon, star: w.star, starText: w.star ? new Array(w.star).fill('★').join('') : '' }))
    }

    if (base.type === 'weapon') {
      const meta = useMiao ? getWeaponMeta(entry.name) : null
      if (meta) {
        base.meta = meta
        base.desc = meta.desc || ''
        base.affixTitle = meta.affixTitle || ''
        base.affixTexts = meta.affixTexts || []
        base.affixTextRich = meta.affixTextRich || meta.affixTexts?.[0] || ''
        base.baseAtk = meta.baseAtk ? Number(meta.baseAtk).toFixed(0) : ''
        base.subAttr = meta.subValue ? `${meta.subCn} ${meta.subValue}%` : ''
        base.materials = meta.materials || []
        base.matWeapon = meta.matPlan?.weaponGroups || []
      }
      base.weaponType = entry.weaponType || ''
      base.subAttrs = entry.subAttrs || []
      // 适用角色（观测枢角色频道按武器类型筛，五星优先展示）
      base.characters = dedupeByName((index.channels.character || [])
        .filter((c) => c.weaponType && base.weaponType && c.weaponType === base.weaponType))
        .sort((a, b) => (b.star || 0) - (a.star || 0))
        .slice(0, 10)
        .map((c) => ({ name: c.name, icon: c.icon, star: c.star }))
    }

    if (base.type === 'artifact') {
      const meta = useMiao ? getArtifactMeta(entry.name) : null
      if (meta) {
        base.meta = meta
        base.pieces = meta.pieces || []
      }
      base.effectTags = entry.effectTags || []
    }

    // ===== 观测枢词条页：推荐装备 / 推荐角色 / 突破材料数量（优先用真数据）=====
    if (rec) {
      const capOf = (kind) => ({ weapon: 6, artifact: 6 }[kind] || 8)
      base.recommend = (rec.tables || []).map((t) => {
        const list = (t.items || []).filter((i) => i.name && i.name !== t.tabName)
        return {
          tabName: t.tabName,
          kind: t.kind,
          total: list.length,
          items: list.slice(0, capOf(t.kind)).map((i) => ({
            name: i.name,
            icon: i.icon,
            reason: (i.reason || '').slice(0, 170)
          }))
        }
      }).filter((t) => t.items.length)
      base.recWeapons = base.recommend.filter((t) => t.kind === 'weapon')
      base.recArtifacts = base.recommend.filter((t) => t.kind === 'artifact')
      base.recRoles = base.recommend.filter((t) => t.kind === 'character' || t.kind === 'other')
      base.materialsObc = rec.fullMaterials || []
      if (rec.pieces?.length) base.obcPieces = rec.pieces
    }

    return base
  }

  num (val) {
    if (val === undefined || val === null || val === '') return ''
    const n = Number(val)
    return Number.isNaN(n) ? '' : n.toFixed(1)
  }

  fmtTime (ts = Date.now()) {
    const d = new Date(Number(ts) || Date.now())
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  buildText (data) {
    const lines = [`【${data.typeCn}图鉴】${data.name}${data.starText ? ` ${data.starText}` : ''}`]
    if (data.summary && data.summary !== data.name) lines.push(data.summary)
    if (data.type === 'character') {
      const info = [data.elemCn, data.weaponCn, data.regionCn].filter(Boolean).join(' · ')
      if (info) lines.push(info)
      if (data.baseAttr?.length) lines.push(data.baseAttr.map((i) => `${i.k} ${i.v}`).join(' / '))
      if (data.tags?.length) lines.push(`特殊机制：${data.tags.join(' / ')}`)
    }
    if (data.type === 'weapon') {
      const info = [data.weaponType, data.subAttr].filter(Boolean).join(' · ')
      if (info) lines.push(info)
      if (data.baseAtk) lines.push(`基础攻击力 ${data.baseAtk}`)
      if (data.affixTitle) lines.push(`${data.affixTitle}：${data.affixTextRich || data.affixTexts?.[0] || ''}`)
    }
    if (data.type === 'artifact') {
      for (const eff of data.effects || []) lines.push(`${eff.key}：${eff.value}`)
      if (data.pieces?.length) lines.push(`部件：${data.pieces.map((p) => p.name).join(' / ')}`)
    }
    if (data.sources?.length) lines.push(`获取：${data.sources.join(' / ')}`)
    if (data.materials?.length) lines.push(`材料：${data.materials.map((m) => m.name).join(' / ')}`)
    lines.push(`数据来源：${data.dataSource} · ${data.updatedText}`)
    return lines.join('\n')
  }

  async renderImg (e, data) {
    try {
      const tplFile = path.join(pluginRoot, 'resources', 'obc', 'index.html')
      if (!fs.existsSync(tplFile)) return false
      // 缓存 key 用模板内容 + 数据，模板或数据一变就重新渲染
      const tpl = fs.readFileSync(tplFile, 'utf8')
      const key = tpl + '\n/*DATA*/\n' + JSON.stringify(data)
      const useCache = cfg.renderCache === true
      const cache = useCache ? this.cacheFileFor(key, 'legacy') : ''
      if (useCache) {
        const hit = this.cachedReply(cache)
        if (hit) {
          logger.debug('[观测枢图鉴] legacy 命中本地缓存')
          return hit
        }
      }
      const renderer = (await import('../../../lib/puppeteer/puppeteer.js')).default
      const base = (path.join(pluginRoot, 'resources', 'obc') + '/').replace(/\\/g, '/')
      const buf = await renderer.render('obc-atlas', {
        tplFile: tplFile.replace(/\\/g, '/'),
        saveId: `obc-${data.type}-${Date.now()}`,
        imgType: 'webp',
        quality: 92,
        deviceScaleFactor: 2,
        _res_path: base,
        pluResPath: base,
        ...data,
        sys: { scale: 'style="transform-origin:0 0;"' }
      })
      const buffer = Array.isArray(buf) ? buf[0] : buf
      if (!buffer || !buffer.length) return false
      if (useCache) {
        fs.writeFileSync(cache, buffer)
        this.pruneCache(path.dirname(cache))
        return this.cachedReply(cache) || segment.image(buffer)
      }
      return segment.image(buffer)
    } catch (err) {
      logger.error(`[观测枢图鉴] 渲染异常：${err}`)
      return false
    }
  }
}








