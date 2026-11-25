import {
  PATRIARCHAL_TYPE, TYPES, DEMO_TRANSCRIPT, DEMO_PDF, seed, homeFor, personFor,
  visiblePeople, visibleEntries, assignablePeople, searchEntries, duplicatePatriarchal,
  fileEntry, insightsFor, HIGHLIGHT_COLORS, annotationRange, changeAnnotation,
} from './blessed-model.mjs';

const app = document.querySelector('#app');
const sheet = document.querySelector('#sheet');
const toastBox = document.querySelector('#toast');
const dateFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium' });
const icon = (symbol, extra = '') => `<span aria-hidden="true" class="icon ${extra}">${symbol}</span>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const uid = () => crypto.randomUUID();
const today = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
};
const displayDate = date => date ? dateFormat.format(new Date(date + 'T12:00:00')) : 'Date unknown';

let db;
let state;
let page = { name: 'family' };
let query = '';
let toastTimer;
let capture;
let retryAudio;
let savingRecording = false;
let audioUrl;
let passageMenu;
let selectionTimer;
let pointerSelecting = false;
let touchGesture;
let touchPassage;
const customTouchSelection = navigator.maxTouchPoints > 0 ||
  window.matchMedia?.('(any-pointer: coarse)').matches ||
  /iPhone|iPad|iPod/.test(navigator.userAgent);
let busy = false;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('blessed-prototype', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('archive');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function load() {
  return new Promise((resolve, reject) => {
    const request = db.transaction('archive').objectStore('archive').get('state');
    request.onsuccess = () => resolve(request.result || { ...seed(), revision: 0 });
    request.onerror = () => reject(request.error);
  });
}

async function update(change) {
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('archive', 'readwrite');
    const store = transaction.objectStore('archive');
    const request = store.get('state');
    let next;
    let failure;
    request.onsuccess = () => {
      next = request.result || { ...seed(), revision: 0 };
      try {
        if (next.revision !== state.revision) {
          state = next;
          throw new Error('The archive changed in another tab. Close this panel and try again.');
        }
        change(next);
        next.revision += 1;
        store.put(next, 'state');
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => { state = next; resolve(); };
    transaction.onabort = () => reject(failure || transaction.error || new Error('The archive could not be saved.'));
  });
}

function toast(message) {
  toastBox.textContent = message;
  toastBox.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastBox.classList.remove('visible'), 3500);
}

function action(label, command, options = {}) {
  const { style = 'quiet', id = '', symbol = '', extra = '' } = options;
  return `<button type="button" class="button ${style} ${extra}" data-action="${command}"${id ? ` data-id="${esc(id)}"` : ''}>${symbol ? icon(symbol) : ''}${esc(label)}</button>`;
}

const familyName = () => state.families[homeFor(state.active)];
const currentPerson = () => personFor(state, state.active);
const displayAccount = () => ({ parent: 'Daniel', spouse: 'Grace' })[state.active] || currentPerson()?.name.split(' ')[0];
const unfiled = () => state.entries.filter(entry => !entry.personId && entry.owner === homeFor(state.active)).reverse();
const canEdit = entry => !personFor(state, entry.personId)?.claimed || state.active === entry.personId;

function go(name, id, back) {
  page = { name, id, back };
  closeSheet();
  render();
  window.scrollTo(0, 0);
  document.querySelector('main h1')?.focus({ preventScroll: true });
}

function avatar(person, large = false) {
  const initials = person.name.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0]).join('');
  return `<span class="avatar ${esc(person.color || 'plum')} ${large ? 'large' : ''}" aria-hidden="true">${esc(initials)}</span>`;
}

function brand() {
  return `<button class="brand" data-action="family" aria-label="Blessed home"><img src="blessed-icon.png" alt=""><span>Blessed<span class="brand-period">.</span></span></button>`;
}

function nav() {
  const active = ['person', 'insights', 'detail'].includes(page.name) ? page.back === 'search' ? 'search' : 'family' : page.name;
  const items = [
    ['family', 'Family', '⌂'],
    ['unfiled', 'Unfiled', '▤'],
    ['search', 'Search', '⌕'],
  ];
  return `<nav class="nav" aria-label="Archive">${items.map(([id, label, symbol]) =>
    `<button data-action="${id}" ${active === id ? 'aria-current="page"' : ''}>${icon(symbol)}<span>${label}</span>${id === 'unfiled' && unfiled().length ? `<span class="nav-count">${unfiled().length}</span>` : ''}</button>`).join('')}</nav>`;
}

function title(heading, subtitle, controls = '') {
  return `<div class="heading"><div><h1 tabindex="-1">${esc(heading)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${controls}</div>`;
}

function back(label, command, id) {
  return action(label, command, { id, symbol: '←', extra: 'back' });
}

function countLabel(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function entryRow(entry, snippet = '', origin = '') {
  const person = personFor(state, entry.personId);
  return `<button class="entry-row" data-action="${person ? 'detail' : 'draft'}" data-id="${esc(entry.id)}" data-origin="${origin}">
    <span class="entry-icon ${entry.type === PATRIARCHAL_TYPE ? 'special' : ''}">${entry.type === PATRIARCHAL_TYPE ? '✧' : entry.audio || entry.sampleAudio ? '◉' : '▤'}</span>
    <span class="entry-copy"><strong>${esc(entry.occasion || entry.name || entry.type || entry.source)}</strong>
      <span>${esc([person?.name, entry.type || entry.source, displayDate(entry.date)].filter(Boolean).join(' · '))}</span>
      ${snippet ? `<span class="snippet">${esc(snippet)}</span>` : ''}</span>
    <span class="arrow" aria-hidden="true">›</span></button>`;
}

function familyScreen() {
  const people = visiblePeople(state);
  const entries = visibleEntries(state);
  return `${title('Family archive', familyName() || 'Your personal blessings', action('Add person', 'new-person', { symbol: '+', style: 'outline' }))}
    <section class="hero"><div class="hero-copy"><h2>Save a blessing</h2><p>Record a blessing in the moment. Give it a home when you’re ready.</p>
      ${action('Record a blessing', 'record', { style: 'light', symbol: '●' })}
      ${action('Import a blessing', 'import', { style: 'hero-link', symbol: '↥' })}</div>
      <div class="hero-art" aria-hidden="true"><i></i><i></i><i></i><span>✦</span></div>
    </section>
    ${!familyName() ? `<section class="empty inline"><p>Start a family archive to keep blessings for your children.</p>${action('Start a family', 'new-family', { style: 'primary' })}</section>` : ''}
    <section class="section"><div class="section-heading"><h2>People</h2><span>${countLabel(people.length, 'profile')}</span></div>
      <div class="people-grid">${people.map(person => `<button class="person-card" data-action="person" data-id="${esc(person.id)}">
        ${avatar(person)}<span><strong>${esc(person.name)}</strong><small>${esc(person.id === state.active ? 'Your profile' : person.relation || 'Family member')} · ${countLabel(entries.filter(entry => entry.personId === person.id).length, 'blessing')}</small></span><span aria-hidden="true" class="arrow">›</span></button>`).join('')}</div>
    </section>
    ${entries.length ? `<section class="section"><div class="section-heading"><h2>Recent blessings</h2></div><div class="list">${entries.slice(0, 3).map(entry => entryRow(entry, '', 'family')).join('')}</div></section>` : ''}`;
}

function unfiledScreen() {
  const drafts = unfiled();
  return `${title('Unfiled', 'Recordings and imports waiting for a person and a blessing type.', action('Import', 'import', { symbol: '↥', style: 'outline' }))}
    ${drafts.length ? `<div class="list">${drafts.map(entry => entryRow(entry)).join('')}</div>` : '<div class="empty"><h2>You’re all caught up.</h2><p>New recordings and imports appear here.</p></div>'}
    <div class="button-row">${action('Record a blessing', 'record', { style: 'primary', symbol: '●' })}${action('Try a sample recording', 'sample', { style: 'outline' })}</div>`;
}

function personScreen(person) {
  const entries = visibleEntries(state).filter(entry => entry.personId === person.id);
  const patriarchal = entries.find(entry => entry.type === PATRIARCHAL_TYPE);
  const control = !person.claimed || person.id === state.active;
  return `${back('Family', 'family')}${title(person.name, person.id === state.active ? 'Your blessing timeline' : person.relation || 'Family member', avatar(person, true))}
    <div class="button-row compact">
      ${action('Insights', 'insights', { id: person.id, style: 'outline', symbol: '✦' })}
      ${control ? action('Add a blessing', 'import', { id: person.id, style: 'outline', symbol: '+' }) : ''}
      ${person.relation !== 'Parent' && !person.claimed ? action(person.invited ? 'View adult invitation' : 'Invite as adult', 'invite', { id: person.id }) : ''}
    </div>
    ${person.claimed && person.id !== state.active ? '<p class="hint">Own account · Previously shared blessings stay here.</p>' : ''}
    ${patriarchal ? `<section class="section feature"><div><h2>Patriarchal Blessing</h2></div>${action('Read blessing', 'detail', { id: patriarchal.id, style: 'outline' })}</section>` :
      control ? `<section class="section feature"><div><h2>Patriarchal Blessing</h2><p>Add a written blessing to this profile.</p></div>${action('Add written blessing', 'patriarchal', { id: person.id, style: 'outline' })}</section>` : ''}
    <section class="section"><div class="section-heading"><h2>Blessing timeline</h2><span>${countLabel(entries.length, 'blessing')}</span></div>
      ${entries.length ? `<div class="list">${entries.map(entry => entryRow(entry)).join('')}</div>` : '<div class="empty"><p>Filed blessings will appear here.</p></div>'}</section>`;
}

function audioPlayer(entry) {
  if (!entry.audio && !entry.sampleAudio) return '';
  if (entry.audio) audioUrl = URL.createObjectURL(entry.audio);
  return `<div class="player"><strong>${icon('◉')} Original audio</strong><audio controls preload="metadata" src="${audioUrl || 'sample.mp3'}" aria-label="Original blessing audio"></audio></div>`;
}

function markedText(entry) {
  const ranges = entry.annotations.flatMap((item, index) => {
    const range = item.highlight && annotationRange(entry.text, item);
    return range ? [{ ...range, index, color: item.color || 'yellow' }] : [];
  });
  const boundaries = [...new Set([0, entry.text.length, ...ranges.flatMap(range => [range.start, range.end])])]
    .sort((first, second) => first - second);
  const seen = new Set();
  return boundaries.slice(1).map((end, index) => {
    const start = boundaries[index];
    const text = esc(entry.text.slice(start, end));
    const range = ranges.findLast(item => item.start <= start && item.end >= end);
    if (!range) return text;
    const first = !seen.has(range.index);
    seen.add(range.index);
    return `<mark data-highlight="${range.index}" data-color="${esc(range.color)}"${first ? ' tabindex="0" role="button" aria-label="Highlight options"' : ''}>${text}</mark>`;
  }).join('');
}

function closePassageMenu() {
  clearTimeout(selectionTimer);
  passageMenu?.element.remove();
  passageMenu = undefined;
}

function clearTouchPassage() {
  clearTimeout(touchGesture?.timer);
  touchGesture = undefined;
  touchPassage?.layer.remove();
  touchPassage = undefined;
}

function dismissPassageSelection() {
  closePassageMenu();
  clearTouchPassage();
}

function detailEntry() {
  return page.name === 'detail' && visibleEntries(state).find(item => item.id === page.id);
}

function showPassageMenu(entry, anchor, context, focus = false) {
  closePassageMenu();
  const item = entry.annotations[context.index];
  const editable = canEdit(entry);
  if (!editable && !item?.note) return;
  const element = document.createElement('div');
  element.className = 'passage-menu';
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Highlight options');
  element.innerHTML = `
    ${editable && !item?.highlight ? action('Highlight', 'passage-highlight') : ''}
    ${editable ? action(item?.highlight ? 'Change color' : 'Highlight color', 'passage-palette') : ''}
    ${editable || item?.note ? action(item?.note ? editable ? 'View or edit note' : 'View note' : 'Add note', 'passage-note') : ''}
    ${editable && item?.highlight ? action('Remove highlight', 'passage-remove') : ''}`;
  document.body.append(element);
  passageMenu = { ...context, entryId: entry.id, anchor, element };
  positionPassageMenu();
  if (focus) element.querySelector('button')?.focus({ preventScroll: true });
}

function positionPassageMenu() {
  const { element, anchor } = passageMenu;
  const viewport = window.visualViewport;
  const top = viewport?.offsetTop || 0;
  const left = viewport?.offsetLeft || 0;
  const width = viewport?.width || window.innerWidth;
  const height = viewport?.height || window.innerHeight;
  const menuWidth = element.offsetWidth;
  const menuHeight = element.offsetHeight;
  element.style.left = Math.max(left + 8, Math.min(anchor.left, left + width - menuWidth - 8)) + 'px';
  const below = anchor.bottom + 10;
  const preferred = below + menuHeight <= top + height - 8 ? below : anchor.top - menuHeight - 10;
  element.style.top = Math.max(top + 8, Math.min(preferred, top + height - menuHeight - 8)) + 'px';
}

function showSelectedPassage() {
  const transcript = document.querySelector('#transcript');
  const selection = document.getSelection();
  const entry = detailEntry();
  if (!entry || !canEdit(entry) || !selection?.rangeCount || selection.isCollapsed || !transcript ||
      transcript.classList.contains('touch-transcript') || !transcript.contains(selection.anchorNode) || !transcript.contains(selection.focusNode)) return;
  const range = selection.getRangeAt(0);
  const raw = range.toString();
  const prefix = range.cloneRange();
  prefix.selectNodeContents(transcript);
  prefix.setEnd(range.startContainer, range.startOffset);
  const offset = prefix.toString().length;
  clearTouchPassage();
  const layer = createSelectionLayer(false);
  touchPassage = { transcript, layer, start: offset, end: offset + raw.length };
  drawTouchPassage();
  selection.removeAllRanges();
  showRangeMenu(entry, range, offset, raw);
}

function showRangeMenu(entry, range, offset, raw = range.toString()) {
  const quote = raw.trim();
  if (!quote) return;
  const start = offset + raw.indexOf(quote);
  if (entry.text.slice(start, start + quote.length) !== quote) return;
  const index = entry.annotations.findIndex(item =>
    item.quote === quote && annotationRange(entry.text, item)?.start === start);
  const rectangles = range.getClientRects();
  const anchor = rectangles[rectangles.length - 1] || range.getBoundingClientRect();
  showPassageMenu(entry, anchor, { index, start, quote });
}

function touchOffset(transcript, x, y) {
  const caret = document.caretPositionFromPoint?.(x, y);
  const range = caret ? null : document.caretRangeFromPoint?.(x, y);
  const node = caret?.offsetNode || range?.startContainer;
  if (!node || !transcript.contains(node)) return;
  const prefix = document.createRange();
  prefix.selectNodeContents(transcript);
  prefix.setEnd(node, caret?.offset ?? range.startOffset);
  return prefix.toString().length;
}

function wordAt(text, offset) {
  const position = Math.min(offset, text.length - 1);
  const word = [...text.matchAll(/[\p{L}\p{M}\p{N}]+(?:[’'][\p{L}\p{M}\p{N}]+)*|[^\s]/gu)]
    .find(item => item.index <= position && item.index + item[0].length > position);
  if (word) return { start: word.index, end: word.index + word[0].length };
}

function touchRange() {
  const { transcript, start, end } = touchPassage;
  const range = document.createRange();
  const walker = document.createTreeWalker(transcript, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let first;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const limit = offset + node.length;
    if (!first && start < limit) {
      range.setStart(node, start - offset);
      first = node;
    }
    if (first && end <= limit) {
      range.setEnd(node, end - offset);
      return range;
    }
    offset = limit;
  }
}

function drawTouchPassage() {
  const range = touchRange();
  const rects = range ? [...range.getClientRects()].filter(rect => rect.width && rect.height) : [];
  const { layer } = touchPassage;
  const fills = layer.firstElementChild;
  fills.replaceChildren();
  for (const rect of rects) {
    const selection = document.createElement('span');
    selection.className = 'touch-selection-fill';
    Object.assign(selection.style, { left: rect.left + 'px', top: rect.top + 'px',
      width: rect.width + 'px', height: rect.height + 'px' });
    fills.append(selection);
  }
  for (const [edge, rect] of [['start', rects[0]], ['end', rects.at(-1)]]) {
    const handle = layer.querySelector(`[data-selection-handle="${edge}"]`);
    if (!handle) continue;
    handle.hidden = !rect;
    if (rect) {
      handle.style.left = (edge === 'start' ? rect.left : rect.right) + 'px';
      handle.style.top = rect.bottom + 'px';
    }
  }
  return range;
}

function startTouchPassage(gesture) {
  const entry = detailEntry();
  if (!entry || !canEdit(entry) || !gesture.transcript.isConnected) return;
  const offset = touchOffset(gesture.transcript, gesture.x, gesture.y);
  const word = Number.isInteger(offset) && wordAt(entry.text, offset);
  if (!word) return;
  const layer = createSelectionLayer();
  touchPassage = { ...word, layer, transcript: gesture.transcript };
  gesture.word = word;
  gesture.active = true;
  drawTouchPassage();
}

function createSelectionLayer(handles = true) {
  const layer = document.createElement('div');
  layer.className = 'touch-selection-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = '<div></div>' +
    (handles ? '<span data-selection-handle="start"></span><span data-selection-handle="end"></span>' : '');
  document.body.append(layer);
  return layer;
}

function startSelectionTouch(event) {
  if (event.touches.length !== 1) {
    dismissPassageSelection();
    return;
  }
  const touch = event.changedTouches[0];
  const handle = event.target.closest?.('[data-selection-handle]');
  if (handle && touchPassage) {
    event.preventDefault();
    closePassageMenu();
    const rect = handle.getBoundingClientRect();
    touchGesture = { id: touch.identifier, edge: handle.dataset.selectionHandle, active: true,
      offsetX: touch.clientX - (rect.left + rect.width / 2), offsetY: touch.clientY - rect.top + 10 };
    return;
  }
  if (passageMenu?.element.contains(event.target)) return;
  const transcript = event.target.closest?.('#transcript');
  if (!transcript || sheet.open || busy) return;

  // Stop the browser's native selection before the long press starts.
  event.preventDefault();
  transcript.classList.add('touch-transcript');
  document.getSelection()?.removeAllRanges();
  dismissPassageSelection();
  const gesture = { id: touch.identifier, x: touch.clientX, y: touch.clientY,
    lastY: touch.clientY, transcript, mark: event.target.closest?.('[data-highlight]') };
  touchGesture = gesture;
  const entry = detailEntry();
  if (entry && canEdit(entry)) gesture.timer = setTimeout(() => startTouchPassage(gesture), 360);
}

function moveSelectionTouch(event) {
  const gesture = touchGesture;
  const touch = gesture && Array.from(event.changedTouches).find(item => item.identifier === gesture.id);
  if (!touch) return;
  event.preventDefault();
  if (!gesture.active) {
    if (!gesture.scrolling && Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) > 10) {
      clearTimeout(gesture.timer);
      gesture.scrolling = true;
    }
    if (gesture.scrolling) {
      window.scrollBy(0, gesture.lastY - touch.clientY);
      gesture.lastY = touch.clientY;
    }
    return;
  }
  const offset = touchOffset(touchPassage.transcript,
    touch.clientX - (gesture.offsetX || 0), touch.clientY - (gesture.offsetY || 0));
  if (!Number.isInteger(offset)) return;
  if (gesture.edge === 'start') touchPassage.start = Math.min(offset, touchPassage.end - 1);
  else if (gesture.edge === 'end') touchPassage.end = Math.max(offset, touchPassage.start + 1);
  else {
    touchPassage.start = Math.min(gesture.word.start, offset);
    touchPassage.end = Math.max(gesture.word.end, offset);
  }
  drawTouchPassage();
}

function endSelectionTouch(event) {
  const gesture = touchGesture;
  if (!gesture || !Array.from(event.changedTouches).some(item => item.identifier === gesture.id)) return;
  clearTimeout(gesture.timer);
  touchGesture = undefined;
  if (!gesture.active) {
    if (!gesture.scrolling && gesture.mark?.isConnected) openExistingHighlight(gesture.mark, false);
    return;
  }
  event.preventDefault();
  const entry = detailEntry();
  const range = entry && touchRange();
  if (range) showRangeMenu(entry, range, touchPassage.start);
}


function queueSelectionMenu(delay) {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(() => {
    if (!pointerSelecting && !sheet.open && !busy) showSelectedPassage();
  }, delay);
}

async function applyPassageChange(context, changes) {
  await update(next => {
    const entry = visibleEntries(next).find(item => item.id === context.entryId);
    if (!entry || !canEdit(entry)) throw new Error('This blessing is read-only.');
    changeAnnotation(entry, context, changes);
  });
  document.getSelection()?.removeAllRanges();
  closeSheet();
  const focusIndex = context.index < 0 ? state.entries.find(entry => entry.id === context.entryId).annotations.length - 1 : context.index;
  render();
  if (changes.highlight !== false) {
    document.querySelector(`[data-highlight="${focusIndex}"][tabindex]`)?.focus({ preventScroll: true });
  }
  toast(changes.highlight === false ? 'Highlight removed.' : 'Passage saved.');
}

function openPassageNote(entry, context) {
  const item = entry.annotations[context.index];
  dismissPassageSelection();
  document.getSelection()?.removeAllRanges();
  const quote = `<blockquote class="passage-quote">${esc(item?.quote || context.quote)}</blockquote>`;
  if (!canEdit(entry)) {
    openSheet('Passage note', `${quote}<p class="journal">${esc(item.note)}</p>`);
    return;
  }
  openSheet(item?.note ? 'Passage note' : 'Add passage note', `${quote}
    <form class="form" data-form="passage-note" data-id="${esc(entry.id)}" data-index="${context.index}" data-start="${context.start ?? ''}">
      <label>Note<textarea name="note" rows="5">${esc(item?.note)}</textarea></label>
      <button type="submit" class="button primary">Save note</button>
    </form>`);
}

function detailScreen(entry) {
  const person = personFor(state, entry.personId);
  const editable = canEdit(entry);
  const origin = page.back;
  return `${origin === 'search' ? back('Search', 'search') : origin === 'insights' ? back('Insights', 'insights', person.id) : origin === 'family' ? back('Family', 'family') : back(person.name, 'person', person.id)}
    ${title(entry.occasion || entry.type, [person.name, entry.type].filter(Boolean).join(' · '), editable ? action('Edit blessing', 'edit-entry', { id: entry.id, style: 'outline' }) : '')}
    <dl class="metadata"><div><dt>Date given</dt><dd>${esc(displayDate(entry.date))}</dd></div><div><dt>Given by</dt><dd>${esc(entry.giver || '—')}</dd></div></dl>
    ${audioPlayer(entry)}
    <section class="section reading"><div class="section-heading"><h2>${entry.audio || entry.sampleAudio ? 'Transcript' : 'Blessing text'}</h2>
      ${entry.simulated ? '<span>Sample text</span>' : ''}</div>
      <p id="transcript" class="transcript${customTouchSelection ? ' touch-transcript' : ''}">${markedText(entry) || 'No transcript yet.'}</p>
      ${editable && entry.text ? `<p class="hint">${customTouchSelection ? 'Touch and hold to select text. Drag the handles to adjust it.' : 'Select text to highlight it.'} Tap a highlight for options.</p>` : ''}</section>
    <section class="section"><div class="section-heading"><h2>Highlights &amp; passage notes</h2></div>
      ${entry.annotations.length ? `<div class="notes">${entry.annotations.map((item, index) => `<article class="annotation"><blockquote>${esc(item.quote)}</blockquote>${item.note ? `<p>${esc(item.note)}</p>` : '<small>Highlight</small>'}
        ${editable || item.note ? action('Passage options', 'passage-existing', { id: index + 1 }) : ''}</article>`).join('')}</div>` : '<p class="hint">Marked passages appear here.</p>'}
    </section>
    <section class="section"><div class="section-heading"><h2>Blessing journal</h2>${editable ? action(entry.journal ? 'Edit note' : 'Add note', 'journal', { id: entry.id, style: 'outline' }) : ''}</div>
      <p class="journal">${esc(entry.journal || 'A place for memories and reflections about this blessing.')}</p></section>`;
}

function draftScreen(entry) {
  const people = assignablePeople(state);
  const selectedPerson = people.some(person => person.id === entry.suggestPerson) ? entry.suggestPerson : '';
  return `${back('Unfiled', 'unfiled')}${title('File blessing', entry.name || entry.source)}
    ${audioPlayer(entry)}
    <form class="form card" data-form="file" data-id="${esc(entry.id)}">
      <div class="field-row"><label>Recipient<select name="person" ${people.length ? '' : 'disabled'}>
        <option value="">Select a person</option>${people.map(person => `<option value="${esc(person.id)}" ${person.id === selectedPerson ? 'selected' : ''}>${esc(person.name)}</option>`).join('')}
        </select></label><label>Blessing type<select name="type" required><option value="">Select a type</option>
        ${TYPES.filter(type => type !== PATRIARCHAL_TYPE || !(entry.audio || entry.sampleAudio)).map(type =>
          `<option ${entry.suggestType === type ? 'selected' : ''}>${esc(type)}</option>`).join('')}
        </select></label></div>
      <label>Or create a new person<input name="newPerson" maxlength="70" value="${esc(entry.newPerson)}" placeholder="Display name"></label>
      <div data-duplicate hidden></div>
      <div class="field-row"><label>Date given<input type="date" name="date" value="${esc(entry.date)}"></label>
      <label>Given by<input name="giver" maxlength="100" value="${esc(entry.giver)}" placeholder="Name"></label></div>
      <label>Occasion<input name="occasion" maxlength="150" value="${esc(entry.occasion)}" placeholder="For example, starting school"></label>
      <label>${entry.audio || entry.sampleAudio ? 'Transcript' : 'Blessing text'}<textarea name="text" rows="7" placeholder="Review or enter the blessing text.">${esc(entry.text)}</textarea></label>
      ${entry.simulated ? '<p class="hint">Sample text for this demo. You can replace it before filing.</p>' : ''}
      ${entry.audio ? `<div class="button-row compact">${action('Try sample transcription', 'transcribe', { id: entry.id, style: 'outline' })}${action('Simulate failure', 'transcription-failure', { id: entry.id })}</div>` : ''}
      ${entry.failed ? '<p class="hint">Transcription failed. Your audio is saved. Retry or enter the text above.</p>' : ''}
      <div class="form-footer"><button class="button outline" type="submit" value="draft" formnovalidate>Save for later</button><button class="button primary" type="submit" value="file">File blessing</button></div>
    </form>`;
}

function searchScreen() {
  return `${title('Search', 'Find words, notes, and highlights across your family archive.')}
    <label class="search-field">${icon('⌕')}<input id="query" type="search" placeholder="Search blessings…" value="${esc(query)}" aria-label="Search blessings"></label>
    <div id="search-results" aria-live="polite"></div>`;
}

function renderResults() {
  const results = document.querySelector('#search-results');
  if (!results) return;
  const matches = searchEntries(state, query);
  results.innerHTML = query.trim() ? `<p class="hint">${countLabel(matches.length, 'result')}</p>
    ${matches.length ? `<div class="list">${matches.map(({ entry, snippet }) => entryRow(entry, snippet, 'search')).join('')}</div>` : '<div class="empty"><p>Try a different word or phrase.</p></div>'}`
    : '<p class="hint">Try a name, a blessing type, or “courage.”</p>';
}

function insightsScreen(person) {
  const insights = insightsFor(state, person.id);
  return `${back(person.name, 'person', person.id)}
    ${title('Blessing insights', person.name)}
    ${person.id === state.active ? `<div class="button-row compact">${action(person.insightsOff ? 'Enable insights' : 'Disable insights', 'toggle-ai', { id: person.id, style: 'outline' })}</div>` : ''}
    ${person.insightsOff ? '<div class="empty"><h2>Insights are off.</h2><p>This person’s blessings are excluded from analysis.</p></div>' :
      `<p class="hint">Illustrative insights generated locally for this demo.</p>
      ${insights.some(insight => insight.kind === 'Recurring theme') ? '' : '<div class="empty"><p>More blessings with shared themes are needed to show patterns across time.</p></div>'}
      <div class="insight-grid">${insights.map(insight => `<article class="insight card"><span class="kicker">${icon('✦')} ${esc(insight.kind)}</span>
        <h2>${esc(insight.title)}</h2><p>${esc(insight.body)}</p>
        <div class="insight-sources">${insight.sources.map(({ entry, quote }) =>
          `<button data-action="detail" data-origin="insights" data-id="${esc(entry.id)}"><q>${esc(quote)}</q><small>${esc(entry.type)} · ${esc(displayDate(entry.date))} →</small></button>`).join('')}</div>
      </article>`).join('')}</div>`}`;
}

function recordingScreen() {
  return `${title('Record a blessing', '')}<section class="record-panel card"><span class="record-dot" aria-hidden="true"></span>
    <p id="record-status" role="status">${capture?.recorder ? 'Recording' : 'Opening microphone…'}</p><strong id="elapsed" aria-label="Elapsed time">0:00</strong>
    <button type="button" class="button primary" data-action="stop" disabled>${icon('■')} Stop &amp; save</button>
    ${action('Cancel', 'cancel-recording')}</section>`;
}

function render() {
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = undefined;
  dismissPassageSelection();
  let content;
  const person = visiblePeople(state).find(item => item.id === page.id);
  if (page.name === 'unfiled') content = unfiledScreen();
  if (page.name === 'search') content = searchScreen();
  if (page.name === 'person' && person) content = personScreen(person);
  if (page.name === 'insights' && person) content = insightsScreen(person);
  if (page.name === 'detail') {
    const entry = visibleEntries(state).find(item => item.id === page.id);
    if (entry) content = detailScreen(entry);
  }
  if (page.name === 'draft') {
    const entry = unfiled().find(item => item.id === page.id);
    if (entry) content = draftScreen(entry);
  }
  if (page.name === 'recording') content = recordingScreen();
  if (!content) {
    page = { name: 'family' };
    content = familyScreen();
  }
  app.innerHTML = `<div class="layout">
    <aside class="sidebar"><div class="sidebar-top">${brand()}${action('Record', 'record', { symbol: '●', style: 'primary', extra: 'sidebar-record' })}</div>
      ${nav()}<div class="sidebar-bottom"><span class="demo-label">FICTIONAL DEMO</span>${action(displayAccount() || 'Account', 'accounts', { symbol: '◉', style: 'outline', extra: 'desktop-account' })}</div>
    </aside>
    <div class="body"><header class="topbar">${brand()}<button class="account-button" data-action="accounts">Demo account <span aria-hidden="true">⌄</span></button></header>
      <main id="main">${content}</main>
      <footer class="footer">Blessed <span>·</span> Fictional demo. Changes stay in this browser.</footer>
    </div>
    <div class="mobile-nav">${nav()}${action('Record', 'record', { symbol: '●', style: 'primary' })}</div>
  </div>`;
  renderResults();
  updateDuplicate();
}

function closeSheet() {
  if (sheet.open) sheet.close();
}

function openSheet(heading, content) {
  sheet.innerHTML = `<div class="sheet-head"><h2 id="sheet-title">${esc(heading)}</h2><button type="button" data-action="close" class="close" aria-label="Close">×</button></div>${content}`;
  if (!sheet.open) sheet.showModal();
}

function addDraft(data, owner = homeFor(state.active)) {
  const entry = {
    id: uid(), owner, source: '', date: today(), text: '', annotations: [], journal: '', ...data,
  };
  return update(next => next.entries.push(entry)).then(() => entry.id);
}

function newPerson(next, name) {
  const colors = ['rose', 'green', 'gold', 'plum'];
  const person = {
    id: uid(), name, home: homeFor(next.active), relation: 'Family member',
    color: colors[next.people.length % colors.length],
  };
  next.people.push(person);
  return person;
}

function importOptions(personId, patriarchal = false) {
  const buttons = [
    ...(!patriarchal ? [['Audio file or Voice Memo', 'import-audio', '◉']] : []),
    ['PDF blessing', 'import-pdf', '▤'],
    ['Paste written text', 'import-text', '✎'],
    ...(!patriarchal ? [['Try a sample recording', 'sample', '●']] : []),
  ];
  openSheet(patriarchal ? 'Add Patriarchal Blessing' : 'Import a blessing',
    `<div class="stack" data-patriarchal="${patriarchal}">${buttons.map(([label, command, symbol]) =>
      action(label, command, { id: personId, symbol, style: 'outline' })).join('')}</div>`);
}

function importForm(kind, personId, patriarchal) {
  const labels = { audio: 'Audio file or Voice Memo', pdf: 'PDF blessing', text: 'Written blessing' };
  openSheet(labels[kind], `<form class="form" data-form="import" data-kind="${kind}" data-id="${esc(personId)}" data-patriarchal="${patriarchal}">
    ${kind === 'text' ? '<label>Blessing text<textarea rows="7" name="text" required></textarea></label>' : `<label>Choose a file<input type="file" name="file" required accept="${kind === 'pdf' ? 'application/pdf,.pdf' : 'audio/*,.m4a,.aac,.mp3,.wav,.caf,.webm,.ogg'}"></label>`}
    ${kind === 'pdf' ? '<p class="hint">The demo fills in fictional text for you to review.</p>' : ''}
    <button class="button primary" type="submit">Save to Unfiled</button></form>`);
}

function accounts() {
  const adult = currentPerson();
  const options = [['parent', 'Daniel · Parent'], ['spouse', 'Grace · Parent']]
    .concat(state.people.filter(person => person.claimed).map(person => [person.id, person.name + ' · Adult']));
  const invitations = state.people.filter(person => person.invited && !person.claimed);
  openSheet('Demo accounts', `<p class="hint">Switch between fictional accounts on this device.</p>
    <div class="stack">${options.map(([id, name]) => state.active === id
      ? `<p class="active-role">${esc(name)} <small>Active</small></p>` : action(name, 'switch-account', { id, style: 'outline' })).join('')}</div>
    ${invitations.length ? `<h3>Pending invitations</h3><div class="stack">${invitations.map(person => action('Open as ' + person.name, 'accept-invite', { id: person.id, style: 'outline' })).join('')}</div>` : ''}
    ${adult ? `<h3>Your blessings</h3><form class="form" data-form="preferences" data-id="${esc(adult.id)}">
      <label class="check"><input name="share" type="checkbox" ${adult.shareNew ? 'checked' : ''}>Share new blessings with my parents</label>
      <label class="check"><input name="insights" type="checkbox" ${adult.insightsOff ? '' : 'checked'}>Allow insights from my blessings</label>
      <button type="submit" class="button primary">Save preferences</button></form>` : ''}
    <div class="sheet-footer">${action('Reset demo data', 'reset-confirm')}</div>`);
}

function entryFields(entry) {
  return `<div class="field-row"><label>Date given<input type="date" name="date" value="${esc(entry.date)}"></label>
    <label>Given by<input name="giver" maxlength="100" value="${esc(entry.giver)}"></label></div>
    <label>Occasion<input name="occasion" maxlength="150" value="${esc(entry.occasion)}"></label>
    <label>Blessing text<textarea name="text" rows="8" ${entry.type === PATRIARCHAL_TYPE ? 'required' : ''}>${esc(entry.text)}</textarea></label>`;
}

function editEntry(entry, kind) {
  if (!entry || !canEdit(entry)) return;
  const heading = { edit: 'Edit blessing', journal: 'Blessing journal' }[kind];
  const fields = {
    edit: entryFields(entry),
    journal: `<label>Journal note<textarea name="journal" rows="7">${esc(entry.journal)}</textarea></label>`,
  };
  openSheet(heading, `<form class="form" data-form="${kind}" data-id="${esc(entry.id)}">${fields[kind]}
    <button class="button primary" type="submit">Save</button></form>`);
}

function updateDuplicate() {
  const form = app.querySelector('[data-form="file"]');
  if (!form) return;
  const box = form.querySelector('[data-duplicate]');
  const entry = unfiled().find(item => item.id === form.dataset.id);
  const duplicate = !form.elements.newPerson.value.trim() &&
    duplicatePatriarchal(state, entry, form.elements.person.value, form.elements.type.value);
  box.hidden = !duplicate;
  box.innerHTML = duplicate ? `<p>This person already has a Patriarchal Blessing.</p>
    ${action('Open existing blessing', 'detail', { id: duplicate.id, style: 'outline' })}` : '';
  form.querySelector('[value="file"]').disabled = Boolean(duplicate);
}

function writeFields(entry, data) {
  entry.date = String(data.get('date') || '');
  entry.giver = String(data.get('giver') || '').trim();
  entry.occasion = String(data.get('occasion') || '').trim();
  const text = String(data.get('text') || '').trim();
  if (entry.text !== text) entry.simulated = false;
  entry.text = text;
}

function saveDraftFields(entry, data) {
  writeFields(entry, data);
  entry.suggestPerson = data.get('person');
  entry.suggestType = data.get('type');
  entry.newPerson = String(data.get('newPerson') || '').trim();
}

function fail(error, scope) {
  const message = ['QuotaExceededError', 'UnknownError'].includes(error?.name)
    ? 'Browser storage could not save this change.' : error?.message || 'Something went wrong.';
  if (scope?.isConnected) {
    const existing = scope.querySelector('.form-error');
    if (existing) existing.textContent = message;
    else {
      const banner = document.createElement('p');
      banner.className = 'form-error';
      banner.setAttribute('role', 'alert');
      banner.textContent = message;
      scope.append(banner);
    }
  } else toast(message);
}

async function saveRecording(blob, owner) {
  retryAudio = { blob, owner };
  savingRecording = true;
  try {
    await addDraft({ source: 'Recording', audio: blob }, owner);
    retryAudio = undefined;
    go('unfiled');
    toast('Recording saved to Unfiled.');
  } catch (error) {
    go('unfiled');
    openSheet('Recording needs to be saved', `<p>The recording is still in this tab. Retry saving or download a copy before closing the page.</p>
      <div class="button-row">${action('Retry save', 'retry-recording', { style: 'primary' })}
      ${action('Download audio', 'download-recording', { style: 'outline' })}</div>`);
    fail(error);
  } finally {
    savingRecording = false;
  }
}

function stopTracks(stream) {
  stream?.getTracks().forEach(track => track.stop());
}

function releaseCapture(session) {
  clearInterval(session.timer);
  stopTracks(session.stream);
  if (capture === session) capture = undefined;
}

async function startRecording() {
  if (capture) return;
  if (retryAudio) {
    await saveRecording(retryAudio.blob, retryAudio.owner);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    microphoneUnavailable();
    return;
  }
  const session = { owner: homeFor(state.active), chunks: [] };
  capture = session;
  go('recording');
  try {
    session.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 1 } } });
    if (session.discard) {
      releaseCapture(session);
      return;
    }
    const recorder = new MediaRecorder(session.stream);
    session.recorder = recorder;
    recorder.ondataavailable = event => { if (event.data.size) session.chunks.push(event.data); };
    recorder.onstop = () => {
      releaseCapture(session);
      if (session.discard) return;
      const blob = new Blob(session.chunks, { type: recorder.mimeType || session.chunks[0]?.type });
      if (blob.size) void saveRecording(blob, session.owner);
      else microphoneUnavailable('No audio was captured.');
    };
    recorder.onerror = () => {
      if (recorder.state !== 'inactive') recorder.stop();
    };
    recorder.start(1000);
    document.querySelector('#record-status').textContent = 'Recording';
    app.querySelector('[data-action=stop]').disabled = false;
    const started = performance.now();
    session.timer = setInterval(() => {
      const seconds = Math.floor((performance.now() - started) / 1000);
      const elapsed = document.querySelector('#elapsed');
      if (elapsed) elapsed.textContent = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    }, 250);
  } catch {
    releaseCapture(session);
    if (!session.discard) microphoneUnavailable();
  }
}

function microphoneUnavailable(message = 'Allow microphone access on localhost or HTTPS, or try a fictional sample recording.') {
  go('unfiled');
  openSheet('Microphone unavailable', `<p>${esc(message)}</p><div class="button-row">
    ${action('Try again', 'record', { style: 'outline' })}${action('Try a sample recording', 'sample', { style: 'primary' })}</div>`);
}

function cancelCapture() {
  if (!capture) return;
  const session = capture;
  session.discard = true;
  if (session.recorder?.state === 'recording') session.recorder.stop();
  releaseCapture(session);
  go('unfiled');
}

async function submit(form, submitter) {
  const data = new FormData(form);
  const { id, kind } = form.dataset;
  const command = form.dataset.form;
  if (command === 'new-person') {
    const name = String(data.get('name')).trim();
    if (!name) throw new Error('Enter a display name.');
    let person;
    await update(next => { person = newPerson(next, name); });
    go('person', person.id);
  }
  if (command === 'new-family') {
    const name = String(data.get('name')).trim();
    if (!name) throw new Error('Enter a family name.');
    await update(next => { next.families[homeFor(next.active)] = name; });
    go('family');
    toast('Family archive created.');
  }
  if (command === 'import') {
    const file = data.get('file');
    const text = kind === 'pdf' ? DEMO_PDF : String(data.get('text') || '').trim();
    if (kind !== 'text' && !file?.size) throw new Error('Choose a file to import.');
    if (kind === 'text' && !text) throw new Error('Enter the blessing text.');
    if (kind === 'pdf' && !/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('Choose a PDF file.');
    if (kind === 'audio' && !file.type.startsWith('audio/') && !/\.(m4a|aac|mp3|wav|caf|webm|ogg|flac|aiff|mp4)$/i.test(file.name)) {
      throw new Error('Choose an audio file or Voice Memo.');
    }
    const entryId = await addDraft({
      source: { text: 'Written blessing', pdf: 'PDF import', audio: 'Audio import' }[kind],
      name: file?.name, text, audio: kind === 'audio' ? file : undefined, simulated: kind === 'pdf',
      suggestPerson: id, suggestType: form.dataset.patriarchal === 'true' ? PATRIARCHAL_TYPE : '',
    });
    go('draft', entryId);
    toast('Import saved to Unfiled.');
  }
  if (command === 'file') {
    const isFiling = submitter?.value !== 'draft';
    let personId;
    await update(next => {
      const entry = next.entries.find(item => item.id === id);
      if (!entry || entry.personId || entry.owner !== homeFor(next.active)) throw new Error('This draft is unavailable.');
      saveDraftFields(entry, data);
      if (!isFiling) return;
      const person = entry.newPerson ? newPerson(next, entry.newPerson) : personFor(next, data.get('person'));
      fileEntry(next, entry, person, data.get('type'));
      personId = person.id;
      delete entry.newPerson;
      delete entry.suggestPerson;
      delete entry.suggestType;
    });
    if (personId) go('detail', id);
    else go('unfiled');
    toast(personId ? 'Blessing filed.' : 'Draft saved.');
  }
  if (command === 'passage-note') {
    const entry = detailEntry();
    const index = Number(form.dataset.index);
    const start = Number(form.dataset.start);
    const quote = entry.annotations[index]?.quote || sheet.querySelector('.passage-quote').textContent;
    const note = String(data.get('note')).trim();
    if (index < 0 && !note) throw new Error('Enter a note.');
    await applyPassageChange({ entryId: id, index, start, quote }, { note, ...(index < 0 ? { highlight: true } : {}) });
  }
  if (command === 'edit' || command === 'journal') {
    await update(next => {
      const entry = next.entries.find(item => item.id === id);
      if (command === 'edit') {
        writeFields(entry, data);
        if (entry.type === PATRIARCHAL_TYPE && !entry.text) throw new Error('Enter the written blessing.');
      }
      if (command === 'journal') entry.journal = String(data.get('journal')).trim();
    });
    closeSheet();
    render();
    toast('Saved.');
  }
  if (command === 'preferences') {
    await update(next => {
      const person = personFor(next, next.active);
      person.shareNew = data.has('share');
      person.insightsOff = !data.has('insights');
    });
    closeSheet();
    render();
    toast('Preferences saved for your account.');
  }
}

async function perform(button) {
  const { action: command, id, origin } = button.dataset;
  const person = visiblePeople(state).find(item => item.id === id);
  const entry = visibleEntries(state).find(item => item.id === id);
  if (command === 'close') closeSheet();
  if (command === 'cancel-recording' && capture && !capture.stopping) {
    openSheet('Discard this recording?', `<p>Choose Stop &amp; save to keep it in Unfiled.</p>
      <div class="button-row">${action('Keep recording', 'close', { style: 'outline' })}${action('Discard recording', 'discard-recording', { style: 'primary' })}</div>`);
  }
  if (command === 'discard-recording') cancelCapture();
  if (command === 'stop' && capture?.recorder?.state === 'recording') {
    capture.stopping = true;
    button.disabled = true;
    app.querySelector('[data-action=cancel-recording]').disabled = true;
    closeSheet();
    document.querySelector('#record-status').textContent = 'Saving audio…';
    capture.recorder.stop();
  }
  if (capture || savingRecording) return;

  if (['family', 'unfiled', 'search'].includes(command)) go(command);
  if (command === 'person' && person) go('person', id);
  if (command === 'insights' && person) go('insights', id);
  if (command === 'detail' && entry) go('detail', id, origin);
  if (command === 'draft' && unfiled().some(item => item.id === id)) go('draft', id);
  if (command === 'record') {
    // Let the permission prompt run independently so Cancel stays available.
    void startRecording();
  }
  if (command === 'retry-recording' && retryAudio) await saveRecording(retryAudio.blob, retryAudio.owner);
  if (command === 'download-recording' && retryAudio) {
    const url = URL.createObjectURL(retryAudio.blob);
    const link = document.createElement('a');
    link.href = url;
    const mime = retryAudio.blob.type.split(';')[0];
    const extension = ({ 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/webm': 'webm' })[mime] || 'audio';
    link.download = 'blessed-recording.' + extension;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  if (command === 'import' || command === 'patriarchal') importOptions(id, command === 'patriarchal');
  if (['import-audio', 'import-pdf', 'import-text'].includes(command)) {
    importForm(command.slice(7), id, button.closest('[data-patriarchal]')?.dataset.patriarchal === 'true');
  }
  if (command === 'sample') {
    await addDraft({ source: 'Sample recording', sampleAudio: true, simulated: true, text: DEMO_TRANSCRIPT, suggestPerson: id });
    go('unfiled');
    toast('Sample recording saved to Unfiled.');
  }
  if (command === 'transcribe' || command === 'transcription-failure') {
    const form = document.querySelector('[data-form="file"]');
    const data = new FormData(form);
    await update(next => {
      const draft = next.entries.find(item => item.id === id);
      saveDraftFields(draft, data);
      draft.failed = command === 'transcription-failure';
      if (!draft.failed && !draft.text) {
        draft.text = DEMO_TRANSCRIPT;
        draft.simulated = true;
      }
    });
    render();
    toast(command === 'transcribe' ? 'Transcript ready for review.' : 'Audio kept in Unfiled.');
  }
  if (command === 'new-person' || command === 'new-family') {
    const family = command === 'new-family' || !familyName();
    openSheet(family ? 'Start a family archive' : 'Add a person', `<form class="form" data-form="${family ? 'new-family' : 'new-person'}">
      <label>${family ? 'Family name' : 'Display name'}<input name="name" required maxlength="70"></label>
      <button class="button primary" type="submit">${family ? 'Create family' : 'Add person'}</button></form>`);
  }
  if (command === 'edit-entry') editEntry(entry, 'edit');
  if (command === 'passage-existing') {
    const current = detailEntry();
    if (current) showPassageMenu(current, button.getBoundingClientRect(), { index: Number(id) - 1 }, true);
  }
  if (command.startsWith('passage-') && command !== 'passage-existing' && passageMenu) {
    const context = passageMenu;
    const current = detailEntry();
    if (!current || current.id !== context.entryId) return;
    if (command === 'passage-note') openPassageNote(current, context);
    if (command === 'passage-highlight') await applyPassageChange(context, { highlight: true });
    if (command === 'passage-remove') await applyPassageChange(context, { highlight: false });
    if (command === 'passage-color') await applyPassageChange(context, { highlight: true, color: id });
    if (command === 'passage-palette') {
      const selected = current.annotations[context.index]?.color || 'yellow';
      context.element.innerHTML = `<div class="passage-palette" aria-label="Highlight color">${HIGHLIGHT_COLORS.map(color =>
        `<button type="button" class="color-choice" data-action="passage-color" data-id="${color}" data-color="${color}" aria-pressed="${color === selected}"><span></span>${color}</button>`).join('')}</div>`;
      positionPassageMenu();
      context.element.querySelector('[aria-pressed=true]')?.focus({ preventScroll: true });
    }
  }
  if (command === 'journal') editEntry(entry, 'journal');
  if (command === 'accounts') accounts();
  if (command === 'switch-account') {
    await update(next => { next.active = id; });
    query = '';
    go('family');
  }
  if (command === 'invite' && person && !person.claimed) {
    openSheet('Adult account invitation', `<p>${esc(person.name)} can claim this profile and its blessing history. Your family keeps access to existing blessings.</p>
      ${person.invited ? `<p class="hint">Invitation pending. Open it from Demo accounts.</p>${action('Open demo accounts', 'accounts', { style: 'primary' })}` :
        action('Send demo invitation', 'send-invite', { id, style: 'primary' })}`);
  }
  if (command === 'send-invite' && person && !person.claimed) {
    await update(next => { personFor(next, id).invited = true; });
    closeSheet();
    render();
    toast('Demo invitation sent. Open it from Demo accounts.');
  }
  if (command === 'accept-invite') {
    const invitee = personFor(state, id);
    if (!invitee?.invited || invitee.claimed) return;
    openSheet('Claim your blessing archive', `<p>Accept this demo invitation as ${esc(invitee.name)}. Your parents can still read prior blessings. You choose whether to share new ones.</p>
      ${action('Accept invitation', 'claim', { id, style: 'primary' })}`);
  }
  if (command === 'claim') {
    await update(next => {
      const recipient = personFor(next, id);
      if (!recipient?.invited || recipient.claimed) throw new Error('This invitation is unavailable.');
      Object.assign(recipient, { claimed: true, invited: false, shareNew: false });
      next.active = id;
    });
    query = '';
    go('person', id);
    toast('You now manage your blessing archive.');
  }
  if (command === 'toggle-ai' && id === state.active) {
    await update(next => {
      const self = personFor(next, id);
      self.insightsOff = !self.insightsOff;
    });
    render();
  }
  if (command === 'reset-confirm') {
    openSheet('Reset demo data?', `<p>This clears recordings, imports, notes, and profile changes saved by this browser.</p>
      <div class="button-row">${action('Cancel', 'close', { style: 'outline' })}${action('Reset demo', 'reset', { style: 'primary' })}</div>`);
  }
  if (command === 'reset') {
    await update(next => Object.assign(next, seed()));
    retryAudio = undefined;
    query = '';
    go('family');
    toast('Fictional demo data restored.');
  }
}

async function run(work, scope) {
  if (busy) return;
  busy = true;
  try {
    await work();
  } catch (error) {
    fail(error, scope);
  } finally {
    busy = false;
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (button) void run(() => perform(button));
});

document.addEventListener('submit', event => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  void run(() => submit(form, event.submitter), form);
});

document.addEventListener('input', event => {
  if (event.target.id === 'query') {
    query = event.target.value;
    renderResults();
  }
  if (event.target.closest('[data-form="file"]') &&
      ['newPerson', 'person', 'type'].includes(event.target.name)) updateDuplicate();
});

function openExistingHighlight(mark, focus) {
  const entry = detailEntry();
  if (!entry) return;
  showPassageMenu(entry, mark.getBoundingClientRect(), { index: Number(mark.dataset.highlight) }, focus);
}

document.addEventListener('pointerdown', event => {
  if (event.target.closest?.('[data-selection-handle]')) return;
  if (passageMenu?.element.contains(event.target)) {
    clearTimeout(selectionTimer);
    return;
  }
  dismissPassageSelection();
  pointerSelecting = Boolean(event.target.closest?.('#transcript:not(.touch-transcript)'));
});

for (const type of ['pointerup', 'pointercancel', 'touchend']) {
  document.addEventListener(type, event => {
    if (passageMenu?.element.contains(event.target)) return;
    pointerSelecting = false;
    if (event.target.closest?.('#transcript:not(.touch-transcript)') || document.getSelection()?.isCollapsed === false) queueSelectionMenu(0);
  });
}

document.addEventListener('click', event => {
  const mark = event.target.closest?.('#transcript [data-highlight]');
  if (mark && !touchPassage && document.getSelection()?.isCollapsed) openExistingHighlight(mark, event.detail === 0);
});

document.addEventListener('selectionchange', () => {
  const selection = document.getSelection();
  if (!pointerSelecting && selection && !selection.isCollapsed &&
      !passageMenu?.element.contains(document.activeElement)) queueSelectionMenu(150);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') dismissPassageSelection();
  const mark = event.target.closest?.('#transcript [data-highlight]');
  if (mark && ['Enter', ' '].includes(event.key)) {
    event.preventDefault();
    openExistingHighlight(mark, true);
  }
});

document.addEventListener('touchstart', startSelectionTouch, { passive: false, capture: true });
document.addEventListener('touchmove', moveSelectionTouch, { passive: false });
document.addEventListener('touchend', endSelectionTouch, { passive: false });
document.addEventListener('touchcancel', dismissPassageSelection);
document.addEventListener('selectstart', event => {
  if (event.target.closest?.('.touch-transcript')) event.preventDefault();
});
document.addEventListener('contextmenu', event => {
  if (event.target.closest?.('#transcript, .touch-selection-layer')) event.preventDefault();
});

window.addEventListener('scroll', () => {
  if (!touchGesture?.scrolling) dismissPassageSelection();
}, { passive: true });
window.addEventListener('resize', dismissPassageSelection);

sheet.addEventListener('cancel', event => { if (busy) event.preventDefault(); });

try {
  db = await openDatabase();
  state = await load();
  render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
  }
} catch {
  app.innerHTML = '<main class="startup-error"><h1>Blessed</h1><p>Browser storage is unavailable. Open the prototype in a browser that allows local site data.</p></main>';
}
