// A hundred source paragraphs with fixed quotas: twenty written as a historical
// paper, twenty in the first person, twenty as somebody recounting their own
// life, and forty spread across other registers.
//
// Topics, situations and sentence shapes are drawn on coprime strides so no two
// paragraphs share a combination and nothing settles into one voice.

export const TOTAL = 100;

const HISTORICAL = [
  'the collapse of the Bronze Age palace economies', 'Hanseatic League trade privileges',
  'the enclosure of English common land', 'Song dynasty paper money', 'the Barbary galley trade',
  'Dutch fluyt shipbuilding', 'the Corn Laws', 'monastic scriptoria before print',
  'the Assize of Bread', 'Venetian glassmakers on Murano', 'the Hudson Bay fur trade',
  'guild control of apprenticeship in Florence', 'the Zanj revolt', 'medieval sumptuary law',
  'the Tanzimat reforms', 'silver from Potosi and European prices', 'the Highland Clearances',
  'Byzantine grain shipments to Constantinople', 'the Truck Acts', 'Ottoman timar landholding',
];

const FIRST_PERSON = [
  'learning to cook after leaving home', 'switching careers at forty', 'running a first marathon',
  'a long commute by train', 'keeping a garden in a rented flat', 'giving up a car',
  'starting therapy', 'learning a language badly', 'living with a chronic injury',
  'the first month of a new job', 'sharing a house with strangers', 'quitting social media',
  'caring for an ageing parent', 'a hobby that became expensive', 'learning to sail',
  'moving to a country whose language you do not speak', 'saving for a deposit',
  'going back to study at thirty-five', 'a friendship that ended', 'working nights',
];

const LIVED = [
  'the week a storm took the roof off', 'waiting for a diagnosis', 'a wedding that nearly did not happen',
  'the day the factory closed', 'a house move that went wrong', 'six months of unemployment',
  'a family recipe nobody wrote down', 'the first winter in a cold house',
  'losing a pet after fifteen years', 'a school reunion', 'the year a parent remarried',
  'a holiday that fell apart', 'learning a trade from a difficult teacher',
  'the night a neighbour needed help', 'coming home after years away',
  'a birth that did not go to plan', 'the last harvest on a family farm',
  'an argument that lasted a decade', 'the summer everybody left town', 'a funeral in a small village',
];

const OTHER = [
  'flood insurance excess', 'why the deployment pipeline is slow', 'coral spawning', 'bus route cuts',
  'a supplier who missed a deadline', 'sourdough hydration', 'library funding', 'peat bog carbon',
  'chess endgames', 'container port automation', 'antibiotic use in farming', 'stage lighting rigs',
  'urban heat islands', 'pension auto-enrolment', 'bicycle gear ratios', 'museum lighting damage',
  'seed bank storage', 'noise in open-plan offices', 'tidal turbine maintenance', 'jury selection',
  'restoring a film print', 'beekeeping in cities', 'contract cleaning tenders', 'birdsong dialects',
  'legacy billing systems', 'volunteer retention', 'glacial retreat measurement', 'shift handover notes',
  'mycorrhizal networks', 'planning objections', 'papermaking by hand', 'octopus problem solving',
  'accessibility audits', 'road maintenance backlogs', 'terrace farming', 'clock escapements',
  'food bank logistics', 'submarine cable repair', 'falconry training', 'salt marsh restoration',
];

const OTHER_REGISTERS = [
  'a formal report paragraph, third person, no contractions',
  'a neutral reference entry, third person',
  'marketing copy for a company website, confident but not shouty',
  'an academic abstract, hedged and precise',
  'a how-to guide, second person, practical',
  'a news article paragraph, plain and factual',
  'a work email to one person, direct',
  'a product or place review by an ordinary customer',
];

const STANCES = [
  'explaining it to someone who has never encountered it',
  'summarising it for someone short of time',
  'arguing that the usual view is wrong',
  'describing what went wrong and why',
  'weighing two readings without settling it',
  'making the case for one course of action',
  'giving the background before a judgement',
  'answering a question that keeps coming up',
  'correcting a common misunderstanding',
  'setting down what happened without interpreting it',
];

const SHAPES = [
  'Use five or six sentences of noticeably different lengths.',
  'Use four sentences, one of them long and complex.',
  'Use seven or eight short-to-medium sentences.',
  'Open with a subordinate clause and vary the rest.',
  'Include one sentence joined with a semicolon.',
  'Include a list of exactly two items, never three.',
  'Start with the conclusion, then give the reasons.',
  'Include one specific number and one date.',
  'Use mostly the passive voice.',
  'Use mostly the active voice with concrete subjects.',
  'Include one parenthetical aside inside commas.',
  'Include one em dash where it is natural.',
];

export function specFor(index) {
  let topic;
  let how;
  let band;
  if (index < 20) {
    band = 'historical paper';
    topic = HISTORICAL[index];
    how = 'a paragraph from an academic history paper: third person, cautious about evidence, no contractions';
  } else if (index < 40) {
    band = 'first person';
    topic = FIRST_PERSON[index - 20];
    how = 'first person throughout, reflective, the writer talking about their own habits and opinions';
  } else if (index < 60) {
    band = 'lived experience';
    topic = LIVED[index - 40];
    how = 'somebody recounting something that happened to them, past tense, concrete and personal';
  } else {
    band = 'mixed';
    topic = OTHER[index - 60];
    how = OTHER_REGISTERS[(index * 3) % OTHER_REGISTERS.length];
  }
  return {
    index,
    band,
    topic,
    how,
    stance: STANCES[(index * 7) % STANCES.length],
    shape: SHAPES[(index * 5) % SHAPES.length],
    words: [90, 110, 130, 150, 170][index % 5],
  };
}

export function promptFor(spec) {
  return [
    `Write one paragraph of about ${spec.words} words about ${spec.topic}.`,
    `Write it as ${spec.how}.`,
    `You are ${spec.stance}.`,
    spec.shape,
    'Output only the paragraph. No heading, no preamble, no bullet points.',
  ].join(' ');
}
