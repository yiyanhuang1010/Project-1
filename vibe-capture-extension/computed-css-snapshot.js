/**
 * Injected before region-picker (or alone for full-tab center sample).
 * Exposes globalThis.__VIBE_COMPUTED_CSS__ for collectFromPoint / readComputedSnapshot.
 *
 * Default snapshot: getComputedStyle(target) at rest.
 * Hover snapshot: temporarily mirrors :hover rules by rewriting selectors to use a probe class
 * on the target and its ancestors, then re-reads computed style (transition/animation etc.).
 *
 * schemaVersion 2+: `motionEvidence` adds ancestor-chain motion/animation summaries so region
 * picks capture parent-owned keyframes/transitions (not only the hit-tested leaf). Full-page
 * center sample uses the same strategy from the element at the viewport center.
 */
(function () {
  "use strict";

  const HOVER_SIM_CLASS = "__vibe_capture_hover_sim__";
  const MAX_HOVER_RULES = 1500;

  const BASE_KEYS = [
    "color",
    "background-color",
    "width",
    "height",
    "font-size",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-radius",
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "box-shadow",
    "backdrop-filter",
    "opacity",
    "transform",
    "filter",
  ];

  /** 含 initial / none 等原样，便于判断静态 */
  const TRANSITION_KEYS = [
    "transition",
    "transition-property",
    "transition-duration",
    "transition-timing-function",
    "transition-delay",
    "transition-behavior",
  ];

  const ANIMATION_KEYS = [
    "animation",
    "animation-name",
    "animation-duration",
    "animation-timing-function",
    "animation-delay",
    "animation-iteration-count",
    "animation-direction",
    "animation-fill-mode",
    "animation-play-state",
    "animation-timeline",
    "animation-range",
    "animation-composition",
  ];

  const ALL_SNAPSHOT_KEYS = [...BASE_KEYS, ...TRANSITION_KEYS, ...ANIMATION_KEYS];

  const MOTION_DIFF_KEYS = [
    ...TRANSITION_KEYS,
    ...ANIMATION_KEYS,
    "transform",
    "opacity",
    "filter",
    "box-shadow",
    "background-color",
    "color",
  ];

  const MOTION_COMPUTED_KEYS = [...TRANSITION_KEYS, ...ANIMATION_KEYS];

  const MAX_ANCESTOR_MOTION_DEPTH = 16;

  /**
   * @param {Element} el
   * @returns {object[]}
   */
  function summarizeWebAnimationsForElement(el) {
    if (!el || typeof el.getAnimations !== "function") return [];
    try {
      const list = el.getAnimations({ subtree: false });
      const out = [];
      const cap = Math.min(list.length, 8);
      for (let i = 0; i < cap; i++) {
        const a = list[i];
        let durationMs = null;
        let easing = null;
        let iterations = null;
        try {
          const eff = a.effect;
          if (eff && typeof eff.getTiming === "function") {
            const tm = eff.getTiming();
            if (tm && typeof tm.duration === "number" && !Number.isNaN(tm.duration)) {
              durationMs = tm.duration === Infinity ? "Infinity" : Math.round(tm.duration);
            }
            if (tm && tm.easing != null) easing = String(tm.easing);
            if (tm && tm.iterations != null) iterations = tm.iterations;
          }
        } catch {
          /* ignore */
        }
        let nameHint = null;
        try {
          if (a.animationName) nameHint = String(a.animationName);
          else if (a.id) nameHint = String(a.id);
        } catch {
          /* ignore */
        }
        out.push({
          playState: a.playState != null ? String(a.playState) : null,
          durationMs,
          easing,
          iterations,
          nameHint,
        });
      }
      return out;
    } catch {
      return [];
    }
  }

  /**
   * From target element up to document / shadow roots: motion-related computed styles + Web Animations API.
   * @param {Element} targetEl
   * @param {number} maxDepth
   */
  function buildAncestorMotionChain(targetEl, maxDepth) {
    const chain = [];
    let cur = targetEl;
    let depth = 0;
    while (cur && cur.nodeType === Node.ELEMENT_NODE && depth < maxDepth) {
      const cs = getComputedStyle(cur);
      const motionComputed = readComputedMap(cs, MOTION_COMPUTED_KEYS);
      const animationsFromAPI = summarizeWebAnimationsForElement(cur);
      chain.push({
        depth,
        tagName: cur.tagName,
        id: cur.id || null,
        className:
          typeof cur.className === "string" && cur.className && cur.className.length < 160 ? cur.className : null,
        motionComputed,
        animationsFromAPI,
      });
      const p = cur.parentNode;
      if (p instanceof ShadowRoot) {
        cur = p.host;
      } else if (p && p.nodeType === Node.ELEMENT_NODE) {
        cur = /** @type {Element} */ (p);
      } else {
        break;
      }
      depth++;
    }
    return chain;
  }

  function readProp(cs, prop) {
    try {
      let v = cs.getPropertyValue(prop);
      if (v != null && String(v).trim() !== "") return String(v).trim();
      const camel = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const legacy = cs[camel];
      if (legacy != null && String(legacy).trim() !== "") return String(legacy).trim();
      return "";
    } catch {
      return "";
    }
  }

  function readComputedMap(cs, keys) {
    const out = {};
    for (const k of keys) {
      out[k] = readProp(cs, k);
    }
    return out;
  }

  function ruleStyleMightAffectMotionOrHoverLook(style) {
    if (!style || !style.length) return false;
    const ct = String(style.cssText || "").toLowerCase();
    return (
      ct.includes("transition") ||
      ct.includes("animation") ||
      ct.includes("transform") ||
      ct.includes("opacity") ||
      ct.includes("filter") ||
      ct.includes("box-shadow") ||
      ct.includes("background") ||
      ct.includes("color") ||
      ct.includes("scale") ||
      ct.includes("rotate") ||
      ct.includes("translate")
    );
  }

  function forEachAncestorElement(el, fn) {
    let cur = el;
    while (cur) {
      if (cur.nodeType === Node.ELEMENT_NODE) fn(/** @type {Element} */ (cur));
      const p = cur.parentNode;
      if (p instanceof ShadowRoot) {
        cur = p.host;
      } else if (p && p.nodeType === Node.ELEMENT_NODE) {
        cur = /** @type {Element} */ (p);
      } else {
        break;
      }
    }
  }

  function addHoverSimClassToAncestors(el) {
    forEachAncestorElement(el, (node) => node.classList.add(HOVER_SIM_CLASS));
  }

  function removeHoverSimClassFromAncestors(el) {
    forEachAncestorElement(el, (node) => node.classList.remove(HOVER_SIM_CLASS));
  }

  /**
   * @param {CSSRuleList} rules
   * @param {string[]} mediaChain
   * @param {string[]} supportsChain
   * @param {(rule: CSSStyleRule, mediaChain: string[], supportsChain: string[]) => void} cb
   */
  function walkRules(rules, mediaChain, supportsChain, cb) {
    if (!rules || !rules.length) return;
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (rule instanceof CSSStyleRule) {
        cb(rule, mediaChain, supportsChain);
      } else if (rule instanceof CSSMediaRule) {
        const cond = rule.conditionText || (rule.media && rule.media.mediaText) || "";
        walkRules(rule.cssRules, [...mediaChain, cond], supportsChain, cb);
      } else if (rule instanceof CSSSupportsRule) {
        walkRules(rule.cssRules, mediaChain, [...supportsChain, rule.conditionText], cb);
      } else if (rule instanceof CSSLayerBlockRule) {
        walkRules(rule.cssRules, mediaChain, supportsChain, cb);
      } else if (typeof CSSContainerRule !== "undefined" && rule instanceof CSSContainerRule) {
        walkRules(rule.cssRules, mediaChain, supportsChain, cb);
      }
    }
  }

  /**
   * @param {string[]} mediaChain
   * @param {string[]} supportsChain
   * @param {string} innerCss  已是完整「选择器 { 声明 }」或嵌套块
   */
  function wrapInAtRules(mediaChain, supportsChain, innerCss) {
    let s = innerCss;
    for (let i = supportsChain.length - 1; i >= 0; i--) {
      const cond = supportsChain[i];
      if (!cond) continue;
      s = `@supports (${cond}) { ${s} }`;
    }
    for (let i = mediaChain.length - 1; i >= 0; i--) {
      const m = mediaChain[i];
      if (!m) continue;
      s = `@media ${m} { ${s} }`;
    }
    return s;
  }

  function transformHoverSelector(selectorText) {
    if (!selectorText || selectorText.indexOf(":hover") === -1) return null;
    return selectorText.replace(/:hover\b/g, "." + HOVER_SIM_CLASS);
  }

  /**
   * @param {Element} el
   * @returns {{ rulesInserted: number; rulesSkipped: number; warnings: string[] }}
   */
  function injectHoverMirrorSheet(el) {
    const warnings = [];
    let rulesInserted = 0;
    let rulesSkipped = 0;

    const styleEl = document.createElement("style");
    styleEl.setAttribute("data-vibe-hover-probe", "1");
    styleEl.setAttribute("type", "text/css");

    let sheet = null;
    try {
      document.documentElement.appendChild(styleEl);
      sheet = styleEl.sheet;
    } catch (e) {
      warnings.push("append_style_failed");
      try {
        styleEl.remove();
      } catch {
        /* ignore */
      }
      return { rulesInserted: 0, rulesSkipped: 0, warnings, styleEl: null };
    }

    if (!sheet) {
      warnings.push("no_stylesheet");
      try {
        styleEl.remove();
      } catch {
        /* ignore */
      }
      return { rulesInserted: 0, rulesSkipped: 0, warnings, styleEl: null };
    }

    const sheets = Array.from(document.styleSheets);
    outer: for (let si = 0; si < sheets.length; si++) {
      const styleSheet = sheets[si];
      let rules;
      try {
        rules = styleSheet.cssRules;
      } catch {
        continue;
      }
      walkRules(rules, [], [], (rule, mediaChain, supportsChain) => {
        if (rulesInserted >= MAX_HOVER_RULES) return;
        if (!(rule instanceof CSSStyleRule)) return;
        const st = rule.selectorText;
        if (!st || st.indexOf(":hover") === -1) return;
        if (!ruleStyleMightAffectMotionOrHoverLook(rule.style)) return;
        const newSel = transformHoverSelector(st);
        if (!newSel || newSel === st) {
          rulesSkipped++;
          return;
        }
        const body = rule.style && rule.style.cssText ? String(rule.style.cssText).trim() : "";
        if (!body) {
          rulesSkipped++;
          return;
        }
        const inner = `${newSel} { ${body} }`;
        const wrapped = wrapInAtRules(mediaChain, supportsChain, inner);
        try {
          sheet.insertRule(wrapped, sheet.cssRules.length);
          rulesInserted++;
        } catch {
          rulesSkipped++;
        }
      });
      if (rulesInserted >= MAX_HOVER_RULES) break outer;
    }

    return { rulesInserted, rulesSkipped, warnings, styleEl };
  }

  /**
   * @param {Element} el
   * @param {Record<string, string>} defaultComputed
   */
  function readHoverSimulatedSnapshot(el, defaultComputed) {
    const warnings = [];
    let styleEl = null;
    let rulesInserted = 0;
    let rulesSkipped = 0;
    try {
      const inj = injectHoverMirrorSheet(el);
      styleEl = inj.styleEl;
      rulesInserted = inj.rulesInserted;
      rulesSkipped = inj.rulesSkipped;
      if (inj.warnings && inj.warnings.length) warnings.push(...inj.warnings);
      if (!styleEl) {
        return {
          error: "hover_probe_no_style",
          warnings,
          computed: null,
          diffFromDefault: null,
          simulation: { rulesInserted, rulesSkipped },
        };
      }

      addHoverSimClassToAncestors(el);
      const csHover = getComputedStyle(el);
      const hoverComputed = readComputedMap(csHover, ALL_SNAPSHOT_KEYS);

      const diffFromDefault = {};
      for (const k of MOTION_DIFF_KEYS) {
        const a = defaultComputed[k] || "";
        const b = hoverComputed[k] || "";
        if (a !== b) {
          diffFromDefault[k] = { default: a, hover: b };
        }
      }

      return {
        error: null,
        warnings,
        computed: hoverComputed,
        diffFromDefault,
        simulation: { rulesInserted, rulesSkipped, className: HOVER_SIM_CLASS },
      };
    } catch (e) {
      return {
        error: e && e.message ? String(e.message) : "hover_probe_failed",
        warnings,
        computed: null,
        diffFromDefault: null,
        simulation: { rulesInserted, rulesSkipped },
      };
    } finally {
      try {
        removeHoverSimClassFromAncestors(el);
      } catch {
        /* ignore */
      }
      try {
        if (styleEl && styleEl.parentNode) styleEl.remove();
      } catch {
        /* ignore */
      }
    }
  }

  function buildComputedSnapshot(el, sampleX, sampleY) {
    if (!el || el.nodeType !== 1) {
      return {
        schemaVersion: 2,
        error: "invalid_element",
        meta: { samplePoint: { x: sampleX, y: sampleY } },
        motionEvidence: null,
      };
    }
    const cs = getComputedStyle(el);
    const computed = readComputedMap(cs, ALL_SNAPSHOT_KEYS);

    const base = {
      schemaVersion: 2,
      meta: {
        samplePoint: { x: sampleX, y: sampleY },
        tagName: el.tagName,
        id: el.id || null,
        className: typeof el.className === "string" && el.className ? el.className : null,
      },
      computed,
      "transition-property": computed["transition-property"],
      "transition-duration": computed["transition-duration"],
      "transition-timing-function": computed["transition-timing-function"],
      "animation-name": computed["animation-name"],
      motionEvidence: {
        version: "likethis.motion.v1",
        notes: [
          "ancestorChain: target (depth 0) then parents; use for motion owned by ancestors (e.g. parent keyframes).",
          "animationsFromAPI: Web Animations API on each element (subtree:false).",
        ],
        ancestorChain: buildAncestorMotionChain(el, MAX_ANCESTOR_MOTION_DEPTH),
      },
      hoverState: readHoverSimulatedSnapshot(el, computed),
    };

    return base;
  }

  /**
   * @param {number} cx
   * @param {number} cy
   * @param {string | null} skipClosestSelector  选区遮罩存在时传入 "#__vibe_capture_region_overlay__"
   */
  function collectFromPoint(cx, cy, skipClosestSelector) {
    const stack = document.elementsFromPoint(cx, cy);
    for (const node of stack) {
      if (!(node instanceof Element)) continue;
      if (skipClosestSelector) {
        try {
          if (node.closest(skipClosestSelector)) continue;
        } catch {
          continue;
        }
      }
      return buildComputedSnapshot(node, cx, cy);
    }
    return {
      schemaVersion: 2,
      error: "no_target_element",
      meta: { samplePoint: { x: cx, y: cy } },
      computed: {},
      "transition-property": "",
      "transition-duration": "",
      "transition-timing-function": "",
      "animation-name": "",
      motionEvidence: null,
      hoverState: null,
    };
  }

  globalThis.__VIBE_COMPUTED_CSS__ = {
    buildComputedSnapshot,
    collectFromPoint,
  };
})();
