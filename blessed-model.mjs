export const PATRIARCHAL_TYPE = 'Patriarchal Blessing';
export const TYPES = [
  'Father’s Blessing', 'Baby Blessing', 'Priesthood Blessing',
  'Ordination', 'Setting Apart', PATRIARCHAL_TYPE,
];

export const DEMO_TRANSCRIPT = 'May you have courage when you face something new. As you pray for guidance, look for small ways to serve the people around you.';
export const DEMO_PDF = 'As you seek guidance in prayer, remember that small acts of service can strengthen your family and those around you.';

const FAMILY = 'carter';
const householdAccounts = new Set(['parent', 'spouse']);

export function seed() {
  const people = [
    { id: 'anna', name: 'Anna Carter', home: FAMILY, relation: 'Daughter', color: 'rose' },
    { id: 'lucas', name: 'Lucas Carter', home: FAMILY, relation: 'Son', color: 'green' },
    { id: 'ella', name: 'Ella Carter', home: FAMILY, relation: 'Daughter', color: 'gold' },
    { id: 'grace', name: 'Grace Carter', home: FAMILY, relation: 'Parent', color: 'plum' },
    { id: 'daniel', name: 'Daniel Carter', home: FAMILY, relation: 'Parent', color: 'green' },
  ];
  const entries = [
    {
      id: 'anna-school', personId: 'anna', type: TYPES[0], date: '2026-08-17',
      occasion: 'Starting a new school year', giver: 'Daniel Carter',
      text: DEMO_TRANSCRIPT, sampleAudio: true, source: 'Sample recording',
      annotations: [{ quote: 'small ways to serve', note: 'Ask Anna about the new student she invited to lunch.', highlight: true }],
      journal: 'We sat together after dinner and talked about what she hoped for this year.',
    },
    {
      id: 'anna-patriarchal', personId: 'anna', type: PATRIARCHAL_TYPE, date: '2026-04-19',
      occasion: 'Patriarchal blessing', giver: 'Brother Ellis', source: 'Sample text',
      text: 'You will have opportunities to serve as you notice people who feel alone. Seek guidance in prayer as you make decisions about your future.',
    },
    {
      id: 'anna-comfort', personId: 'anna', type: TYPES[2], date: '2025-02-09',
      occasion: 'Comfort before a move', giver: 'Daniel Carter', source: 'Sample text',
      text: 'May you find courage as your family moves and peace as you pray. You can serve others by helping them feel at home.',
    },
    {
      id: 'lucas-ordination', personId: 'lucas', type: TYPES[3], date: '2026-01-11',
      occasion: 'Ordained a teacher', giver: 'Daniel Carter', source: 'Sample text',
      text: 'As you serve in your quorum, look for people you can encourage. Pray for guidance as you learn your responsibilities.',
    },
    {
      id: 'ella-baby', personId: 'ella', type: TYPES[1], date: '2018-09-02',
      occasion: 'Baby blessing', giver: 'Daniel Carter', source: 'Sample text',
      text: 'May you feel loved by your family. May you find joy in learning and in showing kindness to others.',
    },
    {
      id: 'unfiled-sample', owner: FAMILY, source: 'Sample recording',
      text: DEMO_TRANSCRIPT, date: '2026-11-15', sampleAudio: true, simulated: true,
    },
  ].map(entry => ({ annotations: [], journal: '', ...entry }));
  return { active: 'parent', families: { [FAMILY]: 'Carter family' }, people, entries };
}

export function homeFor(account) {
  return householdAccounts.has(account) ? FAMILY : account;
}

export function personFor(state, id) {
  return state.people.find(person => person.id === id);
}

export function visiblePeople(state) {
  return state.people.filter(person => person.home === homeFor(state.active) || person.id === state.active);
}

export function assignablePeople(state) {
  return visiblePeople(state).filter(person => !person.claimed || person.id === state.active);
}

export function visibleEntries(state) {
  const people = new Map(visiblePeople(state).map(person => [person.id, person]));
  return state.entries.filter(entry => {
    const person = people.get(entry.personId);
    return person && (!person.claimed || person.id === state.active || entry.sharedWithParents !== false);
  }).sort((first, second) => (second.date || '').localeCompare(first.date || ''));
}

export function searchEntries(state, query) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  return visibleEntries(state).flatMap(entry => {
    const person = personFor(state, entry.personId);
    const fields = [entry.text, entry.journal, ...entry.annotations.flatMap(item => [item.quote, item.note]),
      person.name, entry.type, entry.occasion, entry.giver];
    const match = fields.find(value => value?.toLocaleLowerCase().includes(normalized));
    if (!match) return [];
    const start = Math.max(0, match.toLocaleLowerCase().indexOf(normalized) - 38);
    const end = start + 150;
    return [{ entry, snippet: (start ? '…' : '') + match.slice(start, end) + (match.length > end ? '…' : '') }];
  });
}

export function duplicatePatriarchal(state, entry, personId, type) {
  return type === PATRIARCHAL_TYPE
    ? state.entries.find(item => item.personId === personId && item.type === type && item.id !== entry.id)
    : undefined;
}

export function fileEntry(state, entry, person, type) {
  if (!TYPES.includes(type) || !assignablePeople(state).includes(person) ||
      entry.personId || entry.owner !== homeFor(state.active)) {
    throw new Error('Choose an available person and blessing type.');
  }
  if (type === PATRIARCHAL_TYPE && (entry.audio || entry.sampleAudio)) {
    throw new Error('Use written text or a PDF for a Patriarchal Blessing.');
  }
  if (type === PATRIARCHAL_TYPE && !entry.text.trim()) {
    throw new Error('Add the written text before filing a Patriarchal Blessing.');
  }
  if (duplicatePatriarchal(state, entry, person.id, type)) {
    throw new Error('This person already has a Patriarchal Blessing.');
  }
  entry.personId = person.id;
  entry.type = type;
  entry.sharedWithParents = !person.claimed || Boolean(person.shareNew);
  delete entry.owner;
}

const topics = [
  { pattern: /\b(serv\w*|kindness)\b/i, theme: 'Serving and noticing others', scripture: 'Mosiah 2:17', connection: 'Consider how everyday service connects to serving God.' },
  { pattern: /\b(courage|strength|brave)\b/i, theme: 'Courage during change', scripture: 'Joshua 1:9', connection: 'Study courage in times of uncertainty.' },
  { pattern: /\b(pray\w*|guidance)\b/i, theme: 'Finding guidance in prayer', scripture: 'James 1:5', connection: 'Study the invitation to ask God for wisdom.' },
  { pattern: /\b(peace|comfort|love\w*)\b/i, theme: 'Finding peace and comfort', scripture: 'John 14:27', connection: 'Study the Savior’s promise of peace.' },
];

export function insightsFor(state, personId) {
  const person = personFor(state, personId);
  if (!person || person.insightsOff) return [];
  const entries = visibleEntries(state)
    .filter(entry => entry.personId === personId && entry.text.trim())
    .sort((first, second) => (first.date || '').localeCompare(second.date || ''));
  const topicSources = topics.map(topic => ({
    topic,
    sources: entries.flatMap(entry => {
      const sentences = entry.text.match(/[^.!?\n]+[.!?]?/g) || [];
      const quote = sentences.find(sentence => topic.pattern.test(sentence))?.trim();
      return quote ? [{ entry, quote }] : [];
    }),
  })).filter(item => item.sources.length).sort((a, b) => b.sources.length - a.sources.length);
  if (!entries.length) return [];
  const strongest = topicSources[0];
  const reflectionSources = strongest?.sources.slice(-2) ||
    [{ entry: entries.at(-1), quote: entries.at(-1).text.trim().slice(0, 220) }];
  const insights = [
    { kind: 'Reflection prompt', title: 'What stands out to you today?', body: 'What do you remember about the time this blessing was given? What feels especially relevant now?', sources: reflectionSources },
  ];
  if (strongest) {
    const { topic, sources } = strongest;
    insights.push({ kind: 'Scripture connection', title: topic.scripture, body: topic.connection, sources: sources.slice(-2) });
    if (sources.length >= 2) {
      insights.unshift(
        { kind: 'Recurring theme', title: topic.theme, body: 'This theme appears across these blessings. Read them together and consider what feels consistent over time.', sources },
        { kind: 'Possible fulfillment', title: 'Looking back at earlier counsel', body: 'Where have you seen this earlier counsel find a place in your life? Consider the two passages side by side.', sources: [sources[0], sources.at(-1)] },
      );
    }
  }
  return insights;
}
