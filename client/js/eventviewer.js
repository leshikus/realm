/**
 * eventviewer.js — Renders the narrative event log.
 */
export class EventViewer {
  constructor(listEl, filterEl) {
    this.listEl   = listEl;
    this.filterEl = filterEl;
    this._entries = [];
    filterEl.addEventListener('input', () => this._render(filterEl.value));
  }

  load(entries) {
    this._entries = entries;
    this._render('');
  }

  _render(query) {
    const q = query.toLowerCase();
    this.listEl.innerHTML = '';
    for (const entry of this._entries) {
      if (q && !entry.toLowerCase().includes(q)) continue;
      const li = document.createElement('li');
      li.textContent = entry;
      if (entry.startsWith('==='))           li.className = 'turn-header';
      else if (entry.startsWith('[WORLD EVENT]')) li.className = 'world-event';
      else                                   li.className = 'normal';
      this.listEl.appendChild(li);
    }
  }
}
