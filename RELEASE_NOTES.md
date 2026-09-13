# Attention 0.28.1 — actionable reading recommendations

The article card again gives a reading direction when evidence is incomplete, instead of replacing most recommendations with “Not sure yet.”

- Partial AI assessments retain Read, Skim or Skip, with a visible preliminary note and capped confidence. Russian cards show the model’s concrete explanation of the article’s relevance.
- Local assessment considers all relevant profile goals, learning topics and interests. An explicit current task has priority.
- Related topics lead to selective reading; no detected relation leads to a tentative skip. Missing user context remains distinct from low usefulness.
- Article assessment and passage selection share topic matching. Old cached assessments are recalculated, and previous score versions are excluded from new calibration fits.

No new permissions, network destinations, automatic AI requests or data migrations are introduced.

Validation: 688 unit/integration tests and four isolated browser scenarios passed during implementation. Browser AI responses are mocked; these checks do not establish recommendation quality on users’ articles.
