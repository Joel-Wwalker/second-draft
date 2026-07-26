/** Floating "Humanize" chip shown near an eligible selection. */
export class Chip {
  private readonly host: HTMLElement;
  private readonly btn: HTMLButtonElement;

  constructor(doc: Document, onClick: () => void) {
    this.host = doc.createElement('div');
    this.host.id = 'humanizer-chip-host';
    this.host.style.cssText = 'position:absolute;top:0;left:0;z-index:2147483647;';
    const shadow = this.host.attachShadow({ mode: 'open' });
    this.btn = doc.createElement('button');
    this.btn.textContent = 'Humanize';
    this.btn.style.cssText =
      'all:initial;cursor:pointer;font:600 12.5px system-ui,sans-serif;color:#fff;' +
      'background:#4f46e5;padding:6px 14px;border-radius:999px;box-shadow:0 3px 10px rgba(79,70,229,.35);';
    this.btn.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    shadow.append(this.btn);
    this.doc = doc;
  }

  private readonly doc: Document;

  showAt(x: number, y: number): void {
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
