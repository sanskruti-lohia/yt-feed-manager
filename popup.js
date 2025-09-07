// popup.js
async function getState() {
    const s = await chrome.storage.local.get([
      "policy_enabled",
      "policy_mode",
      "policy_filterSemantics",
      "force_dummy"
    ]);
    return {
      enabled: s.policy_enabled ?? true,
      mode: s.policy_mode || "strict",
      sem: s.policy_filterSemantics || "union",
      forceDummy: !!s.force_dummy,
    };
  }
  
  function setBtnText({ enabled, mode, sem }) {
    document.getElementById("toggle").textContent = `Filter: ${enabled ? "On" : "Off"}`;
    document.getElementById("mode").textContent = `Mode: ${
      mode === "labels" ? "Labels" : mode === "lenient" ? "Lenient" : "Strict"
    }`;
    document.getElementById("sem").textContent = `Semantics: ${
      sem === "intersection" ? "Intersection" : "Union"
    }`;
  
    // status strip
    document.getElementById("sEnabled").textContent = enabled ? "On" : "Off";
    document.getElementById("sMode").textContent = mode;
    document.getElementById("sSem").textContent = sem;
  }
  
  async function syncUI() {
    const st = await getState();
    setBtnText(st);
    const fd = document.getElementById("forceDummy");
    if (fd) fd.checked = st.forceDummy;
  }
  
  async function activeYouTubeTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !/^https?:\/\/(www\.)?youtube\.com\//i.test(tab.url || "")) return null;
    return tab;
  }
  
  // After any change, nudge the content page to re-apply policy (belt + suspenders)
  async function reapplyOnActiveTab() {
    const tab = await activeYouTubeTab();
    if (!tab) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "REAPPLY_POLICY" });
    } catch {
      // content may not be injected yet; this is non-fatal
    }
  }
  
  document.getElementById("toggle").onclick = async () => {
    const st = await getState();
    await chrome.storage.local.set({ policy_enabled: !st.enabled });
    await syncUI();
    await reapplyOnActiveTab();
  };
  
  document.getElementById("mode").onclick = async () => {
    const st = await getState();
    const next = st.mode === "labels" ? "strict" : st.mode === "strict" ? "lenient" : "labels";
    await chrome.storage.local.set({ policy_mode: next });
    await syncUI();
    await reapplyOnActiveTab();
  };
  
  document.getElementById("sem").onclick = async () => {
    const st = await getState();
    const next = st.sem === "union" ? "intersection" : "union";
    await chrome.storage.local.set({ policy_filterSemantics: next });
    await syncUI();
    await reapplyOnActiveTab();
  };
  
  document.getElementById("modal").onclick = async () => {
    const tab = await activeYouTubeTab();
    if (!tab) return;
    // nudge content page to open the intent modal (your content defines this)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => { window.__yt_openIntentModal?.(); }
    });
  };
  
  // NEW: Save "force dummy" from popup (optional convenience)
  document.getElementById("save").onclick = async () => {
    const fd = document.getElementById("forceDummy").checked;
    await chrome.storage.local.set({ force_dummy: fd });
    try { await chrome.runtime.sendMessage({ type: "CONFIG_CHANGED" }); } catch {}
    await syncUI();
    await reapplyOnActiveTab();
  };
  
  syncUI();
  