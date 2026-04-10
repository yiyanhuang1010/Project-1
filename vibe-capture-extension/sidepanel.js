const GEMINI_MODEL_OPTIONS = [
  { label: "Gemini 3.1 Flash", id: "gemini-3-flash-preview" },
  { label: "Gemini 2.5 Pro", id: "gemini-2.5-pro" },
];

const DEFAULT_MODEL_ID = GEMINI_MODEL_OPTIONS[0].id;

const SYSTEM_PROMPT = `You are an expert in visual design and modern web front-end engineering (Tailwind CSS, Framer Motion, Shadcn UI).
Analyze the user's webpage screenshot and produce a single "Vibe Coding" brief.

Output requirements:

Core style keywords: (e.g. Bento Grid, Skeuomorphism, Cyberpunk, Apple-esque)

Technical traits: Extract concrete HEX colors, border radius in rem, shadow levels (blur/spread).

Motion: Describe interaction feel (e.g. Snappy, Elastic, Liquid-smooth).

Final prompt shape: Start with "Build a UI component that..." and weave in all of the above aesthetics.

Use professional design vocabulary so another AI can faithfully recreate the same "vibe".`;

const USER_TEXT =
  "Follow the system instructions. From this screenshot only, output the full Vibe Coding brief. Use what is visible; do not invent UI that is not in the image.";

const captureBtn = document.getElementById("capture-btn");
const copyBtn = document.getElementById("copy-btn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const modelSelect = document.getElementById("model-select");

function setStatus(text) {
  statusEl.textContent = text || "";
}

function toGeminiInlinePngBase64(dataUrl) {
  const comma = dataUrl.indexOf(",");
  if (comma === -1) throw new Error("Invalid capture data (missing data URL separator).");
  let b64 = dataUrl.slice(comma + 1).trim();
  b64 = b64.replace(/\s/g, "");
  if (!b64.length) throw new Error("Screenshot Base64 is empty.");
  return b64;
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

/**
 * @param {(info: { attempt: number; maxAttempts: number; delayMs: number }) => void} [onRetry503]
 */
async function analyzeWithGemini(base64Png, apiKey, modelId, onRetry503) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    modelId,
  )}:generateContent`;

  const fullText = `${SYSTEM_PROMPT}\n\n---\n\n${USER_TEXT}`;

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
  copyBtn.disabled = true;
  resultEl.value = "";
  setStatus("Capturing the active tab…");

  try {
    const cap = await chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" });
    if (!cap?.ok) {
      throw new Error(cap?.error || "Capture failed.");
    }
    const base64 = toGeminiInlinePngBase64(cap.dataUrl);

    const modelId = modelSelect.value || (await getStoredModelId());
    setStatus("Calling Gemini to analyze the page…");
    const text = await analyzeWithGemini(base64, apiKey, modelId, ({ attempt, maxAttempts, delayMs }) => {
      setStatus(
        `Model busy (503). Retrying in ~${Math.round(delayMs / 1000)}s (attempt ${attempt} of ${maxAttempts})…`,
      );
    });

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
    captureBtn.disabled = false;
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
