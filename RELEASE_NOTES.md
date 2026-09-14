# Attention 0.29.1 — English, German and Russian priority (not yet published)

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
