// The variety matrix for a review corpus.
//
// Five hundred paragraphs that all sound alike prove nothing, so nothing here is
// left to the model's default voice: every paragraph gets its own topic, its own
// register, its own author situation, and its own structural constraint, drawn
// from independent lists so the combinations do not repeat.
//
// Topics deliberately span the concrete and the abstract, the technical and the
// domestic, because AI tells show up differently in a paragraph about tax law
// than in one about a recipe.

export const TOPICS = [
  // work and organisations
  'quarterly hiring plans', 'a warehouse safety audit', 'remote onboarding', 'a failed product launch',
  'union negotiations', 'succession planning', 'an office relocation', 'expense policy changes',
  'a customer complaint backlog', 'contractor invoicing', 'a merger announcement', 'shift scheduling',
  'performance review cycles', 'a supplier who missed a deadline', 'open-plan office noise',
  'a company rebrand', 'internal wiki neglect', 'travel budget cuts', 'a hiring freeze',
  'exit interview themes',
  // technical
  'database migration downtime', 'why the build is slow', 'a memory leak in production',
  'choosing a message queue', 'flaky integration tests', 'an incident postmortem', 'API versioning',
  'technical debt in legacy billing', 'a security patch rollout', 'monitoring alert fatigue',
  'moving off a mainframe', 'container orchestration costs', 'a rewrite that overran',
  'accessibility remediation', 'data retention policy',
  // science and nature
  'octopus problem solving', 'peat bog carbon', 'antibiotic resistance in farming', 'tidal energy',
  'coral spawning', 'the water cycle', 'mycorrhizal networks', 'bird migration timing',
  'volcanic soil fertility', 'glacial retreat measurement', 'seed bank storage', 'urban heat islands',
  'beaver dam hydrology', 'insect decline surveys', 'permafrost methane',
  // history and culture
  'the Silk Road', 'medieval guild apprenticeships', 'the printing press', 'Byzantine mosaics',
  'Icelandic sagas', 'the Dust Bowl', 'lighthouse keeping', 'the Pony Express', 'stained glass making',
  'Roman concrete', 'the Grand Tour', 'salt mining', 'the Enigma machine', 'terrace farming',
  'the Marshall Plan', 'falconry', 'clock towers', 'papermaking', 'Sanskrit grammar',
  'submarine telegraph cables',
  // everyday and domestic
  'sourdough starter maintenance', 'repairing a bicycle puncture', 'composting kitchen scraps',
  'choosing a mattress', 'cat behaviour at night', 'houseplant overwatering', 'meal planning on a budget',
  'moving house with children', 'learning to swim as an adult', 'a neighbour dispute over a fence',
  'secondhand furniture restoration', 'winter cycling clothing', 'organising a shared kitchen',
  'sleep and shift work', 'keeping chickens in a small garden',
  // civic and money
  'municipal recycling contracts', 'a local planning objection', 'bus route consolidation',
  'library funding', 'flood insurance', 'pension auto-enrolment', 'small business tax filing',
  'a council budget shortfall', 'jury duty', 'rent stabilisation', 'student loan repayment',
  'a charity annual report', 'volunteer retention', 'food bank logistics', 'road maintenance backlogs',
  // arts and leisure
  'jazz improvisation', 'stage lighting design', 'restoring a film print', 'community theatre casting',
  'learning an instrument late', 'museum lighting damage', 'chess openings', 'long distance hiking',
  'amateur astronomy', 'bookbinding',
];

export const REGISTERS = [
  { name: 'business memo', how: 'an internal business memo to colleagues, formal but not stiff' },
  { name: 'report', how: 'a formal report paragraph, third person, no contractions' },
  { name: 'encyclopedic', how: 'a neutral reference entry, third person' },
  { name: 'blog', how: 'a personal blog post, first person, conversational' },
  { name: 'marketing', how: 'marketing copy for a company website, upbeat but not shouty' },
  { name: 'academic', how: 'an academic abstract, hedged and precise' },
  { name: 'how-to', how: 'a how-to guide, second person, practical' },
  { name: 'news', how: 'a news article paragraph, plain and factual' },
  { name: 'email', how: 'a work email to one person, direct' },
  { name: 'review', how: 'a product or place review by an ordinary customer' },
];

/** Situations that change what a writer emphasises and how confident they sound. */
export const STANCES = [
  'explaining it to someone who has never encountered it',
  'summarising it for a busy manager who wants the decision',
  'arguing that the usual approach is wrong',
  'describing what went wrong and why',
  'comparing two options without picking one',
  'recommending one option firmly',
  'giving background before a decision is made',
  'answering a question that keeps coming up',
  'correcting a common misunderstanding',
  'reporting a result without interpreting it',
];

/** Structural constraints, so grammar varies rather than settling into one shape. */
export const SHAPES = [
  'Use five or six sentences of noticeably different lengths.',
  'Use four sentences, one of them long and complex.',
  'Use seven or eight short-to-medium sentences.',
  'Open with a subordinate clause and vary the rest.',
  'Include one two-part sentence joined with a semicolon.',
  'Include a list of exactly two items somewhere, never three.',
  'Include one rhetorical question and answer it.',
  'Start with the conclusion, then give the reasons.',
  'Include one specific number and one date.',
  'Use mostly the passive voice.',
  'Use mostly the active voice with concrete subjects.',
  'Include one parenthetical aside in commas.',
];

/** Deterministic spread: coprime strides so combinations do not cycle early. */
export function specFor(index) {
  const topic = TOPICS[index % TOPICS.length];
  const register = REGISTERS[(index * 3) % REGISTERS.length];
  const stance = STANCES[(index * 7) % STANCES.length];
  const shape = SHAPES[(index * 5) % SHAPES.length];
  const words = [80, 95, 110, 130, 150][index % 5];
  return { index, topic, register: register.name, stance, shape, words };
}

export function promptFor(spec) {
  const register = REGISTERS.find(r => r.name === spec.register);
  return [
    `Write one paragraph of about ${spec.words} words about ${spec.topic}.`,
    `Write it as ${register.how}.`,
    `You are ${spec.stance}.`,
    spec.shape,
    'Output only the paragraph. No heading, no preamble, no bullet points.',
  ].join(' ');
}

export const TOTAL = 500;
