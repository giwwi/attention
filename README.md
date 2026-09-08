# Attention

**A local-first Chrome extension that estimates whether an article is worth your attention right now.**

[Website](https://giwwi.github.io/attention/) · [Download the extension](https://giwwi.github.io/attention/releases/attention-0.25.1.zip)

![Attention demo](docs/attention-demo.gif)

Attention combines the article, your personal profile, and your current goal to suggest **Read, Skim, Save, or Skip**. The decision lives in a card on the article page. The extension popup is a short launcher with access to **Saved** and **Settings**; it does not show or calculate a second assessment.

The **Utility Score** is an estimate on a 0–100 scale, shown as **/100** in the card's details. It is not a probability that the article will be useful or correct. Article and passage reading durations are estimates, not measured time savings. Later feedback can calibrate future predictions locally.

A saved personal profile is required before cards appear. Start with a profile prepared in ChatGPT or Claude using context you have already shared, review it, and save it locally. Attention does not access your chat history or connect to either account. Local article evaluation needs no API key or analytics. An optional Vercel AI Gateway connection can provide a deeper analysis with a model selected by the user; `google/gemini-2.5-flash-lite` is the default suggestion.

## Try it in Chrome

1. Download and unzip the [version 0.25.1](https://giwwi.github.io/attention/releases/attention-0.25.1.zip).
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the unzipped `attention-extension` folder.
5. Pin **Attention**, open an article, and click the extension icon.
6. On first use, create your local vault with a password of at least 12 characters. Keep the password: Attention cannot recover it. Then choose **ChatGPT** or **Claude**, follow the handoff instructions, paste the returned profile, review it and choose **Use this profile**. The saved profile enables article and feed cards in already open tabs. Until then, Attention does not extract articles, track reading, add title launchers or show recommendation cards. A detailed manual profile is available under **Other ways**; the short AI questionnaire is offered only to existing users.

Deleting the profile disables article and feed cards again. An old “onboarding complete” flag, an unfinished import, empty profile or format preferences alone does not enable them. Existing saved profiles with personal context continue to work.

Unlock the vault when you start a new browser session. **Lock** closes access to Attention's personal data until you unlock again. If you forget the password, the reset option deletes the local vault and lets you start over; it cannot recover the old data.

The article card shows one recommendation, a short reason and the estimated reading time for the whole article. Its actions are **Go to passages** (when matching potentially new passages are found and passage highlighting is enabled) and **Save for later**. The first highlights the actual text, scrolls to the first passage and closes the large card. The passage panel lets you move between matches. Saving adds the whole article to the local reading list and shows **Saved ✓** without closing the card. There are no Read, Skim or Skip buttons on an already open article.

Your scenario and current goal appear above the recommendation. Expand that context row to edit them, then choose **Apply**. There is no time-budget selector: the displayed duration estimates the article’s length rather than asking you for another setting. Applying context updates the local assessment without requesting external AI. The AI action and analysis status remain visible. **Why this assessment** is collapsed by default and contains the Utility Score, explanation and recommended sections when available.

To reopen the card, click the extension icon and choose **Evaluate this page**. The popup also opens your saved articles and settings for language, profile, sources, AI, and privacy. On the article itself, Tab to the **Attention** button beside its title and press Enter or Space. Focus moves to a visible action; Tab reaches the other controls and expandable details. Escape closes the card and returns focus to the title button. Hovering over the title opens the same card. On a protected or unsupported page, the launcher explains that you need an accessible article.

To save a potentially new passage to Readwise, enable **Settings → Highlight new passages** and connect Readwise through the personalization sources. Open the Attention card beside the article title, choose **Go to passages**, then **Save to Readwise** in the passage panel. The panel is available when matching passages are found; its Readwise button appears when Readwise is connected. Marking a passage **New to me** or **Already knew** keeps the selected passage open so you can save it afterward. **Save for later** adds the whole article to Attention's local reading list.

No API key is required for the local evaluation. To configure optional AI analysis, open **Settings → AI**, paste a Vercel AI Gateway key, and keep the suggested Gemini model or enter another `provider/model` identifier. Choose **Check with AI** directly on the article card. The same visible row shows **Checked with AI** after success or lets you retry after an error. If AI is not connected or local-only mode is enabled, the disabled control explains why it is unavailable. Opening the card, popup, or details does not itself send an AI request.

## What it does

- Evaluates an article relative to your current **Work, Learn, Explore, or Relax** context.
- Explains the recommendation in terms of the current scenario, such as relevance for work or taste and effort for relaxation.
- Shows lightweight previews on material links in feeds and one article card with details available on request.
- Lets you save an article or jump directly to potentially new passages.
- Asks whether the material was worth the time and calibrates later predictions locally.
- Optionally uses local evidence from browser history, Readwise and Obsidian. Notion requires a separately configured OAuth service and is unavailable in the standard release.
- Offers setup, profile controls, decisions, reading plans, and feedback in English, Russian, German, Spanish, French, Italian, Simplified Chinese, Arabic, and Hindi. Article text, quotations, and imported personal content keep their original language.

## Privacy model

Attention is local-first. Read the [privacy policy](https://giwwi.github.io/attention/privacy.html) for the complete data inventory and service boundaries.

- Local evaluation works without an account, analytics or AI. Stored article text and URLs, profile, goals, decisions, feedback, saved items, reading memory, history-derived data and source indexes are encrypted in your Chrome profile. Reading time and scroll progress support local feedback prompts.
- Optional browser-history import derives local encounter fingerprints, visit statistics, topics and source hostnames. Attention does not retain the raw history list and attempts to release history permission after import.
- **Local only** blocks cloud AI and is on by default. It does not block Readwise or other connected services when you explicitly use them.
- An explicit AI article check sends Vercel AI Gateway and your selected model provider the article, current goal and selected profile, knowledge and derived history signals. AI-assisted profile creation instead sends your short self-description answers. The complete profile, raw history and imported note/highlight bodies are not sent to AI. Providers apply their own data policies and account terms.
- Readwise import authenticates directly with Readwise using your token. **Save to Readwise** sends your selected quotation, article title, optional author, cleaned source URL and timestamp. Obsidian reads the folder you choose locally. Notion connection is unavailable in the standard release without a separately configured OAuth service.
- The vault encrypts personal records and connected keys/tokens with AES-256-GCM. A random data key is wrapped using a key derived from your password with PBKDF2-SHA-256. The password is not stored or sent to a server. The unlocked key is held in Chrome's memory-only session storage, restricted to trusted extension contexts, until you lock the vault or the browser session ends. Persistent storage outside the encrypted records contains non-personal vault and coordination metadata.
- Unlocking permits Attention to read the data needed for its features and to show relevant context on the page. Optional AI and source requests still send the data described above; vault encryption protects stored copies and does not encrypt the original website, original source files, or data being processed by a chosen provider.
- Optional pilot and diagnostic exports are created only when you request them and are not shared automatically. The diagnostic profile export contains counts and structural checks, excluding personal field values, goals, titles, URLs, quotations, note text and credentials. Downloaded exports are outside the vault.
- Obsidian folder access is held only in the active extension page's memory. After closing that page, locking the vault or restarting Chrome, choose the folder again for the next synchronization. Imported notes remain encrypted in the vault.
- **Delete all Attention data** removes local data and connected keys and invalidates unfinished imports. It does not erase original notes, previously saved Readwise highlights, downloaded exports or data already processed by external providers.
- Attention does not sell data or use it for advertising or credit decisions. Its use and transfer of information received from Google APIs adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

When an existing installation first creates its vault, Attention copies its older local records and source libraries into encrypted storage, reads them back to verify the copy, and then removes the old stored copies and folder handles. If migration fails, it keeps access locked and retains the remaining originals so the operation can be retried.

The current prototype requests access to ordinary web pages so it can show title previews and end-of-reading feedback without opening the popup. Chrome describes this broadly as permission to “read and change your data on all websites.” Attention uses it only to extract the current page and render its own isolated UI after you save a profile. You can restrict site access in Chrome's extension settings.

## Build from source

Requirements: Node.js 22+ and pnpm 9+.

```bash
pnpm install
pnpm check
```

The production extension is created in `dist/`:

```bash
pnpm build
```

Load `dist/` through `chrome://extensions` → **Load unpacked**.

For an existing unpacked installation, rebuild and click **Reload** in `chrome://extensions`, then refresh open article tabs. Version 0.25.1 requires a saved profile before cards activate.

Useful commands:

```bash
pnpm test          # unit and integration tests
pnpm check:e2e     # browser-level extension tests
pnpm preview       # local UI preview on http://127.0.0.1:4173
pnpm check:real    # extraction checks against current HN links
pnpm check:corpus  # separate authored quality/novelty challenge; not a user study
```

## How it works

Mozilla Readability extracts the article. A local analyzer calculates the recommendation from inspectable heuristics. The optional AI analyzer returns structured evidence, but the final Utility Score and product policy remain in code. Results, decisions, and later usefulness ratings are connected by canonical URL in a bounded local memory.

The core loop is:

```text
Current context + content → predicted utility → decision → actual utility
```

See [PRODUCT.md](PRODUCT.md) for the product model, architecture, privacy boundaries, scoring assumptions, and known limitations.

## Voluntary pilot (prepared, not yet conducted)

Settings → **Additional options** → **Voluntary pilot · RU / EN** opens a separate opt-in experiment for Work, a 15-minute budget and technical articles. First make your own choice from the title and current goal; then see the local Attention assessment. Choose an unread article whose Attention result you have not already seen. Optional reviews, random Skip-audit invitations and explicit JSON export stay local. Pilot feedback does not train the main analyzer. No invitations or results are sent automatically.

The [proposed protocol](experiments/PILOT_PROTOCOL_RU.md) defines the baseline, false-Skip denominators, useful recommendations, timing and limitations. The [authored development corpus](experiments/corpus/seed-v1.json) has separate quality and novelty labels; it is not a human-validated test set or evidence of product-market fit.

Evaluation records now retain raw and displayed scores with analyzer/scoring/calibration versions. Calibration uses compatible raw feedback within the same scenario; legacy display-only records remain visible but do not train the model. Explicit hard Skip constraints survive calibration. Local knowledge matching preserves numerical and factual distinctions, conservatively abstaining when statements differ.

Source synchronizations use persistent per-source revisions: a newer sync or disconnect invalidates unfinished work across extension pages. Obsidian cache reuse requires the same currently held folder handle; the handle is never persisted. Notes/pages and their search indexes are stored together as encrypted vault records. Notion reports partial indexing, and absence from a search result alone does not establish deletion.

## Status

Attention is an early functional prototype. It has not been published to the Chrome Web Store and its recommendations are estimates—not fact-checking or a guarantee that a source is correct. Feedback and reproducible bug reports are welcome through GitHub Issues.
