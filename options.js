// options.js
const $ = (id) => document.getElementById(id);

async function load() {
  const s = await chrome.storage.local.get([
    "api_provider", "model", "api_key", "api_keys",
    "provider", "apiKey", "force_dummy"
  ]);

  const provider = s.api_provider || s.provider || "openai";
  const model = s.model || (provider === "gemini" ? "gemini-1.5-flash" : "gpt-4o-mini");
  const directKey = s.api_key || s.apiKey || "";
  const mappedKey = (s.api_keys && s.api_keys[provider]) || "";
  const apiKey = directKey || mappedKey || "";
  const forceDummy = !!s.force_dummy;

  $("provider").value = provider;
  $("model").value = model;
  $("apiKey").value = apiKey;
  $("forceDummy").checked = forceDummy;
}

async function save() {
  const provider = $("provider").value;
  const model = $("model").value.trim();
  const key = $("apiKey").value.trim();
  const forceDummy = $("forceDummy").checked;

  const api_keys = {};
  if (key) api_keys[provider] = key;

  // options.js — add inside save(), before set():
  console.log("[OPT] saving", {
    provider, model, keyPresent: !!key, forceDummy
  });

  await chrome.storage.local.set({
    api_provider: provider,
    model,
    api_key: key || null,
    api_keys,
    provider,
    apiKey: key || null,
    force_dummy: forceDummy
  });

  // after set():
  const roundtrip = await chrome.storage.local.get([
    "api_provider", "model", "api_key", "api_keys", "provider", "apiKey", "force_dummy"
  ]);
  console.log("[OPT] roundtrip read", roundtrip);

  // keep this
  try { await chrome.runtime.sendMessage({ type: "CONFIG_CHANGED" }); } catch { }
  console.log("[OPT] sent CONFIG_CHANGED");


  await chrome.storage.local.set({
    // preferred keys
    api_provider: provider,
    model,
    api_key: key || null,
    api_keys,
    // legacy compatibility (if BG still reads these)
    provider,
    apiKey: key || null,
    // manual override
    force_dummy: forceDummy
  });

  // nudge BG to drop any cache
  try { await chrome.runtime.sendMessage({ type: "CONFIG_CHANGED" }); } catch { }

  $("status").textContent = "Saved ✓";
  setTimeout(() => ($("status").textContent = ""), 1200);
}

$("save").addEventListener("click", save);
load();
