// background.js — MV3 service worker (phase 2 / step 5, debug-ready)
// Version bumps whenever we tweak runtime behavior.
console.log("[BG] service worker booted");
const VERSION = "0.5.1";

// ========================== CACHE CONFIG ==========================
const CACHE_DB_NAME = "yt-tiles-cache";
const CACHE_DB_VERSION = 1;
const CACHE_STORE = "classifications";
const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const CACHE_MAX_ENTRIES = 5000; // soft cap for LRU purge (tune later)


// // step 7: nav + abort wiring (additive)
// let __currentNavId = null;
// let __abortCtl = null;

// ========================== KEY BUILDER (SHA-1) ==========================
async function sha1Hex(str) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-1", enc.encode(str));
  const view = new DataView(buf);
  let hex = "";
  for (let i = 0; i < view.byteLength; i++) {
    const b = view.getUint8(i).toString(16).padStart(2, "0");
    hex += b;
  }
  return hex;
}

async function tileCacheKey(tile) {
  const title = tile?.title ?? "";
  const channel = tile?.channel ?? "";
  const dur = Number(tile?.duration_sec || 0);
  return sha1Hex(`${title}|${channel}|${dur}`);
}
// === step 3: keyboard commands → update storage + toast the active YT tab ===

// tiny helper: toast on the active youtube tab (content.js shows it)
async function __toastActive(text) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.id || !tab.url) return;
    if (!/^https?:\/\/(www\.)?youtube\.com\//i.test(tab.url)) return;
    chrome.tabs.sendMessage(tab.id, { type: "SHOW_TOAST", text });
  } catch { }
}


// handle Alt+Shift+F / S / U (declared in manifest "commands")
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const cfg = await chrome.storage.local.get(["policy_mode", "policy_filterSemantics", "force_dummy"]);

    if (command === "toggle_filter_on_off") {
      const cfg2 = await chrome.storage.local.get(["policy_enabled"]);
      const curr = !!cfg2.policy_enabled;
      const next = !curr;
      await chrome.storage.local.set({ policy_enabled: next });
      console.log("[BG] toggle_filter_on_off →", next ? "ON" : "OFF");
      __toastActive(next ? "Filter: ON" : "Filter: OFF");
      return;
    }

    if (command === "toggle_strict_lenient") {
      const curr = cfg.policy_mode || "strict";
      const next = (curr === "labels") ? "strict" : (curr === "strict" ? "lenient" : "strict");
      await chrome.storage.local.set({ policy_mode: next });
      console.log("[BG] toggle_strict_lenient →", next);
      __toastActive(next === "strict" ? "Mode: Strict" : "Mode: Lenient");
      return;
    }

    if (command === "toggle_union_intersection") {
      const sem = cfg.policy_filterSemantics || "union";
      const next = (sem === "union") ? "intersection" : "union";
      await chrome.storage.local.set({ policy_filterSemantics: next });
      console.log("[BG] toggle_union_intersection →", next);
      __toastActive(next === "union" ? "Semantics: Union" : "Semantics: Intersection");
      return;
    }

    // OPTIONAL: add a keyboard command "toggle_force_dummy" in manifest if you want
    if (command === "toggle_force_dummy") {
      const next = !cfg.force_dummy;
      await chrome.storage.local.set({ force_dummy: next });
      console.log("[BG] toggle_force_dummy →", next);
      __toastActive(next ? "Classifier: Dummy (forced)" : "Classifier: LLM (if key)");
      return;
    }
  } catch (e) {
    console.warn("[BG] commands handler error", e);
  }
});

// ========================== INDEXEDDB HELPERS ==========================
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        const store = db.createObjectStore(CACHE_STORE, { keyPath: "key" });
        store.createIndex("by_ts", "ts");           // for expiry
        store.createIndex("by_lastAccess", "lastAccess"); // for LRU
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetMany(keys) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readonly");
    const store = tx.objectStore(CACHE_STORE);
    const out = new Map();
    let remaining = keys.length;
    if (remaining === 0) { resolve(out); return; }
    keys.forEach((k) => {
      const r = store.get(k);
      r.onsuccess = () => {
        if (r.result) out.set(k, r.result);
        if (--remaining === 0) resolve(out);
      };
      r.onerror = () => reject(r.error);
    });
  });
}

async function idbPutMany(entries) {
  if (!entries?.length) return;
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readwrite");
    const store = tx.objectStore(CACHE_STORE);
    for (const e of entries) store.put(e);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbUpdateLastAccess(keys) {
  if (!keys?.length) return;
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const now = Date.now();
    const tx = db.transaction(CACHE_STORE, "readwrite");
    const store = tx.objectStore(CACHE_STORE);
    let remaining = keys.length;
    keys.forEach((k) => {
      const g = store.get(k);
      g.onsuccess = () => {
        const row = g.result;
        if (row) {
          row.lastAccess = now;
          store.put(row);
        }
        if (--remaining === 0) resolve();
      };
      g.onerror = () => reject(g.error);
    });
  });
}

// Purge expired (TTL) and if still large, purge oldest by LRU until under soft cap
async function idbPurgeExpiredAndLRU() {
  const db = await idbOpen();
  const now = Date.now();
  let purged = 0;

  await new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readwrite");
    const store = tx.objectStore(CACHE_STORE);
    const idx = store.index("by_ts");
    const upper = IDBKeyRange.upperBound(now - CACHE_TTL_MS);
    const cursorReq = idx.openCursor(upper);
    cursorReq.onsuccess = (ev) => {
      const cursor = ev.target.result;
      if (cursor) {
        store.delete(cursor.primaryKey);
        purged++;
        cursor.continue();
      } else {
        resolve();
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });

  // Soft LRU cull if over max
  let count = await new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readonly");
    const store = tx.objectStore(CACHE_STORE);
    const countReq = store.count();
    countReq.onsuccess = () => resolve(countReq.result || 0);
    countReq.onerror = () => reject(countReq.error);
  });

  if (count > CACHE_MAX_ENTRIES) {
    const toDelete = count - CACHE_MAX_ENTRIES;
    await new Promise((resolve, reject) => {
      let deleted = 0;
      const tx = db.transaction(CACHE_STORE, "readwrite");
      const idx = tx.objectStore(CACHE_STORE).index("by_lastAccess");
      const cursorReq = idx.openCursor();
      cursorReq.onsuccess = (ev) => {
        const cursor = ev.target.result;
        if (cursor && deleted < toDelete) {
          cursor.delete();
          deleted++;
          cursor.continue();
        } else {
          purged += deleted;
          resolve();
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  }

  if (purged) console.log(`[BG] cache purge complete — removed ${purged} entries`);
}


// ========================== AJV (optional) ==========================
let __ajvCtor = null;
let __ajvInstance = null;
(async () => {
  try {
    const mod = await import(chrome.runtime.getURL("lib/ajv.mjs"));
    __ajvCtor = mod.default || mod.Ajv || null;
    if (__ajvCtor) console.log("[BG] Ajv loaded");
  } catch (e) {
    console.log("[BG] Ajv not found — falling back to lightweight validator");
  }
})();


// ========================== STORAGE / CONFIG ==========================
let cachedProvider = null;
let cachedModel = null;
let cachedKey = null;
let __forceDummy = false;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "CONFIG_CHANGED") {
    cachedProvider = cachedModel = cachedKey = null;
    console.log("[BG] CONFIG_CHANGED → cleared API config cache");
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.api_provider || changes.api_key || changes.api_keys || changes.model || changes.provider || changes.apiKey) {
    cachedProvider = cachedModel = cachedKey = null;
    console.log("[BG] storage change → cleared API config cache");
  }
  if (changes.force_dummy && "newValue" in changes.force_dummy) {
    __forceDummy = !!changes.force_dummy.newValue;
    console.log("[BG] force_dummy →", __forceDummy ? "ON (always dummy)" : "OFF (use LLM if key)");
  }
});

// hydrate once at boot
chrome.storage.local.get(["force_dummy"], (res) => {
  __forceDummy = !!res.force_dummy;
});


async function getApiConfig() {
  if (cachedProvider && cachedModel !== null && cachedKey !== null) {
    return { provider: cachedProvider, model: cachedModel, apiKey: cachedKey };
  }
  const st = await chrome.storage.local.get([
    "api_provider", "model", "api_key", "api_keys",
    "provider", "apiKey"
  ]);

  const provider = st.api_provider || st.provider || "openai";
  const model = st.model || (provider === "gemini" ? "gemini-1.5-flash" : "gpt-4o-mini");
  const directKey = st.api_key || st.apiKey || "";
  const mappedKey = (st.api_keys && st.api_keys[provider]) || "";
  const apiKey = directKey || mappedKey || "";

  cachedProvider = provider;
  cachedModel = model;
  cachedKey = apiKey;

  console.log("[BG] getApiConfig()", { provider, model, hasKey: !!apiKey });
  return { provider, model, apiKey };
}


chrome.storage.onChanged?.addListener((changes, area) => {
  if (area !== "local") return;

  if (
    changes.api_provider || changes.api_key || changes.api_keys ||
    changes.provider || changes.apiKey || changes.model
  ) {
    const before = { provider: cachedProvider, model: cachedModel, hasKey: !!cachedKey };

    if (changes.api_provider?.newValue) cachedProvider = changes.api_provider.newValue;
    if (changes.provider?.newValue)     cachedProvider = changes.provider.newValue;

    if (changes.model?.newValue)        cachedModel   = changes.model.newValue;

    // try to hydrate key immediately, else force reload next call
    if (changes.api_key?.newValue) {
      cachedKey = changes.api_key.newValue;
    } else if (changes.api_keys?.newValue && cachedProvider && changes.api_keys.newValue[cachedProvider]) {
      cachedKey = changes.api_keys.newValue[cachedProvider];
    } else if (changes.apiKey?.newValue) {
      cachedKey = changes.apiKey.newValue;
    } else {
      cachedKey = null; // cause getApiConfig() to re-read storage
    }

    console.log("[BG] API config cache updated", {
      before,
      after: { provider: cachedProvider, model: cachedModel, hasKey: !!cachedKey }
    });
  }
});


// ========================== LABEL CONTRACT ==========================
const LLM_LABELS = [
  "Learning - Academic Study",
  "Learning - Career Prep",
  "Learning - Skill Learning",
  "Learning - News & Current Affairs",
  "Learning - Explainers & Docs",
  "Learning - Reviews & Analysis",
  "Entertainment",
  "Motivation & Self",
  "Custom",
];

const INTENT_DEFINITIONS = `
Pick exactly one label for each YouTube tile (see enum). 
Return JSON array of {index,label,confidence in [0,1]}. 
Labels enum: ${LLM_LABELS.join(" | ")}.
`.trim();
// ========================== SCHEMAS ==========================
const LLM_ITEM_SCHEMA = {
  $id: "https://yt-tiles/schemas/llm_result_item.json",
  type: "object",
  additionalProperties: false,
  required: ["index", "label", "confidence"],
  properties: {
    index: { type: "integer", minimum: 0 },
    label: { type: "string", enum: LLM_LABELS },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

const LLM_BATCH_SCHEMA = {
  $id: "https://yt-tiles/schemas/llm_result_batch.json",
  type: "array",
  items: { $ref: "https://yt-tiles/schemas/llm_result_item.json" },
};

// ========================== PAYLOAD BUILDER ==========================
function buildLlmRequest({ intentText = INTENT_DEFINITIONS, items = [] } = {}) {
  const clean = items.map((it, idx) => ({
    index: Number.isInteger(it.index) ? it.index : idx,
    title: it.title || "",
    channel: it.channel || "",
    duration_sec: Number(it.duration_sec || 0),
    ...(it.snippet ? { snippet: it.snippet } : {}),
    page_context: it.page_context || "home",
  }));

  if (typeof self !== "undefined" && self.__VER && console) {
    console.debug("[BG] buildLlmRequest() sanitized items:", clean.slice(0, 5));
  }

  return {
    intent: intentText.trim(),
    items: clean,
    response_contract: {
      description: "Array of per-item classifications matching input order",
      item_schema: {
        type: "object",
        additionalProperties: false,
        required: ["index", "label", "confidence"],
        properties: {
          index: { type: "integer", minimum: 0 },
          label: { type: "string", enum: LLM_LABELS },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    instructions:
      'Return JSON ONLY: [{"index":0,"label":"Learning - Skill Learning","confidence":0.92}, ...]',
  };
}

// ========================== VALIDATION ==========================
function __validateLlmResponseLight(resp) {
  if (!Array.isArray(resp)) return "Not an array";
  for (const r of resp) {
    if (!r || typeof r !== "object") return "Item not an object";
    if (!Number.isInteger(r.index) || r.index < 0) return "Bad index";
    if (!LLM_LABELS.includes(r.label)) return `Bad label: ${r.label}`;
    if (typeof r.confidence !== "number" || r.confidence < 0 || r.confidence > 1) return "Bad confidence";
  }
  return "ok";
}

async function validateLlmBatchOrThrow(json) {
  const arr =
    Array.isArray(json) ? json :
      Array.isArray(json?.items) ? json.items :
        Array.isArray(json?.result) ? json.result : // tolerate {result:[...]} too
          null;

  if (!arr) throw new Error("Bad shape: expected array or {items:[...]} or {result:[...]}");

  if (__ajvCtor) {
    if (!__ajvInstance) {
      __ajvInstance = new __ajvCtor({ allErrors: true, strict: true });
      __ajvInstance.addSchema(LLM_ITEM_SCHEMA);
      console.log("[BG] Ajv instance initialized");
    }
    const validate = __ajvInstance.compile(LLM_BATCH_SCHEMA);
    const ok = validate(arr);
    if (!ok) {
      const msg = (validate.errors || []).map(e => `${e.instancePath || ""} ${e.message}`).join("; ");
      throw new Error("Schema validation failed: " + msg);
    }
    return arr;
  }

  const res = __validateLlmResponseLight(arr);
  if (res !== "ok") throw new Error("Lightweight validation failed: " + res);
  return arr;
}

// ========================== DUMMY CLASSIFIER ==========================
function classifyOneDummy(tile) {
  const t = `${tile?.title || ""} ${tile?.snippet || ""}`.toLowerCase();
  const dur = Number(tile?.duration_sec || 0);
  const has = (re) => re.test(t);

  if (has(/(pomodoro|lecture|exam|syllabus|semester|assignment|course(work)?)/))
    return { label: "Learning - Academic Study", confidence: 0.8 };

  if (has(/(interview|resume|cv|ats|mock|case\s*study|guesstimate|pm interview|system design|career)/))
    return { label: "Learning - Career Prep", confidence: 0.8 };

  if (has(/(python|javascript|typescript|react|node|sql|leetcode|dsa|ml|ai|prompt|product management|walkthrough|tutorial)/))
    return { label: "Learning - Skill Learning", confidence: 0.8 };

  if (has(/(news|breaking|headlines|budget|election|geopolitics|market[s]?|finance)/))
    return { label: "Learning - News & Current Affairs", confidence: 0.75 };

  if (has(/(explained|explainer|documentary|how\s*it\s*works|inside|history of)/))
    return { label: "Learning - Explainers & Docs", confidence: 0.75 };

  if (has(/(review|unboxing|vs|comparison|analysis|deep dive)/))
    return { label: "Learning - Reviews & Analysis", confidence: 0.75 };

  if (has(/(meme|gaming|funny|comedy|vlog|shorts|music|song|prank)/))
    return { label: "Entertainment", confidence: 0.75 };

  if (has(/(motivation|motivational|slay|routine|discipline|productivity|habit[s]?|mindset|wellness|fitness|gym|study with me)/))
    return { label: "Motivation & Self", confidence: 0.72 };

  if (dur >= 900) return { label: "Learning - Explainers & Docs", confidence: 0.6 };
  if (dur <= 60) return { label: "Entertainment", confidence: 0.6 };

  return { label: "Custom", confidence: 0.55 };
}

// ========================== FETCH WITH RETRY (429-aware) ==========================
async function fetchWithRetry(url, baseOpts, {
  maxRetries = 4,
  perAttemptTimeoutMs = 6000,   // timeout per HTTP attempt
  initialBackoffMs = 700,       // backoff base
} = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const timeoutSignal = AbortSignal.timeout(perAttemptTimeoutMs);
    const externalSignal = baseOpts?.signal;
    const combinedSignal =
      externalSignal
        ? (AbortSignal.any ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal)
        : timeoutSignal;

    const opts = { ...baseOpts, signal: combinedSignal };
    try {
      const resp = await fetch(url, opts);

      // happy path (not 429 and not 5xx)
      if (resp.status !== 429 && (resp.status < 500 || resp.status > 599)) return resp;

      // final attempt: show full context, then throw
      if (attempt === maxRetries) {
        const body = await resp.text().catch(() => "(no body)");
        console.warn(`[BG] final HTTP ${resp.status}`, {
          statusText: resp.statusText,
          body: body.slice(0, 300),
          headers: {
            reqLimit: resp.headers.get("x-ratelimit-limit-requests"),
            reqRemain: resp.headers.get("x-ratelimit-remaining-requests"),
            reqReset: resp.headers.get("x-ratelimit-reset-requests"),
            tokLimit: resp.headers.get("x-ratelimit-limit-tokens"),
            tokRemain: resp.headers.get("x-ratelimit-remaining-tokens"),
            tokReset: resp.headers.get("x-ratelimit-reset-tokens"),
          }
        });
        throw new Error(`HTTP ${resp.status} ${resp.statusText} — ${body.slice(0, 200)}`);
      }

      // compute wait: Retry-After header (seconds or HTTP-date) or exponential backoff + jitter
      const ra = resp.headers.get("retry-after");
      let waitMs = initialBackoffMs * Math.pow(2, attempt); // 700, 1400, 2800, 5600...
      if (ra) {
        const n = Number(ra);
        waitMs = Number.isFinite(n) ? n * 1000 : Math.max(0, Date.parse(ra) - Date.now());
      }
      waitMs = Math.max(300, waitMs + Math.floor(Math.random() * 250)); // jitter

      const lim = {
        reqLimit: resp.headers.get("x-ratelimit-limit-requests"),
        reqRemain: resp.headers.get("x-ratelimit-remaining-requests"),
        reqReset: resp.headers.get("x-ratelimit-reset-requests"),
        tokLimit: resp.headers.get("x-ratelimit-limit-tokens"),
        tokRemain: resp.headers.get("x-ratelimit-remaining-tokens"),
        tokReset: resp.headers.get("x-ratelimit-reset-tokens"),
      };
      console.warn(`[BG] ${resp.status} retry #${attempt + 1} in ~${waitMs}ms`, lim);

      await new Promise(r => setTimeout(r, waitMs));
      continue;
    } catch (e) {
      lastErr = e;
      if (attempt === maxRetries) throw e;
      const waitMs = initialBackoffMs * Math.pow(2, attempt) + Math.floor(Math.random() * 150);
      console.warn(`[BG] fetch error (attempt ${attempt + 1}) → retrying in ${waitMs}ms`, e?.message || e);
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastErr || new Error("Retries exhausted");
}


// ========================== SIMPLE RPM LIMITER ==========================
const RATE = { rpm: 20, windowMs: 60_000 }; // adjust to your org limits
let callTimes = [];
async function rateLimitWait() {
  const now = Date.now();
  callTimes = callTimes.filter((t) => now - t < RATE.windowMs);
  if (callTimes.length >= RATE.rpm) {
    const waitMs = RATE.windowMs - (now - callTimes[0]) + 50;
    console.warn(`[BG] local rate limit wait ~${waitMs}ms (calls in window=${callTimes.length})`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  callTimes.push(Date.now());
}

// ========================== CONCURRENCY GATE ==========================
let __inflight = Promise.resolve();
function runExclusive(fn) {
  const next = __inflight.then(fn, fn);
  __inflight = next.catch(() => { });
  return next;
}

// ========================== LLM CALL ==========================
  async function classifyWithLlm(items, { signal } = {}) {
    const { provider, apiKey, model } = await getApiConfig();
    console.log("[BG] classifyWithLlm() begin", { provider, model, count: items?.length ?? 0 });
  
    // NEW: manual override
    if (__forceDummy) {
      console.warn("[BG] force_dummy ON — using dummy classifier");
      return items.map((it, index) => {
        const r = classifyOneDummy(it);
        return { index, label: r.label, confidence: r.confidence };
      });
    }
  
    if (!apiKey) {
      console.warn("[BG] no apiKey in storage — using dummy classifier");
      return items.map((it, index) => {
        const r = classifyOneDummy(it);
        return { index, label: r.label, confidence: r.confidence };
      });
    }
  const payload = buildLlmRequest({
    items: items.map((it, i) => ({ ...it, index: i })),
  });

  const messages = [
    { role: "system", content: "You are a strict JSON classifier. Output ONLY valid JSON that matches the schema (an array). No prose." },
    { role: "user", content: JSON.stringify(payload) }
  ];

  try {
    await rateLimitWait();

    const resp = await fetchWithRetry(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal,
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 200,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "TileBatch",
              strict: true,
              schema: { type: "array", items: LLM_ITEM_SCHEMA }
            }
          },
          messages,
          user: "yt-tiles-extension"
        }),
      },
      { maxRetries: 4, perAttemptTimeoutMs: 6500, initialBackoffMs: 700 }
    );

    if (!resp.ok) {
      const body = await resp.text().catch(() => "(no body)");
      console.warn("[BG] non-OK response", { status: resp.status, statusText: resp.statusText, body: body.slice(0, 300) });
      throw new Error(`HTTP ${resp.status} ${resp.statusText} — ${body.slice(0, 200)}`);
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || "";
    let parsed;
    try {
      parsed = JSON.parse(content);
      console.log("[BG] raw model JSON (type):", Array.isArray(parsed) ? `Array(${parsed.length})` : typeof parsed);
    } catch {
      console.warn("[BG] model returned non-JSON (trunc):", String(content).slice(0, 220));
      throw new Error("Model returned non-JSON");
    }

    const arr = await validateLlmBatchOrThrow(parsed);
    const safe = arr.map((r, idx) => ({
      index: Number.isInteger(r.index) ? r.index : idx,
      label: LLM_LABELS.includes(r.label) ? r.label : "Custom",
      confidence: typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : 0
    }));

    console.log("[BG] classifyWithLlm() OK", { outCount: safe.length, sample: safe[0] });
    return safe;
  } catch (e) {
    console.warn("[BG] LLM call failed → fallback:", e?.message || e);
    return items.map((_, index) => ({ index, label: "Custom", confidence: 0.0 }));
  }
}

async function classifyWithGemini(items, { signal } = {}) {
  const { apiKey, model } = await getApiConfig();

  // NEW: manual override
  if (__forceDummy) {
    console.warn("[BG] force_dummy ON — using dummy classifier");
    return items.map((it, index) => {
      const r = classifyOneDummy(it);
      return { index, label: r.label, confidence: r.confidence };
    });
  }

  if (!apiKey) {
    console.warn("[BG] no Gemini apiKey — using dummy");
    return items.map((it, index) => {
      const r = classifyOneDummy(it);
      return { index, label: r.label, confidence: r.confidence };
    });
  }

  const payload = buildLlmRequest({ items: items.map((it, i) => ({ ...it, index: i })) });
  const contents = [{ role: "user", parts: [{ text: JSON.stringify(payload) }] }];

  const responseSchema = {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        index: { type: "INTEGER" },
        label: { type: "STRING", enum: LLM_LABELS },
        confidence: { type: "NUMBER" }
      },
      required: ["index", "label", "confidence"]
    }
  };

  const body = {
    contents,
    generationConfig: {
      temperature: 0,
      response_mime_type: "application/json",
      response_schema: responseSchema
    },
    systemInstruction: { role: "system", parts: [{ text: "Output ONLY valid JSON matching the schema." }] }
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const resp = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(body),
      signal,
    },
    { maxRetries: 4, perAttemptTimeoutMs: 6500, initialBackoffMs: 700 }
  );

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`Gemini HTTP ${resp.status} ${resp.statusText} — ${txt.slice(0, 200)}`);
  }

  const data = await resp.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  let parsed;
  try {
    parsed = JSON.parse(raw);
    console.log("[BG] Gemini raw JSON preview:", JSON.stringify(parsed).slice(0, 220));
  } catch {
    console.warn("[BG] Gemini returned non-JSON (trunc):", String(raw).slice(0, 220));
    throw new Error("Gemini returned non-JSON");
  }

  const arr = await validateLlmBatchOrThrow(parsed);
  return arr.map((r, idx) => ({
    index: Number.isInteger(r.index) ? r.index : idx,
    label: LLM_LABELS.includes(r.label) ? r.label : "Custom",
    confidence: typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : 0
  }));
}

// ===================== messenger-router.js (drop-in) =====================
(() => {
  // internal state for step 7
  let __currentNavId = null;
  let __abortCtl = null;

  // simple registry
  const __handlers = new Map();
  function on(type, handler) {
    __handlers.set(type, handler);
  }
  function off(type) {
    __handlers.delete(type);
  }

  // utility: wrap async handler to keep sendResponse open
  function handleAsync(sendResponse, fn) {
    Promise.resolve()
      .then(fn)
      .then((res) => sendResponse(res))
      .catch((err) => {
        try { sendResponse({ ok: false, error: String(err) }); } catch { }
      });
    return true; // tell Chrome this is async
  }

  // public helpers to access router state if you need from elsewhere
  const MessengerRouter = {
    on, off,
    getNavId: () => __currentNavId,
    setNavId: (id) => { __currentNavId = id; },
    getAbortController: () => __abortCtl,
    abortActive: (reason = "abort") => { if (__abortCtl) try { __abortCtl.abort(reason); } catch { } },
  };
  // expose globally (no modules in MV3 by default)
  // eslint-disable-next-line no-undef
  self.__MessengerRouter = MessengerRouter;

  // ---------------- built-in handlers ----------------

  // PING
  on("PING", async (_msg, sender) => {
    return { ok: true, from: sender?.tab?.id ?? "extension", version: (typeof VERSION !== "undefined" ? VERSION : "dev") };
  });

  // GET_API_CONFIG (expects your getApiConfig() to exist)
  on("GET_API_CONFIG", async () => {
    const cfg = await getApiConfig();
    return { ok: true, ...cfg };
  });

  // NAVIGATION_CHANGED: record nav and abort inflight
  on("NAVIGATION_CHANGED", async (msg) => {
    __currentNavId = msg.navId ?? Date.now();
    if (__abortCtl) {
      try { __abortCtl.abort("nav-change"); } catch { }
    }
    return { ok: true, aborted: true, navId: __currentNavId };
  });

  // CLASSIFY_BATCH:
  // expects: msg.payload: TileMetadata[], msg.navId
  // uses: runExclusive, tileCacheKey, idbGetMany, idbPutMany, idbUpdateLastAccess, getApiConfig, classifyWithLlm, classifyWithGemini, CACHE_TTL_MS
  on("CLASSIFY_BATCH", (msg, sender, sendResponse) =>
    handleAsync(sendResponse, async () => {
      const navId = msg.navId ?? Date.now();
      if (__currentNavId !== null && navId !== __currentNavId) {
        return { stale: true };
      }

      const itemsRaw = msg.payload || msg.items || msg.data || msg.tiles;

      if (!Array.isArray(itemsRaw) || !itemsRaw.every(o => o && typeof o.title === "string")) {
        return { ok: false, error: "Invalid payload: expected array of TileMetadata" };
      }

      const items = itemsRaw.slice(0, 12); // hard cap 12
      console.log("[BG] got batch", { size: items.length, navId });

      return runExclusive(async () => {
        // re-check staleness after queue wait
        if (__currentNavId !== null && navId !== __currentNavId) {
          return { stale: true };
        }

        __currentNavId = navId;
        __abortCtl = new AbortController();

        try {
          console.log("[BG] CLASSIFY_BATCH received", { count: items.length, fromTab: sender?.tab?.id });

          // build cache keys
          const keys = await Promise.all(items.map(tile => tileCacheKey(tile)));

          // read cache
          const cachedMap = await idbGetMany(keys);

          const now = Date.now();
          const results = new Array(items.length);
          const missIdx = [];
          const missItems = [];

          for (let i = 0; i < items.length; i++) {
            const k = keys[i];
            const row = cachedMap.get(k);
            if (row && (now - row.ts) <= CACHE_TTL_MS) {
              results[i] = { index: i, label: row.label, confidence: row.confidence };
            } else {
              missIdx.push(i);
              missItems.push(items[i]);
            }
          }

          console.log("[BG] cache stats", { hits: items.length - missIdx.length, misses: missIdx.length });
          if (missIdx.length === 0) {
            console.log("[BG] provider skipped — all items served from cache");
          }

          // update lastAccess for hits
          const hitKeys = keys.filter((_, i) => !missIdx.includes(i));
          idbUpdateLastAccess(hitKeys).catch(e => console.warn("[BG] cache lastAccess update error:", e?.message || e));

          // provider for misses
          let missResults = [];
          if (missItems.length) {
            const { provider } = await getApiConfig();
            console.log("[BG] CLASSIFY_BATCH provider for misses:", provider, { missCount: missItems.length });

            try {
              if (provider === "gemini") {
                missResults = await classifyWithGemini(missItems, { signal: __abortCtl.signal });
              } else {
                missResults = await classifyWithLlm(missItems, { signal: __abortCtl.signal });
              }
            } catch (e) {
              const aborted = (e?.name === "AbortError" || String(e).includes("AbortError"));
              if (aborted) return { ok: false, aborted: true, error: "aborted" };
              console.warn("[BG] provider error on misses → fallback:", e?.message || e);
              missResults = missItems.map((_, j) => ({ index: j, label: "Custom", confidence: 0 }));
            }
          }

          // staleness check after provider
          if (__currentNavId !== navId) {
            return { stale: true };
          }

          // merge misses + prepare writes
          const toWrite = [];
          for (let j = 0; j < missIdx.length; j++) {
            const out = missResults[j] || { index: 0, label: "Custom", confidence: 0 };
            const at = missIdx[j];
            results[at] = { index: at, label: out.label, confidence: out.confidence };

            const k = keys[at];
            const now2 = Date.now();
            toWrite.push({ key: k, label: out.label, confidence: out.confidence, ts: now2, lastAccess: now2 });
          }

          if (toWrite.length) {
            idbPutMany(toWrite).catch(e => console.warn("[BG] cache write error:", e?.message || e));
          }

          console.log("[BG] classified (cache+llm) batch", { in: items.length, out: results.length });
          // --- sanity check for dummy/classifier results ---
          const ALLOWED = [
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

          for (const r of results) {
            if (!ALLOWED.includes(r.label)) {
              console.warn("[BG] unknown label:", r.label, "→ coercing to Custom");
              r.label = "Custom";
            }
            if (!(typeof r.confidence === "number" && r.confidence >= 0 && r.confidence <= 1)) {
              console.warn("[BG] bad confidence:", r.confidence, "→ defaulting to 0.50");
              r.confidence = 0.50;
            }
          }

          // summary
          const by = {};
          for (const r of results) by[r.label] = (by[r.label] || 0) + 1;
          console.log("[BG] classify summary by label:", by);

          console.log("[BG] replying to CLASSIFY_BATCH", { ok: true, count: results.length, navId });
          return { ok: true, result: results };

        } finally {
          __abortCtl = null;
        }
      });
    }, /* sender */ sender));

  // --------------- wire chrome listener once ---------------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    try {
      if (!msg || typeof msg !== "object" || !msg.type) return;

      const handler = __handlers.get(msg.type);
      if (!handler) return; // ignore unknown messages

      // support both sync and async handler
      const maybePromise = handler(msg, sender, sendResponse);

      // if handler returned true, it already opted into async pattern
      if (maybePromise === true) return true;

      // if it's a promise, keep channel open
      if (maybePromise && typeof maybePromise.then === "function") {
        return handleAsync(sendResponse, () => maybePromise);
      }

      // otherwise treat as sync return
      sendResponse(maybePromise);
    } catch (e) {
      console.error("[BG] router error:", e);
      try { sendResponse({ ok: false, error: String(e) }); } catch { }
    }
  });

  console.log("[BG] MessengerRouter installed");
})();


// --- DEV ADMIN HELPERS: add near the bottom of background.js ---
async function __cacheClearAll() {
  const db = await idbOpen();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readwrite");
    const st = tx.objectStore(CACHE_STORE);
    const req = st.clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  console.log("[BG] cache cleared via __cacheClearAll()");
}

async function __cacheDump(limit = 20) {
  const db = await idbOpen();
  const out = [];
  await new Promise((resolve, reject) => {
    const tx = db.transaction(CACHE_STORE, "readonly");
    const st = tx.objectStore(CACHE_STORE);
    const req = st.openCursor();
    req.onsuccess = (e) => {
      const c = e.target.result;
      if (c && out.length < limit) {
        out.push(c.value);
        c.continue();
      } else resolve();
    };
    req.onerror = () => reject(req.error);
  });
  console.log("[BG] cache dump", out);
  return out;
}

// ---- ensure content script registration (idempotent) ----
async function ensureRegisteredContentScript() {
  try {
    if (!chrome.scripting?.registerContentScripts) return;

    // remove old copy (just in case you renamed files)
    try {
      await chrome.scripting.unregisterContentScripts({ ids: ["yt_cs"] });
    } catch { }

    await chrome.scripting.registerContentScripts([{
      id: "yt_cs",
      matches: ["*://*.youtube.com/*"],
      js: ["content.js"],
      runAt: "document_start",
      allFrames: true,
      persistAcrossSessions: true
    }]);

    console.log("[BG] registered content script yt_cs");
  } catch (e) {
    console.warn("[BG] registerContentScripts failed", e);
  }
}

// on install/update and on SW boot
chrome.runtime.onInstalled.addListener(() => ensureRegisteredContentScript());
ensureRegisteredContentScript();

// optional: on tab updates, nudge injection on already-open YT tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab || !tab.url) return;
  if (!/^https?:\/\/(www\.)?youtube\.com\//i.test(tab.url)) return;
  if (changeInfo.status === "loading") {
    // no-op: registered content script will run at document_start
    console.log("[BG] YT tab loading → content script will run", tabId);
  }
});


// expose to SW console
self.__cacheClearAll = __cacheClearAll;
self.__cacheDump = __cacheDump;


// ========================== DEV EXPORTS ==========================
self.__VER = VERSION;
self.__LLM_LABELS = LLM_LABELS;
self.__INTENT_DEFINITIONS = INTENT_DEFINITIONS;
self.__buildLlmRequest = buildLlmRequest;
self.__validateLlmResponse = __validateLlmResponseLight;
self.__getApiConfig = getApiConfig;
self.idbOpen = idbOpen;
