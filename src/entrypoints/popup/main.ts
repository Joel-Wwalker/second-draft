import type {
  ApplyRequest,
  ApplyResponse,
  CancelRequest,
  HumanizeRequest,
  PendingRefusal,
  PendingSelection,
  PortServerMessage,
  UndoRequest,
} from '../../shared/messages';
import { HUMANIZE_PORT, PENDING_KEY, isPendingFresh, isPendingSelection } from '../../shared/messages';
import type { HumanizeResult, Intensity } from '../../shared/types';
import { getSettings, updateSettings, isSiteDisabled, toggleSiteDisabled } from '../../shared/storage';
import { engineLabel as engineLabelFor, resultStatus } from '../../shared/labels';
import { formatChanges } from '../../shared/change-log';
import { findAlternatives, shiftRangesAfter, swapWord } from '../../shared/alternatives';
import type { AltSpan } from '../../shared/alternatives';
import { analyzeWriting, compareToProfile } from '../../shared/profile';
import type { Change } from '../../shared/types';

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const input = byId<HTMLTextAreaElement>('input');
const out = byId<HTMLDivElement>('out');
const outField = byId<HTMLDivElement>('outField');
const intensityGroup = byId<HTMLDivElement>('intensity');
const go = byId<HTMLButtonElement>('go');
const copy = byId<HTMLButtonElement>('copy');
const regen = byId<HTMLButtonElement>('regen');
const applyBtn = byId<HTMLButtonElement>('apply');
const undoBtn = byId<HTMLButtonElement>('undo');
const resultRow = byId<HTMLDivElement>('resultRow');
const status = byId<HTMLParagraphElement>('status');
const headline = byId<HTMLDivElement>('headline');
const ring = byId<HTMLDivElement>('ring');
const ringFg = document.getElementById('ringFg') as unknown as SVGCircleElement;
const ringNum = byId<HTMLSpanElement>('ringNum');
const engineLabel = byId<HTMLSpanElement>('engine');
const profileNote = byId<HTMLParagraphElement>('profileNote');
const fidelityEl = byId<HTMLDivElement>('fidelity');
const changesBox = byId<HTMLDetailsElement>('changesBox');
const changesList = byId<HTMLDivElement>('changesList');
const openOptions = byId<HTMLButtonElement>('openOptions');
const siteRow = byId<HTMLLabelElement>('siteRow');
const siteToggle = byId<HTMLInputElement>('siteToggle');
const siteHost = byId<HTMLSpanElement>('siteHost');

const RING_CIRCUMFERENCE = 106.8;
/** Give up if nothing arrives for this long. "The worker never answered" is a real MV3 state. */
const REQUEST_TIMEOUT_MS = 60_000;
/** A right click opens this window before the text has been parked, so wait for it. */
const HANDOFF_WAIT_MS = 1500;

type HandedText = Extract<PendingSelection, { kind: 'text' }>;

/** Where the text came from, when it arrived from a page selection. */
let pending: HandedText | null = null;
/** The rewrite currently on screen, including any alternative words swapped in. */
let current: { text: string; changes: Change[]; result: HumanizeResult } | null = null;
/** The long-lived connection rewrites stream over. */
let port: chrome.runtime.Port | null = null;
let inFlight: { id: string; original: string; timer: ReturnType<typeof setTimeout> } | null = null;
let requests = 0;
let intensity: Intensity = 'light';

void init();

async function init(): Promise<void> {
  const settings = await getSettings();
  setIntensity(settings.defaultIntensity, false);
  for (const option of intensityGroup.querySelectorAll<HTMLButtonElement>('.seg-opt')) {
    option.addEventListener('click', () => setIntensity(option.dataset['value'] as Intensity, true));
  }
  go.addEventListener('click', () => run());
  regen.addEventListener('click', () => run());
  copy.addEventListener('click', () => void navigator.clipboard.writeText(out.textContent ?? '').catch(() => {}));
  openOptions.addEventListener('click', () => void chrome.runtime.openOptionsPage());
  applyBtn.addEventListener('click', () => void applyToPage());
  undoBtn.addEventListener('click', () => void undoOnPage());

  await wireSiteToggle();
  await showEngine(settings);

  // Text handed over by a right click or the keyboard shortcut starts on its own.
  const handed = await takePending();
  if (handed?.kind === 'text') {
    pending = handed;
    input.value = handed.text;
    run();
  } else if (handed?.kind === 'refused') {
    showRefusal(handed.reason);
  }
}

/**
 * Read the parked selection, if there is one worth having. The background opens
 * this window before it parks the text, so a right click arrives a moment after
 * we start. Anything stale is dropped rather than run: a selection nobody read
 * must not rewrite itself in a popup opened days later for something else.
 */
function takePending(): Promise<PendingSelection | null> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: PendingSelection | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.storage.onChanged.removeListener(onChanged);
      resolve(value);
    };
    const tryRead = (): void => {
      void consumePending().then(parked => {
        if (parked) finish(parked);
      });
    };
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
      if (area === 'local' && PENDING_KEY in changes) tryRead();
    };
    const timer = setTimeout(() => finish(null), HANDOFF_WAIT_MS);
    chrome.storage.onChanged.addListener(onChanged);
    tryRead();
  });
}

async function consumePending(): Promise<PendingSelection | null> {
  const stored = await chrome.storage.local.get(PENDING_KEY);
  const parked: unknown = stored[PENDING_KEY];
  if (parked === undefined) return null;
  // Whatever it was, it has been read now. Clearing it here is what stops the
  // same text from running again the next time this popup opens.
  await chrome.storage.local.remove(PENDING_KEY);
  void chrome.action.setBadgeText({ text: '' });
  if (!isPendingSelection(parked) || !isPendingFresh(parked, Date.now())) return null;
  return parked;
}

const REFUSALS: Record<PendingRefusal, { headline: string; status: string }> = {
  none: {
    headline: 'Nothing selected',
    status: 'Select some text on the page, then right click and choose Humanize.',
  },
  sensitive: {
    headline: 'Nothing captured',
    status: 'Second Draft does not read password, payment, or one-time-code fields.',
  },
  unavailable: {
    headline: 'Not running on that page',
    status: 'It may be turned off for this site, or the page may not allow extensions. You can paste text here instead.',
  },
};

function showRefusal(reason: PendingRefusal): void {
  headline.textContent = REFUSALS[reason].headline;
  status.textContent = REFUSALS[reason].status;
}

function run(): void {
  const text = input.value.trim();
  if (!text) return;
  if (inFlight) cancelInFlight();
  setWorking(true);
  resetResult();
  const id = `req-${++requests}`;
  try {
    const req: HumanizeRequest = { type: 'humanize', id, text, intensity };
    connect().postMessage(req);
  } catch (err) {
    setWorking(false);
    fail(String(err));
    return;
  }
  inFlight = { id, original: text, timer: armTimeout(id) };
}

/**
 * Rewrites stream, so this is a long-lived port rather than a one-shot message.
 * Closing the popup disconnects it, which is what cancels the work in flight.
 */
function connect(): chrome.runtime.Port {
  if (port) return port;
  const opened = chrome.runtime.connect({ name: HUMANIZE_PORT });
  opened.onMessage.addListener(msg => onPortMessage(msg as PortServerMessage));
  opened.onDisconnect.addListener(() => {
    if (port === opened) port = null;
    if (!inFlight) return;
    clearInFlight();
    setWorking(false);
    fail('The background worker stopped before it answered. Try again.');
  });
  port = opened;
  return opened;
}

function onPortMessage(msg: PortServerMessage): void {
  if (!inFlight || msg.id !== inFlight.id) return; // superseded or cancelled
  if (msg.type === 'chunk') {
    outField.hidden = false;
    out.textContent = msg.textSoFar;
    // Text arriving is proof of life, so the timeout is an idle timeout.
    clearTimeout(inFlight.timer);
    inFlight = { ...inFlight, timer: armTimeout(msg.id) };
    return;
  }
  const { original } = inFlight;
  clearInFlight();
  setWorking(false);
  if (msg.type === 'done') render(msg.result, original);
  else fail(msg.message);
}

function armTimeout(id: string): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    if (inFlight?.id !== id) return;
    cancelInFlight();
    setWorking(false);
    fail('Nothing came back for a minute. Try again, or try a shorter piece of text.');
  }, REQUEST_TIMEOUT_MS);
}

function cancelInFlight(): void {
  if (!inFlight) return;
  const req: CancelRequest = { type: 'cancel', id: inFlight.id };
  try {
    port?.postMessage(req);
  } catch {
    // Port already gone; the background aborts everything on disconnect.
  }
  clearInFlight();
}

function clearInFlight(): void {
  if (inFlight) clearTimeout(inFlight.timer);
  inFlight = null;
}

function render(result: HumanizeResult, original: string): void {
  current = { text: result.rewritten, changes: [...result.changes], result };
  outField.hidden = false;
  resultRow.hidden = false;
  copy.disabled = false;
  engineLabel.textContent = engineLabelFor(result.engine);
  status.textContent = resultStatus(result) + retryNote(result);
  setRing(result.tells.before, result.tells.after);
  headline.textContent =
    result.tells.before === 0
      ? 'Looks human already'
      : result.tells.after === 0
        ? 'All clear'
        : `${result.tells.after} tell${result.tells.after === 1 ? '' : 's'} left`;
  renderFidelity(result.fidelity);
  renderChanges(result, original);
  void renderProfileNote(result.rewritten);
  applyBtn.hidden = !(pending?.canApply ?? false);
  undoBtn.hidden = true;
  renderBody();
}

function setIntensity(next: Intensity, remember: boolean): void {
  intensity = next;
  for (const option of intensityGroup.querySelectorAll<HTMLButtonElement>('.seg-opt')) {
    const on = option.dataset['value'] === next;
    option.classList.toggle('on', on);
    option.setAttribute('aria-pressed', String(on));
  }
  if (remember) void updateSettings({ defaultIntensity: next });
}

/** A second pass ran. Say so, without claiming it worked when it did not. */
function retryNote(result: HumanizeResult): string {
  if (!result.retried) return '';
  return result.fidelity.length === 0
    ? ' Rewrote it twice to keep your facts.'
    : ' Rewrote it twice; what is still missing is below.';
}

/** Rewrite text with change highlights and clickable alternative words. */
function renderBody(): void {
  if (!current) return;
  out.textContent = '';
  const text = current.text;
  const changes = current.changes
    .filter(c => c.range.end > c.range.start)
    .sort((a, b) => a.range.start - b.range.start);
  const alts = findAlternatives(
    text,
    changes.map(c => c.range),
  );
  type Piece =
    | { start: number; end: number; kind: 'mark'; reason: string }
    | { start: number; end: number; kind: 'alt'; span: AltSpan };
  const pieces: Piece[] = [
    ...changes.map(c => ({ start: c.range.start, end: c.range.end, kind: 'mark' as const, reason: c.reason })),
    ...alts.map(a => ({ start: a.start, end: a.end, kind: 'alt' as const, span: a })),
  ].sort((a, b) => a.start - b.start);

  let pos = 0;
  for (const piece of pieces) {
    if (piece.start < pos) continue;
    if (piece.start > pos) out.append(text.slice(pos, piece.start));
    if (piece.kind === 'mark') {
      const mark = document.createElement('mark');
      mark.textContent = text.slice(piece.start, piece.end);
      mark.title = piece.reason;
      out.append(mark);
    } else {
      const btn = document.createElement('button');
      btn.className = 'alt';
      btn.type = 'button';
      btn.textContent = piece.span.word;
      btn.title = `Swap for: ${piece.span.options.join(', ')}`;
      btn.addEventListener('click', () => openAlts(btn, piece.span));
      out.append(btn);
    }
    pos = piece.end;
  }
  if (pos < text.length) out.append(text.slice(pos));
}

function openAlts(anchor: HTMLElement, span: AltSpan): void {
  document.querySelectorAll('.alts').forEach(el => el.remove());
  const pop = document.createElement('div');
  pop.className = 'alts';
  for (const option of span.options) {
    const choice = document.createElement('button');
    choice.className = 'alt-opt';
    choice.type = 'button';
    choice.textContent = option;
    choice.addEventListener('click', () => {
      if (!current) return;
      const before = current.text;
      current.text = swapWord(before, span, option);
      current.changes = shiftRangesAfter(current.changes, span.end, current.text.length - before.length);
      pop.remove();
      renderBody();
    });
    pop.append(choice);
  }
  anchor.insertAdjacentElement('afterend', pop);
}

function renderFidelity(issues: HumanizeResult['fidelity']): void {
  fidelityEl.textContent = '';
  fidelityEl.hidden = issues.length === 0;
  if (issues.length === 0) return;
  const label = document.createElement('b');
  label.textContent = issues.length === 1 ? 'Check this' : 'Check these';
  fidelityEl.append(label);
  for (const issue of issues) {
    const line = document.createElement('div');
    line.textContent = issue.message;
    fidelityEl.append(line);
  }
}

function renderChanges(result: HumanizeResult, original: string): void {
  changesList.textContent = '';
  const rows = formatChanges(result, original);
  changesBox.hidden = rows.length === 0;
  changesBox.open = rows.length > 0 && rows.length <= 3;
  for (const row of rows) {
    const item = document.createElement('div');
    item.className = 'chg';
    const why = document.createElement('span');
    why.className = 'why';
    why.textContent = row.reason;
    const line = document.createElement('div');
    const before = document.createElement('s');
    before.className = 'b';
    before.textContent = row.before;
    const after = document.createElement('span');
    after.className = 'a';
    after.textContent = row.after;
    line.append(before, document.createTextNode(' → '), after);
    item.append(why, line);
    changesList.append(item);
  }
}

async function renderProfileNote(rewritten: string): Promise<void> {
  const { voiceSample } = await getSettings();
  const profile = analyzeWriting(voiceSample);
  const note = profile ? compareToProfile(rewritten, profile) : null;
  profileNote.textContent = note ?? '';
  profileNote.hidden = !note;
}

async function applyToPage(): Promise<void> {
  if (!current || !pending) return;
  const req: ApplyRequest = { type: 'apply', text: current.text };
  try {
    const res = await chrome.tabs.sendMessage<ApplyRequest, ApplyResponse>(pending.tabId, req);
    if (res.ok) {
      status.textContent = 'Replaced on the page.';
      applyBtn.hidden = true;
      undoBtn.hidden = false;
    } else {
      status.textContent = 'Could not replace it. The text on the page changed, so copy it instead.';
    }
  } catch {
    status.textContent = 'That tab is no longer listening. Copy the text instead.';
  }
}

async function undoOnPage(): Promise<void> {
  if (!pending) return;
  const req: UndoRequest = { type: 'undo' };
  try {
    const res = await chrome.tabs.sendMessage<UndoRequest, ApplyResponse>(pending.tabId, req);
    status.textContent = res.ok ? 'Put the original back.' : 'Could not undo. The text changed again.';
    if (res.ok) {
      undoBtn.hidden = true;
      applyBtn.hidden = false;
    }
  } catch {
    status.textContent = 'That tab is no longer listening.';
  }
}

function resetResult(): void {
  current = null;
  outField.hidden = true;
  out.textContent = '';
  resultRow.hidden = true;
  copy.disabled = true;
  applyBtn.hidden = true;
  undoBtn.hidden = true;
  fidelityEl.hidden = true;
  fidelityEl.textContent = '';
  profileNote.hidden = true;
  changesBox.hidden = true;
  changesList.textContent = '';
  engineLabel.textContent = '';
  document.querySelectorAll('.alts').forEach(el => el.remove());
}

function fail(message: string): void {
  headline.textContent = 'Could not rewrite';
  status.textContent = message;
}

function setWorking(on: boolean): void {
  go.disabled = on;
  regen.disabled = on;
  ring.classList.toggle('working', on);
  status.classList.toggle('working-dots', on);
  go.textContent = on ? 'Working' : 'Humanize';
  if (on) {
    headline.textContent = 'Humanizing';
    status.textContent = 'Rewriting';
    ringFg.setAttribute('stroke-dashoffset', '80');
    ringNum.textContent = '';
  }
}

function setRing(before: number, after: number): void {
  const cleared = before === 0 ? 1 : Math.max(0, before - after) / before;
  const offset = Math.round(RING_CIRCUMFERENCE * (1 - cleared) * 10) / 10;
  ringFg.setAttribute('stroke-dashoffset', String(offset));
  ringNum.textContent = String(after);
}

async function showEngine(settings: Awaited<ReturnType<typeof getSettings>>): Promise<void> {
  if (settings.byok.provider !== 'none' && settings.byok.apiKey) {
    const model =
      settings.byok.model || (settings.byok.provider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini');
    status.textContent = `Your API key (${model})`;
  } else if (typeof LanguageModel !== 'undefined' && LanguageModel) {
    const availability = await LanguageModel.availability().catch(() => 'unavailable' as const);
    status.textContent =
      availability === 'available' ? 'On-device AI ready' : 'On-device AI not ready. Open Settings.';
  } else {
    status.textContent = 'Quick clean only, no AI engine available';
  }
}

async function wireSiteToggle(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url;
  if (!url || !/^https?:/i.test(url)) return;
  const host = new URL(url).host;
  siteHost.textContent = host;
  siteToggle.checked = await isSiteDisabled(host);
  siteRow.hidden = false;
  siteToggle.addEventListener('change', () => {
    siteToggle.disabled = true;
    void toggleSiteDisabled(host)
      .catch(() => {
        siteToggle.checked = !siteToggle.checked;
      })
      .finally(() => {
        siteToggle.disabled = false;
      });
  });
}
