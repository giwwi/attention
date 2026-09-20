# Attention 0.30.0 — profile first, five assistant choices

- Create and review your profile before choosing the vault password. First setup stays in a dedicated extension tab; the draft remains in that tab’s memory until the encrypted save. Returning from the password step preserves the draft; closing or reloading the setup tab discards it.
- Choose “Let ChatGPT introduce me”, “Let Claude introduce me”, “Let Gemini introduce me”, “Let Copilot introduce me” or “Let Perplexity introduce me”. Provider-specific prompts, import attribution and the copy/open/return flow support all five services. Attention does not connect to their accounts or read chat history.
- Restored the assistant-page notice explaining that the prompt was copied, where to paste it and how to return the full response to Attention. The first-run notice works before a vault exists and stores only temporary non-personal coordination flags.
- Simplified the welcome screen and combined all interface languages into one selector.
- Password fields support standard autofill attributes and macOS system Passwords guidance. No password is saved to a manager automatically; the 12-character minimum is unchanged.
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
