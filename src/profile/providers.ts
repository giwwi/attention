import type { ExternalProfileSource } from './schema';

export interface ProfileProvider {
  id: ExternalProfileSource;
  name: string;
  prompt: string;
}

const schemaExample = `{
  "schema_version": "2.0",
  "generated_at": "ISO-8601 timestamp",
  "source": "PROVIDER",
  "interests": [
    { "topic": "string", "strength": 0.0, "confidence": 0.0 }
  ],
  "goals": [
    {
      "goal": "string",
      "priority": "low | medium | high",
      "status": "active | paused | completed",
      "confidence": 0.0
    }
  ],
  "expertise": [
    {
      "topic": "string",
      "level": "beginner | intermediate | advanced | expert",
      "confidence": 0.0,
      "basis": ["short non-sensitive reason"]
    }
  ],
  "demonstrated_knowledge": [
    {
      "topic": "string",
      "statement": "specific concept or claim the user appears to know",
      "evidence_type": "demonstrated | explicitly_stated | inferred",
      "confidence": 0.0,
      "basis": ["short non-sensitive reason"]
    }
  ],
  "learning_areas": [
    {
      "topic": "string",
      "focus": "specific aspect being learned or null",
      "confidence": 0.0
    }
  ],
  "uncertainties": [
    {
      "topic": "string",
      "note": "what cannot be established about the user's knowledge",
      "confidence": 0.0
    }
  ],
  "content_preferences": {
    "preferred_depth": "low | medium | high",
    "novelty_preference": "low | medium | high",
    "avoid_repetition": true,
    "preferred_formats": [],
    "confidence": 0.0
  },
  "leisure_profile": {
    "status": "available | insufficient_data",
    "preferences": [
      {
        "kind": "genre | format | creator | recreationalTopic | dislike",
        "category": "specific leisure preference",
        "preference": "unknown | low | medium | high",
        "confidence": 0.0,
        "evidence_type": "demonstrated | explicitly_stated | inferred",
        "basis": "short non-sensitive reason"
      }
    ],
    "novelty_preference": "familiar | balanced | novel | null",
    "effort_preference": "low | medium | high | null",
    "typical_session_minutes": null,
    "confidence": 0.0
  },
  "low_value_topics": [
    { "topic": "string", "confidence": 0.0 }
  ]
}`;

function buildPrompt(providerName: string, source: string): string {
  return `Create a portable profile for me using only information you actually know from our previous interactions or stored context in ${providerName}.

Return ONLY valid JSON. Do not use Markdown or add commentary. Follow this schema exactly, replacing PROVIDER with "${source}":

${schemaExample}

Rules:
1. Do not invent facts. If you do not know something, omit it or use an empty array.
2. Distinguish explicit knowledge from inference through the confidence values. Use numbers from 0 to 1.
3. Represent uncertainty explicitly and keep confidence conservative.
4. Separate interest, expertise, and concrete knowledge. Interest or repeated questions about a topic are NOT evidence that I know it.
5. Put a concrete item in demonstrated_knowledge only when I explained, applied, corrected, or explicitly stated it. Prefer demonstrated over explicitly_stated, and explicitly_stated over inferred.
6. Expertise is only a broad prior. Never infer that I know a specific fact merely because I have advanced expertise in its domain.
7. Use learning_areas for topics I am actively trying to understand. High interest plus repeated requests for explanation usually belongs here, not in demonstrated_knowledge.
8. Record genuine ambiguity in uncertainties rather than guessing. Keep confidence conservative.
9. Include only information useful for evaluating whether future content is worth my attention: interests, active goals, broad expertise, concrete knowledge, learning areas, content preferences, leisure preferences, and low-value topics.
10. Do not create a personality or psychological profile.
11. Exclude sensitive or unnecessary personal information, including health data, religion, political affiliation, sexual life or orientation, precise location or address, financial account information, passwords, account identifiers, identification numbers, and private family information.
12. Keep each text field concise. Do not include conversation excerpts.
13. Before finalizing the profile, make a separate evidence pass devoted only to leisure and entertainment. Actively look for supported preferences in films, series, YouTube or other videos, documentaries, fiction and reading for pleasure, games, podcasts, humour, music, recreational browsing, genres, formats, creators, and dislikes.
14. Leisure items must describe an actionable taste signal rather than a broad work topic. Prefer specific entries such as a genre, format, creator, recurring recreational topic, or dislike. Keep separate preferences as separate items.
15. Use explicit positive or negative statements as the strongest evidence. Repeated voluntary selection, repeated engagement after consuming something, enthusiastic comparison, returning to a creator or series, and positive follow-up behaviour may be included as inferred evidence with conservative confidence. Do not require the exact words "I like" when this repeated behavioural evidence exists.
16. A single question, mention, recommendation request, or factual discussion about a film, game, creator, book, or topic does not prove preference. Work interest does not imply leisure interest. Curiosity does not prove enjoyment.
17. Distinguish creating, editing, publishing, researching, or marketing a book from reading for pleasure. Professional work involving books is not evidence of preferred authors, genres, or recreational reading taste. Apply the same distinction to professional work involving video, music, games, or other media.
18. Capture supported dislikes and avoidance patterns as well as likes. Do not infer a dislike merely because the user criticised one claim or asked for alternatives.
19. leisure_profile is mandatory. Never invent its contents. If at least one leisure preference has real evidence, use status "available" even when the profile is incomplete, keep unknown optional fields null, and set conservative confidence. Only when there is no supported leisure preference at all, return exactly status "insufficient_data", empty preferences, null novelty/effort/session values, and confidence 0.
20. Aim for a small set of distinct, useful leisure signals rather than an exhaustive media history. Do not include titles or creators that merely appeared in conversation unless they support a genuine preference.
21. Use empty arrays when another category is unknown. Omit content_preferences if unknown.
22. Output only the JSON object.`;
}

export const PROFILE_PROVIDERS: Record<ExternalProfileSource, ProfileProvider> =
  {
    chatgpt: {
      id: 'chatgpt',
      name: 'ChatGPT',
      prompt: buildPrompt('ChatGPT', 'chatgpt'),
    },
    claude: {
      id: 'claude',
      name: 'Claude',
      prompt: buildPrompt('Claude', 'claude'),
    },
    other: {
      id: 'other',
      name: 'другого AI',
      prompt: buildPrompt('this AI assistant', 'other'),
    },
  };
