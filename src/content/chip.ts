/** Floating "Humanize" chip shown near an eligible selection. */
export class Chip {
  private readonly host: HTMLElement;
  private readonly btn: HTMLButtonElement;
  private readonly label: HTMLSpanElement;
  private readonly badge: HTMLSpanElement;

  constructor(doc: Document, onClick: () => void) {
    this.host = doc.createElement('div');
    this.host.id = 'humanizer-chip-host';
    this.host.style.cssText = 'position:absolute;top:0;left:0;z-index:2147483647;';
    const shadow = this.host.attachShadow({ mode: 'open' });
    this.btn = doc.createElement('button');
    this.label = doc.createElement('span');
    this.label.textContent = 'Humanize';
    this.badge = doc.createElement('span');
    this.badge.hidden = true;
    this.badge.style.cssText =
      'all:initial;font:700 11px system-ui,sans-serif;color:#fff;background:rgba(255,255,255,.24);' +
      'border-radius:99px;padding:1px 7px;margin-left:7px;';
    this.btn.append(this.label, this.badge);
    this.btn.style.cssText =
      'all:initial;cursor:pointer;display:inline-flex;align-items:center;' +
      'font:700 13px system-ui,sans-serif;color:#fff;background:#4f46e5;' +
      'padding:8px 14px;border-radius:999px;' +
      'box-shadow:0 2px 6px rgba(79,70,229,.32),0 10px 22px -8px rgba(79,70,229,.5);';
    this.btn.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    shadow.append(this.btn);
    this.doc = doc;
  }

  private readonly doc: Document;

  showAt(x: number, y: number, tellCount = 0): void {
    this.badge.hidden = tellCount <= 0;
    this.badge.textContent = String(tellCount);
    this.host.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (!this.host.isConnected) this.doc.body.append(this.host);
  }

  hide(): void {
    this.host.remove();
  }

  contains(target: EventTarget | null): boolean {
    return (
      target instanceof Node &&
      (this.host === target || (this.host.shadowRoot?.contains(target) ?? false))
    );
  }
}
