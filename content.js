// content.js — TileMetadata (v1) extractor for YouTube MV3
// Schema:
// {
//   "title": "string",
//   "channel": "string",
//   "duration_sec": 0,
//   "snippet": "string (optional)",
//   "page_context": "home|search|watch|explore|trending|channel",
//   "tile_kind": "grid|list|compact|reel"
// }
(() => {
  // prevent double boots (manifest + dynamic)
  if (window.__ytTilesBooted) return;
  window.__ytTilesBooted = true;
  try {
    console.log("[CT] content boot @", location.href);
  } catch { }
})();



(

  function ensureShadowBadgeCss() {
    if (document.getElementById("yt-shadow-badge-style")) return;
    const css = `
    /* Shadow mode ON gate */
    .yt-shadow-on [data-intent-label] { position: relative !important; overflow: visible !important; }
    .yt-shadow-on [data-intent-label]::after {
      content: attr(data-intent-label) " (" attr(data-intent-confshort) ")";
      position: absolute;
      top: 6px; right: 6px;
      padding: 2px 6px;
      font-size: 10px; font-weight: 700;
      border-radius: 3px;
      z-index: 9999;
      color: #fff;
      pointer-events: none;
      box-shadow: 0 1px 2px rgba(0,0,0,.35);
      /* fallback so text is readable even if intent-class color isn't set */
    background: rgba(0,0,0,.72);
    }

  /* step 2: non-destructive control */
  .yf-dim { opacity: 0.25 !important; filter: grayscale(80%) !important; transition: opacity .18s ease, filter .18s ease; }
  .yf-hide { display: none !important; }

  /* tiny chip overlay for dimmed tiles */
  .yt-shadow-on [data-intent-label].yf-dim::before {
    content: attr(data-intent-short) " · show once";
    position: absolute;
    left: 6px; bottom: 6px;
    font-size: 10px; font-weight: 600;
    padding: 2px 6px; border-radius: 10px;
    background: rgba(0,0,0,0.65); color: #fff; pointer-events: auto;
    z-index: 10000;
  }

    /* Colors by class */
    .yt-shadow-on [data-intent-class="study"]::after        { background:#1e88e5; }
    .yt-shadow-on [data-intent-class="career"]::after       { background:#8e24aa; }
    .yt-shadow-on [data-intent-class="skill"]::after        { background:#43a047; }
    .yt-shadow-on [data-intent-class="news"]::after         { background:#f4511e; }
    .yt-shadow-on [data-intent-class="docs"]::after         { background:#6d4c41; }
    .yt-shadow-on [data-intent-class="reviews"]::after      { background:#3949ab; }
    .yt-shadow-on [data-intent-class="entertainment"]::after{ background:#fdd835; color:#000; }
    .yt-shadow-on [data-intent-class="motivation"]::after   { background:#d81b60; }
    .yt-shadow-on [data-intent-class="custom"]::after       { background:#757575; }
  `;
    const style = document.createElement("style");
    style.id = "yt-shadow-badge-style";
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  })();

// step 3: toast ui
function ensureToastCss() {
  if (document.getElementById("yf-toast-style")) return;
  const el = document.createElement("style");
  el.id = "yf-toast-style";
  el.textContent = `
  #yf-toast-host { position: fixed; left: 12px; bottom: 14px; z-index: 10050; display: flex; flex-direction: column; gap: 8px; }
  .yf-toast {
    background: rgba(0,0,0,.85); color:#fff; border:1px solid rgba(255,255,255,.12);
    padding:8px 10px; border-radius:10px; font: 600 12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial;
    box-shadow: 0 6px 24px rgba(0,0,0,.35); opacity: 0; transform: translateY(6px);
    transition: opacity .18s ease, transform .18s ease;
  }
  .yf-toast.show { opacity: 1; transform: translateY(0); }
  `;
  document.documentElement.appendChild(el);
}
function showToast(text, ms = 2500) {
  ensureToastCss();
  let host = document.getElementById("yf-toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "yf-toast-host";
    document.body.appendChild(host);
  }
  const t = document.createElement("div");
  t.className = "yf-toast";
  t.textContent = text;
  host.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 200);
  }, ms);
}

// messages from background (shortcuts confirmations, etc.)
try {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "SHOW_TOAST" && msg.text) {
      showToast(msg.text);
    }
  });
} catch { }

// step 3: unclassified timers
// step 3: unclassified timers (fixed: clear by closest tile)
const __unclassifiedTimers = new WeakMap();
const TILE_SEL = "ytd-rich-item-renderer,ytd-video-renderer,ytd-compact-video-renderer,ytd-reel-video-renderer";

function __armUnclassified(tile) {
  if (!(tile instanceof Element)) return;
  // already classified anywhere inside? then don't arm
  if (tile.getAttribute("data-intent-label") || tile.querySelector("[data-intent-label]")) return;
  if (__unclassifiedTimers.has(tile)) return;

  const tid = setTimeout(() => {
    try {
      // check again at fire time; if anything inside is labeled, bail
      if (tile.getAttribute("data-intent-label") || tile.querySelector("[data-intent-label]")) return;

      // ensure visible (fail-open)
      tile.classList?.remove("yf-dim", "yf-hide");
      tile.removeAttribute?.("data-yt-hide");

      // add a small badge (mark it so we can remove later)
      if (typeof addOverlayBadgeToTile === "function") {
        addOverlayBadgeToTile(tile, "Unclassified", { unclassified: true });
      } else {
        const host = tile.querySelector("#dismissible") || tile;
        const b = document.createElement("div");
        b.textContent = "Unclassified";
        b.setAttribute("data-yf-unclassified", "1");
        b.style.cssText = "position:absolute;top:6px;left:6px;padding:2px 6px;background:rgba(0,0,0,.7);color:#fff;font:600 11px system-ui;border-radius:6px;z-index:10;";
        host.appendChild(b);
      }
    } catch { }
  }, 2000);

  __unclassifiedTimers.set(tile, tid);
  console.log("[CT] arming unclassified", { tile });

}

function __clearUnclassified(node) {
  if (!(node instanceof Element)) return;
  const tile = node.closest?.(TILE_SEL) || node;
  const t = __unclassifiedTimers.get(tile);
  if (t) { clearTimeout(t); __unclassifiedTimers.delete(tile); }
  // remove fallback badge if present
  (tile.querySelectorAll?.('[data-yf-unclassified="1"]') || []).forEach(n => n.remove());
  console.log("[CT] clearing unclassified", { node });

}

function ensureUnclassifiedObserver() {
  if (window.__yf_unclassifiedObs) return;

  // arm on existing tiles lacking any label
  document.querySelectorAll(TILE_SEL).forEach(el => {
    if (!el.getAttribute("data-intent-label") && !el.querySelector("[data-intent-label]")) {
      __armUnclassified(el);
    }
  });

  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "childList") {
        m.addedNodes.forEach(n => {
          if (n.nodeType === 1) {
            if (n.matches?.(TILE_SEL)) __armUnclassified(n);
            n.querySelectorAll?.(TILE_SEL).forEach(__armUnclassified);
          }
        });
      } else if (m.type === "attributes" && m.attributeName === "data-intent-label") {
        __clearUnclassified(m.target);
      }
    }
  });

  obs.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-intent-label"]
  });

  window.__yf_unclassifiedObs = obs;
}

// call once after your first scan/extract
try { ensureUnclassifiedObserver(); } catch { }


function ensureControlCss() {
  if (document.getElementById("yt-controls-style")) return;
  const css = `
  /* quick chip */
  #yf-quick-chip {
    position: fixed; top: 10px; right: 12px;
    z-index: 10001;
    font: 600 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    padding: 6px 10px; border-radius: 999px;
    background: rgba(0,0,0,.7); color: #fff;
    cursor: pointer; user-select: none; backdrop-filter: blur(4px);
    border: 1px solid rgba(255,255,255,.12);
  }
  #yf-quick-chip:hover { background: rgba(0,0,0,.8); }

  /* modal */
  #yf-intent-modal {
    position: fixed; inset: 0;
    background: rgba(0,0,0,.45);
    z-index: 10002; display: flex; align-items: center; justify-content: center;
  }
  #yf-intent-modal .yf-card {
    width: min(680px, 92vw); max-height: 82vh; overflow: auto;
    background: #111; color: #fff; border-radius: 12px; padding: 16px 16px 12px;
    box-shadow: 0 10px 30px rgba(0,0,0,.5); border: 1px solid rgba(255,255,255,.08);
  }
  #yf-intent-modal h3 { margin: 0 0 8px; font-size: 16px; }
  #yf-intent-modal .row { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 8px 12px; }
  #yf-intent-modal .group { margin: 10px 0 6px; }
  #yf-intent-modal label { display: flex; gap: 8px; align-items: center; font-size: 13px; }
  #yf-intent-modal .footer { display:flex; gap:8px; justify-content:flex-end; margin-top: 10px; }
  #yf-intent-modal button {
    padding: 6px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.1);
    background: #1d1d1d; color: #fff; cursor: pointer;
  }
  #yf-intent-modal button.primary { background: #2563eb; border-color: #1d4ed8; }
  #yf-intent-modal input[type="number"] { width: 80px; background:#0e0e0e; color:#fff; border:1px solid #333; border-radius:6px; padding:4px 6px; }
  #yf-intent-modal .muted { color: #aaa; font-size: 12px; }
  `;
  const el = document.createElement("style");
  el.id = "yt-controls-style";
  el.textContent = css;
  document.documentElement.appendChild(el);
}


function chipLabelFromPolicy() {
  const p = (window.__yt_getPolicy && window.__yt_getPolicy()) || { activeFilters: [], mode: "strict", filterSemantics: "union" };
  const first = Array.isArray(p.activeFilters) && p.activeFilters[0];

  // local short-label map (no dependency on inner shortLabel())
  const short = (() => {
    switch (first) {
      case "Learning - Academic Study": return "Study";
      case "Learning - Career Prep": return "Career";
      case "Learning - Skill Learning": return "Skill";
      case "Learning - News & Current Affairs": return "News";
      case "Learning - Explainers & Docs": return "Docs";
      case "Learning - Reviews & Analysis": return "Reviews";
      case "Entertainment": return "Entertainment";
      case "Motivation & Self": return "Motivation";
      case "Custom": return "Custom";
      default: return first || "All";
    }
  })();

  const modeBadge = p.mode === "strict" ? " • S" : p.mode === "lenient" ? " • L" : " • Labels";
  const semBadge = p.filterSemantics === "intersection" ? " • ∩" : "";
  return first ? (short + modeBadge + semBadge) : "All";
}


function refreshQuickChip() {
  const chip = document.getElementById("yf-quick-chip");
  if (chip) chip.textContent = chipLabelFromPolicy();
}

function ensureQuickChip() {
  ensureControlCss();
  const mast = document.querySelector("#masthead-container") || document.body;
  if (!mast) return;
  if (document.getElementById("yf-quick-chip")) { refreshQuickChip(); return; }

  const chip = document.createElement("div");
  chip.id = "yf-quick-chip";
  chip.textContent = chipLabelFromPolicy();

  // left-click → cycle active filter
  chip.addEventListener("click", (e) => {
    e.preventDefault();
    const p = (window.__yt_getPolicy && window.__yt_getPolicy()) || {};
    const list = window.__yt_labels || [
      "Learning - Academic Study",
      "Learning - Career Prep",
      "Learning - Skill Learning",
      "Learning - News & Current Affairs",
      "Learning - Explainers & Docs",
      "Learning - Reviews & Analysis",
      "Entertainment",
      "Motivation & Self",
      "Custom"
    ];
    const curr = Array.isArray(p.activeFilters) && p.activeFilters[0];
    const idx = Math.max(0, list.indexOf(curr));
    const next = list[(idx + 1) % list.length];
    chrome.storage?.local?.set({ policy_activeFilters: [next] });
  });

  // middle-click → open modal
  chip.addEventListener("auxclick", (e) => {
    if (e.button === 1) { e.preventDefault(); window.__yt_openIntentModal?.(); }
  });

  // right-click → open modal
  chip.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    window.__yt_openIntentModal?.();
  });

  // Shift+mousedown → switch mode ; Alt+mousedown → toggle union/intersection
  chip.addEventListener("mousedown", (e) => {
    const p = (window.__yt_getPolicy && window.__yt_getPolicy()) || {};
    if (e.altKey) {
      e.preventDefault();
      const next = p.filterSemantics === "union" ? "intersection" : "union";
      chrome.storage?.local?.set({ policy_filterSemantics: next });
    } else if (e.shiftKey) {
      e.preventDefault();
      const next = p.mode === "strict" ? "lenient" : (p.mode === "lenient" ? "labels" : "strict");
      chrome.storage?.local?.set({ policy_mode: next });
    }
  });

  mast.appendChild(chip);
}

document.addEventListener("keydown", (e) => {
  if (e.shiftKey && e.key.toLowerCase() === "s") {
    window.__yt_openIntentModal?.();
  }
});

(() => {
  // ========== state ==========
  const state = {
    dev: false,
    counters: {
      scans: 0,
      tilesSeen: 0,
      tilesExtracted: 0,
      tilesSkippedNoTitle: 0,
      tilesSkippedDuplicate: 0,
      tilesErrored: 0,
      lastScanMs: 0,
    },
    lastBatch: [],
    lastErrorSample: null,
  };

  const policy = {
    enabled: true,
    // existing knobs
    mode: "strict",                   // labels | strict | lenient
    strictMin: 0.65,                  // confidence >= this in strict
    lenientMin: 0.80,                 // confidence >= this in lenient (kept for future)
    activeFilters: [
      "Learning - Academic Study",
      "Learning - Career Prep",
      "Learning - Skill Learning"
    ],

    // NEW: step 2 knobs
    filterSemantics: "union",         // union | intersection
    scope: {                          // surfaces where filtering is applied
      home: true,
      related: true,                  // right-rail on watch page
      explore: true,
      shorts: true,
      search: true
    },
    modalLastShownYMD: null           // e.g., "20250906" → show picker once/day
  };

  function loadPolicyFromStorage() {
    try {
      chrome.storage?.local?.get(
        [
          "policy_mode",
          "policy_strictMin",
          "policy_lenientMin",
          "policy_activeFilters",
          // NEW
          "policy_filterSemantics",
          "policy_scope",
          "policy_modalLastShownYMD",
          "policy_enabled"
        ],
        (res) => {
          policy.mode = res.policy_mode || policy.mode;
          policy.strictMin = Number.isFinite(res.policy_strictMin) ? res.policy_strictMin : policy.strictMin;
          policy.lenientMin = Number.isFinite(res.policy_lenientMin) ? res.policy_lenientMin : policy.lenientMin;
          policy.activeFilters = Array.isArray(res.policy_activeFilters) && res.policy_activeFilters.length
            ? res.policy_activeFilters
            : policy.activeFilters;

          // NEW
          policy.filterSemantics = res.policy_filterSemantics || policy.filterSemantics;
          if (typeof res.policy_enabled === "boolean") policy.enabled = res.policy_enabled;

          // now gate the overlay after we know enabled/mode
          const overlayOn = !!policy.enabled || policy.mode === "labels";
          document.documentElement.classList.toggle("yt-shadow-on", overlayOn);



          if (res.policy_scope && typeof res.policy_scope === "object") {
            policy.scope = { ...policy.scope, ...res.policy_scope };
          }
          policy.modalLastShownYMD = res.policy_modalLastShownYMD || null;

          // re-apply to already-labeled tiles
          applyPolicyToAllLabeledTiles();

          // NEW: show intent picker once per day  
          maybeShowIntentModalOnceADay();
          // NEW: make sure controls CSS/Chip exist
          ensureControlCss();
          ensureQuickChip();

        }
      );
    } catch { }
  }

  loadPolicyFromStorage();

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== "local") return;

    let changed = false;

    // --- ON/OFF hard toggle ---
    if (changes.policy_enabled && "newValue" in changes.policy_enabled) {
      // keep in-memory flag in sync
      policy.enabled = !!changes.policy_enabled.newValue;

      // CSS gate for the label overlay (show labels when filtering is ON or in labels-only mode)
      const overlayOn = policy.enabled || policy.mode === "labels";
      document.documentElement.classList.toggle("yt-shadow-on", overlayOn)

      // when OFF → remove all explicit badges and ensure everything is visible
      if (!policy.enabled) {
        document.querySelectorAll('[data-yf-unclassified="1"], .yf-intent-badge, [data-yf-badge]').forEach(n => n.remove());
        document.querySelectorAll('.yf-hide, .yf-dim, [data-yt-hide]').forEach(el => {
          el.classList.remove('yf-hide', 'yf-dim');
          el.removeAttribute('data-yt-hide');
        });
      }
      changed = true;
      applyPolicyToAllLabeledTiles();
    }

    // --- mode (strict / lenient / labels) ---
    if (changes.policy_mode && "newValue" in changes.policy_mode) {
      policy.mode = changes.policy_mode.newValue || policy.mode;

      // Show labels when filtering is ON or in labels-only mode
const overlayOn = policy.enabled || policy.mode === "labels";
document.documentElement.classList.toggle("yt-shadow-on", overlayOn);

      changed = true;
    }

    // --- thresholds ---
    if (changes.policy_strictMin && "newValue" in changes.policy_strictMin) {
      const v = Number(changes.policy_strictMin.newValue);
      if (Number.isFinite(v)) { policy.strictMin = v; changed = true; }
    }
    if (changes.policy_lenientMin && "newValue" in changes.policy_lenientMin) {
      const v = Number(changes.policy_lenientMin.newValue);
      if (Number.isFinite(v)) { policy.lenientMin = v; changed = true; }
    }

    // --- filters ---
    if (changes.policy_activeFilters && "newValue" in changes.policy_activeFilters) {
      const v = changes.policy_activeFilters.newValue;
      if (Array.isArray(v)) { policy.activeFilters = v; changed = true; }
    }

    // --- semantics + scope (optional but supported) ---
    if (changes.policy_filterSemantics && "newValue" in changes.policy_filterSemantics) {
      policy.filterSemantics = changes.policy_filterSemantics.newValue || policy.filterSemantics;
      changed = true;
    }
    if (changes.policy_scope && "newValue" in changes.policy_scope) {
      const next = changes.policy_scope.newValue;
      if (next && typeof next === "object") {
        policy.scope = { ...(policy.scope || {}), ...next };
        changed = true;
      }
    }
    if (changes.policy_modalLastShownYMD && "newValue" in changes.policy_modalLastShownYMD) {
      policy.modalLastShownYMD = changes.policy_modalLastShownYMD.newValue ?? null;
    }

    // --- reflect to UI immediately ---
    if (changed) {
      try { applyPolicyToAllLabeledTiles(); } catch { }
      try { refreshQuickChip?.(); } catch { }
    }
  });




  const printSummary = () => {
    const c = state.counters;
    if (state.dev) console.groupCollapsed("[YT Tiles] summary");
    console.log({
      scans: c.scans,
      tilesSeen: c.tilesSeen,
      tilesExtracted: c.tilesExtracted,
      tilesSkippedNoTitle: c.tilesSkippedNoTitle,
      tilesSkippedDuplicate: c.tilesSkippedDuplicate,
      tilesErrored: c.tilesErrored,
      lastScanMs: `${c.lastScanMs.toFixed(1)} ms`,
    });
    if (state.dev) console.groupEnd();
  };


  // ---- Dev toggle bridge via postMessage (CSP-safe) ----
  window.addEventListener(
    "message",
    (ev) => {
      if (ev.source !== window) return;
      const d = ev.data;
      if (d && d.type === "YT_TOGGLE_DEV") {
        state.dev = !!d.on;
        console.log(`[YT Tiles] dev=${state.dev ? "ON" : "OFF"}`);
        if (state.dev && state.lastBatch?.length) {
          console.log("[YT Tiles] __yf_lastBatch (first 10):", state.lastBatch.slice(0, 10));
        }
        printSummary();
      }
    },
    { passive: true }
  );

  // ========== helpers ==========
  const txt = (el) => (el?.textContent || "").trim();
  const attr = (el, a) => (el ? el.getAttribute(a) || "" : "");

  // step 3: BG health state + pause helper
  let __bgMisses = 0;
  let __bgLastOk = Date.now();

  function __pauseFilteringForBgFailure() {
    chrome.storage?.local?.set({ policy_enabled: false });

    try { showToast("Filtering paused — background not responding"); } catch { }
  }

  function removeAllExplicitBadges() {
    document.querySelectorAll('[data-yf-unclassified="1"], .yf-intent-badge, [data-yf-badge]')
      .forEach(n => n.remove());
  }
  const normalize = (s, maxLen = null) => {
    if (!s) return "";
    let v = s.replace(/\s+/g, " ").trim();
    v = v.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
    if (maxLen && v.length > maxLen) v = v.slice(0, maxLen);
    return v;
  };

  const toSeconds = (raw) => {
    if (!raw) return 0;
    const clean = raw.replace(/\s/g, "").toUpperCase();
    if (clean.includes("LIVE") || clean.includes("PREMIERE")) return 0;
    const parts = clean.split(":").map(Number);
    if (parts.some(Number.isNaN)) return 0;
    return parts.reverse().reduce((acc, v, i) => acc + v * (60 ** i), 0);
  };
  const debounce = (fn, ms = 150) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  function ymdToday() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}${mm}${dd}`;
  }

  function maybeShowIntentModalOnceADay() {
    const today = ymdToday();
    if (policy.modalLastShownYMD !== today) {
      openIntentModal();
    }
  }

  function openIntentModal() {
    ensureControlCss();
    const prev = document.getElementById("yf-intent-modal");
    if (prev) prev.remove();

    const modal = document.createElement("div");
    modal.id = "yf-intent-modal";

    const card = document.createElement("div");
    card.className = "yf-card";

    // content
    const html = `
      <h3>Pick your filters & scope</h3>
      <div class="group">
        <div class="muted">Select labels to allow through:</div>
        <div class="row">
          ${KNOWN_LABELS.map(lbl => {
      const checked = policy.activeFilters.includes(lbl) ? "checked" : "";
      return `<label><input type="checkbox" name="labels" value="${lbl}" ${checked}/> ${lbl}</label>`;
    }).join("")}
        </div>
      </div>
  
      <div class="group">
        <div class="muted">Mode & Semantics:</div>
        <label><input type="radio" name="mode" value="strict" ${policy.mode === "strict" ? "checked" : ""}/> Strict</label>
        <label><input type="radio" name="mode" value="lenient" ${policy.mode === "lenient" ? "checked" : ""}/> Lenient</label>
        <label><input type="radio" name="mode" value="labels" ${policy.mode === "labels" ? "checked" : ""}/> Labels-only</label>
        <div style="height:6px"></div>
        <label><input type="radio" name="sem" value="union" ${policy.filterSemantics === "union" ? "checked" : ""}/> Union (any selected)</label>
        <label><input type="radio" name="sem" value="intersection" ${policy.filterSemantics === "intersection" ? "checked" : ""}/> Intersection (all selected)</label>
      </div>
  
      <div class="group">
        <div class="muted">Thresholds:</div>
        <label>Strict min <input type="number" step="0.01" min="0" max="1" id="strictMin" value="${policy.strictMin}"/></label>
        <label>Lenient min <input type="number" step="0.01" min="0" max="1" id="lenientMin" value="${policy.lenientMin}"/></label>
      </div>
  
      <div class="group">
        <div class="muted">Apply on surfaces:</div>
        <label><input type="checkbox" id="scp_home" ${policy.scope.home ? "checked" : ""}/> Home</label>
        <label><input type="checkbox" id="scp_related" ${policy.scope.related ? "checked" : ""}/> Related (watch)</label>
        <label><input type="checkbox" id="scp_explore" ${policy.scope.explore ? "checked" : ""}/> Explore</label>
        <label><input type="checkbox" id="scp_shorts" ${policy.scope.shorts ? "checked" : ""}/> Shorts</label>
        <label><input type="checkbox" id="scp_search" ${policy.scope.search ? "checked" : ""}/> Search</label>
      </div>
  
      <div class="footer">
        <button class="secondary" id="yf-cancel">Cancel</button>
        <button class="primary" id="yf-save">Save</button>
      </div>
    `;
    card.innerHTML = html;
    modal.appendChild(card);
    document.body.appendChild(modal);

    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });
    card.querySelector("#yf-cancel").addEventListener("click", () => modal.remove());
    card.querySelector("#yf-save").addEventListener("click", () => {
      const selected = Array.from(card.querySelectorAll('input[name="labels"]:checked')).map(i => i.value);
      const mode = card.querySelector('input[name="mode"]:checked')?.value || policy.mode;
      const sem = card.querySelector('input[name="sem"]:checked')?.value || policy.filterSemantics;
      const strictMin = Number(card.querySelector("#strictMin")?.value ?? policy.strictMin) || policy.strictMin;
      const lenientMin = Number(card.querySelector("#lenientMin")?.value ?? policy.lenientMin) || policy.lenientMin;

      const scope = {
        home: !!card.querySelector("#scp_home")?.checked,
        related: !!card.querySelector("#scp_related")?.checked,
        explore: !!card.querySelector("#scp_explore")?.checked,
        shorts: !!card.querySelector("#scp_shorts")?.checked,
        search: !!card.querySelector("#scp_search")?.checked
      };

      const today = ymdToday();
      chrome.storage?.local?.set({
        policy_activeFilters: selected.length ? selected : policy.activeFilters,
        policy_mode: mode,
        policy_filterSemantics: sem,
        policy_strictMin: strictMin,
        policy_lenientMin: lenientMin,
        policy_scope: scope,
        policy_modalLastShownYMD: today
      }, () => {
        modal.remove();
        // will auto re-apply via onChanged, but we can nudge visuals
        try { refreshQuickChip(); } catch { }
      });
    });
  }


  const isAboveFold = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight || 800;
    // treat “above the fold” as entering viewport with a small buffer (80px)
    return r.top < (vh - 80) && r.bottom > 0;
  };

  const safe = (fn, onErr = undefined) => {
    try {
      return fn();
    } catch (e) {
      state.counters.tilesErrored++;
      state.lastErrorSample = e?.stack || String(e);
      if (state.dev) console.debug("[YT Tiles] safe() caught:", state.lastErrorSample);
      return onErr;
    }
  };

  const isLabelsOnly = () => (policy.mode === "labels" || window.__shadowModeOn === true);



  const getPageContext = () => {
    const p = location.pathname;
    if (p === "/" || p.startsWith("/feed")) return "home";
    if (p.startsWith("/results")) return "search";
    if (p.startsWith("/watch")) return "watch";
    if (p.startsWith("/explore")) return "explore";
    if (p.startsWith("/trending")) return "trending";
    if (p.startsWith("/@") || p.startsWith("/channel") || p.startsWith("/c/") || p.startsWith("/user/")) return "channel";
    return "home";
  };

  // step 2: scope check
  function inScope(page_context, tile_kind, scope) {
    // home feed
    if (page_context === "home" && scope.home) return true;
    // explore
    if (page_context === "explore" && scope.explore) return true;
    // search results
    if (page_context === "search" && scope.search) return true;
    // related (watch right-rail compact tiles)
    if (page_context === "watch" && tile_kind === "compact" && scope.related) return true;
    // shorts surface / reels
    if ((location.pathname.startsWith("/shorts") || tile_kind === "reel") && scope.shorts) return true;

    return false;
  }

  function __dbgLogPolicy() {
    console.log("[CT] policy now:", JSON.parse(JSON.stringify(policy)));
  }



  const getTileKind = (tile) => {
    const tag = tile.tagName || "";
    if (tag === "YTD-RICH-ITEM-RENDERER") return "grid";
    if (tag === "YTD-VIDEO-RENDERER") return "list";
    if (tag === "YTD-COMPACT-VIDEO-RENDERER") return "compact";
    if (tag.includes("REEL")) return "reel";
    return "list";
  };



  // Stable per-video id (used for session-level de-dupe)
  const getVideoId = (tile) => {
    const a =
      tile.querySelector('a#thumbnail[href]') ||
      tile.querySelector('a#video-title-link[href]') ||
      tile.querySelector('a.yt-simple-endpoint[href]');

    const href = attr(a, "href") || "";
    if (!href) return null;

    try {
      const u = new URL(href, location.origin);
      if (u.pathname === "/watch") {
        const v = u.searchParams.get("v");
        if (v) return `watch:${v}`;
      }
      if (u.pathname.startsWith("/shorts/")) {
        const id = u.pathname.split("/")[2];
        if (id) return `shorts:${id}`;
      }
      if (u.pathname.startsWith("/live/")) {
        const id = u.pathname.split("/")[2];
        if (id) return `live:${id}`;
      }
      return `path:${u.pathname}${u.search || ""}`;
    } catch {
      return `href:${href}`;
    }
  }
  // ========== field pickers ==========
  const pickTitle = (tile) => {
    const t1 = tile.querySelector("#video-title");
    const t2 = tile.querySelector("a#video-title-link");
    const t3 = tile.querySelector(".yt-lockup-metadata-view-model__title, .yt-lockup-metadata-view-model__heading-reset");
    for (const el of [t1, t2, t3]) {
      const v = (attr(el, "title") || attr(el, "aria-label") || txt(el)).trim();
      if (v) return v;
    }
    return "";
  };

  const pickChannel = (tile) => {
    const c1 = tile.querySelector("ytd-channel-name a");
    const c2 = tile.querySelector("#channel-name a");
    const c3 = tile.querySelector('a[href^="/@"]'); // handle link
    const c4 = tile.querySelector('a[href^="/channel/"], a[href^="/c/"], a[href^="/user/"]');
    let name = txt(c1) || txt(c2) || txt(c3) || txt(c4);
    if (!name && c3) name = attr(c3, "href").slice(2); // "/@handle" -> "handle"
    if (!name) {
      const t = tile.querySelector("#video-title, a#video-title-link");
      const aria = attr(t, "aria-label") || attr(t, "title") || "";
      const m = aria.match(/\bby\s+(.+?)(?:\s+[•|]|$)/i);
      if (m) name = m[1].trim();
    }
    // Fallbacks for Mix/My Mix tiles where channel anchors are missing
    if (!name) {
      // try byline chips on rich grid
      const byline = tile.querySelector('#metadata-line a, #metadata-line yt-formatted-string');
      name = txt(byline) || name;
    }
    if (!name) {
      // mine the title's aria-label: "... by <channel> • ..."
      const t = tile.querySelector("#video-title, a#video-title-link");
      const aria = (t && (t.getAttribute("aria-label") || t.getAttribute("title"))) || "";
      const m = aria.match(/\bby\s+(.+?)(?:\s+[•|]|$)/i);
      if (m) name = m[1].trim();
    }
    return name;
  };

  const pickDurationRaw = (tile) => {
    const b1 = tile.querySelector(".yt-badge-shape__text"); // new lockup badge
    const b2 = tile.querySelector("ytd-thumbnail-overlay-time-status-renderer #text"); // classic overlay
    return (txt(b1) || txt(b2) || "");
  };

  // Search page snippet (avoid view counts etc.)
  const pickSnippet = (tile, page_context) => {
    if (page_context !== "search") return undefined;
    const candidates = [
      "yt-formatted-string.metadata-snippet-text",
      "yt-formatted-string.metadata-snippet-text-navigation",
      ".metadata-snippet-container-one-line yt-formatted-string",
      "#description-text",
      "yt-formatted-string#description-text",
    ];
    let raw = "";
    for (const sel of candidates) {
      const el = tile.querySelector(sel);
      const t = (el?.textContent || "").replace(/\s+/g, " ").trim();
      if (t) {
        raw = t;
        break;
      }
    }
    if (!raw) return undefined;
    const looksLikeMeta = /\bviews\b\s*•\s*\d|^\s*\d[\d,.\s]*\s*(views|watching)/i.test(raw);
    if (looksLikeMeta) return undefined;
    return normalize(raw, 280);
  };

  // ========== extraction ==========
  const TILE_SELECTORS = [
    "ytd-rich-item-renderer",        // home/explore grid
    "ytd-video-renderer",            // search list
    "ytd-compact-video-renderer",    // watch sidebar
    "ytd-reel-item-renderer",        // shorts item
    "ytd-reel-renderer",             // shorts tray
    "ytd-reel-shelf-renderer"        // shorts shelf
  ].join(",");

  const sessionSeenIds = new Set();     // per-session stable id dedupe
  const processedEls = new WeakSet(); // node-level guard

  const extractOne = (tile) =>
    safe(() => {
      if (!tile || processedEls.has(tile) || tile.dataset.ytTileDone === "1") return null;

      const tStart = performance.now();
      const tile_kind = getTileKind(tile);
      const page_context = getPageContext();
      const vidKey = safe(() => getVideoId(tile), null);

      if (vidKey && sessionSeenIds.has(vidKey)) {
        tile.dataset.ytTileDone = "1";
        processedEls.add(tile);
        state.counters.tilesSkippedDuplicate++;
        return null;
      }

      const titleRaw = safe(() => pickTitle(tile), "");
      const channelRaw = safe(() => pickChannel(tile), "");
      const durRaw = safe(() => pickDurationRaw(tile), "");
      const snippetRaw = safe(() => pickSnippet(tile, page_context), undefined);

      const title = normalize(titleRaw, 140);
      if (!title) {
        state.counters.tilesSkippedNoTitle++;
        return null;
      }

      const channel = normalize(channelRaw, 80);
      const duration_sec = tile_kind === "reel" ? 0 : toSeconds(durRaw);

      const obj = {
        title,
        channel,
        duration_sec,
        ...(snippetRaw ? { snippet: snippetRaw } : {}),
        page_context,
        tile_kind,
      };

      tile.dataset.ytTileDone = "1";
      processedEls.add(tile);
      if (vidKey) sessionSeenIds.add(vidKey);

      state.counters.tilesExtracted++;
      if (state.dev) obj._t_ms = +(performance.now() - tStart).toFixed(1);
      Object.defineProperty(obj, "__el", { value: tile, enumerable: false });
      Object.defineProperty(obj, "_key", { value: vidKey, enumerable: false }); // used to match replies defensively
      return obj;
    }, null);

  const extractAllNow = () => {
    const t0 = performance.now();
    const nodes = Array.from(document.querySelectorAll(TILE_SELECTORS));
    state.counters.tilesSeen += nodes.length;

    const items = nodes.map(extractOne).filter(Boolean);

    state.counters.scans++;
    state.counters.lastScanMs = performance.now() - t0;
    return items;
  };

  // Stream + print
  const pushNew = (items) => {
    if (!items.length) {
      if (state.dev) printSummary();
      return;
    }
    state.lastBatch = items.slice(0, 10);

    if (state.dev) {
      console.table(items.slice(0, 30));
      console.log("[YT Tiles] __yf_lastBatch (first 10):", state.lastBatch);
      printSummary();
    }

    //console.log("TileMetadata JSON:", JSON.stringify(items, null, 2));
    if (window.__ytTiles_enqueueForAnalysis) {
      window.__ytTiles_enqueueForAnalysis(items);
    }
    // chrome.runtime?.sendMessage?.({ type: "YT_TILES_V1", payload: items });
  };

  // initial extraction (after a short tick for hydration)
  setTimeout(() => pushNew(extractAllNow()), 500);
  ensureControlCss();
  ensureQuickChip();


  // observe new tiles while scrolling/streaming
  const mo = new MutationObserver(debounce(() => pushNew(extractAllNow()), 50));
  mo.observe(document.documentElement, { subtree: true, childList: true });

  // debug handle (content-world only; use postMessage for toggling)
  window.YouTubeTilesDump = () => {
    // fresh extraction (may be empty if everything is already processed)
    const all = extractAllNow();
    if (state.dev) console.table(all.slice(0, 30));
    return all;
  };
  // last batch that was actually queued/sent (first 10 only)
  window.YouTubeTilesLast = () => state.lastBatch.map(({ __el, ...rest }) => rest);


  // ========== navigation handling (no double-count on back) ==========
  const nudgeScroll = () => {
    const y = window.scrollY || 0;
    window.scrollTo(0, y + 1);
    window.scrollTo(0, y);
  };

  const untilTilesAppear = (min = 1, timeoutMs = 2000) =>
    new Promise((resolve) => {
      const start = performance.now();
      const tick = () => {
        const count = document.querySelectorAll(TILE_SELECTORS).length;
        if (count >= min || performance.now() - start > timeoutMs) return resolve(count);
        requestAnimationFrame(tick);
      };
      tick();
    });

  const rescanNow = async () => {
    try {
      nudgeScroll();
      await untilTilesAppear(1, 2000);
      pushNew(extractAllNow());
    } catch (e) {
      state.counters.tilesErrored++;
      state.lastErrorSample = e?.stack || String(e);
      if (state.dev) printSummary();
      // swallow: guardrail—never crash the content script
    }
  };

  let lastPathname = location.pathname;

  window.addEventListener(
    "yt-navigate-finish",
    debounce(() => {
      const p = location.pathname;
      if (p !== lastPathname) {
        lastPathname = p;
        rescanNow();

        if (window.__ytTiles_onNav) window.__ytTiles_onNav();
      } else {
        rescanNow();
      }
    }, 100)
  );

  window.addEventListener("pageshow", (e) => {
    if (e.persisted) rescanNow(); // bfcache restore
  });

  (() => {
    const origPush = history.pushState;
    const origReplace = history.replaceState;
    const onHist = debounce(() => {
      const p = location.pathname;
      if (p !== lastPathname) {
        lastPathname = p;
        rescanNow();

        // step 7 addition: drop queued batches + abort background
        const navId = Date.now();
        chrome.runtime.sendMessage({ type: "NAVIGATION_CHANGED", navId });
        if (window.__ytTiles_batcher) {
          window.__ytTiles_batcher.reset(navId);
        }
      }
    }, 50);
    history.pushState = function (...args) {
      const r = origPush.apply(this, args);
      onHist();
      return r;
    };
    history.replaceState = function (...args) {
      const r = origReplace.apply(this, args);
      onHist();
      return r;
    };
    window.addEventListener("popstate", () => onHist());
  })();

  // ===== step 7: batching & rate control (content side) =====
  (() => {
    const BATCH_SIZE = 12;

    class BatchQueue {
      constructor() {
        this.queue = [];
        this.inflight = false;
        this.navId = Date.now();
        this.backoffMs = 120;
      }
      reset(newNavId) {
        this.queue.length = 0;
        this.inflight = false;
        this.navId = newNavId ?? Date.now();
      }
      enqueueFromScan(metas) {
        if (!Array.isArray(metas) || metas.length === 0) return;

        // above-the-fold first
        const first12 = metas.slice(0, BATCH_SIZE);
        const rest = metas.slice(BATCH_SIZE);

        // priority: first 12 to the very front, then whatever was queued, then the rest
        this.queue = [...first12, ...this.queue, ...rest];

        this._pump();
      }
      _pump() {
        if (this.inflight || this.queue.length === 0) return;

        const batch = this.queue.splice(0, BATCH_SIZE);
        const navIdAtSend = this.navId;
        this.inflight = true;
        console.log("[CT] send batch", { size: batch.length, navId: navIdAtSend });

        try {

          // Keep DOM refs locally
          const domRefs = batch.map(it => it.__el || null);
          const keyMap = Object.create(null);
          batch.forEach((it, i) => { if (it && it._key) keyMap[it._key] = domRefs[i]; });

          // Include batch-local index + stable key
          const payload = batch.map((it, i) => {
            const { __el, _key, ...rest } = it;
            return { ...rest, __idx: i, __key: _key || null };
          });

          // step 3: guard timer — if no reply in ~3s, auto fail-open once
          const __bgGuard = setTimeout(() => {
            if (Date.now() - __bgLastOk > 2500) {
              __pauseFilteringForBgFailure();
            }
          }, 3000);
          chrome.runtime.sendMessage(
            { type: "CLASSIFY_BATCH", navId: navIdAtSend, payload },
            (res) => {

              // step 3: bg fail-open — early exit on error/missing response
              clearTimeout(__bgGuard);
              if (chrome.runtime.lastError || !res) {
                __bgMisses++;
                if (__bgMisses === 1) {
                  __pauseFilteringForBgFailure();
                }
                // keep your original inflight/pump behavior:
                this.inflight = false;
                setTimeout(() => this._pump(), 0);
                return; // IMPORTANT: stop here on error
              }

              // good response → mark healthy
              __bgMisses = 0;
              __bgLastOk = Date.now();

              const err = chrome.runtime && chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
              if (err) console.warn("[CT] sendMessage lastError:", err);
              if (!res) {
                console.warn("[CT] no response from background (res is null/undefined)");
                this.inflight = false;
                setTimeout(() => this._pump(), 0);
                return;
              }

              console.log("[CT] batch reply:", {
                navIdSent: navIdAtSend,
                navIdReply: res.navId,
                stale: !!res.stale,
                count: Array.isArray(res.result) ? res.result.length : 0
              });

              if (res.stale) {
                console.log("[CT] reply marked stale; skipping decorate", { navIdSent: navIdAtSend, navIdReply: res.navId });
                this.inflight = false;
                setTimeout(() => this._pump(), 0);
                return;
              }
              if (res.aborted) {
                console.log("[CT] reply aborted by nav-change");
                this.inflight = false;
                setTimeout(() => this._pump(), 0);
                return;
              }
              if (res.ok !== true || !Array.isArray(res.result)) {
                console.warn("[CT] bad reply shape (fallback to neutral labels):", res);
                // decorate everything in this batch so you can SEE badges during 429s
                domRefs.forEach((tileEl) => {
                  if (!tileEl) return;
                  try {
                    addOverlayBadgeToTile(tileEl, "Custom");

                    const anchor =
                      tileEl.querySelector("#dismissible") ||
                      tileEl.querySelector("a#thumbnail") ||
                      tileEl.querySelector("#content") ||
                      tileEl;

                    // write both numeric + short strings (no 'out' here!)
                    anchor.setAttribute("data-intent-confidence", "0");
                    tileEl.setAttribute("data-intent-confidence", "0");
                    anchor.setAttribute("data-intent-confshort", "0.00");
                    tileEl.setAttribute("data-intent-confshort", "0.00");

                    // still run policy (labels mode = no hide; strict/lenient will act)
                    applyDecisionToTile(tileEl, "Custom", 0);
                  } catch (e) {
                    console.warn("[CT] fallback decorate failed:", e);
                  }
                });
                this.inflight = false;
                setTimeout(() => this._pump(), 0);
                return;
              }

              res.result.forEach(out => {
                // 1) use the plain index if it's correct
                let tileEl = Number.isInteger(out.index) ? domRefs[out.index] : null;
                // 2) fall back to a stable key if background sends one
                if (!tileEl && out.key && keyMap[out.key]) tileEl = keyMap[out.key];
                // 3) fall back to echoed fields we just sent (__idx / __key)
                if (!tileEl && Number.isInteger(out.__idx)) tileEl = domRefs[out.__idx];
                if (!tileEl && out.__key && keyMap[out.__key]) tileEl = keyMap[out.__key];
                console.log("[CT] add badge", { index: out.index, label: out.label, hasEl: !!tileEl });
                if (!tileEl) {
                  console.warn("[CT] tileEl missing for", out);
                  return;
                }
                try {
                  addOverlayBadgeToTile(tileEl, out.label);

                  // persist confidence on attributes so we can re-apply policy later
                  try {
                    const anchor =
                      tileEl.querySelector("#dismissible") ||
                      tileEl.querySelector("a#thumbnail") ||
                      tileEl.querySelector("#content") ||
                      tileEl;
                    anchor.setAttribute("data-intent-confidence", String(out.confidence ?? 0));
                    tileEl.setAttribute("data-intent-confidence", String(out.confidence ?? 0));
                    anchor.setAttribute(
                      "data-intent-confshort",
                      out.confidence != null ? Number(out.confidence).toFixed(2) : "0.00"
                    );
                    tileEl.setAttribute(
                      "data-intent-confshort",
                      out.confidence != null ? Number(out.confidence).toFixed(2) : "0.00"
                    );

                    // apply decision immediately
                    applyDecisionToTile(tileEl, out.label, out.confidence);
                  } catch { }

                  // verify attribute actually landed
                  const anchor =
                    tileEl.querySelector("#dismissible") ||
                    tileEl.querySelector("a#thumbnail") ||
                    tileEl.querySelector("#content") ||
                    tileEl;
                  console.log("[CT] wrote attrs", {
                    label: anchor.getAttribute("data-intent-label"),
                    klass: anchor.getAttribute("data-intent-class"),
                  });
                } catch (e) {
                  console.error("[CT] addOverlayBadgeToTile error:", e);
                }
                console.log("[CT] wrote label", { label: out.label, confidence: out.confidence });
              });

              this.inflight = false;
              setTimeout(() => this._pump(), 0);
            }
          );
        } catch (e) {
          console.warn("[YT Tiles] sendMessage failed:", e);
          this.inflight = false;
        }
      }
    }

    // singleton
    const batcher = new BatchQueue();

    // call this on SPA nav (you already did inside history patch and yt-navigate-finish)
    window.__ytTiles_onNav = () => {
      const navId = Date.now();
      batcher.reset(navId);
      try { chrome.runtime.sendMessage({ type: "NAVIGATION_CHANGED", navId }); } catch { }
      ensureQuickChip();
    };

    // expose for other parts of content.js
    window.__ytTiles_batcher = batcher;
    window.__ytTiles_enqueueForAnalysis = (metas) => batcher.enqueueFromScan(metas);

  })();

  // step 2: known labels list (chip cycles, modal lists)
  const KNOWN_LABELS = [
    "Learning - Academic Study",
    "Learning - Career Prep",
    "Learning - Skill Learning",
    "Learning - News & Current Affairs",
    "Learning - Explainers & Docs",
    "Learning - Reviews & Analysis",
    "Entertainment",
    "Motivation & Self",
    "Custom"
  ];

  // expose for toolbar chip
  window.__yt_getPolicy = () => policy;
  window.__yt_labels = KNOWN_LABELS;
  window.__yt_openIntentModal = openIntentModal;


  function shortLabel(label) {
    switch (label) {
      case "Learning - Academic Study": return "Study";
      case "Learning - Career Prep": return "Career";
      case "Learning - Skill Learning": return "Skill";
      case "Learning - News & Current Affairs": return "News";
      case "Learning - Explainers & Docs": return "Docs";
      case "Learning - Reviews & Analysis": return "Reviews";
      case "Entertainment": return "Entertainment";
      case "Motivation & Self": return "Motivation";
      default: return "Custom";
    }
  }

  function removeOverlayBadges() {
    document.querySelectorAll("[data-intent-label]").forEach(el => {
      el.removeAttribute("data-intent-label");
      el.removeAttribute("data-intent-class");
    });
  }

  window.__shadowModeOn = false; // default OFF in phase 3 → allow filtering

  document.addEventListener("keydown", (e) => {
    if (e.shiftKey && e.key.toLowerCase() === "l") {
      document.documentElement.classList.toggle("yt-shadow-on");
      const on = document.documentElement.classList.contains("yt-shadow-on");
      console.log("[YT Tiles] ShadowMode=", on ? "ON" : "OFF");
      if (!on) {
        // keep attributes but hide via CSS gate, or clear if you prefer:
        // removeOverlayBadges();
      } else {
        // re-show on already-labeled tiles
        document.querySelectorAll("[data-intent-label]").forEach(el => {
          addOverlayBadgeToTile(el, el.dataset.intentLabel || el.getAttribute("data-intent-label"));
        });
      }
    }
    if (e.shiftKey && e.key.toLowerCase() === "m") {
      const next = policy.mode === "strict" ? "lenient" : (policy.mode === "lenient" ? "labels" : "strict");
      chrome.storage?.local?.set({ policy_mode: next }, () => {
        console.log("[YT Tiles] policy_mode ->", next);
        // applyPolicyToAllLabeledTiles() will run via onChanged listener
      });
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "REAPPLY_POLICY") {
      try {
        // call your existing function that re-applies filtering & labels
        // names vary; pick whichever you already use after storage changes:
        // e.g., reapplyAllTiles(), applyPolicyToVisibleTiles(), runPolicyPass(), etc.
        typeof reapplyAllTiles === "function" ? reapplyAllTiles()
          : typeof applyPolicyToVisibleTiles === "function" ? applyPolicyToVisibleTiles()
            : typeof runPolicyPass === "function" ? runPolicyPass()
              : null;
      } catch { }
    }
  });

  // --- anchor-aware badge writer (CSS-only overlays) ---
  function addOverlayBadgeToTile(tile, fullLabel) {
    if (!tile) return;
    const short = shortLabel(fullLabel);
    const klass = mapIntentToClass(fullLabel);

    // 1) Prefer a stable inner anchor for nice positioning
    const anchor =
      tile.querySelector("#dismissible") ||
      tile.querySelector("a#thumbnail") ||
      tile.querySelector("#content") ||
      tile;

    anchor.setAttribute("data-intent-class", klass);
    anchor.setAttribute("data-intent-label", fullLabel);
    anchor.setAttribute("data-intent-short", shortLabel(fullLabel));

    // ensure relative pos for ::before hit target
    if (getComputedStyle(anchor).position === "static") {
      anchor.style.position = "relative";
    }

    // one-time click handler to detect chip click (bottom-left ~80x22 zone)
    if (!anchor.__yfChipBound) {
      anchor.__yfChipBound = true;
      anchor.addEventListener("click", (ev) => {
        try {
          const r = anchor.getBoundingClientRect();
          const x = ev.clientX - r.left;
          const y = ev.clientY - r.top;
          // chip bounds (adjust if needed): left 6–86px, bottom 6–28px
          const withinX = (x >= 6 && x <= 86);
          const withinY = (y >= (r.height - 28) && y <= (r.height - 6));
          const outer = tile.closest(TILE_SEL) || tile;

          if (withinX && withinY && outer.classList.contains("yf-dim")) {
            outer.setAttribute("data-yt-override", "show-once");
            outer.classList.remove("yf-dim", "yf-hide");
            outer.removeAttribute("data-yt-hide");
            const t = pendingHideTimers.get(outer);
            if (t) { clearTimeout(t); pendingHideTimers.delete(outer); }
            ev.preventDefault();
            ev.stopPropagation();
            console.log("[CT] show once override");
          }
        } catch { }
      }, true); // capture to beat YouTube handlers if necessary
    }

    // 2) Also mirror attributes on the OUTER tile so queries like
    //    document.querySelectorAll("[data-intent-label]") never return 0
    anchor.setAttribute("data-intent-short", short);
    tile.setAttribute("data-intent-short", short);
    tile.setAttribute("data-intent-label", fullLabel);
    tile.setAttribute("data-intent-class", klass);

    if (getComputedStyle(anchor).position === "static") {
      anchor.style.position = "relative";
    }
    console.log("[CT] addOverlayBadgeToTile", { label: fullLabel, tile, enabled: policy.enabled });

  }


  function mapIntentToClass(label) {
    switch (label) {
      case "Learning - Academic Study": return "study";
      case "Learning - Career Prep": return "career";
      case "Learning - Skill Learning": return "skill";
      case "Learning - News & Current Affairs": return "news";
      case "Learning - Explainers & Docs": return "docs";
      case "Learning - Reviews & Analysis": return "reviews";
      case "Entertainment": return "entertainment";
      case "Motivation & Self": return "motivation";
      default: return "custom";
    }
  }

  function shouldShowByPolicy(activeFilters, label, confidence, mode, strictMin, lenientMin) {
    if (label === "Unclassified") return true;
    if (isLabelsOnly()) return true; // labels-only: always show

    const inSet = activeFilters.includes(label);
    let ok;
    if (mode === "strict") {
      ok = inSet && confidence >= strictMin;
    } else {
      // lenient: currently treat as "label matches" (conf ignored)
      ok = inSet;
    }

    // step 2: filter semantics
    if (policy.filterSemantics === "union") {
      return ok; // any selected label passes
    } else {
      // intersection: require the tile's label to match ALL selected labels.
      // with current single-label classifier, 2+ selections will effectively hide all.
      if (Array.isArray(activeFilters) && activeFilters.length > 1) {
        return activeFilters.every(f => f === label) && ok;
      }
      return ok;
    }
  }

  const pendingHideTimers = new WeakMap();

  function applyDecisionToTile(tileEl, label, confidence) {
    const outer = tileEl.closest(TILE_SEL) || tileEl;

    const page_context = getPageContext();
    const tile_kind = getTileKind(outer);

    // filtering OFF → ensure visible and strip badges
    if (!policy.enabled) {
      outer.classList.remove("yf-dim", "yf-hide");
      outer.removeAttribute("data-yt-hide");
      outer.querySelectorAll('[data-yf-unclassified="1"], .yf-intent-badge, [data-yf-badge]').forEach(n => n.remove());
      return;
    }
    if (!inScope(page_context, tile_kind, policy.scope)) {
      // out of scope → ensure visible; still keep badges in shadow mode
      outer.classList.remove("yf-dim", "yf-hide");
      outer.removeAttribute("data-yt-hide");
      return;
    }
    if (!outer) return;

    // labels-only: keep every tile visible; we still write badges
    if (isLabelsOnly()) {
      // Show everything, but KEEP badges/attrs for the shadow overlay
      outer.classList.remove("yf-dim", "yf-hide");
      outer.removeAttribute("data-yt-hide");
      return;
    }
    // respect a one-time override
    if (outer.getAttribute("data-yt-override") === "show-once") {
      outer.classList.remove("yf-dim", "yf-hide");
      outer.removeAttribute("data-yt-hide");
      return;
    }

    const show = shouldShowByPolicy(policy.activeFilters, label, Number(confidence || 0), policy.mode, policy.strictMin, policy.lenientMin);

    if (show) {
      outer.classList.remove("yf-dim", "yf-hide");
      outer.removeAttribute("data-yt-hide");
      const t = pendingHideTimers.get(outer);
      if (t) { clearTimeout(t); pendingHideTimers.delete(outer); }
      return;
    }

    // hide path
    const tExisting = pendingHideTimers.get(outer);
    if (tExisting) { clearTimeout(tExisting); pendingHideTimers.delete(outer); }

    // reflect debug attr if you want to keep it

    if (isAboveFold(outer)) {
      // 1) dim now (no layout shift)
      outer.classList.add("yf-dim");
      outer.classList.remove("yf-hide");

      // 2) after ~0.5s, upgrade to hide
      const delayMs = 500;
      const tid = setTimeout(() => {
        outer.classList.remove("yf-dim");
        outer.classList.add("yf-hide");
        // optional debug flag at *hide* moment only
        outer.setAttribute("data-yt-hide", "1");
        pendingHideTimers.delete(outer);
      }, delayMs);
      pendingHideTimers.set(outer, tid);
    } else {
      // offscreen — hide immediately
      outer.classList.remove("yf-dim");
      outer.classList.add("yf-hide");
      // optional debug flag
      outer.setAttribute("data-yt-hide", "1");
    }
  }


  function applyPolicyToAllLabeledTiles() {
    document.querySelectorAll(TILE_SEL).forEach((tile) => {
      const anchor =
        tile.querySelector("#dismissible") ||
        tile.querySelector("a#thumbnail") ||
        tile.querySelector("#content") ||
        tile;
      const label =
        anchor.getAttribute("data-intent-label") ||
        tile.getAttribute("data-intent-label") ||
        "Custom";
      const conf = Number(
        anchor.getAttribute("data-intent-confidence") ||
        tile.getAttribute("data-intent-confidence") ||
        0
      );
      if (label) applyDecisionToTile(tile, label, conf);
    });
  }


  // Debug helper: allow manual badge write from page console
  window.__ytTiles_debugBadge = (sel, fullLabel) => {
    try {
      const el = document.querySelector(sel);
      if (!el) return console.warn("[CT] __ytTiles_debugBadge: no element for", sel);
      addOverlayBadgeToTile(el, fullLabel || "Learning - Academic Study");
      console.log("[CT] __ytTiles_debugBadge wrote:", el);
    } catch (e) {
      console.error("[CT] __ytTiles_debugBadge error:", e);
    }
  };


})();
