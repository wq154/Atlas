# obc-atlas · 观测枢图鉴

TRSS-Yunzai 用的《原神》图鉴渲染插件：**数据实时取自米游社观测枢公开接口**，图片全部自己排版（2 倍高清 + WebP），不依赖任何停更的图库。

> 原神相关文本与图像版权归 miHoYo / HoYoverse 所有；本插件只做数据整理与排版展示。

---

## 特性

- **四套排版**（全部 2× DPR 渲染，输出 WebP）
  | 指令 | 版式 | 尺寸 |
  |---|---|---|
  | `#角色名` | 角色资料长页（属性 / 天赋 / 突破材料 / 推荐装备） | 1200 × 自适应 |
  | `#角色名材料` | 培养材料卡：七元素换肤，四栏（突破 / 天赋 / Lv80 / A1-E8-Q8） | 1280×720 → 2560×1440 |
  | `#武器名` | 武器图鉴：圆形展台 + 斜置立绘 + 属性 / 效果 / 实战分析 / 适用角色 / 突破素材 | 1280×720 → 2560×1440 |
  | `#圣遗物名` | 圣遗物海报：金色顶带 + 2/4 件套 + 五部件交错 + 可用角色 | 1080 × 自适应 → 2160 宽 |
- **稀有度配色**：五星金 / 四星紫 / 三星蓝，整卡联动（底纹、缎带、胶囊、高亮色）
- **七元素换肤**：火水风雷草冰岩，元素色方块 + 白色元素图标 + 四栏主题色
- **别名支持**：自维护别名表 → miao 预设别名 → 停更版 Atlas 的 `othername` 别名
- **实时渲染**：默认不写本地图片缓存，每次按当前数据出图（可用 `renderCache` 打开）
- **星铁图鉴**（`*希儿` 这类）：走本地资料库，纯离线

## 指令

```
#角色名            角色资料
#角色名材料        角色培养材料卡
#角色名图鉴        交给 miao-plugin 的 wiki 页（本插件不接管）
#武器名            武器图鉴
#圣遗物名          圣遗物图鉴
#图鉴更新          强制重建观测枢索引
#图鉴帮助          帮助图
```

- 名字可以是正名，也可以是别名（如 `#超导套` → 影中沉凝的幻灭、`#绝缘套` → 绝缘之旗印）
- `#名字面板` / `#名字图片` / `#名字图鉴` 这类「名字 + 其他后缀」本插件一律放行给后面的插件
- 星铁：`*角色名` / `*光锥名` / `*遗器名`，`#名字` 在观测枢查不到时会自动转星铁

## 依赖

| 依赖 | 是否必需 | 用途 |
|---|---|---|
| [TRSS-Yunzai](https://gitee.com/TimeRainStarSky/Yunzai) | **必需** | 宿主框架；出图用它的 puppeteer 渲染器 |
| Node.js ≥ 18 | **必需** | 插件是 ESM，用了原生 `fetch` |
| [miao-plugin](https://github.com/yoimiya-kokomi/miao-plugin) | **强烈建议** | 角色/武器元数据、材料图标、透明底素材图、别名表 |
| [genshin](https://gitee.com/TimeRainStarSky/Yunzai)（Yunzai 自带插件之一） | 建议 | 七元素图标、武器类型图标（`resources/img/gacha/items/*.png`），缺失时回落为纯文字 |
| `yaml` npm 包 | 自带 | Yunzai 已内置，无需单独安装 |
| 停更版 Atlas 插件 | 可选 | 只用于它的 `othername` 别名表；装不装都能跑 |

不需要 `pnpm i`：本插件没有自己的 npm 依赖。

## 安装

```bash
cd plugins
git clone <本仓库地址> obc-atlas
# 重启 Yunzai
```

重启后发 `#刻晴` / `#绝缘套` / `#雾切之回光` 验证。

## 配置（`config.yaml`）

```yaml
priority: 1        # 数字越小越先处理；1 表示先于 Atlas(10)、miao(50)
cacheHours: 12     # 观测枢索引 / 词条页 / 星铁索引的缓存时长（小时）
renderCache: false # false = 每次实时渲染；true = 按内容哈希缓存成 webp（省 CPU）
useLocalMeta: true # 是否用本地 miao 元数据补全明细
srMetaPath: ''     # 星铁本地资料库目录；留空自动找 miao 的 meta-sr
```

## 渲染说明

- **2 倍高清**：截图时传 `deviceScaleFactor: 2`（需要 Yunzai 渲染器支持该参数，本仓库附带说明见下）
- **WebP 输出**：`imgType: 'webp'`、`quality: 92`，一张 2560×1440 的卡约 350–700 KB
- **实时渲染**：默认不落盘。想缓存就把 `renderCache` 设 `true`，缓存目录 `resources/obc/cache/`，超过 400 张自动清最旧
- **字体**：优先用系统里的思源宋体 / 华文中宋 / 宋体、思源黑体 / 微软雅黑，**不内嵌字体**，换机器字形可能略有差异

> `deviceScaleFactor` 不是 Yunzai 上游渲染器的默认参数。如果你用的渲染器不支持，二选一：
> ① 在 `renderers/puppeteer/lib/puppeteer.js` 的 `captureScreenshot` 里加 `page.setViewport({ deviceScaleFactor })`；
> ② 把 `apps/obcAtlas.js` 里所有 `deviceScaleFactor: 2` 删掉（输出变 1 倍，仍能正常出图）。

## 数据来源

- **观测枢索引**：`act-api-takumi-static.mihoyo.com/hoyowiki/genshin/wapi/entry_page?app_sn=ys_obc`
- **词条页**：同上接口按 `entry_page_id` 取，用于推荐装备 / 推荐角色 / 突破材料逐级数量 / 圣遗物五部件
- **本地补全**：miao-plugin 的 `resources/meta-gs`（角色、武器、材料图标）与 `resources/meta-sr`（星铁）
- 索引与词条页缓存在 `data/`（默认 12 小时），`#图鉴更新` 可强制重建

## 目录

```txt
obc-atlas/
├── apps/
│   ├── obcAtlas.js          原神指令入口：取名 → 索引 → 词条页 → 组装 → 出图
│   └── obcSr.js             星铁指令入口
├── model/
│   ├── obcIndex.js          观测枢索引（拉取 / 解析 / 缓存 / 查名）
│   ├── obcEntry.js          观测枢词条页（推荐 / 材料明细 / 部件）
│   ├── alias.js             别名解析（自维护 → miao → Atlas）
│   ├── miaoMeta.js          miao 元数据读取
│   ├── materialCard.js      角色材料数据（突破分级 / 天赋常量 / 图标）
│   ├── weaponTemplate.js    武器图鉴模板（1280×720）
│   ├── charMatTemplate.js   角色材料卡模板（七元素换肤）
│   ├── artifactTemplate.js  圣遗物海报模板
│   ├── atlasCard.js         旧版通用卡 + 圣遗物数据组装
│   ├── srIndex.js / srAlias.js / srRender.js / srMeta.js   星铁链路
├── resources/obc/           页面模板与装饰件（logo、贴图）
├── config.yaml              优先级 / 缓存 / 补全开关
└── data/                    索引与词条页缓存（运行时生成，不提交）
```

## 已知限制

- 观测枢没有「武器实战分析」这种攻略文本，卡里的实战分析是按推荐角色 + 属性生成的模板句
- 「适用角色」只能拿到观测枢给了头像的条目，纯文字推荐（如“其他单手剑输出型角色”）会单独成一行
- 四星/五星的 **Lv90 突破消耗相同**，天赋消耗也相同；差异只体现在星级显示与突破材料种类
- 观测枢限流时可能取不到词条页，此时会退回索引里的基础字段（图仍能出，只是推荐栏为空）

## 更新日志

- `1.1.0` 武器图鉴 / 圣遗物海报 / 角色材料卡全部换成新模板；2× WebP 输出；默认实时渲染
- `1.0.0` 初版：观测枢索引 + 词条页 + 别名 + 星铁本地图鉴
