/** @typedef {{ label: string; id: string; provider: "gemini" | "claude" }} ModelOption */

/** @type {ModelOption[]} */
const MODEL_OPTIONS = [
  { label: "Gemini 3.1 Flash", id: "gemini-3-flash-preview", provider: "gemini" },
  { label: "Gemini 2.5 Pro", id: "gemini-2.5-pro", provider: "gemini" },
  // gemini-1.5-* is no longer exposed for generateContent on many keys; use 2.x family instead.
  { label: "Gemini 2.5 Flash", id: "gemini-2.5-flash", provider: "gemini" },
  { label: "Gemini 2.0 Flash", id: "gemini-2.0-flash", provider: "gemini" },
  { label: "Claude Sonnet 4", id: "claude-sonnet-4-20250514", provider: "claude" },
  { label: "Claude 3.5 Sonnet", id: "claude-3-5-sonnet-20241022", provider: "claude" },
  { label: "Claude 3.5 Haiku", id: "claude-3-5-haiku-20241022", provider: "claude" },
  { label: "Claude 3 Opus", id: "claude-3-opus-20240229", provider: "claude" },
];

const DEFAULT_MODEL_ID = MODEL_OPTIONS[0].id;

const ANTHROPIC_MESSAGES_VERSION = "2023-06-01";

function getModelSpec(modelId) {
  return MODEL_OPTIONS.find((o) => o.id === modelId) || null;
}

/** Legacy / removed Gemini 1.5 IDs in storage → working models on current API */
const LEGACY_GEMINI_MODEL_ID_MAP = {
  "gemini-1.5-pro": "gemini-2.5-pro",
  "gemini-1.5-flash": "gemini-2.5-flash",
  "gemini-1.5-pro-001": "gemini-2.5-pro",
  "gemini-1.5-flash-001": "gemini-2.5-flash",
  "gemini-1.5-pro-002": "gemini-2.5-pro",
  "gemini-1.5-flash-002": "gemini-2.5-flash",
};

function normalizeStoredGeminiModelId(id) {
  const t = (id || "").trim();
  return LEGACY_GEMINI_MODEL_ID_MAP[t] || t;
}

/** Default: design-oriented labels. Alternative: technical parameter summary (see plan.md §5). */
const MOTION_OUTPUT_DESIGN = "designLabels";
const MOTION_OUTPUT_TECH = "technicalSummary";

const PROMPTS = {
  en: {
    designLabels: {
      system: `Role: You are a rigorous front-end engineering expert and visual analyst.

Task: Analyze the user's partial screenshot and the accompanying CSS property data; distill precise Vibe Coding keywords.

Core principle: No hallucination. Every description must be grounded in the provided CSS facts or what is visibly evident in the image.

Output requirements (follow this structure strictly):

Visual style & composition: Identify layout patterns for the region (e.g. Bento, Flex-center).

Color & physical feel: From the screenshot only, extract HEX colors, border thickness, border radius, and material evidence (e.g. backdrop-blur).

Evidence-based motion:

You must inspect transition-duration, transition-timing-function, or @keyframes in the CSS data (including default-state computed styles).

If JSON includes hoverState: the extension simulated :hover in-page by mirroring :hover selectors with a temporary class and re-reading getComputedStyle. Compare hoverState.diffFromDefault (or hoverState.computed vs top-level computed):
    * If the diff includes transition/animation keys, or hover differs in transform, opacity, box-shadow, filter, background-color, color, etc.: in "Evidence-based motion" describe verifiable default→hover changes (quote JSON values/keywords only), and in the final prompt spell out default vs hover styling and transition feel.
    * If hoverState.error is set, or diffFromDefault is empty and transition/animation matches default: state that mirrored :hover rules were not captured (e.g. strict CSP); do not invent hover motion.

If there is no motion data (default and hover lack transition/animation evidence): state exactly "Static (No motion data detected)" — do not guess.

Final Vibe Coding prompt:
    * Start with "Build this component based on the exact styles provided..."
    * Include only confirmed facts above.
    * If hover diffs exist, the final prompt must include hover interaction and transition description; if neither default nor hover has motion evidence, do not add motion wording to the prompt.`,
    userIntro: `【CSS data】
If a 【CSS_JSON】 block appears below: strings come from getComputedStyle on the target (including initial, none, 0s, etc.). transition / animation fields are the primary signal for static vs animated; do not invent values absent from JSON.

Top-level computed is the pointer-not-hovered state; hoverState is a second pass that simulates :hover; prefer hoverState.diffFromDefault for default→hover; if hoverState.simulation.rulesInserted is 0 and error is set, do not invent hover motion.

Without 【CSS_JSON】: do not infer computed beyond what the screenshot plainly shows; for "Evidence-based motion" use Static (No motion data detected) per system instructions (do not invent concrete duration/easing from the image alone).

Follow the section titles and order from the system instructions. Applies to full-page and region captures.`,
    },
    technicalSummary: {
      system: `Role: You are a rigorous front-end engineer. Prioritize TECHNICAL HANDOFF over marketing language.

Task: From the screenshot and CSS JSON, produce a parameter-dense summary. When motionEvidence.ancestorChain exists, parent elements may own keyframes or transitions—cite the correct depth (0 = hit-tested target).

Output (this order):
1) Technical parameter summary — bullets of property: value from JSON only (transition*, animation*, transform when present in JSON). Include relevant non-trivial lines from ancestorChain[].motionComputed.
2) Visual & composition — short.
3) Evidence-based motion — attribute motion to target vs ancestor using ancestorChain and animationsFromAPI; respect hoverState the same way as design mode.
4) Design keyword tags — optional short list after the above.

If no motion in JSON: state exactly "Static (No motion data detected)" for motion. No invented numbers.

Final block must start with "Build this component based on the exact styles provided..." and stay dense with quoted JSON-backed parameters.`,
      userIntro: `【CSS data — technical mode】
【CSS_JSON】 may include schemaVersion 2+ and motionEvidence.ancestorChain (depth 0 = element at sample point, then parents). Use the chain to detect motion on ancestors. animationsFromAPI comes from the Web Animations API. hoverState rules match design mode.

Without 【CSS_JSON】: screenshot-only; for motion use Static (No motion data detected) per system instructions.`,
    },
  },
  zh: {
    designLabels: {
      system: `Role: 你是一位严谨的前端工程专家与视觉分析师。

Task: 请分析用户提供的局部截图及对应的 CSS 属性数据，提炼出精准的 Vibe Coding 关键词。

核心原则：严禁幻觉（No Hallucination）。所有的描述必须基于提供的 CSS 事实或视觉可见元素。

输出要求（严格按以下结构）：

视觉流派与构图： 识别该区域的布局模式（如 Bento, Flex-center）。

颜色与物理质感： 仅根据截图提取 HEX 色值、边框厚度、圆角半径及真实的材质感（如 backdrop-blur 证据）。

真实交互动效 (Evidence-based Motion)：

必须 检查 CSS 数据中的 transition-duration, transition-timing-function 或 @keyframes（含默认态 computed）。

若 JSON 中存在 hoverState：表示扩展在页面内通过「:hover 选择器镜像 + 临时类」模拟了悬停态并再次读取 getComputedStyle。请同时对照 hoverState.diffFromDefault（或 hoverState.computed 与顶层 computed 的差异）：
    * 若 diff 中出现 transition / animation 相关键，或 hover 下 transform、opacity、box-shadow、filter、background-color、color 等与默认态不同：必须在「真实交互动效」中写出从默认态到悬停态的可验证变化（仅引用 JSON 中的数值与关键字），并在最终 Prompt 中明确「默认态 / Hover 态」各自的样式与过渡手感。
    * 若 hoverState.error 非空、或 diffFromDefault 为空对象且 transition/animation 与默认态完全一致：说明未捕获到可镜像的 :hover 规则（如严格 CSP、复杂选择器未命中）；此时不得编造悬停动效，可简短注明 hover 数据不可用。

如果没有可用的动效数据（默认与 hover 均无 transition/animation 证据）： 明确标注为 “Static (No motion data detected)”，严禁凭空猜测。

Vibe Coding 最终 Prompt：
    * 以 "Build this component based on the exact styles provided..." 开头。
    * 仅包含上述确认的事实。
    * 若存在 hover 差异证据，最终 Prompt 须包含悬停交互与过渡描述；若默认与 hover 均无动效证据，不要在 Prompt 中加入任何动效描述。`,
    userIntro: `【CSS 数据说明】
若下方附带【CSS_JSON】代码块：其中的字符串均来自目标元素 getComputedStyle（含 initial、none、0s 等原样值）。transition / animation 相关字段为判断「是否静态」的首要依据；不得编造 JSON 中未出现的数值。
顶层 computed 为指针未悬停时的样式；hoverState 为扩展尽力模拟 :hover 后的二次采样：优先使用 hoverState.diffFromDefault 描述「默认→悬停」的可验证样式与动效变化；hoverState.simulation.rulesInserted 为 0 且存在 error 时不得臆造悬停动效。
若无【CSS_JSON】：除截图直接可见信息外不得推断 computed；「真实交互动效」须按系统指令写 Static (No motion data detected)（截图本身能无可争议证明动效时仍不得编造具体 duration/easing）。

请严格按系统指令中的章节标题与顺序输出。整页与框选截图均适用。`,
    },
    technicalSummary: {
      system: `Role: 你是严谨的前端工程师。本模式以「技术参数摘要」为主，口语化标签为辅。

Task: 根据截图与【CSS_JSON】输出便于工程落地的参数化描述。若存在 motionEvidence.ancestorChain，父级可能承载 animation/transition，请在分析中注明 depth 与层级来源。

输出顺序：
1）技术参数摘要：仅引用 JSON 中的 transition/animation/transform 等字段，写成 property: value 要点；结合 ancestorChain 各层的 motionComputed。
2）视觉与构图：简短。
3）真实动效：对照 ancestorChain、animationsFromAPI 与 hoverState（规则与设计模式相同）。
4）设计向关键词：少量短语，放在技术块之后。

无动效证据时动效部分写 "Static (No motion data detected)"。

最终小节仍以 "Build this component based on the exact styles provided..." 开头，内容偏参数密度。`,
      userIntro: `【CSS 数据 — 技术摘要模式】
【CSS_JSON】 可能含 schemaVersion 2+ 与 motionEvidence.ancestorChain（depth 0 为采样点元素，向上为父级）。animationsFromAPI 来自 Web Animations API。hoverState 与设计模式一致。

若无【CSS_JSON】：动效按系统指令写 Static (No motion data detected)。`,
    },
  },
};

/** @type {{ en: Record<string, string>; zh: Record<string, string> }} */
const STRINGS = {
  en: {
    language: "Language",
    model: "Model",
    linkSettings: "API settings",
    captureFull: "Capture full page",
    regionVibe: "Draw region for Vibe",
    labelMotionOutput: "Motion output",
    motionOutputDesignOption: "Design labels (default)",
    motionOutputTechnicalOption: "Technical summary",
    outputLabelDesign: "Vibe Coding prompt",
    outputLabelTechnical: "Technical parameter summary",
    outputPlaceholderDesign: "Generated text will appear here after capture and analysis.",
    outputPlaceholderTechnical: "Technical summary will appear here after capture and analysis.",
    copy: "Copy to clipboard",
    copyHint: "Copies the full text in the box above.",
    spinnerLoading: "Loading",
    errInvalidModel: "Invalid model selection.",
    errGeminiKey: "Add your Google Gemini API key in API settings first.",
    errAnthropicKey: "Add your Anthropic API key in API settings first.",
    statusCapturingTab: "Capturing the active tab…",
    errCapture: "Capture failed.",
    statusCallingGemini: "Calling Gemini to analyze the page…",
    statusCallingClaude: "Calling Claude to analyze the page…",
    statusModelBusy: "Model busy. Retrying in ~{s}s (attempt {a} of {m})…",
    errNoText: "The model returned no text.",
    statusDone: "Done.",
    errCouldNotGetTab: "Could not get the active tab.",
    errRegionNotAvailable: "Region selection is not available on this page (use a normal http(s) tab).",
    statusDragRegion: "Drag on the page to select a region. Press Esc to cancel.",
    errInjectPicker: "Could not inject region picker on this page.",
    errSelectionCancelled: "Selection cancelled or too small.",
    statusCapturingVisible: "Capturing visible tab…",
    statusCropping: "Cropping selection…",
    statusCallingGeminiRegion: "Calling Gemini on the cropped region…",
    statusCallingClaudeRegion: "Calling Claude on the cropped region…",
    copyDone: "Copied to clipboard.",
    copyFailed: "Copy failed. Select the text and copy manually.",
    themeAriaWhenDark: "Switch to light mode",
    themeAriaWhenLight: "Switch to dark mode",
    uiTooltipThemeWhenDark: "Switch to light mode",
    uiTooltipThemeWhenLight: "Switch to dark mode",
    uiTooltipApiDotOk: "Green: key ready",
    uiTooltipApiDotMissing: "Red: key missing",
    uiTooltipApiLink: "Open API settings to add Gemini or Claude keys.",
    apiDotAriaOk: "API key configured for the selected model",
    apiDotAriaMissing: "API key missing for the selected model",
  },
  zh: {
    language: "语言",
    model: "模型",
    linkSettings: "API 设置",
    captureFull: "全屏捕获",
    regionVibe: "框选区域提炼 Vibe",
    labelMotionOutput: "动效输出",
    motionOutputDesignOption: "口语标签（默认）",
    motionOutputTechnicalOption: "技术参数摘要",
    outputLabelDesign: "Vibe Coding 提示词",
    outputLabelTechnical: "技术参数摘要",
    outputPlaceholderDesign: "捕获并分析后，生成的内容将显示在这里。",
    outputPlaceholderTechnical: "捕获并分析后，技术向摘要将显示在这里。",
    copy: "复制到剪贴板",
    copyHint: "复制上方文本框中的全部内容。",
    spinnerLoading: "加载中",
    errInvalidModel: "模型选择无效。",
    errGeminiKey: "请先在 API 设置中填写 Google Gemini API key。",
    errAnthropicKey: "请先在 API 设置中填写 Anthropic API key。",
    statusCapturingTab: "正在捕获当前标签页…",
    errCapture: "截图失败。",
    statusCallingGemini: "正在调用 Gemini 分析页面…",
    statusCallingClaude: "正在调用 Claude 分析页面…",
    statusModelBusy: "模型繁忙，约 {s} 秒后重试（第 {a}/{m} 次）…",
    errNoText: "模型未返回文本。",
    statusDone: "完成。",
    errCouldNotGetTab: "无法获取当前标签页。",
    errRegionNotAvailable: "当前页面无法框选（请在普通 http(s) 网页使用）。",
    statusDragRegion: "在页面上拖拽框选区域，按 Esc 取消。",
    errInjectPicker: "无法在此页面注入框选脚本。",
    errSelectionCancelled: "已取消选择或区域过小。",
    statusCapturingVisible: "正在捕获可见区域…",
    statusCropping: "正在裁剪选区…",
    statusCallingGeminiRegion: "正在用 Gemini 分析裁剪区域…",
    statusCallingClaudeRegion: "正在用 Claude 分析裁剪区域…",
    copyDone: "已复制到剪贴板。",
    copyFailed: "复制失败，请手动选择文本复制。",
    themeAriaWhenDark: "切换到浅色模式",
    themeAriaWhenLight: "切换到深色模式",
    uiTooltipThemeWhenDark: "切换到浅色模式",
    uiTooltipThemeWhenLight: "切换到深色模式",
    uiTooltipApiDotOk: "绿色：Key 已就绪",
    uiTooltipApiDotMissing: "红色：缺少 Key",
    uiTooltipApiLink: "打开 API 设置，填写 Gemini 或 Claude 的密钥。",
    apiDotAriaOk: "当前模型所需的 API key 已配置",
    apiDotAriaMissing: "当前模型所需的 API key 未配置",
  },
};

/** @type {"en" | "zh"} */
let currentLocale = "en";

function resolveLocale(loc) {
  return loc === "zh" ? "zh" : "en";
}

function t(key, vars) {
  const raw = STRINGS[currentLocale]?.[key] ?? STRINGS.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ""));
}

function ti(locale, key, vars) {
  const loc = resolveLocale(locale);
  const raw = STRINGS[loc]?.[key] ?? STRINGS.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ""));
}

function resolveMotionOutputMode(mode) {
  return mode === MOTION_OUTPUT_TECH ? MOTION_OUTPUT_TECH : MOTION_OUTPUT_DESIGN;
}

/**
 * @param {string} [locale]
 * @param {string} [outputMode]  MOTION_OUTPUT_DESIGN | MOTION_OUTPUT_TECH
 */
function getPromptPack(locale, outputMode) {
  const loc = resolveLocale(locale);
  const mode = resolveMotionOutputMode(outputMode);
  const langPack = PROMPTS[loc] || PROMPTS.en;
  return langPack[mode] || langPack.designLabels;
}

const ICON_SUN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M17.66 6.34l1.41-1.41"/></svg>`;

const ICON_MOON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

const captureBtn = document.getElementById("capture-btn");
const regionVibeBtn = document.getElementById("region-vibe-btn");
const copyBtn = document.getElementById("copy-btn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const modelSelect = document.getElementById("model-select");
const langSelect = document.getElementById("lang-select");
const motionOutputSelect = document.getElementById("motion-output-mode");
const loadingIndicator = document.getElementById("loading-indicator");
const linkSettingsEl = document.getElementById("link-settings");
const labelLang = document.getElementById("label-lang");
const labelModel = document.getElementById("label-model");
const labelResult = document.getElementById("label-result");
const labelMotionOutput = document.getElementById("label-motion-output");
const spinnerEl = document.getElementById("spinner-el");
const themeToggleBtn = document.getElementById("theme-toggle");
const themeToggleIcon = document.getElementById("theme-toggle-icon");
const apiStatusDot = document.getElementById("api-status-dot");
const tooltipThemeEl = document.getElementById("tooltip-theme");
const tooltipApiDotEl = document.getElementById("tooltip-api-dot");
const tooltipApiLinkEl = document.getElementById("tooltip-api-link");

function syncThemeToggleUi() {
  if (!themeToggleBtn || !themeToggleIcon) return;
  const isDark = document.documentElement.getAttribute("data-theme") !== "light";
  themeToggleIcon.innerHTML = isDark ? ICON_SUN_SVG : ICON_MOON_SVG;
  themeToggleBtn.removeAttribute("title");
  const aria = isDark ? t("themeAriaWhenDark") : t("themeAriaWhenLight");
  themeToggleBtn.setAttribute("aria-label", aria);
  themeToggleBtn.setAttribute("aria-pressed", isDark ? "true" : "false");
  if (tooltipThemeEl) {
    tooltipThemeEl.textContent = isDark ? t("uiTooltipThemeWhenDark") : t("uiTooltipThemeWhenLight");
  }
}

function applyTheme(theme) {
  const mode = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", mode);
  chrome.storage.sync.set({ likethisTheme: mode });
  syncThemeToggleUi();
}

async function getStoredTheme() {
  const { likethisTheme } = await chrome.storage.sync.get("likethisTheme");
  return likethisTheme === "light" ? "light" : "dark";
}

async function updateApiStatusIndicator() {
  if (!apiStatusDot) return;
  const modelId = modelSelect.value || (await getStoredModelId());
  const spec = getModelSpec(modelId);
  let ok = false;
  if (spec?.provider === "gemini") ok = !!(await getStoredGeminiKey());
  else if (spec?.provider === "claude") ok = !!(await getStoredAnthropicKey());
  apiStatusDot.classList.toggle("api-status-dot--ok", ok);
  apiStatusDot.classList.toggle("api-status-dot--missing", !ok);
  apiStatusDot.removeAttribute("title");
  const ariaShort = ok ? t("apiDotAriaOk") : t("apiDotAriaMissing");
  apiStatusDot.setAttribute("aria-label", ariaShort);
  if (tooltipApiDotEl) {
    tooltipApiDotEl.textContent = ok ? t("uiTooltipApiDotOk") : t("uiTooltipApiDotMissing");
  }
}

function updateApiSettingsLinkTooltip() {
  if (!linkSettingsEl || !tooltipApiLinkEl) return;
  linkSettingsEl.removeAttribute("title");
  tooltipApiLinkEl.textContent = t("uiTooltipApiLink");
}

function updateResultLabelAndPlaceholder() {
  const mode = resolveMotionOutputMode(motionOutputSelect?.value);
  if (labelResult) {
    labelResult.textContent = mode === MOTION_OUTPUT_TECH ? t("outputLabelTechnical") : t("outputLabelDesign");
  }
  if (resultEl) {
    resultEl.placeholder =
      mode === MOTION_OUTPUT_TECH ? t("outputPlaceholderTechnical") : t("outputPlaceholderDesign");
  }
}

function applyUiLocale() {
  const loc = currentLocale;
  document.documentElement.lang = loc === "zh" ? "zh-CN" : "en";
  if (labelLang) labelLang.textContent = t("language");
  if (labelModel) labelModel.textContent = t("model");
  if (labelMotionOutput) labelMotionOutput.textContent = t("labelMotionOutput");
  if (motionOutputSelect) {
    motionOutputSelect.options[0].textContent = t("motionOutputDesignOption");
    motionOutputSelect.options[1].textContent = t("motionOutputTechnicalOption");
  }
  updateResultLabelAndPlaceholder();
  if (linkSettingsEl) linkSettingsEl.textContent = t("linkSettings");
  captureBtn.textContent = t("captureFull");
  regionVibeBtn.textContent = t("regionVibe");
  copyBtn.textContent = t("copy");
  copyBtn.title = t("copyHint");
  if (spinnerEl) spinnerEl.setAttribute("aria-label", t("spinnerLoading"));
  syncThemeToggleUi();
  updateApiSettingsLinkTooltip();
  void updateApiStatusIndicator();
}

function setStatus(text) {
  statusEl.textContent = text || "";
}

function setLoading(visible) {
  if (!loadingIndicator) return;
  loadingIndicator.classList.toggle("is-hidden", !visible);
  loadingIndicator.setAttribute("aria-hidden", visible ? "false" : "true");
}

function toGeminiInlinePngBase64(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) throw new Error("Invalid capture data (missing data URL separator).");
  let b64 = dataUrl.slice(comma + 1).trim();
  b64 = b64.replace(/\s/g, "");
  if (!b64.length) throw new Error("Screenshot Base64 is empty.");
  return b64;
}

function canInjectRegionPicker(tabUrl) {
  if (!tabUrl) return false;
  const u = tabUrl.toLowerCase();
  if (u.startsWith("chrome://") || u.startsWith("chrome-extension://") || u.startsWith("devtools://")) {
    return false;
  }
  if (u.startsWith("https://chrome.google.com/webstore") || u.startsWith("https://chromewebstore.google.com/")) {
    return false;
  }
  return u.startsWith("http://") || u.startsWith("https://");
}

/**
 * Map CSS-pixel rect (viewport) onto the PNG from captureVisibleTab and crop to PNG Base64.
 */
function cropScreenshotToRegionBase64(dataUrl, rect, viewportWidth, viewportHeight) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      if (!iw || !ih) {
        reject(new Error("Screenshot has zero size."));
        return;
      }
      const scaleX = iw / viewportWidth;
      const scaleY = ih / viewportHeight;
      let sx = Math.max(0, Math.round(rect.x * scaleX));
      let sy = Math.max(0, Math.round(rect.y * scaleY));
      let sw = Math.max(1, Math.round(rect.width * scaleX));
      let sh = Math.max(1, Math.round(rect.height * scaleY));
      sw = Math.min(sw, iw - sx);
      sh = Math.min(sh, ih - sy);
      if (sw < 1 || sh < 1) {
        reject(new Error("Crop region is outside the screenshot bounds."));
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get 2D context for crop."));
        return;
      }
      try {
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        const out = canvas.toDataURL("image/png");
        resolve(toGeminiInlinePngBase64(out));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("Failed to decode screenshot for cropping."));
    img.src = dataUrl;
  });
}

async function getStoredGeminiKey() {
  const { geminiApiKey } = await chrome.storage.sync.get("geminiApiKey");
  return (geminiApiKey || "").trim();
}

async function getStoredAnthropicKey() {
  const { anthropicApiKey } = await chrome.storage.sync.get("anthropicApiKey");
  return (anthropicApiKey || "").trim();
}

async function getStoredModelId() {
  const { vibeAnalysisModelId, geminiModelId } = await chrome.storage.sync.get([
    "vibeAnalysisModelId",
    "geminiModelId",
  ]);
  const raw = (vibeAnalysisModelId || geminiModelId || DEFAULT_MODEL_ID || "").trim() || DEFAULT_MODEL_ID;
  const id = normalizeStoredGeminiModelId(raw);
  if (id !== raw && MODEL_OPTIONS.some((o) => o.id === id)) {
    chrome.storage.sync.set({ vibeAnalysisModelId: id, geminiModelId: id });
  }
  const known = MODEL_OPTIONS.some((o) => o.id === id);
  return known ? id : DEFAULT_MODEL_ID;
}

function buildModelSelect() {
  modelSelect.innerHTML = "";
  for (const opt of MODEL_OPTIONS) {
    const el = document.createElement("option");
    el.value = opt.id;
    el.textContent = opt.label;
    modelSelect.appendChild(el);
  }
}

async function bootstrap() {
  currentLocale = await getStoredLocale();
  if (langSelect) langSelect.value = currentLocale;

  const theme = await getStoredTheme();
  document.documentElement.setAttribute("data-theme", theme);

  const motionMode = await getStoredMotionOutputMode();
  if (motionOutputSelect) motionOutputSelect.value = motionMode;

  buildModelSelect();
  modelSelect.value = await getStoredModelId();

  applyUiLocale();
}

modelSelect.addEventListener("change", () => {
  const value = modelSelect.value;
  chrome.storage.sync.set({ vibeAnalysisModelId: value, geminiModelId: value });
  void updateApiStatusIndicator();
});

if (langSelect) {
  langSelect.addEventListener("change", () => {
    currentLocale = resolveLocale(langSelect.value);
    chrome.storage.sync.set({ likethisUiLocale: currentLocale });
    applyUiLocale();
  });
}

if (motionOutputSelect) {
  motionOutputSelect.addEventListener("change", () => {
    const v = resolveMotionOutputMode(motionOutputSelect.value);
    chrome.storage.sync.set({ likethisMotionOutputMode: v });
    updateResultLabelAndPlaceholder();
  });
}

if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    applyTheme(isDark ? "light" : "dark");
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.geminiApiKey || changes.anthropicApiKey) {
    void updateApiStatusIndicator();
  }
  if (changes.likethisTheme) {
    const v = changes.likethisTheme.newValue;
    document.documentElement.setAttribute("data-theme", v === "light" ? "light" : "dark");
    syncThemeToggleUi();
  }
  if (changes.likethisMotionOutputMode && motionOutputSelect) {
    motionOutputSelect.value = resolveMotionOutputMode(changes.likethisMotionOutputMode.newValue);
    updateResultLabelAndPlaceholder();
  }
});

function buildAnalysisUserText(cssSnapshot, locale, outputMode) {
  const { userIntro } = getPromptPack(locale, outputMode);
  if (cssSnapshot == null) {
    return userIntro;
  }
  return `${userIntro}\n\n【CSS_JSON】\n\`\`\`json\n${JSON.stringify(cssSnapshot, null, 2)}\n\`\`\``;
}

async function getStoredLocale() {
  const { likethisUiLocale } = await chrome.storage.sync.get("likethisUiLocale");
  return resolveLocale(likethisUiLocale);
}

async function getStoredMotionOutputMode() {
  const { likethisMotionOutputMode } = await chrome.storage.sync.get("likethisMotionOutputMode");
  return resolveMotionOutputMode(likethisMotionOutputMode);
}

/**
 * @param {(info: { attempt: number; maxAttempts: number; delayMs: number; provider?: string }) => void} [onRetry503]
 * @param {object | null | undefined} [cssSnapshot]  来自页面的 computed 样式快照（可含于 pick）
 */
async function analyzeWithGemini(base64Png, apiKey, modelId, onRetry503, cssSnapshot, locale, outputMode) {
  const resolvedModelId = normalizeStoredGeminiModelId(modelId);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    resolvedModelId,
  )}:generateContent`;

  const { system } = getPromptPack(locale, outputMode);
  const fullText = `${system}\n\n---\n\n${buildAnalysisUserText(cssSnapshot, locale, outputMode)}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            inline_data: {
              mime_type: "image/png",
              data: base64Png,
            },
          },
          { text: fullText },
        ],
      },
    ],
    generation_config: {
      max_output_tokens: 8192,
      temperature: 0.7,
    },
  };

  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`API returned non-JSON (HTTP ${res.status}): ${raw.slice(0, 300)}`);
    }

    if (res.ok) {
      const block = data.promptFeedback?.blockReason;
      if (block) {
        throw new Error(`Request blocked by safety settings: ${block}`);
      }

      const parts = data.candidates?.[0]?.content?.parts;
      const text = Array.isArray(parts)
        ? parts
            .map((p) => (typeof p.text === "string" ? p.text : ""))
            .join("")
            .trim()
        : "";

      const finish = data.candidates?.[0]?.finishReason;
      if (!text && finish === "SAFETY") {
        throw new Error("The model produced no text due to safety settings.");
      }

      return text;
    }

    const msg = data.error?.message || data.message || raw.slice(0, 400);

    if (res.status === 429) {
      const lower = String(msg).toLowerCase();
      const looksLikeBillingExhausted =
        lower.includes("credit") ||
        lower.includes("billing") ||
        lower.includes("prepayment") ||
        lower.includes("payment required") ||
        lower.includes("insufficient");
      if (looksLikeBillingExhausted) {
        throw new Error(
          "Gemini 429: API credits or prepayment for this project may be exhausted. Open https://aistudio.google.com/ or your AI Studio project to fix billing or create a new API key.",
        );
      }
      throw new Error(
        `Gemini 429: Rate limit or too many requests. Wait and try again, or space out calls. (${msg})`,
      );
    }

    if (res.status === 503 && attempt < maxAttempts) {
      const delayMs = 2000 * 2 ** (attempt - 1);
      onRetry503?.({ attempt, maxAttempts, delayMs, provider: "gemini" });
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    if (res.status === 503) {
      throw new Error(
        "Gemini 503: This model is under heavy load after automatic retries. Try again later, or pick another model in the sidebar.",
      );
    }

    throw new Error(`Gemini API ${res.status}: ${msg}`);
  }

  throw new Error("Internal error: Gemini request did not complete.");
}

/**
 * @param {(info: { attempt: number; maxAttempts: number; delayMs: number; provider?: string }) => void} [onRetrySlow]
 */
async function analyzeWithClaude(base64Png, apiKey, modelId, onRetrySlow, cssSnapshot, locale, outputMode) {
  const url = "https://api.anthropic.com/v1/messages";
  const { system } = getPromptPack(locale, outputMode);
  const userText = buildAnalysisUserText(cssSnapshot, locale, outputMode);
  const body = {
    model: modelId,
    max_tokens: 8192,
    system,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: base64Png,
            },
          },
          { type: "text", text: userText },
        ],
      },
    ],
  };

  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_MESSAGES_VERSION,
      },
      body: JSON.stringify(body),
    });

    const raw = await res.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`Anthropic returned non-JSON (HTTP ${res.status}): ${raw.slice(0, 300)}`);
    }

    if (res.ok) {
      const parts = data.content;
      const text = Array.isArray(parts)
        ? parts
            .filter((p) => p && p.type === "text" && typeof p.text === "string")
            .map((p) => p.text)
            .join("")
            .trim()
        : "";
      const stop = data.stop_reason;
      if (!text && stop === "max_tokens") {
        throw new Error("Claude returned no text (max_tokens). Try again or use a smaller crop.");
      }
      return text;
    }

    const msg = data.error?.message || data.message || raw.slice(0, 400);

    if (res.status === 429) {
      throw new Error(`Claude 429: Rate limit or quota. (${msg})`);
    }

    if ((res.status === 529 || res.status === 503) && attempt < maxAttempts) {
      const delayMs = 2000 * 2 ** (attempt - 1);
      onRetrySlow?.({ attempt, maxAttempts, delayMs, provider: "claude" });
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    throw new Error(`Claude API ${res.status}: ${msg}`);
  }

  throw new Error("Internal error: Claude request did not complete.");
}

/**
 * @param {(info: { attempt: number; maxAttempts: number; delayMs: number; provider?: string }) => void} [onRetrySlow]
 */
async function analyzeWithSelectedModel(base64Png, modelId, onRetrySlow, cssSnapshot, locale, outputMode) {
  const spec = getModelSpec(modelId);
  if (!spec) {
    throw new Error(ti(locale, "errInvalidModel"));
  }
  if (spec.provider === "gemini") {
    const key = await getStoredGeminiKey();
    if (!key) {
      throw new Error(ti(locale, "errGeminiKey"));
    }
    return analyzeWithGemini(base64Png, key, modelId, onRetrySlow, cssSnapshot, locale, outputMode);
  }
  if (spec.provider === "claude") {
    const key = await getStoredAnthropicKey();
    if (!key) {
      throw new Error(ti(locale, "errAnthropicKey"));
    }
    return analyzeWithClaude(base64Png, key, modelId, onRetrySlow, cssSnapshot, locale, outputMode);
  }
  throw new Error(ti(locale, "errInvalidModel"));
}

captureBtn.addEventListener("click", async () => {
  const locale = resolveLocale(langSelect?.value);
  currentLocale = locale;
  const outputMode = resolveMotionOutputMode(motionOutputSelect?.value);
  const modelIdEarly = modelSelect.value || (await getStoredModelId());
  const specEarly = getModelSpec(modelIdEarly);
  if (!specEarly) {
    setStatus(t("errInvalidModel"));
    return;
  }
  if (specEarly.provider === "gemini" && !(await getStoredGeminiKey())) {
    setStatus(t("errGeminiKey"));
    return;
  }
  if (specEarly.provider === "claude" && !(await getStoredAnthropicKey())) {
    setStatus(t("errAnthropicKey"));
    return;
  }

  captureBtn.disabled = true;
  regionVibeBtn.disabled = true;
  copyBtn.disabled = true;
  resultEl.value = "";
  setStatus(t("statusCapturingTab"));
  setLoading(true);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const cap = await chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" });
    if (!cap?.ok) {
      throw new Error(cap?.error || t("errCapture"));
    }
    const base64 = toGeminiInlinePngBase64(cap.dataUrl);

    let cssSnapshot = null;
    if (tab?.id && canInjectRegionPicker(tab.url)) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["computed-css-snapshot.js"],
        });
        const snapRes = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const api = globalThis.__VIBE_COMPUTED_CSS__;
            if (!api) return null;
            return api.collectFromPoint(
              Math.floor(window.innerWidth / 2),
              Math.floor(window.innerHeight / 2),
              null,
            );
          },
        });
        cssSnapshot = snapRes?.[0]?.result ?? null;
      } catch (err) {
        console.warn("CSS snapshot (fullscreen) failed:", err);
      }
    }

    const modelId = modelSelect.value || (await getStoredModelId());
    const spec = getModelSpec(modelId);
    setStatus(spec?.provider === "claude" ? t("statusCallingClaude") : t("statusCallingGemini"));
    const text = await analyzeWithSelectedModel(
      base64,
      modelId,
      ({ attempt, maxAttempts, delayMs }) => {
        setStatus(
          t("statusModelBusy", {
            s: Math.round(delayMs / 1000),
            a: attempt,
            m: maxAttempts,
          }),
        );
      },
      cssSnapshot,
      locale,
      outputMode,
    );

    if (!text) {
      throw new Error(t("errNoText"));
    }

    resultEl.value = text;
    copyBtn.disabled = false;
    setStatus(t("statusDone"));
  } catch (e) {
    console.error(e);
    setStatus(e.message || String(e));
  } finally {
    setLoading(false);
    captureBtn.disabled = false;
    regionVibeBtn.disabled = false;
  }
});

regionVibeBtn.addEventListener("click", async () => {
  const locale = resolveLocale(langSelect?.value);
  currentLocale = locale;
  const outputMode = resolveMotionOutputMode(motionOutputSelect?.value);
  const modelIdEarly = modelSelect.value || (await getStoredModelId());
  const specEarly = getModelSpec(modelIdEarly);
  if (!specEarly) {
    setStatus(t("errInvalidModel"));
    return;
  }
  if (specEarly.provider === "gemini" && !(await getStoredGeminiKey())) {
    setStatus(t("errGeminiKey"));
    return;
  }
  if (specEarly.provider === "claude" && !(await getStoredAnthropicKey())) {
    setStatus(t("errAnthropicKey"));
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus(t("errCouldNotGetTab"));
    return;
  }
  if (!canInjectRegionPicker(tab.url)) {
    setStatus(t("errRegionNotAvailable"));
    return;
  }

  captureBtn.disabled = true;
  regionVibeBtn.disabled = true;
  copyBtn.disabled = true;
  resultEl.value = "";
  setStatus(t("statusDragRegion"));
  setLoading(false);

  let pick = null;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["computed-css-snapshot.js"],
    });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["region-picker.js"],
    });
    pick = results?.[0]?.result ?? null;
  } catch (e) {
    console.error(e);
    setStatus(e.message || t("errInjectPicker"));
    captureBtn.disabled = false;
    regionVibeBtn.disabled = false;
    return;
  }

  if (!pick || typeof pick.x !== "number") {
    setStatus(t("errSelectionCancelled"));
    captureBtn.disabled = false;
    regionVibeBtn.disabled = false;
    return;
  }

  setLoading(true);
  setStatus(t("statusCapturingVisible"));

  try {
    const cap = await chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" });
    if (!cap?.ok) {
      throw new Error(cap?.error || t("errCapture"));
    }

    setStatus(t("statusCropping"));
    const base64 = await cropScreenshotToRegionBase64(
      cap.dataUrl,
      { x: pick.x, y: pick.y, width: pick.width, height: pick.height },
      pick.viewportWidth,
      pick.viewportHeight,
    );

    const modelId = modelSelect.value || (await getStoredModelId());
    const spec = getModelSpec(modelId);
    setStatus(spec?.provider === "claude" ? t("statusCallingClaudeRegion") : t("statusCallingGeminiRegion"));
    const text = await analyzeWithSelectedModel(
      base64,
      modelId,
      ({ attempt, maxAttempts, delayMs }) => {
        setStatus(
          t("statusModelBusy", {
            s: Math.round(delayMs / 1000),
            a: attempt,
            m: maxAttempts,
          }),
        );
      },
      pick.cssSnapshot ?? null,
      locale,
      outputMode,
    );

    if (!text) {
      throw new Error(t("errNoText"));
    }

    resultEl.value = text;
    copyBtn.disabled = false;
    setStatus(t("statusDone"));
  } catch (e) {
    console.error(e);
    setStatus(e.message || String(e));
  } finally {
    setLoading(false);
    captureBtn.disabled = false;
    regionVibeBtn.disabled = false;
  }
});

copyBtn.addEventListener("click", async () => {
  const text = resultEl.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus(t("copyDone"));
  } catch (e) {
    setStatus(t("copyFailed"));
  }
});

bootstrap();
