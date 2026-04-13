const GEMINI_MODEL_OPTIONS = [
  { label: "Gemini 3.1 Flash", id: "gemini-3-flash-preview" },
  { label: "Gemini 2.5 Pro", id: "gemini-2.5-pro" },
];

const DEFAULT_MODEL_ID = GEMINI_MODEL_OPTIONS[0].id;

const SYSTEM_PROMPT = `Role: 你是一位严谨的前端工程专家与视觉分析师。

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
    * 若存在 hover 差异证据，最终 Prompt 须包含悬停交互与过渡描述；若默认与 hover 均无动效证据，不要在 Prompt 中加入任何动效描述。`;

const USER_TEXT = `【CSS 数据说明】
若下方附带【CSS_JSON】代码块：其中的字符串均来自目标元素 getComputedStyle（含 initial、none、0s 等原样值）。transition / animation 相关字段为判断「是否静态」的首要依据；不得编造 JSON 中未出现的数值。
顶层 computed 为指针未悬停时的样式；hoverState 为扩展尽力模拟 :hover 后的二次采样：优先使用 hoverState.diffFromDefault 描述「默认→悬停」的可验证样式与动效变化；hoverState.simulation.rulesInserted 为 0 且存在 error 时不得臆造悬停动效。
若无【CSS_JSON】：除截图直接可见信息外不得推断 computed；「真实交互动效」须按系统指令写 Static (No motion data detected)（截图本身能无可争议证明动效时仍不得编造具体 duration/easing）。

请严格按系统指令中的章节标题与顺序输出。整页与框选截图均适用。`;

const captureBtn = document.getElementById("capture-btn");
const regionVibeBtn = document.getElementById("region-vibe-btn");
const copyBtn = document.getElementById("copy-btn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const modelSelect = document.getElementById("model-select");
const loadingIndicator = document.getElementById("loading-indicator");

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

async function getStoredApiKey() {
  const { geminiApiKey } = await chrome.storage.sync.get("geminiApiKey");
  return (geminiApiKey || "").trim();
}

async function getStoredModelId() {
  const { geminiModelId } = await chrome.storage.sync.get("geminiModelId");
  const id = geminiModelId || DEFAULT_MODEL_ID;
  const known = GEMINI_MODEL_OPTIONS.some((o) => o.id === id);
  return known ? id : DEFAULT_MODEL_ID;
}

function buildModelSelect() {
  modelSelect.innerHTML = "";
  for (const opt of GEMINI_MODEL_OPTIONS) {
    const el = document.createElement("option");
    el.value = opt.id;
    el.textContent = opt.label;
    modelSelect.appendChild(el);
  }
}

async function initModelSelect() {
  buildModelSelect();
  const saved = await getStoredModelId();
  modelSelect.value = saved;
}

modelSelect.addEventListener("change", () => {
  chrome.storage.sync.set({ geminiModelId: modelSelect.value });
});

function buildGeminiUserText(cssSnapshot) {
  if (cssSnapshot == null) {
    return USER_TEXT;
  }
  return `${USER_TEXT}\n\n【CSS_JSON】\n\`\`\`json\n${JSON.stringify(cssSnapshot, null, 2)}\n\`\`\``;
}

/**
 * @param {(info: { attempt: number; maxAttempts: number; delayMs: number }) => void} [onRetry503]
 * @param {object | null | undefined} [cssSnapshot]  来自页面的 computed 样式快照（可含于 pick）
 */
async function analyzeWithGemini(base64Png, apiKey, modelId, onRetry503, cssSnapshot) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelId,
  )}:generateContent`;

  const fullText = `${SYSTEM_PROMPT}\n\n---\n\n${buildGeminiUserText(cssSnapshot)}`;

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
      onRetry503?.({ attempt, maxAttempts, delayMs });
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }

    if (res.status === 503) {
      throw new Error(
        "Gemini 503: This model is under heavy load after automatic retries. Try again later, or switch to another model (e.g. Gemini 2.5 Pro) in the sidebar.",
      );
    }

    throw new Error(`Gemini API ${res.status}: ${msg}`);
  }

  throw new Error("Internal error: Gemini request did not complete.");
}

captureBtn.addEventListener("click", async () => {
  const apiKey = await getStoredApiKey();
  if (!apiKey) {
    setStatus('Add your Gemini API key under "API settings" first.');
    return;
  }

  captureBtn.disabled = true;
  regionVibeBtn.disabled = true;
  copyBtn.disabled = true;
  resultEl.value = "";
  setStatus("Capturing the active tab…");
  setLoading(true);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const cap = await chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" });
    if (!cap?.ok) {
      throw new Error(cap?.error || "Capture failed.");
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
    setStatus("Calling Gemini to analyze the page…");
    const text = await analyzeWithGemini(
      base64,
      apiKey,
      modelId,
      ({ attempt, maxAttempts, delayMs }) => {
        setStatus(
          `Model busy (503). Retrying in ~${Math.round(delayMs / 1000)}s (attempt ${attempt} of ${maxAttempts})…`,
        );
      },
      cssSnapshot,
    );

    if (!text) {
      throw new Error("The model returned no text.");
    }

    resultEl.value = text;
    copyBtn.disabled = false;
    setStatus("Done.");
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
  const apiKey = await getStoredApiKey();
  if (!apiKey) {
    setStatus('Add your Gemini API key under "API settings" first.');
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus("Could not get the active tab.");
    return;
  }
  if (!canInjectRegionPicker(tab.url)) {
    setStatus("Region pick is not available on this page (use a normal http(s) tab).");
    return;
  }

  captureBtn.disabled = true;
  regionVibeBtn.disabled = true;
  copyBtn.disabled = true;
  resultEl.value = "";
  setStatus("Drag on the page to select a region. Press Esc to cancel.");
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
    setStatus(e.message || "Could not inject region picker on this page.");
    captureBtn.disabled = false;
    regionVibeBtn.disabled = false;
    return;
  }

  if (!pick || typeof pick.x !== "number") {
    setStatus("Selection cancelled or too small.");
    captureBtn.disabled = false;
    regionVibeBtn.disabled = false;
    return;
  }

  setLoading(true);
  setStatus("Capturing visible tab…");

  try {
    const cap = await chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" });
    if (!cap?.ok) {
      throw new Error(cap?.error || "Capture failed.");
    }

    setStatus("Cropping selection…");
    const base64 = await cropScreenshotToRegionBase64(
      cap.dataUrl,
      { x: pick.x, y: pick.y, width: pick.width, height: pick.height },
      pick.viewportWidth,
      pick.viewportHeight,
    );

    const modelId = modelSelect.value || (await getStoredModelId());
    setStatus("Calling Gemini on the cropped region…");
    const text = await analyzeWithGemini(
      base64,
      apiKey,
      modelId,
      ({ attempt, maxAttempts, delayMs }) => {
        setStatus(
          `Model busy (503). Retrying in ~${Math.round(delayMs / 1000)}s (attempt ${attempt} of ${maxAttempts})…`,
        );
      },
      pick.cssSnapshot ?? null,
    );

    if (!text) {
      throw new Error("The model returned no text.");
    }

    resultEl.value = text;
    copyBtn.disabled = false;
    setStatus("Done.");
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
    setStatus("Copied to clipboard.");
  } catch (e) {
    setStatus("Copy failed. Select the text and copy manually.");
  }
});

initModelSelect();
