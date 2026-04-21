# Likethis — 开发计划与架构说明

> 基于当前仓库（`vibe-capture-extension/`）通读后的梳理，用于后续迭代对齐。

---

## 1. 当前系统架构

### 1.1 技术栈与形态

| 维度 | 说明 |
|------|------|
| **产品形态** | Chrome 扩展（Manifest V3），无独立后端；推理请求由侧栏直接向 **Google Gemini** 与 **Anthropic Claude** 的公开 HTTPS API 发起。 |
| **前端框架** | **无框架**：原生 **HTML + CSS + 原生 JavaScript**。未使用 React / Vue / Svelte 等；无 `package.json`、无打包链路。 |
| **扩展页面** | **Side Panel**（`sidepanel.html`）为主界面；**Options**（`options.html`）配置 API Key；**Service Worker**（`background.js`）处理截图与安装行为。 |
| **内容脚本** | 通过 `chrome.scripting.executeScript` 按需注入：`computed-css-snapshot.js`、`region-picker.js`（仅 `http(s)` 等可注入页面）。 |

### 1.2 状态管理

- **持久化状态**：统一使用 **`chrome.storage.sync`**，主要包括：
  - `geminiApiKey`、`anthropicApiKey`
  - `vibeAnalysisModelId`、`geminiModelId`（模型选择，存在历史双键写入）
  - `likethisUiLocale`（`en` / `zh`）
  - `likethisTheme`（`light` / `dark`）
  - `likethisMotionOutputMode`（`designLabels` | `technicalSummary`，动效分析结果的输出偏好）
  - `likethisActiveTab`（`webpage` | `artwork`，侧栏顶部 Tab 的上次位置，见 §9）
- **本地数据集（`chrome.storage.local` + `unlimitedStorage` 权限，见 §10）**：
  - `likethisFavoritesIndex`（Array，画廊元数据：`{ id, createdAt, title, type, thumbnail, sourceUrl }`——用于快速渲染卡片列表，**不读每条详情**即可显示画廊）。
  - `likethisFav:<id>`（Object，每条收藏的完整详情：5 段解析结构、Final prompt 全文、source 元信息、model / mode 溯源）。
  - 本地库**仅 local，不用 sync**（单条可达数十 KB–百 KB，会直接超出 sync 的 8KB / 102KB 限制）。
- **会话/界面状态**：以 **DOM + 模块级变量** 为主，例如 `sidepanel.js` 中的 `currentLocale`，以及各控件 `value` / `disabled` / `textContent`。
- **跨上下文同步**：侧栏监听 `chrome.storage.onChanged`，在密钥或主题变化时刷新 API 状态指示与主题切换 UI；Favorites 页同样监听 `likethisFavoritesIndex` / `likethisTheme` / `likethisUiLocale` 变更以实时刷新。

**结论**：并非 Redux/MobX 式全局 store，而是 **「Storage API + 命令式 DOM 更新」**，适合当前体量，但可测试性与模块边界较弱。

### 1.3 目录结构（仓库级）

```
Project 1/
├── plan.md                          # 本文件
└── vibe-capture-extension/
    ├── manifest.json                # MV3 清单：side_panel、permissions、host_permissions
    ├── background.js                # 安装时 sidePanel 行为；CAPTURE_VISIBLE_TAB 消息
    ├── sidepanel.html               # 侧栏壳
    ├── sidepanel.css                # 主题 token、布局、工具提示、按钮等
    ├── sidepanel.js                 # 核心业务：模型列表、API 调用、捕获流程、i18n
    ├── options.html / options.js    # API Key 表单与保存
    ├── computed-css-snapshot.js     # 注入页内：computed 样式 + :hover 模拟快照
    ├── region-picker.js           # 注入页内：框选区域 + 中点 CSS 采样
    └── icons/
        └── likethis.svg
```

---

## 2. 已完成功能（Done）

### 2.1 核心能力

- **全页「可见区域」截图**：经 `background.js` 调用 `chrome.tabs.captureVisibleTab`，侧栏将 PNG 转为 Base64 后送模型分析。
- **区域框选**：在网页上拖拽选区，按视口坐标映射到截图并 **裁剪**，再送模型；与全页流程共用分析管线。
- **CSS 上下文**：注入 `computed-css-snapshot.js`，对 **视口中心（全页）** 或 **选区中心（框选）** 命中元素采样 `getComputedStyle`，并尽力模拟 `:hover` 规则以产出 `hoverState` / diff；**`schemaVersion` 2+** 含 **`motionEvidence.ancestorChain`**（目标 + 祖先链上的 transition/animation 聚合 + `getAnimations()` 摘要，跨 **ShadowRoot** 穿透到 host，深度上限 `MAX_ANCESTOR_MOTION_DEPTH = 16`），避免父级动画遗漏。
- **动效输出模式**：侧栏 **`likethisMotionOutputMode`** 下拉切换「口语标签（设计向，默认）」与「技术参数摘要」，对应不同 **system / user** 提示词；结果区标签与 placeholder 随模式切换（单 textarea 方案，未做双栏）。仍为 **单次模型调用**；两步管线延后（见 §5.3）。
- **双模型提供商**：同一套 UI 选择 **Gemini** 或 **Claude** 模型；请求格式、重试策略（如 503/529）在 `sidepanel.js` 中分函数实现。
- **遗留模型 ID 迁移**：旧版 `gemini-1.5-*` 存储值映射到 2.x 可用模型 ID。

### 2.2 侧栏产品功能

- 品牌与 **深色 / 浅色主题**（`data-theme` + `likethisTheme`）。
- **中 / 英 UI**（文案、`PROMPTS` 与 `STRINGS` 分语言；分析请求随当前语言切换）。
- **模型下拉**、**API 连接状态点**（绿/红）、**API settings** 链向 Options。
- **自定义悬停工具提示**（非原生 `title` 为主），避免被侧栏顶部裁切（当前设计为在触发控件**下方**展示）。
- **复制结果**、加载态与状态行文案国际化。

### 2.3 配置与权限

- Options 页保存 **Gemini / Anthropic** API Key（明文存在于 `chrome.storage.sync`，属浏览器扩展常见做法，但需注意账号与设备同步范围）。
- `manifest.json` 声明 `sidePanel`、`storage`、`tabs`、`scripting`、`activeTab` 及 `<all_urls>` 与两家 API 域名。

---

## 3. 潜在问题与技术债（Tech Debt）

### 3.1 架构与可维护性

| 问题 | 说明 |
|------|------|
| **`sidepanel.js` 体量过大** | 单文件聚合 UI、存储、双 API、重试、裁剪、i18n、Prompt 常量；后续功能增加时拆分模块（或引入轻量打包）的收益高。 |
| **无类型与无测试** | 纯 JS + JSDoc 片段；无单元测试 / E2E，回归依赖手工点侧栏。 |
| **命名历史包袱** | 目录名仍为 `vibe-capture-extension`，注入脚本全局仍为 `__VIBE_*`；与产品名 Likethis 并存，易造成新人困惑。 |

### 3.2 一致性与重复逻辑

- **模型与密钥校验**：全页捕获与区域捕获入口前，对 `modelId` / provider / key 的校验逻辑 **重复**，可提取为 `async function assertReadyToAnalyze()`。
- **存储键**：`vibeAnalysisModelId` 与 `geminiModelId` 同时写入，历史兼容合理，但应在文档或常量区 **单一说明**「以何为准」，避免未来再增第三键。
- **Options 与侧栏**：Options 页文案以英文为主；侧栏已 i18n，**产品语言体验不完全一致**。

### 3.3 错误与边界

- 部分 **Gemini 错误提示**（如 429 计费相关长文案）在代码中为 **硬编码英文**，未走 `STRINGS`，与整体 i18n 策略不一致。
- **内容安全策略严格的页面**：`:hover` 模拟可能失败（Prompt 中已要求模型不臆造）；属预期，但可在 UI 上增加简短说明以减少「为什么没 hover 数据」的困惑。
- **侧栏内工具提示**：依赖 CSS 定位；极端窄高或 Chrome UI 变化时仍可能出现裁切，若反馈增多可考虑 **Portal 式 fixed 定位 + JS 测边**（成本较高）。

### 3.4 安全与合规（提醒项）

- API Key 存于 **sync storage**；无加密。若面向更广分发，需在隐私说明中明确，并评估 **最小权限** 与 Key 轮换引导。
- 截图与选区内容发往第三方模型，**敏感页面**使用需用户自知。

---

## 4. 建议的后续开发方向（供 backlog 使用）

以下为基于当前架构的 **可选** 方向，实施前请再排优先级：

1. **拆分 `sidepanel.js`**：`api/gemini.js`、`api/anthropic.js`、`ui/i18n.js`、`capture.js`，主文件只做组装。
2. **统一错误与状态文案**：全部走 `STRINGS` / `ti()`，并补全中文。
3. **Options 页 i18n**：与侧栏共用字典或共享一小段 `options-strings.js`。
4. **构建与质量**：引入 `esbuild`/`vite` 仅作打包与 minify；加 ESLint + 少量单测（如 `normalizeStoredGeminiModelId`、裁剪坐标计算）。
5. **重命名内部前缀**（低优先级）：`__VIBE_*` → `__LIKETHIS_*`，需同步注入脚本与文档，避免与旧已发布扩展混淆时谨慎做。

---

## 5. Motion Vibe 分析增强 — 决策与待办（TODO）

本节记录已对齐的产品决策，以及实现时可逐项勾选的 **Markdown 任务列表**（在编辑器中 `- [ ]` / `- [x]` 切换完成态）。与架构相关的存储键在落地时补入 **§1.2** 的 bullet 列表。

### 5.1 已确认决策

| 主题 | 结论 |
|------|------|
| **输出形态** | **既要**设计向口语标签 **也要**技术参数摘要；**默认**生成口语标签；用户切换到「技术参数摘要」时，结果/导出以技术向摘要为主（或双栏：标签 + 参数，实现时二选一，需与 UI 稿一致）。 |
| **成本与管线** | 接受 **额外一次模型调用** 或 **单次更长 prompt / 更高 token**，以换取更稳的 motion 归纳（参见前文「路径 B」类方案）。 |
| **全页 vs 框选** | **一致对待**：框选场景需覆盖 **选中元素及其祖先链** 上与 motion 相关的样式/动画证据（避免只采中点单层节点导致漏掉父级 `animation`）。 |

### 5.2 待办清单

- [x] **数据层**：在注入脚本中扩展结构化 **motion 证据**（`transition`/`animation` 聚合、`getAnimations()` 摘要），`schemaVersion: 2` + **`motionEvidence.ancestorChain`**（目标 + 祖先链，与全页 / 框选命中元素一致）；脚本头注释已说明策略。
- [x] **存储与偏好**：`chrome.storage.sync` 键 **`likethisMotionOutputMode`**（`designLabels` | `technicalSummary`），默认口语标签；已写入 **§1.2**。
- [x] **侧栏 UI**：下拉切换「口语标签 / 技术参数摘要」；文案走 **`STRINGS`**；采用 **单 textarea**，标签与 placeholder 随模式切换（未做双栏，与 §5.1「二选一」一致）。
- [x] **分析管线**：按模式切换 **system / user**（`PROMPTS.*.designLabels` / `technicalSummary`）。**未实现**独立第二步 API 与「正在提取动效要点…」状态行（仍为单次调用；可后续迭代）。
- [x] **导出/复制**：复制按钮复制 **当前文本框内全部内容**（两种模式一致）；`copyHint` 提示已加。
- [x] **回归与边界**：无 JSON / hover 失败等仍由 **提示词**约束（与 §3.3 一致）；框选过小仍为 **中心点命中**（与此前行为一致，未新增侧栏降级文案）。

### 5.3 已推迟 / Deferred（后续迭代再排期）

以下项在本版本 **显式推迟**，但已在当前代码或 §5.2 中留出切入点；重启时可直接从这里续做。

- [ ] **两步调用管线**：先以小请求抽取 `{ keywords, evidence[], confidence }` 的结构化 JSON，再把它作为不可辩驳输入喂给最终 Vibe prompt；需要新增状态文案（如「正在提取动效要点…」）并走 `STRINGS`。
- [ ] **「技术摘要」模式下的分块导出**：默认复制仍是 textarea 全文；若产品定稿要「只复制技术参数段」，给 `copyBtn` 增加二级选择或拆分为两段 only-read 区域（当前已存在 `copyHint` 文案位可复用）。
- [ ] **Evidence-based motion 文案对齐**：在 `PROMPTS.*.designLabels.system` 里显式引用 `motionEvidence.ancestorChain`，让设计模式也能区分「target vs ancestor」——目前 `technicalSummary` 已引用，`designLabels` 还未。
- [ ] **框选过小 / 无命中**：`readSnapshotAtClientPoint` 返回 `no_target_element` 时，侧栏给出简短降级提示（与 §3.3 的 hover 失败文案同级）。**注**：§8 的 Retake/Cancel/Confirm 确认层落地后，这个场景大概率已由 UX 侧阻断（用户看到空框会直接 Retake / Cancel），此条可在 §8 上线后**回看再评估是否仍需**。
- [ ] **双栏 UI（可选）**：若将来要「同时」展示口语标签 + 技术摘要，参考 §5.1「二选一」决策重评；涉及复制按钮语义变更，需联动更新 §5.3 第 2 项。

---

## 6. UI / 设计迭代（Inbox）

用于 **随手记录** 视觉与布局想法，避免与 §4 / §5 的架构级 backlog 混在一起。规则简述：

- **Inbox**：无序草稿，想到就加；不必勾选。
- **Next**：本迭代（或下一版）确定要做的少量条目；完成后可移到 §2「已完成功能」一句概括，或从本表删除。
- 与 **Motion / 输出模式强相关** 的界面，优先在 **§5** 写清，本节只作补充或草图级备注。

### 6.1 Inbox（草稿）

- （在此添加 bullet，例如：侧栏输出区改为可折叠、Options 与侧栏统一字号层级。）

### 6.2 Next（本批要做）

- [ ] （在此添加可勾选任务；与 Motion 专题重叠时以 §5.2 为准。）

---

## 7. 分区展示提示词（Structured Sections）— 决策与待办（TODO）

把当前单 textarea 的长文本拆为 **5 张只读卡片**，让设计师能扫视并学习视觉语言；最终可复制粘贴给 LLM 复刻截图的**仍是一个整合好的 Final Vibe Coding prompt**。本节格式与 §5 对齐。

### 7.1 已确认决策

| 主题 | 结论 |
|------|------|
| **结构化方式** | **A2 优先（Markdown 小节）**：要求模型用固定 `##` 标题输出 5 段；侧栏按标题 split 渲染卡片。解析失败时回退到「把原文整段塞进 Final prompt 卡片」的软降级。**A1（强制 JSON）暂不做**，留到未来需要 per-keyword 交互 / evidence tooltip 时再升（见 §7.3）。 |
| **关键词交互** | **纯展示（B1）**：`## Vibe keywords` 小节在 UI 上渲染为 chip 样式，但不可点选 / 勾选；Phase 2 再考虑可交互（见 §7.3）。 |
| **与动效模式共存** | **共用分区（C1）**：`designLabels` 与 `technicalSummary` 都输出同一套 5 段标题；两模式的**区别只体现在每段内容的密度 / 措辞**（技术模式下 Color 段更偏参数、Motion 段引用 `ancestorChain`/`animationsFromAPI`）。 |
| **复制语义** | **只复制 Final prompt（D1）**：侧栏保留一个主复制按钮，复制 Final Vibe Coding prompt 卡片的全文；Final prompt 内部已包含其他 4 段中需要的 confirmed facts（由 prompt 约束），粘贴到 LLM 即可复刻视觉 / 风格。每卡暂不加独立复制键。 |
| **分区标题（协议层）** | 标题作为**稳定协议**，中英一致、不翻译：<br>`## Vibe keywords` / `## Visual style & composition` / `## Color & physical feel` / `## Motion` / `## Final Vibe Coding prompt`。UI 卡片上的显示标题通过 `STRINGS` 再本地化，不影响模型输出协议。 |

### 7.2 待办清单（Phase 1 — MVP）

- [ ] **Prompt 协议改造**：在 `PROMPTS.en/zh.designLabels.system` 与 `...technicalSummary.system` 中，将输出结构强制为上表 5 个固定 `## ` 标题（中英一致），并约束：
  - `## Vibe keywords` **单行、逗号分隔**短语（便于侧栏 split 成 chip），不超过 ~6 个。
  - `## Motion` 无证据时写 `Static (No motion data detected)`（与现有规则一致）。
  - `## Final Vibe Coding prompt` 仍以 `Build this component based on the exact styles provided...` 起句，并**自包含**前 4 段的 confirmed facts（用户只复制这段也能复刻）。
- [ ] **解析层**：新增 `parseSections(text)`（放在 `sidepanel.js` 或拆出 `ui/parse-sections.js`），按已知 `## ` 标题切分为 `{ vibeKeywords: string[], visual: string, color: string, motion: string, finalPrompt: string, rawFallback?: string }`；缺节填 `""`；完全解析失败时把原文放入 `rawFallback`，仅渲染 Final prompt 卡片显示原文。
- [ ] **UI 重构**：把 `sidepanel.html` 的 `output-section` 换为 `.section-card` 列表（5 张）；每卡含 **卡片标题 + 内容**；`## Vibe keywords` 卡片内用 chip 样式渲染（纯 CSS，无交互）；`## Final Vibe Coding prompt` 卡片保留 **主「Copy to clipboard」按钮**，语义 = 复制该卡内容。
- [ ] **CSS（`sidepanel.css`）**：新增 `.section-card` / `.section-card__title` / `.section-card__body` / `.chip` / `.chip-list` tokens；沿用现有 `--bg-elevated` / `--border-subtle` / `--glow-neutral`，保持与现有控件一致的视觉语言；深浅色主题都要覆盖。
- [ ] **i18n（`STRINGS`）**：新增卡片显示标题键 `sectionTitleVibe` / `sectionTitleVisual` / `sectionTitleColor` / `sectionTitleMotion` / `sectionTitleFinalPrompt`；空态文案键 `sectionEmpty`（例：`N/A`）；其余现有 `copyHint` / `copy` 等复用。
- [ ] **与动效模式联动**：切换 `likethisMotionOutputMode` 时 UI **结构不变**，只是提示词不同；`Motion` 卡片在 `technicalSummary` 下会自然更密。不新增卡片状态。
- [ ] **空态 / 降级**：任一小节为空 → 卡片 body 渲染 `sectionEmpty`；整体解析失败 → 仅显示 Final prompt 卡片的 `rawFallback`，并在 `status` 行追加一次性 debug 标记（如 `fallback: raw`），便于你后续观察哪个模型更不守规矩。
- [ ] **回归**：全页 & 框选两条链路都走新 UI；Gemini / Claude 两个 provider 都验证一次；深 / 浅色 + 中 / 英全量勾一遍；复制按钮仍可用且只复制 Final prompt。

### 7.3 已推迟 / Deferred（后续迭代再排期）

- [ ] **A1 升级（强制 JSON 输出）**：当需要 per-keyword 证据 tooltip / 关键词可点选重写 Final prompt 时再升；届时 Gemini 用 `responseMimeType + responseSchema`，Claude 用 tool use 或严格 JSON prompt，并保留「JSON 失败 → A2 降级」三道墙（提取首个 `{...}` → `JSON.parse` → 标题 split）。
- [ ] **B2 关键词可选择 / 取消**：点亮 / 勾掉的 chip 会即时重写 Final prompt 卡片（要么模板拼接，要么二次模型调用）；触发时**仍坚持 D1 语义**：主复制键复制重写后的 Final prompt。
- [ ] **每卡独立复制键**：若真实反馈显示有需要，再给除 Final prompt 之外的卡片加小复制键（Phase 1 不做以保持信号纯度）。
- [ ] **Evidence hover（依赖 A1）**：chip 悬停显示来源（例 `snappy ← transition-duration: 180ms`），需结构化证据数据，故与 A1 绑定。
- [ ] **卡片折叠 / 展开与记忆**：在 `chrome.storage.sync` 存每卡折叠状态；窄宽侧栏下可默认折叠 `Visual` / `Color` 保留 `Vibe keywords` + `Final prompt` 高亮。
- [ ] **Technical 模式的参数表渲染**：`Color` / `Motion` 在 technical 模式下从段落升级为 `property: value` 表格 UI；与 §5.3「技术摘要分块导出」协同评估。

---

## 8. 动效证据升级 — 多帧采样与共享确认层（Multi-frame Motion + Region Confirm）

CSS + `getAnimations()` 只能覆盖「声明式 / WAAPI」动效，**漏掉** GSAP/Framer Motion/Lottie/Canvas/WebGL/滚动触发等大类（约占现代站点 ~40–60% 的可见动效）。本节加入**多帧采样**作为第二路证据；同时把「框选确认」UX 作为**共享前置改动**，让 `Draw region` 与新的 `Record motion` 走同一流程，减少 token 浪费。

### 8.1 已确认决策

| 主题 | 结论 |
|------|------|
| **技术路径** | **路径 1 先行（多帧采样）**：用户触发后以 `chrome.tabs.captureVisibleTab` **~500ms × 6 帧 ≈ 2.5s**（Chrome 单标签稳定速率约 2 次/秒），全部按选区坐标裁剪，多张图一次性送模型。**路径 2 延后**（`chrome.tabCapture` + 原生视频，仅 Gemini）。**路径 3 不做**（运行时探针复杂度高、无法覆盖 canvas/WebGL）。 |
| **触发方式** | **F1 = 独立第三按钮**：新增「Record motion」按钮，与「Draw region for Vibe」并列（颜色 / 视觉层级区分，避免误点）。复用现有 region picker 的矩形拖拽。 |
| **共享确认层** | 无论 `Draw region` 还是 `Record motion`，**拖拽松开后都进入确认态**：页面上在矩形框**下方**展示三个 icon 按钮 **Retake / Cancel / Confirm**，用户确认后才发起截图 / 多帧 / 模型调用。此为 **§8 的前置共享改动**（既影响 §2.1 已完成的 `Draw region`，也服务新功能），减少误框导致的 token 浪费。 |
| **Static 短路** | 6 帧全部抓到后，在**侧栏端**（避免注入脚本体积膨胀）做**像素级帧差**：相邻帧差之和低于阈值（例如 `<0.5%` 发生变化的像素）→ 判定 `Static`，**跳过模型调用**，直接在 `## Motion` 小节写 `Static (No motion data detected)`，前 4 段沿用现有单帧分析结果。 |
| **CSS 快照保留** | CSS / `motionEvidence` 依旧收集并喂给模型，作为「作者意图」的一路证据；帧序列作为「肉眼现实」第二路证据，提示词里明确两路的权重规则（冲突时以帧差为准）。 |
| **与 §7 的耦合** | §8 的帧序列产生「真实动效文字」后，仍通过 §7 的 `## Motion` 小节呈现——不新增卡片。推荐顺序：**§7 先 ship → §8 再做**，避免同时改输出结构 + 数据源。 |
| **与动效模式（§5）耦合** | `likethisMotionOutputMode = technicalSummary` 时，帧差提示词额外要求输出可读的 property-level 推断（如「`translateY` 约 20→0 px，持续 ~600ms，ease-out」）；`designLabels` 时只给口语化动效短语（`smooth rise-in`、`snappy fade`）。 |

**参考**：motionsites.ai 的产品验证了「视频 / 时序画面是 motion 分析的正确输入模态」这一方向（其站点为 hero 示例画廊，不是实时分析管线）。

### 8.2 待办清单（Phase 1 — Multi-frame MVP）

> 依赖顺序：**共享确认层** → **多帧管线** → **帧差短路** → **提示词与降级** → **回归**。

- [ ] **共享确认层（region-picker.js）**：`Draw region` 与 `Record motion` 都触发同一 picker；拖拽 `mouseup` 后**不立刻**返回坐标，而是在 overlay 内、框**下方**渲染 3 个 icon 按钮 `Retake` / `Cancel` / `Confirm`（纯内联 SVG + 原生事件，避免额外依赖）。
  - `Confirm` → postMessage 回 sidepanel 触发后续流程（带 `mode: "snapshot" | "motion"`）。
  - `Retake` → 清空当前矩形，回到「拖拽中」状态，不退出 picker。
  - `Cancel` → 退出 picker，侧栏显示 `errSelectionCancelled`（已存在的 `STRINGS` 键可复用）。
  - 边界：框太小（例如 `<8×8` px）时 `Confirm` 置灰 + tooltip 提示「selection too small」。
- [ ] **侧栏新按钮（sidepanel.html / .js / .css）**：在 `actions-stack` 里，`Draw region for Vibe` 下方加第三个按钮 `Record motion (2.5s)`（英文文案；中文 `录制动效（2.5s）`），视觉与现有两个按钮区分（建议柔蓝色系 + motion icon）。新增 `STRINGS` 键 `recordMotion` / `recordMotionHint` / `statusRecordingFrames` / `statusFramesCaptured{a}/{m}` / `statusStaticShortCircuit` / `errFramesCaptureFailed`。
- [ ] **多帧采样管线（background.js + sidepanel.js）**：封装 `captureFrameSequence({ rect, frames: 6, intervalMs: 500 })`，内部串行调用 `chrome.tabs.captureVisibleTab` 并 `setTimeout` 间隔；每帧客户端裁剪到 `rect`，**记录时间戳**（真实间隔可能 >500ms，提示词里据实告知）。失败单帧可跳过但 ≥4 帧才继续；否则报 `errFramesCaptureFailed` 并建议用户关闭其它截图扩展。
- [ ] **像素级帧差（sidepanel.js）**：新增 `computeFrameDeltaRatio(frames)`——把每帧缩到例如 `128×N` 灰度，计算相邻帧差像素占比的最大值；`< 0.5%` 判定 `Static`，跳过模型调用；否则把 ratio 作为 meta 塞进 prompt，让模型知道「有多动」。
- [ ] **Prompt 协议扩展**：在 `PROMPTS.en/zh.designLabels.system` 和 `technicalSummary.system` 中新增一块「Frame sequence evidence」说明：  
  - 输入包含 N 张连续帧（meta 附时间戳），优先用**跨帧差异**推断 `## Motion` 段；CSS 快照降为次要参考。  
  - 冲突规则：「CSS 声明 hover transform，但帧间无明显变化 → 说明没触发，不要在 Final prompt 写 hover 动效」；「CSS 无动效、但帧间有变化 → 按肉眼推断，标注为 `inferred from frames (no CSS evidence)`」。  
  - 无动效时仍写 `Static (No motion data detected)`（与现有统一）。
- [ ] **请求构造**：`analyzeWithGemini` / `analyzeWithClaude` 扩展成接受 `images: Array<base64>` 而非单张；Claude 走 `content: [{type:"image",source:...}, ...]` 数组，Gemini 走 `parts: [{inlineData:...}, ...]` 数组；**保留单帧请求路径**（snapshot 模式仍是 1 张图）。
- [ ] **状态文案**：录制阶段 status 行按帧推进：`recording {a}/{m}` → `analyzing frames…` → `done.`；短路时直接显示 `statusStaticShortCircuit` + `done.`。
- [ ] **复制与输出**：§7 的 5 卡结构**不变**；`## Motion` 卡片内容由帧差结果填入；**主复制按钮仍只复制 `## Final Vibe Coding prompt`**（D1 决策不变）。
- [ ] **回归**：
  - `Draw region`（snapshot 模式 + 确认层）在 Gemini / Claude 两家各跑一次；中 / 英、深 / 浅色勾一遍。
  - `Record motion`（motion 模式 + 确认层）在 Gemini 跑，Claude 跑（多图请求）；覆盖「有动 / 基本静止 / 完全静止」三种站点。
  - CSP 严格页面 / 扩展页面：确认层不能注入时显示现有 `errInjectPicker`。

### 8.3 已推迟 / Deferred（后续迭代再排期）

- [ ] **路径 2：视频 + Gemini 原生视频模态**：加 `tabCapture` 权限 → `MediaRecorder` 录 3s webm → 裁剪到 rect → 送 Gemini（`inlineData`: `video/webm`）。仅 Gemini，Claude 仍走多帧。UI 上在 `Record motion` 下多一个 `High fidelity (Gemini only)` 小开关。
- [ ] **帧差热力图作为第 N+1 张图**：把相邻帧的像素差生成一张红色热力图（256×N 灰度→红 alpha），作为额外一张图送模型，直接告诉它「哪里在动」。实现成本小，但和 §7 Final prompt 的 token 开销要一起算。
- [ ] **帧数 / 间隔可调**：Options 或侧栏 advanced 面板提供 `frames / intervalMs` 两个数；默认 `6 / 500ms`，高级用户可改为 `10 / 300ms`（提醒其可能超出 `captureVisibleTab` 节流）。
- [ ] **运行时探针（路径 3）**：仅在路径 1/2 仍显著漏动效的**具体站点清单**累积到一定数量时再做；一旦做，需 `MutationObserver` + 覆盖 `Element.prototype.animate` 等高风险改动，单独开 §评估 CSP 兼容性。
- [ ] **Cross-tab 录制 / 滚动触发支持**：当前多帧只能覆盖用户**静止不动的 2.5s**；若要触发滚动动画，需脚本化 `window.scrollBy` 的编排 + 并发采帧，属 P2 功能。
- [ ] **帧序列缓存**：同一选区在「分析失败 / 换模型重试」时不重新录制，直接复用上次帧（sidepanel 内存里存最近一组）。

---

## 9. 艺术风格迁移 Tab（Artwork Style Transfer）— 决策与待办（TODO）

设计师在网上看到一幅艺术作品（绘画 / 插画 / 海报 / 数字艺术）时，希望**提炼其可迁移的风格**（流派、构图、色彩、媒介语言），并得到一段**可粘贴给 LLM 的网页设计 prompt**，用作原创设计的灵感起点。本功能以**独立 Tab** 的形式落地，与 §2.1 的「网页组件分析」并列；API keys / 语言 / 主题 **共享**。格式与 §5 / §7 / §8 对齐。

### 9.1 已确认决策

| 主题 | 结论 |
|------|------|
| **触发形态（N4）** | **独立 Tab**：侧栏 header 下新增传统 tab 标签条 `[ Webpage analysis  \|  Artwork analysis ]`（**R2**：下划线式 tab，非顶部分段控件）；切换即切换下方整块 body，上层 header（品牌、主题按钮、Language、Model、API status、API settings）**共享**。记忆上次所在 tab 到 `likethisActiveTab`。 |
| **按钮布局（S1）** | Artwork tab 只保留 **一个主按钮 `Draw region for artwork`**。不提供 `Capture full page`（艺术作品分析信噪比要求选区聚焦），也不提供 `Record motion`（Q1：动效不适用）。 |
| **模式下拉（T1）** | **MVP 不加任何艺术专属下拉**（`Style depth` / `Transfer target` 均延后，见 §9.3）。一键出 5 卡结果。 |
| **输出协议（O1）** | 复用 §7 的 5 卡片 UI 与 `parseSections` 解析器，**更换一套稳定的 `##` 协议标题**（中英一致、不翻译）：<br>`## Art style tags` / `## Composition & form` / `## Color palette` / `## Texture & medium` / `## Final Web-design transfer prompt`。UI 卡片显示标题通过 `STRINGS` 另存本地化键，不影响模型输出协议。 |
| **CSS 数据处理（I1）** | Artwork tab **不注入 `computed-css-snapshot.js`**，不采集 `motionEvidence`：艺术作品主体通常是 `<img>` / `<canvas>` / 数字扫描件，CSS 是容器样式，对风格分析是噪音。管线只送**裁剪后的单张图**。 |
| **版权与去署名化（P1' 融合版）** | 产品默认启用最保守护栏，不依赖运行时判断作品是否在公共领域：<br>1) prompt 优先输出**流派 / 运动 / 技法**（Impressionism、Ukiyo-e、Bauhaus、Risograph、glitch-punk…），而非艺术家人名；<br>2) `## Art style tags` 卡**允许**出现艺术家名字作为参考，但 `## Final Web-design transfer prompt` 卡**禁止**出现任何特定艺术家人名——只留可抽象的风格词；<br>3) Final prompt 显式加一行护栏：`Use as style inspiration only. Do NOT reproduce identifiable subjects, faces, signature motifs, or the original composition of the source artwork.`；<br>4) 作品本身版权 / PD 状态我们无法判定，但 **风格不受版权保护**（美、欧、中一致）；真正的风险点是「产出过于接近某一具体作品」，护栏句即为此写。 |
| **与 §7 的耦合** | **§9 依赖 §7**：`parseSections` 与 `.section-card` UI 必须先 ship。§9 本质是「同一个容器 + 另一套标题和 prompt」。推荐顺序：**§7 → §9**；§8 与 §9 彼此独立，谁先谁后都行。 |
| **与 §8 的耦合（弱）** | §9 的 `Draw region for artwork` **若 §8 已 ship**，直接复用共享 `Retake / Cancel / Confirm` 确认层；**若 §8 尚未 ship**，先走现有 `region-picker.js` 单步返回坐标流程，等 §8 到位再免费继承。不强绑定。 |
| **Motion 下拉（Q1）** | 切换到 Artwork tab 时，`Motion output` 下拉**隐藏**（`likethisMotionOutputMode` 仍保留，仅作用于 Webpage tab）；切回 Webpage tab 恢复显示。 |

### 9.2 待办清单（Phase 1 — MVP）

> 依赖顺序：**Tab 壳 + 存储** → **Prompt 协议 + 解析** → **管线去 CSS 化** → **UI 卡片（复用 §7）+ i18n** → **回归**。

- [ ] **Tab 壳（sidepanel.html / .css / .js）**：在 header 下方加一条传统 tabs（`[data-tab="webpage"] / [data-tab="artwork"]` + 下划线 active 态）；激活 tab 切换下方 body 显隐（两个 `<section>` 同级，用 `hidden` 属性控制）。切换时同步 `chrome.storage.sync.set({ likethisActiveTab })`；启动时从存储恢复（默认 `webpage`）。
- [ ] **存储键 §1.2 补齐**：已在本次更新写入 `likethisActiveTab`；注意**不要**把艺术分析结果写入 `likethisMotionOutputMode`，两 tab 的「结果偏好 / 模式」各自独立存（MVP 阶段艺术 tab 无模式，暂无新增键）。
- [ ] **Motion 下拉可见性联动**：Artwork tab 激活时给 `#motion-output-mode` 的 `.field-row` 容器加 `hidden`；`applyUiLocale()` 仍正常刷新（切回 Webpage 时文案已就绪）。
- [ ] **Artwork 主按钮**：在 Artwork body 内加 `Draw region for artwork`（视觉与 `Draw region for Vibe` 同系蓝，但文案不同；避免误认）。新增 `STRINGS` 键：`tabWebpage` / `tabArtwork` / `artworkDrawRegion` / `artworkDrawRegionHint` / `statusArtworkAnalyzing`。
- [ ] **Prompt 协议（PROMPTS 扩展）**：新增 `PROMPTS.en.artwork.system` / `userIntro` 与 `PROMPTS.zh.artwork.system` / `userIntro`；System prompt 必须包含：
  - 5 个**固定** `##` 标题（中英一致）：`## Art style tags` / `## Composition & form` / `## Color palette` / `## Texture & medium` / `## Final Web-design transfer prompt`。
  - **去署名化规则**：`## Art style tags` 可含艺术家名（作参考）；`## Final Web-design transfer prompt` **禁止**出现艺术家人名，只留风格词（流派、技法、时代、媒介）。
  - **护栏句**：Final prompt **必须**以 `Build a website inspired by this artwork's transferable style attributes…` 开头（不是现 Webpage 的 `Build this component based on the exact styles provided…`），并在末尾追加 `Use as style inspiration only. Do NOT reproduce identifiable subjects, faces, signature motifs, or the original composition of the source artwork.`。
  - **可迁移属性 vs 不可复制内容**：系统指令需明确让模型**只把 palette / composition rhythm / mark-making / mood / era** 写入 Final prompt；具体对象、人脸、签名 motif 仅可作为 `## Composition & form` 的分析素材，不得进入 Final prompt。
  - **HEX 色要求**：`## Color palette` 至少给 3–5 个 HEX + 角色（primary / secondary / accent / neutral）+ 情绪词。
- [ ] **解析层复用**：`parseSections` 扩展为接受「协议表 id」（`webpage` | `artwork`），在同一函数内按不同标题数组切分；返回结构 `{ artStyle: string, composition: string, color: string, texture: string, finalPrompt: string, rawFallback?: string }`（和 §7 的 webpage 返回是两种类型，UI 渲染层分发）。解析失败回退同 §7：只渲染 Final prompt 卡 + status 行追加 `fallback: raw`。
- [ ] **分析管线（sidepanel.js）**：Artwork tab 的 `Draw region` 回调**不注入 `computed-css-snapshot.js`**，裁剪后只送 1 张图 + artwork prompt 包；复用现有 `analyzeWithGemini` / `analyzeWithClaude`（`images: [base64]` 单元素数组即可，**不需要** §8 的多帧改动）。路由逻辑：`getPromptPack(locale, mode, tab)` 把 `tab === 'artwork'` 时 mode 参数忽略、统一指向 `PROMPTS[loc].artwork`。
- [ ] **UI 卡片（复用 §7 组件）**：用 §7 的 `.section-card` / `.section-card__title` / `.section-card__body` / `.chip` / `.chip-list` 原样渲染；`## Art style tags` 用 chip 样式（纯展示，B1 规则一致）；`## Color palette` 卡体内做一个**轻量增强**——检测到 `#RRGGBB` 时在色值旁渲染 6×14 小色块（纯 CSS、无 JS 交互）；`## Final Web-design transfer prompt` 卡保留**主复制按钮**，语义 = 复制该卡（D1 规则一致）。
- [ ] **护栏视觉提示**：Final prompt 卡**顶部**加一行浅色文字注释（`sectionFinalPromptGuardrail` 键）：`Use as inspiration. Transform, don't copy. Style is not copyright-protected, but specific compositions can be.`（中文：`仅作灵感使用。请在此之上做原创转化——风格本身不受版权保护，但具体作品的构图和识别性元素可能受保护。`）。
- [ ] **i18n（`STRINGS`）**：新增键：tab 标签 `tabWebpage` / `tabArtwork`；artwork 按钮与状态 `artworkDrawRegion` / `artworkDrawRegionHint` / `statusArtworkAnalyzing` / `statusArtworkDone`；卡片显示标题 `artSectionStyleTags` / `artSectionComposition` / `artSectionColor` / `artSectionTexture` / `artSectionFinalPrompt`；空态 `sectionEmpty` 复用 §7；护栏 `sectionFinalPromptGuardrail`。
- [ ] **回归**：
  - Artwork tab：在至少 3 种来源各跑一次——**公共领域绘画**（博物馆网站）/ **商业插画站**（Behance / Dribbble）/ **数字生成艺术**（Are.na / generative gallery）。
  - Gemini / Claude 各跑一次；中 / 英 × 深 / 浅全量勾一遍。
  - **护栏验证**：人工检查 `## Final Web-design transfer prompt` 是否出现具体艺术家人名（若出现 → prompt 需加强）。
  - Tab 切换：Webpage ↔ Artwork 反复切，确认 `Motion output` 下拉按预期显示 / 隐藏，`likethisActiveTab` 持久化正确。

### 9.3 已推迟 / Deferred（后续迭代再排期）

- [ ] **T2 — `Style depth` 下拉**（`Quick tags` / `Deep analysis`）：两档切换输出密度（快速标签 vs 深度构图 + 色谱 + 媒介分析）。需要第二套 prompt 包；Phase 1 只给「中等密度」一档。
- [ ] **T3 — `Transfer target` 下拉**（`Website` / `Component` / `Illustration`）：控制 Final prompt 的翻译方向——整站 vs 单组件 vs 单幅插画；涉及 prompt pack 三分支，Phase 2 做。
- [ ] **色谱可视化增强**：除了内联小色块，再加一个独立色带（palette bar）+ HEX copy-on-click；与 §7.3 的 per-card copy 一起评估。
- [ ] **艺术家 / 流派知识库对齐**：当模型输出在 `## Art style tags` 中给出知名艺术家时，旁附 tooltip 显示「该艺术家是否仍在世 / 公共领域状态」（需本地静态表，不联网）；仅作用户侧提醒，不改变模型输出。
- [ ] **A1 升级（JSON 协议）**：与 §7.3 的 A1 并轨——同一个 JSON 出口，artwork 与 webpage 共用 schema 骨架、标题字段可分叉。
- [ ] **IP 风险启发式**：本地关键词黑名单（知名当代 IP 与艺术家名）触发时自动**加强 Final prompt 护栏语气**（`Transform significantly; maintain only abstractable qualities`）。误杀风险高，需要 A/B。
- [ ] **多作品对比模式**：一次框选两幅作品，让模型输出「共性风格向量」+ 一段迁移 prompt（侧栏 UI 需大改，至少 Phase 3）。
- [ ] **本地提交 / 收藏**：把一次艺术分析结果（截图 + 5 卡 + tab 状态）存到 `chrome.storage.local` 历史记录，供后续回看 / 对比。

---

## 10. 收藏库（Favorites Library）— 决策与待办（TODO）

用户可以**主动保存**一次分析（Webpage 组件 / 区域截图 / Artwork 风格）为一张卡片，在一个独立的画廊页面里浏览、排序、重命名、复制 Final prompt、删除。这是 Likethis **第一次引入用户侧的持久数据集**，也是侧栏能力向「工作流产品」演化的关键一步。格式与 §5 / §7 / §8 / §9 对齐。

### 10.1 已确认决策

| 主题 | 结论 |
|------|------|
| **页面形态（U2）** | **独立全屏页面 `favorites.html`**，通过 `chrome.tabs.create` 在新 tab 打开；侧栏在「结果区 / tab 切换条」附近加一个入口按钮（`Open library` / `打开收藏库`）。侧栏**不**渲染画廊本身（400px 宽不适合卡片 grid）。 |
| **保存触发（V1）** | **手动保存**：Webpage tab 与 Artwork tab 的分析成功完成后，在结果区加一个 `Save to Favorites ♡` 按钮；点击即入库。不做自动保存（避免积累低价值条目稀释信号）。已入库的同一次分析结果（同 id）再次点按钮 = 取消收藏 / 再次收藏 toggle。 |
| **卡片标题规则（W3）** | **自动生成 + 可重命名**：Webpage 卡的 `title` 默认 = `## Vibe keywords` 解析出的**第一个**短语；Artwork 卡的 `title` 默认 = `## Art style tags` 解析出的**第一个**短语。完全解析失败（走 §7 `rawFallback`）时 title = `Untitled snapshot` / `Untitled artwork`（走 `STRINGS`）。Favorites 页上每张卡片**双击标题**可改写，写回 `likethisFavoritesIndex` 与 `likethisFav:<id>`。 |
| **缩略图策略（X1）** | **只存缩略图**：区域截图 / 整页截图在保存前通过 offscreen canvas 缩到 **~400px 宽、保比例**、**JPEG q=0.7**（预计 20–50KB/张）。详情 modal 也用同一张——用户想要高清原图时可点 `Re-capture from source`（新 tab 打开 `sourceUrl`，回到原流程）。不存原图，避免库膨胀。 |
| **存储后端** | **`chrome.storage.local` + `unlimitedStorage` 权限**：`manifest.json` `permissions` 新增 `unlimitedStorage`（Chrome Web Store 列为普通权限，审核风险低）。不用 IndexedDB——Phase 1 预期条目量 <几百条，simple key/value 足够；真到瓶颈再迁到 IndexedDB（见 §10.3）。 |
| **数据分片** | **索引 + 每条详情分开存**：<br>• `likethisFavoritesIndex` = 有序数组，每元素 `{ id, createdAt, title, type, thumbnail, sourceUrl }`（**画廊渲染只读这一个键**，避免一次性反序列化全量 sections 文本）。<br>• `likethisFav:<id>` = 该条详情（5 段解析、Final prompt、完整 source、model、mode）——**仅在打开详情 modal 时懒加载**。<br>• 这种分片也让**删除 / 重命名** 的写只影响 1–2 个键，避免 read-modify-write 全量数组的竞争。 |
| **保存范围** | **单一合并库**：Webpage 与 Artwork 两类卡片**共处一库**，用 `type` 字段区分；画廊页顶部提供 `All / Webpage / Artwork` 过滤器。不为两类各开一个库（避免用户在两个画廊之间来回切）。 |
| **排序维度（MVP）** | 画廊页默认排序 **日期新→旧**；可切换至 **日期旧→新** / **标题 A–Z** / **类型**（Webpage 在先 / Artwork 在先）。不做搜索（Phase 2，见 §10.3）。 |
| **详情交互** | 点击卡片 → **模态层**（在 favorites.html 内）展开该条的 5 卡片内容（完全复用 §7 / §9 的 `.section-card` 组件）+ 顶部缩略图 + source 元信息。modal 内提供：`Copy final prompt`（主按钮）/ `Open source` / `Rename` / `Delete`（二级）。不做跳转到 detail 独立页——额外路由对 MVP 不划算。 |
| **设备范围** | `chrome.storage.local` 是**本机 + 当前 Chrome profile** 范围，**跨设备不同步**。Likethis 当前用户画像是独立设计师，该限制可接受；跨设备同步 / 导出 JSON 列入 §10.3 延后。 |
| **依赖关系** | **硬依赖 §7 和 §9**：Webpage 卡需要 §7 的 `parseSections` + `.section-card`；Artwork 卡需要 §9 的艺术协议 + `.section-card`。`ParsedSections` 已是卡片详情的 persisted 形态。**不依赖 §8**——§8 产出的 `## Motion` 段只是 §7 Motion 卡里一段文字，对 §10 的存储 schema 透明。 |
| **护栏继承** | Artwork 卡在详情 modal 内**保留 §9 的护栏条**（`sectionFinalPromptGuardrail`）；复制 Final prompt 时也复制 §9 规定的「inspiration only, do not reproduce…」护栏句（已嵌在 Final prompt 正文里，无需额外处理）。 |

### 10.2 待办清单（Phase 1 — MVP）

> 依赖顺序：**manifest / 存储层** → **缩略图生成 + 侧栏保存按钮** → **favorites.html 壳** → **画廊 grid + sort + filter** → **详情 modal + rename / delete** → **i18n + 主题共享** → **回归**。

- [ ] **manifest 权限**：`manifest.json` `permissions` 数组新增 `"unlimitedStorage"`；保留现有 `storage`。Chrome Web Store 上该权限审核友好，无需额外 justification。
- [ ] **存储层（`favorites.js` 或 `storage/favorites.js`）**：封装纯函数 CRUD——`listFavorites()` / `getFavorite(id)` / `addFavorite(item)` / `updateFavoriteMeta(id, patch)`（标题等索引字段）/ `deleteFavorite(id)` / `hasFavorite(id)`。内部通过 `chrome.storage.local` 读写 `likethisFavoritesIndex` 与 `likethisFav:<id>`。`add` 时先写详情键，再 push 到索引并整体写回索引（保证画廊永远能渲染，即使详情写失败也不会出现幽灵条目——此处应先写详情、后写索引）。
- [ ] **数据模型（JSDoc `@typedef`）**：在 `favorites.js` 顶部定义 `FavoriteItem` / `FavoriteIndexEntry` / `ParsedSectionsWebpage` / `ParsedSectionsArtwork`，作为后续所有模块的单一 source of truth；`ParsedSections*` 直接复用 §7 / §9 的解析返回类型。
- [ ] **缩略图生成（`sidepanel.js` 或 `util/thumbnail.js`）**：`async function buildThumbnail(base64Png, { maxWidth = 400, quality = 0.7 })` → 用 `OffscreenCanvas`（侧栏环境支持）绘制缩放后导出 `image/jpeg` 的 dataURL；失败时回退到原 PNG。保存时同步调用。
- [ ] **侧栏保存按钮**：Webpage tab 与 Artwork tab 的结果区（§7 的卡片组末尾 / 或 Final prompt 卡旁边）加一个 `Save to Favorites ♡` 按钮；点击时：
  - 从当前 `lastAnalysis` 会话态拿到 `sections` / `finalPrompt` / `rawModelText` / 原始截图 base64 / `sourceUrl` / `pageTitle` / `model` / `mode`。
  - 生成 `id = crypto.randomUUID()`，`title = autoTitleFromSections(sections, type)`。
  - 生成 thumbnail，调用 `addFavorite(...)`，按钮变为 `Saved ♥`（toggle 状态；再次点击调 `deleteFavorite` 取消）。
  - 新增 `STRINGS` 键：`saveToFavorites` / `unsave` / `statusSaved` / `statusUnsaved` / `openLibrary`。
- [ ] **会话态容器**：`sidepanel.js` 引入 `let lastAnalysisContext = null;` 保留当前结果的完整素材，避免从 DOM 反向拼装；每次新分析触发时先清空；切换 tab 时也清空 + 重置 `Save` 按钮为未保存态。
- [ ] **`favorites.html` 壳**：新文件 `favorites.html` + `favorites.css` + `favorites.js`；不走侧栏容器，自己有一个 `<header>`（品牌 + 主题切换 + 语言切换 + `Back to side panel` 提示）+ 一个 toolbar（排序下拉 + 类型过滤 `All / Webpage / Artwork` + 计数徽章）+ 一个 `<main class="gallery-grid">`。`favorites.js` 启动时并行：`chrome.storage.sync.get(['likethisUiLocale', 'likethisTheme'])` 同步 UI；`chrome.storage.local.get('likethisFavoritesIndex')` 读画廊。
- [ ] **入口按钮（侧栏 → Favorites）**：在侧栏 header 附近（建议主题按钮左侧）加一个小 icon 按钮 `Open library`；`click` → `chrome.tabs.create({ url: chrome.runtime.getURL('favorites.html') })`。不依赖 §9 的 tab 切换条；**无论当前在 Webpage 还是 Artwork tab 都显示**。
- [ ] **画廊卡片组件**：`.fav-card`，内部结构：`thumbnail` → `title`（双击可编辑，contenteditable + blur 回写）→ `source meta`（favicon + hostname）→ `type badge`（`Webpage` / `Artwork`，配色区分）→ hover 出现二级 action 行（`Open details` / `Copy final prompt` / `Delete`）。CSS 沿用侧栏的 tokens（`--bg-elevated` / `--border-subtle` / `--glow-neutral`）。
- [ ] **排序 / 过滤逻辑**：纯客户端排序 `likethisFavoritesIndex`；过滤靠 `type` 字段。状态持久到 `chrome.storage.sync`（新键 `likethisFavoritesSort` / `likethisFavoritesFilter`，启动时恢复）。
- [ ] **详情 modal（`favorites.html`）**：点卡片 → 懒加载 `likethisFav:<id>` → 打开 modal（顶部展示缩略图 + source；body 渲染 5 张 `.section-card`，完全复用 §7 / §9 的 UI 样式；底部 action 栏 `Copy final prompt` / `Open source` / `Rename` / `Delete`）。`Delete` 弹一次确认。
- [ ] **重命名交互**：双击卡片标题或 modal 里的 `Rename` → 编辑框 → Enter / blur 保存；调用 `updateFavoriteMeta(id, { title: newTitle })`，UI 立即反映。
- [ ] **i18n**：新增 `STRINGS` 键覆盖 `openLibrary` / `favoritesTitle` / `libraryEmpty` / `sortNewestFirst` / `sortOldestFirst` / `sortTitleAZ` / `sortByType` / `filterAll` / `filterWebpage` / `filterArtwork` / `cardActionOpen` / `cardActionCopy` / `cardActionDelete` / `confirmDelete` / `untitledSnapshot` / `untitledArtwork` / `copyFinalPrompt` / `openSource`。Favorites 页也通过 `langSelect` 控件同步切换，写入同一 `likethisUiLocale`。
- [ ] **主题共享**：`favorites.html` 读 `likethisTheme` 并在 `<html data-theme>` 上应用，沿用 `sidepanel.css` 的 tokens（建议 `sidepanel.css` 里与主题 token 相关的变量**抽到一个独立 `theme.css`** 被两处共用；不做也可以暂时 copy-paste，先 ship 再重构）。
- [ ] **跨上下文同步**：Favorites 页监听 `chrome.storage.onChanged` 对 `likethisFavoritesIndex`、`likethisTheme`、`likethisUiLocale` 的变更；侧栏保存一条 → Favorites 页已打开时即时出现新卡。
- [ ] **空态**：画廊为空时渲染一个居中的插画 + 文案 `libraryEmpty`（例：`Nothing saved yet. Run an analysis in the side panel and click Save ♥ to add it here.`）。
- [ ] **回归**：
  - Webpage 保存 / Artwork 保存 / 两者混存 / 排序切换 / 类型过滤 / 重命名 / 删除 / 取消收藏（通过侧栏 `Saved ♥` toggle）。
  - 画廊页中 / 英切换、深 / 浅色切换；关闭再开 Chrome，数据仍在。
  - 恶劣数据：`likethisFav:<id>` 意外缺失（详情键丢失、索引还在）时，打开详情显示错误态 + `Delete this entry` 按钮（不让脏数据永久卡住画廊）。
  - 尺寸压力：批量造 200 条假数据，验证画廊首屏渲染 <500ms；若肉眼可感卡顿，打开 §10.3 的虚拟滚动条目。

### 10.3 已推迟 / Deferred（后续迭代再排期）

- [ ] **X3 — 原图 + 缩略图双存**：详情 modal 上显示原尺寸图（而非缩略图放大模糊）；`likethisFav:<id>` 新增 `fullImage` 字段。需评估库大小（原图可能 ~500KB × N 条）。可做成 per-item 可选：「Save in high fidelity」勾选框。
- [ ] **文本搜索**：画廊 toolbar 加搜索输入框，按 `title` + Final prompt 文本模糊匹配；>200 条时在 sidepanel 侧也可复用。
- [ ] **标签 / 文件夹**：允许给每张卡片打多个 tag（`bauhaus` / `e-commerce` / `motion-heavy`）；或支持拖入自定义文件夹。涉及 `likethisFavoritesIndex` schema 升级（加 `tags: string[]`），需迁移逻辑。
- [ ] **拖拽重排 / 自定义顺序**：默认排序之外加一个 `Custom` 模式，`index` 记录用户手动顺序；HTML5 DnD 即可。
- [ ] **批量操作**：多选 → 批量删除 / 批量导出 / 批量打 tag。
- [ ] **导出 / 导入 JSON**：把整个库（索引 + 所有详情）dump 成一份 JSON 文件（缩略图仍在 dataURL 里），供跨设备迁移；对应导入逻辑需要冲突策略（相同 id 合并 / 跳过 / 替换）。这是「跨设备同步」的廉价替代方案。
- [ ] **云同步**：真做跨设备同步需引入后端（或 GDrive / iCloud App Folder）；大改工程，Phase 3+ 再评估。
- [ ] **虚拟滚动**：当索引 >300–500 条时，卡片 grid 切换到虚拟化渲染（`IntersectionObserver` 或自建），避免 DOM 数量过多导致滚动卡顿。
- [ ] **IndexedDB 迁移**：当需要复杂查询（跨 tag + 时间段 + 模糊搜索）或库规模 >1000 条时，把 `likethisFav:*` 迁到 IndexedDB；保留 `likethisFavoritesIndex` 在 `storage.local` 作为快速首屏索引。需一次性迁移脚本。
- [ ] **分享 / 导出单卡**：右键卡片 → 「Export as PNG」（缩略图 + 5 段文本拼版）或 `Copy share JSON`，供设计评审贴到 Notion / Figma。
- [ ] **侧栏「Recent 5」摘要**：在侧栏底部加一个折叠小抽屉显示最近 5 条收藏的缩略图，点击打开 `favorites.html` 并定位。属 U3 决策的一部分，未来若数据证明侧栏场景存在再做。
- [ ] **详情 modal 内的 re-run**：卡片存了 `sourceUrl` 和 `mode` / `model` 信息，可直接在 modal 里一键「用另一模型重跑这张截图」并生成新卡；依赖重构 `analyzeWith*` 允许传入 base64 + sections 回显。

---

*文档版本：与仓库 `manifest.json` 中 Likethis **v1.5.0** 左右一致；若结构大改请更新本文件。*
