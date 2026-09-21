# Attention 0.30.3 — local meaning search and focused reading-list passages

- Add optional on-device multilingual passage search using multilingual-e5-small (ONNX q8). It is off by default, downloads about 135 MB of pinned public model data only after enabling, and keeps article/profile text on the device. Runtime JavaScript and WASM are bundled. No API key is required.
- Let a semantic body-text match support a selective reading recommendation when lexical matching missed the connection. Name the matched goal or interest without increasing quality/novelty scores or claiming AI verification. This remains experimental retrieval, not a guarantee of usefulness.
- Split reading lists into individual source descriptions, retaining introductions, parent entries and trailing caveats without absorbing sibling resources. Exclude subscription prompts. Local and API selection use the same structural boundaries; API instructions distinguish source descriptions from the unread linked papers.
- Navigate selected passages in page order. Close the previous passage panel when reopening the article assessment or starting AI. Count shared context once when estimating reading time and say when selected passages cover most of the article. Invalidate older cached evaluations.
- Strengthen the shared profile prompt for ChatGPT, Claude, Gemini, Copilot and Perplexity: use accessible evidence, separate goals/interests/learning/knowledge, and do not treat assistant replies or pasted sources as demonstrated user knowledge. Existing profiles are not rewritten.
- Add the offscreen permission and local WASM execution needed for on-device inference. Model download requests go to Hugging Face; inference does not send article or profile text there. See [local semantic search](docs/LOCAL_SEMANTIC_SEARCH.md) for privacy boundaries and limitations.
- GitHub release only. No Chrome Web Store upload, withdrawal or review changes.

Validation: 856 unit/integration tests verified; one test exceeded its time limit during the combined run and passed with the full 29-test card suite on an isolated rerun. TypeScript, ESLint and production builds passed. Six browser scenarios verified article actions and local/API passage behavior; the long-context case passed after correcting a test that assumed local matches always exist. API responses are fixtures, not live generations. A separate browser check with the actual local model and a synthetic Russian profile selected two focused English resource entries, excluded unrelated neighbors and subscription text, matched card/panel counts, and closed the old panel when reopening the card. This is regression coverage and a smoke check, not a broad quality benchmark.

# Attention 0.30.2 — your context, your choice

- Replace the introductory checklist with a short invitation to bring your AI context into Attention and choose what to read on your own terms. The primary action is “Take my profile with me →”.
- Follow the reviewed profile with “Now let’s protect your data” before password creation.
- Update the welcome and password introduction in all nine interface languages. Keep assistant selection, editable review, encryption and optional setup in their existing order.
- GitHub release only; no Chrome Web Store upload or review changes.
- License the current original software source under the unmodified PolyForm Shield License 1.0.0. Update the package metadata, README, NOTICE and future build banners consistently.
- Previously granted licenses remain in effect. Published v0.30.0 and v0.30.1 release files, including the 0.30.1 Chrome Web Store submission, keep their MPL-2.0 license.
- The software-only scope and third-party licenses are unchanged. Books, logos and promotional materials remain outside this grant.

Validation: 834 unit/integration tests verified after updating an obsolete welcome-screen assertion; TypeScript, ESLint and the production build passed. Eleven browser scenarios passed, covering first-run setup, language switching, assistant handoffs, profile review, encrypted saving, unlocking, migration, restart and data erasure. Assistant replies are test fixtures, not live model generations. No new extension permissions.

# Attention 0.30.1 — passages on demand and simpler optional setup

- Always offer matched passages in the article card, including when the old highlight preference is absent or off. Remove that switch from Settings; highlights and the passage panel still appear only after the reader clicks the passage button. AI display diagnostics now record the actual matching result.
- Simplified Privacy and data: keep the local-only control and a short AI-sharing explanation visible, collapse data-sharing details, website permissions and support reports, remove the public-session status. Updated English, German and Russian copy; report downloads and confirmed data deletion remain available.
- Recognize article headings whose hyphenation or quotation marks differ from page metadata. This restores title-hover cards in Substack's reader and keeps analysis on the open article rather than the background feed.
- After the profile and password are saved, offer optional Readwise, Obsidian and browser-history setup.
- Follow with optional AI-key setup: explain its purpose, link directly to Vercel AI Gateway key creation, and accept the key in a masked field.
- Both steps can be skipped. Skipping AI leaves the current privacy and AI settings unchanged; connecting stores the key encrypted and explicitly enables cloud AI. Setup itself makes no AI request.
- Resume an unfinished optional step after closing the tab or restarting the browser. Existing profiles are not forced through setup again.
- No additional extension permissions. AI analysis still starts only on request and uses the reader’s own key.
- Removed the non-working Apple Passwords autofill suggestion from password creation and unlocking, including its translations and setup instructions.

Validation: 834 unit/integration tests verified (one timeout passed on an isolated rerun); TypeScript, ESLint and the production build passed. Eleven browser scenarios passed, covering local and AI passages with the legacy preference off or absent, privacy settings, title detection, first-run activation, encrypted saving, restart and cross-tab deletion. Three browser scenarios that initially exceeded their time limits passed on a separate rerun. AI replies in browser tests are fixtures, not live model generations. No new extension permissions.

# Attention 0.30.0 — profile first, five assistant choices

- Create and review your profile before choosing the vault password. First setup stays in a dedicated extension tab; the draft remains in that tab’s memory until the encrypted save. Returning from the password step preserves the draft; closing or reloading the setup tab discards it.
- Choose “Let ChatGPT introduce me”, “Let Claude introduce me”, “Let Gemini introduce me”, “Let Copilot introduce me” or “Let Perplexity introduce me”. Provider-specific prompts, import attribution and the copy/open/return flow support all five services. Attention does not connect to their accounts or read chat history.
- Restored the assistant-page notice explaining that the prompt was copied, where to paste it and how to return the full response to Attention. The first-run notice works before a vault exists and stores only temporary non-personal coordination flags.
- Simplified the welcome screen and combined all interface languages into one selector.
- Password fields use standard autocomplete attributes. The 12-character minimum is unchanged.
- The passage panel always shows “Save to Readwise”; it stays gray and disabled until connected.
- Original software code is licensed under MPL-2.0. License and third-party notices ship with the extension. Books, logos and promotional materials are outside this grant.

No new extension permissions. AI analysis still uses the user’s own Vercel AI Gateway key and starts only on request.

Validation: 809 unit/integration tests and 10 browser scenarios passed. TypeScript, ESLint and the production build passed. Browser checks cover first-run activation, assistant handoffs, encrypted profile saving, migration, locking, restart and reset. Assistant replies in tests are fixtures, not live model generations.

# Attention 0.29.1 — English, German and Russian priority

- English, Deutsch and Русский are available directly on the first onboarding screen and during profile setup. The selection updates the interface and is saved inside the encrypted vault after creation; other interface languages remain available.
- German local matching recognizes common inflections, selected topic equivalents and task vocabulary. Passage selection recognizes German examples, instructions and caveats and keeps necessary neighboring context.
- AI explanations follow the selected interface language. Source quotations and passage IDs retain the original text. Changing the language invalidates earlier cached evaluations without making an automatic AI request.
- Local matching remains a bounded lexical heuristic; these changes do not provide general translation or prove recommendation quality on real German usage.

Validation: 770 unit and integration tests passed; TypeScript passed. Browser onboarding checks passed for language switching, persistence, profile activation and profile deletion.

# Attention 0.29.0 — clearer setup and contextual AI passages

The first launch now demonstrates why a personal profile changes a reading recommendation, then guides the reader through ChatGPT or Claude, an editable profile review and a return to the original article. Existing profiles remain usable.

- AI now selects prepared passage windows with context by ID, correcting the path that rejected otherwise useful passages. Relevance and confidence use a consistent 0–1 scale.
- A downloadable diagnostic report shows passage counts and rejection stages without article text, profile content or credentials. Nothing is sent automatically.
- Short local passages keep neighboring context. Passage and section highlights use one consistent style.
- The main card uses green, neutral gray or red according to the recommendation, with a concise reason.
- Store screenshots and the demonstration video show the current interface.

Local matching remains heuristic. AI sampling can omit parts of long articles; partial coverage is marked. No additional permissions were introduced.

Validation: TypeScript and ESLint passed; 751 unit tests passed. Browser checks cover onboarding, article actions, local/AI passages, partial assessments, encryption, migration and locking.
