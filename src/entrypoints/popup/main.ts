import type {
  ApplyRequest,
  ApplyResponse,
  BackgroundRequest,
  HumanizeResponse,
  PendingSelection,
  UndoRequest,
} from '../../shared/messages';
import { PENDING_KEY } from '../../shared/messages';
import type { HumanizeResult, Intensity } from '../../shared/types';
import { getSettings, updateSettings, isSiteDisabled, toggleSiteDisabled } from '../../shared/storage';
import { engineLabel as engineLabelFor, resultStatus } from '../../shared/labels';
import { formatChanges } from '../../shared/change-log';
import { findAlternatives, swapWord } from '../../shared/alternatives';
import type { AltSpan } from '../../shared/alternatives';
import { analyzeWriting, compareToProfile } from '../../shared/profile';
import type { Change } from '../../shared/types';

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const input = byId<HTMLTextAreaElement>('input');
const out = byId<HTMLDivElement>('out');
const intensity = byId<HTMLSelectElement>('intensity');
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

/** Where the text came from, when it arrived from a page selection. */
let pending: PendingSelection | null = null;
/** The rewrite currently on screen, including any alternative words swapped in. */
let current: { text: string; changes: Change[]; result: HumanizeResult } | null = null;

void init();

async function init(): Promise<void> {
  const settings = await getSettings();
  intensity.value = settings.defaultIntensity;
  intensity.addEventListener('change', () => {
    void updateSettings({ defaultIntensity: intensity.value as Intensity });
  });
  go.addEventListener('click', () => void run());
  regen.addEventListener('click', () => void run());
  copy.addEventListener('click', () => void navigator.clipboard.writeText(out.textContent ?? '').catch(() => {}));
  openOptions.addEventListener('click', () => void chrome.runtime.openOptionsPage());
  applyBtn.addEventListener('click', () => void applyToPage());
  undoBtn.addEventListener('click', () => void undoOnPage());

  await wireSiteToggle();
  await showEngine(settings);

  // Text handed over by a right click or the keyboard shortcut starts on its own.
  const stored = await chrome.storage.local.get(PENDING_KEY);
  const handed = stored[PENDING_KEY] as PendingSelection | undefined;
  if (handed?.text) {
    pending = handed;
    await chrome.storage.local.remove(PENDING_KEY);
    void chrome.action.setBadgeText({ text: '' });
    input.value = handed.text;
    void run();
  }
}

async function run(): Promise<void> {
  const text = input.value.trim();
  if (!text) return;
  setWorking(true);
  resetResult();
  try {
    const req: BackgroundRequest = {
      type: 'humanize',
      id: crypto.randomUUID(),
      text,
      intensity: intensity.value as Intensity,
    };
    const res = (await chrome.runtime.sendMessage(req)) as HumanizeResponse;
    if (res.ok) render(res.result, text);
    else fail(res.message);
  } catch (err) {
    fail(String(err));
  } finally {
    setWorking(false);
  }
}

function render(result: HumanizeResult, original: string): void {
  current = { text: result.rewritten, changes: [...result.changes], result };
  out.hidden = false;
  resultRow.hidden = false;
  copy.disabled = false;
  engineLabel.textContent = engineLabelFor(result.engine);
  status.textContent = resultStatus(result) + (result.retried ? ' Rewritten twice to keep your facts.' : '');
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
      const delta = current.text.length - before.length;
      current.changes = current.changes.map(c =>
        c.range.start >= span.end
          ? { ...c, range: { start: c.range.start + delta, end: c.range.end + delta } }
          : c,
      );
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
  out.hidden = true;
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
