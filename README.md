# AI-Powered YouTube Intent Filter (Chrome Extension)

Filters YouTube by your intent (Study / Info / Chill / Custom) using an LLM.  
Shows labels on every video (shadow mode) or hides/dims non-matching tiles.

## ✨ Features
- LLM classification per tile (Study/Info/Chill/Custom)
- Shadow mode (labels only) and Filtered mode
- Multi-filter (union/intersection) + confidence threshold
- Scope toggles (Home, Related, Explore, Shorts, Search)
- Fail-open (no breakage if API times out)

## 🔐 Privacy
Sends **only**: `title`, `channel`, `duration_sec`, optional `snippet`, and `page_context` to the LLM provider.  
**Does not send**: cookies, URLs, user IDs, watch history.

## 🛠 Local Install
1. Clone this repo.
2. Open `chrome://extensions` → enable **Developer mode**.
3. Click **Load unpacked** → select this folder.
4. In the extension Options, set your LLM provider & API key.
5. Open YouTube → toggle **Shadow / Filtered / Off** from the header chip.

## 🧪 Dev Tips
- Dev overlay: shows counts (visible/hidden/unclassified).
- Keyboard: `Alt+Shift+F` (Filter on/off), `Alt+Shift+S` (strict/lenient), `Alt+Shift+U` (union/intersection).

## 📄 License
MIT — see [LICENSE](./LICENSE).
