# Attention 0.29.0 — clearer setup and contextual AI passages

The first launch now demonstrates why a personal profile changes a reading recommendation, then guides the reader through ChatGPT or Claude, an editable profile review and a return to the original article. Existing profiles remain usable.

- AI now selects prepared passage windows with context by ID, correcting the path that rejected otherwise useful passages. Relevance and confidence use a consistent 0–1 scale.
- A downloadable diagnostic report shows passage counts and rejection stages without article text, profile content or credentials. Nothing is sent automatically.
- Short local passages keep neighboring context. Passage and section highlights use one consistent style.
- The main card uses green, neutral gray or red according to the recommendation, with a concise reason.
- Store screenshots and the demonstration video show the current interface.

Local matching remains heuristic. AI sampling can omit parts of long articles; partial coverage is marked. No additional permissions were introduced.

Validation: TypeScript and ESLint passed; 751 unit tests passed. Browser checks cover onboarding, article actions, local/AI passages, partial assessments, encryption, migration and locking.
