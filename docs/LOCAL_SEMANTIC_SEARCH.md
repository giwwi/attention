# Experimental local passage search

This source build adds an optional **Settings → Find passages by meaning** switch. It is off by default. It supplements the ordinary local evaluation; cloud analysis still starts only on request. English, German and Russian profiles can be compared with passages in another language.

Enabling downloads 135,392,183 bytes of public model data from Hugging Face (multilingual-e5-small, ONNX q8). Each of the five files is pinned by revision and SHA-256. Installation is marked complete only after all files are checked and the model loads. A cancelled or failed installation is not enabled. The model is retained across browser restarts; **Remove model** removes its download. No API key is involved.

The model runs in a dedicated worker inside an extension offscreen document, using the bundled ONNX WASM runtime. Runtime JavaScript/WASM is never downloaded from a CDN. Inference has remote model loading disabled. Model cache contains only public weights/configuration/tokenizer; profile text, article text and embeddings are not written there. Embeddings are cached in bounded memory and discarded when the worker closes. Disabling, locking or erasing private data cancels work and closes the worker. An idle worker closes after three minutes.

The article card appears using the ordinary local evaluation. Semantic selection arrives asynchronously and updates the current local passages. When it finds a body-text connection that the heuristic missed, the card recommends starting with the passages and names the matched goal or interest. This supports selective reading; it does not increase the utility, quality or novelty scores. It does not replace a cloud result or a result for a changed profile, goal or article. If model execution fails or times out, the ordinary selection remains available.

## Selection

- Query embeddings come from the current intent and distinct active goals, learning areas, interests and supported leisure preferences. They are not filtered by literal overlap with the article first. At most five entries from each profile category are used. Scenario and confidence provide a small ranking adjustment (up to 0.04); an explicit current intent keeps full weight.
- Every eligible paragraph or individual resource-list entry can be a candidate. Shared list introductions supply context rather than competing as standalone selections. Long paragraphs are split into overlapping model windows. For exceptionally long articles, up to 160 windows are sampled across the full article and the selection is marked partial.
- Similarity ranks candidates. The initial absolute threshold is 0.80; candidates must also be within 0.035 of the best surviving score. These are experimental retrieval thresholds, not probabilities or validated usefulness scores.
- Explicit low-value topics can veto a candidate; supported leisure dislikes also apply in Relax and Explore. Existing evidence of already-known content is retained. Selected paragraphs expand into neighboring context windows. Resource-list entries retain their structural introduction, parent entry and trailing caveats without absorbing sibling entries. Distinct entries can share context without being merged into an entire section. Selection is deduplicated to at most three passages, then displayed in page order.
- Semantic results remain `source: local`, `knowledge: unknown`. They never claim AI verification or proved novelty.

Semantic similarity does not establish truth, agreement, novelty or usefulness. Opposing statements can be close in embedding space. Real-reader feedback and a broader EN/DE/RU corpus are still needed before treating this feature as a default.

## Initial verification

A disposable Chrome profile with synthetic reading interests exercised the actual bundled model, settings, article card and encrypted-vault lifecycle. Inference was also run with the browser offline and generated no HTTP requests. A small three-language retrieval example ranked factual-verification passages above unrelated gardening passages. It also exposed expected limitations: opposite advice can have nearly the same similarity, a nearby topic can score highly, and a relevant cross-language example can fall below the initial threshold. This is a smoke check, not a quality benchmark.

Cold loading and a small inference batch took roughly 6–10 seconds on the development machine. The ordinary card is available first; a longer article can take more time, and inference times out after two minutes. Unit checks cover context retention, empty results, exclusions, whole-article sampling and ignoring a late semantic response after profile changes or a cloud result.

## Profile prompt

All supported assistants now receive the same strengthened prompt. It asks for accessible evidence only; separates goals, interests, learning and demonstrated knowledge; excludes the assistant's own answers and pasted sources as proof of user knowledge; avoids broad exclusions; and asks for concise, self-contained goals and knowledge with relevant conditions. The JSON schema and import/review flow remain compatible. Existing profiles are not rewritten automatically.

## Dependencies

Transformers.js is pinned to 3.8.1. Its published declaration files contain unrelated processor/Float16 type errors, so TypeScript skips checking third-party declaration files; application source remains strictly checked. See `SEMANTIC_MODEL_NOTICES.txt` and generated `THIRD_PARTY_NOTICES.txt` in the extension for model/runtime attribution.

Available in GitHub release 0.30.3. This release is not submitted to the Chrome Web Store.

## Reading-list regression checks

Regression fixtures reproduce nested source lists, unrelated neighboring entries, subscription prompts and qualifications after a list. They cover local selection, fixed AI passage windows, native and fallback highlights, reopening the panel and preserving links. AI responses in these checks are authored fixtures, not live generations.

A browser check with the actual local model and a synthetic Russian profile selected two focused English source descriptions, excluded unrelated neighbors and subscription text, and verified that card/panel counts agree. The previous panel closed when reopening the assessment. This is a targeted regression check, not validation against the user’s private profile or a representative article corpus.
