const { Plugin, PluginSettingTab, Setting, MarkdownView, Notice, MarkdownRenderer, MarkdownRenderChild } = require('obsidian');
const model = require('./model.cjs');
const GROUP = '.ec-plain-group';
const CELL = ':scope > .ec-column';
const TEXT = {
  ru: {
    language: 'Язык интерфейса', languageDescription: 'Язык надписей и подсказок Easy Columns.',
    tooltips: 'Подсказки', tooltipsDescription: 'Показывать подсказки разделителей и кнопок колонок.',
    saveSettingsFailed: 'Не удалось сохранить настройки. Повторите попытку.',
    tip: 'Двойной клик — переставить колонки.\nПравый клик — действия.',
    empty: 'Пустая колонка', add: 'Добавить колонку', addLeft: 'Добавить колонку слева', addRight: 'Добавить колонку справа',
    invalid: 'Структура колонок неоднозначна или повреждена; изменение отменено.',
    limit: 'Шкала 2100 поддерживает не более 2100 колонок.', changed: 'Содержимое изменилось; повторите действие.',
    equalize: 'Выровнять ширину колонок', chooseDelete: 'Выбрать колонку для удаления',
    confirmDelete: 'Подтвердить удаление колонки с содержимым', deleteLeft: 'Удалить левую колонку', deleteRight: 'Удалить правую колонку',
    saveFailed: 'Не удалось сохранить язык интерфейса. Повторите попытку.'
  },
  en: {
    language: 'Interface language', languageDescription: 'Language of Easy Columns labels and hints.',
    tooltips: 'Tooltips', tooltipsDescription: 'Show tooltips for column dividers and buttons.',
    saveSettingsFailed: 'Could not save settings. Please try again.',
    tip: 'Double-click to swap columns.\nRight-click for actions.',
    empty: 'Empty column', add: 'Add column', addLeft: 'Add column on the left', addRight: 'Add column on the right',
    invalid: 'The column structure is ambiguous or damaged; the change was cancelled.',
    limit: 'The 2100-unit scale supports no more than 2100 columns.', changed: 'The content has changed; please try again.',
    equalize: 'Equalize column widths', chooseDelete: 'Choose a column to delete',
    confirmDelete: 'Confirm deletion of the column and its contents', deleteLeft: 'Delete left column', deleteRight: 'Delete right column',
    saveFailed: 'Could not save the interface language. Please try again.'
  }
};
const STACK_WIDTH = 600;
const LINE_HOVER_MS = 300;
const LINE_HOLD_MS = LINE_HOVER_MS;
const LINE_DISPLAY_RADIUS = 50;
const EDGE_DISPLAY_WIDTH = 100;
const TIP_DELAY_MS = 1000;

class ColumnsSettingsTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    this.containerEl.replaceChildren();
    const plugin = this.plugin;
    const setting = new Setting(this.containerEl);
    const toggle = document.createElement('div');
    toggle.className = 'ec-language-switch';
    toggle.setAttribute('role', 'group');
    setting.controlEl.appendChild(toggle);
    const buttons = [];
    let hintsToggle;
    const hintsSetting = new Setting(this.containerEl).addToggle(control => {
      hintsToggle = control;
      control.setValue(plugin.settings.showTooltips !== false).onChange(async enabled => {
        control.setDisabled(true);
        try { await plugin.updateSettings({ showTooltips: enabled }); }
        finally { control.setDisabled(false); refresh(); }
      });
    });
    const refresh = () => {
      setting.setName(plugin.t('language')).setDesc(plugin.t('languageDescription'));
      hintsSetting.setName(plugin.t('tooltips')).setDesc(plugin.t('tooltipsDescription'));
      hintsToggle.setValue(plugin.settings.showTooltips !== false);
      toggle.setAttribute('aria-label', plugin.t('language'));
      for (const [language, button] of buttons) button.setAttribute('aria-pressed', String(plugin.settings.language === language));
    };
    for (const [language, label] of [['ru', 'Русский'], ['en', 'English']]) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = label; button.lang = language;
      button.addEventListener('click', async () => {
        buttons.forEach(([, item]) => { item.disabled = true; });
        try { await plugin.setLanguage(language); }
        finally { buttons.forEach(([, item]) => { item.disabled = false; }); refresh(); }
      });
      buttons.push([language, button]); toggle.appendChild(button);
    }
    refresh();
  }
}

class EasyColumns extends Plugin {
  t(key) { return TEXT[this.settings?.language === 'en' ? 'en' : 'ru'][key]; }

  async setLanguage(language) {
    if (!['ru', 'en'].includes(language) || language === this.settings.language) return;
    await this.updateSettings({ language });
  }

  updateSettings(changes) {
    this.settingsSave = (this.settingsSave || Promise.resolve()).then(async () => {
      const settings = { ...this.settings, ...changes };
      try { await this.saveData(settings); }
      catch { new Notice(this.t(changes.language ? 'saveFailed' : 'saveSettingsFailed')); return; }
      this.settings = settings;
      if (this.addColumnCommand) this.addColumnCommand.name = `${this.manifest.name}: ${this.t('add')}`;
      this.closeMenu(); this.hideTip();
      for (const record of this.records.values()) {
        for (const cell of record.cells) cell.querySelector('.ec-column-content')?.setAttribute('data-ec-empty-label', this.t('empty'));
      }
      this.schedule();
    });
    return this.settingsSave;
  }

  async onload() {
    const saved = await this.loadData();
    this.settings = { ...saved, language: saved?.language === 'en' ? 'en' : 'ru', showTooltips: saved?.showTooltips !== false };
    this.addSettingTab(new ColumnsSettingsTab(this.app, this));
    this.registerAddColumnCommand();
    this.records = new Map();
    this.visible = new Set();
    this.frame = 0;
    this.layer = document.createElement('div');
    this.layer.className = 'ec-controls';
    document.body.appendChild(this.layer);
    this.registerDomEvent(this.layer, 'pointerover', event => {
      if (this.settings.showTooltips === false && event.target.closest?.('button')) event.stopPropagation();
    });
    this.style = document.createElement('style');
    this.style.textContent = __PLUGIN_CSS__;
    document.head.appendChild(this.style);
    this.resize = new ResizeObserver(entries => {
      for (const entry of entries) {
        const record = this.records.get(entry.target.parentElement);
        if (record?.content === entry.target) this.updateStack(record, entry.contentRect.width);
      }
      this.schedule();
    });
    this.intersection = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) this.visible.add(entry.target); else this.visible.delete(entry.target);
      }
      this.schedule();
    });
    this.observer = new MutationObserver(changes => {
      for (const change of changes) {
        if (change.type === 'attributes' && change.attributeName === 'data-ec-weights') this.discover(change.target);
        if (change.type === 'childList') {
          const parentGroup = change.target.closest?.(GROUP);
          if (parentGroup) this.discover(parentGroup);
        }
        for (const node of change.addedNodes) if (node.nodeType === 1) this.discover(node);
      }
      this.prune();
      this.schedule();
    });
    this.observer.observe(this.app.workspace.containerEl, { childList: true, characterData: true, subtree: true,
      attributes: true, attributeFilter: ['data-ec-weights', 'class'] });
    this.registerMarkdownPostProcessor((el, context) => this.discover(el, context));
    this.registerMarkdownCodeBlockProcessor('easy-columns', (source, el, context) => this.renderPlain(source, el, context));
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, info) => this.editorMenu(menu, editor, info)));
    this.registerEvent(this.app.workspace.on('layout-change', () => { this.closeMenu(); this.schedule(); }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => { this.cancelDrag?.(); this.closeMenu(); this.schedule(); }));
    this.registerEvent(this.app.workspace.on('file-open', () => { this.cancelDrag?.(); this.closeMenu(); this.prune(); this.schedule(); }));
    this.registerEvent(this.app.workspace.on('editor-change', () => {
      this.cancelDrag?.(); this.closeMenu(); this.schedule();
    }));
    this.registerDomEvent(document, 'pointerdown', e => this.pointerDown(e), true);
    this.registerDomEvent(document, 'contextmenu', e => this.contextMenu(e), true);
    this.registerDomEvent(document, 'dblclick', e => this.doubleClick(e), true);
    this.registerDomEvent(document, 'pointermove', e => { this.updateLineHover(e); this.tooltip(e); }, true);
    this.registerDomEvent(document, 'pointerout', e => {
      const line = e.target.closest?.('.ec-line');
      if (line && !line.contains(e.relatedTarget)) this.hideTip();
      if (!e.relatedTarget) this.leaveLineArea();
    }, true);
    this.registerDomEvent(document, 'click', e => {
      if (this.blockReadingTask(e)) return;
      if (this.menu && !this.menu.contains(e.target)) this.closeMenu();
      else if (this.confirmButton && e.target !== this.confirmButton) this.resetConfirmation();
    }, true);
    this.registerDomEvent(document, 'keydown', e => {
      if (e.key === 'Escape') { this.cancelDrag?.(); this.closeMenu(); this.hideTip(); }
      if (e.key === ' ' || e.key === 'Enter') this.blockReadingTask(e);
    }, true);
    this.registerDomEvent(document, 'scroll', () => { this.hideTip(); this.closeMenu(); this.schedule(); }, true);
    this.registerDomEvent(window, 'resize', () => { this.closeMenu(); this.schedule(); });
    this.registerDomEvent(window, 'blur', () => { this.cancelDrag?.(); this.closeMenu(); this.hideTip(); this.leaveLineArea(); });
    this.discover(this.app.workspace.containerEl);
    this.register(() => {
      this.cancelDrag?.(); this.closeMenu(); this.hideTip();
      for (const line of this.lineHovers?.keys() || []) this.clearLineHover(line);
      this.observer.disconnect(); this.resize.disconnect(); this.intersection.disconnect();
      cancelAnimationFrame(this.frame);
      this.layer.remove(); this.style.remove();
      for (const record of this.records.values()) {
        record.content.style.removeProperty('--ec-columns');
        record.content.classList.remove('ec-stacked');
        record.cells.forEach(cell => cell.classList.remove('ec-empty-column'));
      }
      this.records.clear(); this.visible.clear();
    });
  }

  focusColumn(editor, group, index) {
    let line = group.start + 3;
    for (let i = 0; i < index; i++) line += group.columns[i].text.split('\n').length + 1;
    const lines = group.columns[index].text.split('\n');
    line += lines.length - 1;
    editor.setCursor({ line, ch: lines[lines.length - 1].length }); editor.focus();
  }

  async renderPlain(source, el, context) {
    const data = model.plainBody(source.replace(/\r?\n$/, ''));
    if (!data.valid) {
      const pre = document.createElement('pre');
      pre.textContent = source;
      el.appendChild(pre);
      return;
    }
    const group = document.createElement('div');
    group.className = 'ec-plain-group';
    group.setAttribute('data-ec-weights', data.weights.join(','));
    const content = document.createElement('div'); content.className = 'ec-group-content';
    content.style.setProperty('--ec-columns', data.weights.map(w => `minmax(0, ${w}fr)`).join(' '));
    const bodies = data.columns.map((column, index) => {
      const cell = document.createElement('div'); cell.className = 'ec-column';
      cell.dataset.ecColumn = String(index);
      const body = document.createElement('div'); body.className = 'ec-column-content';
      cell.appendChild(body); content.appendChild(cell);
      return body;
    });
    group.appendChild(content); el.appendChild(group);
    const child = new MarkdownRenderChild(group);
    let active = true;
    child.register(() => { active = false; this.removeRecord(group); });
    context.addChild(child);
    this.discover(group, context);
    for (const [index, column] of data.columns.entries()) {
      await MarkdownRenderer.render(this.app, column.text, bodies[index], context.sourcePath, child);
      if (!active) return;
    }
    const clickedColumn = event => {
      const record = this.records.get(group);
      if (!record || !this.editable(record)) return null;
      const cell = event.target.closest('[data-ec-column]');
      const index = record.cells.indexOf(cell);
      return index >= 0 ? { record, index } : null;
    };
    for (const type of ['pointerdown', 'mousedown']) child.registerDomEvent(content, type, event => {
      if (event.button === 0 && clickedColumn(event) && !event.target.closest('a, button, audio, video')) event.stopPropagation();
    });
    child.registerDomEvent(content, 'click', event => {
      if (event.button !== 0 || event.target.closest('a, button, audio, video') || window.getSelection()?.toString()) return;
      const hit = clickedColumn(event);
      if (!hit) return;
      const { record, index } = hit;
      const snapshot = this.snapshot(record);
      if (!snapshot || snapshot.view.file?.path !== context.sourcePath) return;
      event.preventDefault(); event.stopPropagation();
      this.focusColumn(snapshot.view.editor, snapshot.group, index);
    });
    // Rendered tasks must never rewrite the outer document using inner line numbers.
    for (const input of content.querySelectorAll('input[type="checkbox"]')) input.disabled = true;
    this.discover(group, context);
  }

  discover(root, context) {
    const elements = [...(root.matches?.(GROUP) ? [root] : []), ...root.querySelectorAll(GROUP)];
    for (const el of elements) {
      const content = el.querySelector(':scope > .ec-group-content');
      if (!content) continue;
      const data = model.metadata(el.getAttribute('data-ec-weights') || '');
      const cells = [...content.querySelectorAll(CELL)];
      cells.forEach(cell => {
        cell.classList.toggle('ec-empty-column', this.emptyCell(cell));
        cell.querySelector('.ec-column-content')?.setAttribute('data-ec-empty-label', this.t('empty'));
      });
      const weights = data && data.weights.length === cells.length ? data.weights : cells.map(() => 1);
      content.style.setProperty('--ec-columns', weights.map(w => `minmax(0, ${w}fr)`).join(' '));
      const previous = this.records.get(el);
      if (previous?.content === content) {
        previous.data = data; previous.cells = cells;
        if (context) previous.context = context;
        continue;
      }
      if (previous) this.removeRecord(el);
      const record = { el, content, data, cells, context, lines: [] };
      this.records.set(el, record);
      this.updateStack(record, content.getBoundingClientRect().width);
      this.resize.observe(content);
      this.intersection.observe(el);
    }
    this.schedule();
  }

  removeRecord(el) {
    const record = this.records.get(el);
    if (!record) return;
    record.lines.forEach(line => { this.clearLineHover(line); line.remove(); });
    record.content.classList.remove('ec-stacked');
    record.cells.forEach(cell => cell.classList.remove('ec-empty-column'));
    this.resize.unobserve(record.content); this.intersection.unobserve(el);
    this.records.delete(el); this.visible.delete(el);
  }

  prune() {
    for (const el of this.records.keys()) if (!el.isConnected || !el.matches(GROUP)) this.removeRecord(el);
  }

  schedule() {
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.layout(); });
  }

  updateStack(record, width) {
    if (width <= 0) return;
    const stacked = width <= STACK_WIDTH;
    if (record.stacked === stacked) return;
    this.cancelDrag?.(); this.closeMenu(); this.hideTip();
    record.stacked = stacked;
    record.content.classList.toggle('ec-stacked', stacked);
    if (stacked) record.lines.forEach(line => { this.clearLineHover(line); line.hidden = true; });
  }

  enterLine(line) {
    this.clearLineHover(line);
    this.lineHovers ??= new Map();
    const target = line.ecHoverBounds?.side ? line.firstChild : line;
    this.lineHovers.set(line, { entered: performance.now(), timer: null, target });
    target.style.opacity = '1';
    if (target !== line) target.style.pointerEvents = 'auto';
  }

  updateLineHover(event) {
    this.hoverPointer = { clientX: event.clientX, clientY: event.clientY, target: event.target };
    for (const record of this.records.values()) {
      for (const line of record.lines) {
        const bounds = line.ecHoverBounds;
        const distance = bounds && (event.clientX - bounds.x) * (bounds.side === 'right' ? -1 : 1);
        const nearby = bounds && (bounds.side ? distance >= 0 && distance <= EDGE_DISPLAY_WIDTH :
          Math.abs(distance) <= LINE_DISPLAY_RADIUS);
        const onButton = bounds?.side && line.firstChild?.contains?.(event.target);
        const inside = !line.hidden && bounds && (onButton ||
          (nearby && event.clientY >= bounds.top && event.clientY <= bounds.bottom));
        const state = this.lineHovers?.get(line);
        if (inside && (!state || state.timer !== null)) this.enterLine(line);
        else if (!inside && state && state.timer === null) this.leaveLine(line);
      }
    }
  }

  leaveLineArea() {
    this.hoverPointer = null;
    for (const [line, state] of this.lineHovers || []) if (state.timer === null) this.leaveLine(line);
  }

  leaveLine(line) {
    const state = this.lineHovers?.get(line);
    if (!state) return;
    if (performance.now() - state.entered >= LINE_HOVER_MS || line.hidden) {
      this.clearLineHover(line);
      return;
    }
    state.timer = setTimeout(() => this.clearLineHover(line), LINE_HOLD_MS);
  }

  clearLineHover(line) {
    const state = this.lineHovers?.get(line);
    if (!state) return;
    if (state.timer !== null) clearTimeout(state.timer);
    state.target.style.removeProperty('opacity');
    if (state.target !== line) state.target.style.removeProperty('pointer-events');
    this.lineHovers.delete(line);
  }

  editable(record) {
    return record.el.isConnected && !!record.el.closest('.markdown-source-view.is-live-preview');
  }

  viewFor(el) {
    const leaves = this.app.workspace.getLeavesOfType('markdown');
    return leaves.map(leaf => leaf.view).find(view => view instanceof MarkdownView && view.containerEl.contains(el));
  }

  emptyCell(cell) {
    const content = cell.querySelector(':scope > .ec-column-content');
    if (!content) return true;
    return !content.textContent.trim() && !content.querySelector('img, video, audio, iframe, canvas, svg, table, hr, input, .internal-embed');
  }

  // Only visible groups are measured. Lines live outside clipped editor containers.
  layout() {
    this.prune();
    for (const record of this.records.values()) {
      if (record.stacked || !this.visible.has(record.el) || !this.editable(record) || !record.data || record.cells.length !== record.data.weights.length) {
        record.lines.forEach(line => { this.clearLineHover(line); line.hidden = true; });
      }
    }
    for (const el of this.visible) {
      const record = this.records.get(el);
      if (!record || record.stacked || !this.editable(record) || !record.data || record.cells.length !== record.data.weights.length) continue;
      const contentRect = record.content.getBoundingClientRect();
      let top = Math.max(0, contentRect.top), bottom = Math.min(window.innerHeight, contentRect.bottom);
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
          const r = parent.getBoundingClientRect(); top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom);
        }
      }
      const rects = record.cells.map(cell => cell.getBoundingClientRect());
      const xs = [contentRect.left];
      for (let i = 1; i < rects.length; i++) xs.push((rects[i - 1].right + rects[i].left) / 2);
      xs.push(contentRect.right);
      while (record.lines.length > xs.length) {
        const line = record.lines.pop(); this.clearLineHover(line); line.remove();
      }
      xs.forEach((x, index) => {
        let line = record.lines[index];
        if (!line) {
          line = document.createElement('div'); line.className = 'ec-line';
          line.ecRecord = record;
          this.layer.appendChild(line); record.lines.push(line);
        }
        const inner = index > 0 && index < rects.length;
        const side = inner ? undefined : index === 0 ? 'left' : 'right';
        if (line.ecHoverBounds?.side !== side) this.clearLineHover(line);
        line.ecIndex = index;
        line.className = inner ? 'ec-line ec-inner' : 'ec-edge';
        if (inner) {
          line.setAttribute('role', 'separator'); line.setAttribute('aria-orientation', 'vertical');
          line.replaceChildren();
        } else {
          line.removeAttribute('role'); line.removeAttribute('aria-orientation');
          if (!line.firstChild) {
            const add = this.button('+', this.t('add'), event => {
              event.preventDefault(); event.stopImmediatePropagation();
              const snapshot = this.snapshot(line.ecRecord);
              if (snapshot) this.action(snapshot, 'add', line.ecIndex);
            });
            line.appendChild(add);
          }
          line.firstChild.setAttribute('aria-label', index === 0 ? this.t('addLeft') : this.t('addRight'));
        }
        line.hidden = bottom <= top || contentRect.width <= 0;
        if (line.hidden) this.clearLineHover(line);
        line.style.left = `${Math.max(6, Math.min(window.innerWidth - 6, x))}px`;
        line.style.top = `${top}px`; line.style.height = `${Math.max(0, bottom - top)}px`;
        line.ecHoverBounds = { x: parseFloat(line.style.left), top, bottom, side };
      });
    }
    if (this.hoverPointer) this.updateLineHover(this.hoverPointer);
  }

  snapshot(record) {
    if (!record) return null;
    const view = this.viewFor(record.el);
    if (!view || view.getMode() !== 'source' || !this.editable(record)) return null;
    const document = view.editor.getValue();
    let line = null;
    // Live Preview uses CodeMirror; resolve this widget, never the active cursor.
    try {
      const cm = view.editor.cm;
      if (cm?.posAtDOM && cm.dom.contains(record.el)) {
        line = view.editor.offsetToPos(cm.posAtDOM(record.el)).line;
      } else {
        line = record.context?.getSectionInfo(record.el)?.lineStart ?? null;
      }
    } catch { /* A detached or replaced widget cannot be edited safely. */ }
    const matches = model.groups(document).filter(g => line !== null && line >= g.start && line < g.end);
    if (matches.length !== 1 || !matches[0].valid) {
      new Notice(this.t('invalid')); return null;
    }
    return { view, file: view.file, group: matches[0], document };
  }

  commit(snapshot, next, headerOnly = false) {
    if (next.columns.length > model.WEIGHT_TOTAL) {
      new Notice(this.t('limit')); return false;
    }
    const { view, file, group } = snapshot;
    if (view.file !== file || view.getMode() !== 'source') return false;
    const document = view.editor.getValue();
    const current = model.groups(document).find(g => g.start === group.start);
    if ((snapshot.document !== undefined && snapshot.document !== document) || !current?.valid || current.source !== group.source) {
      new Notice(this.t('changed')); return false;
    }
    const text = model.serialize(next);
    const editor = view.editor;
    const first = current.start + (headerOnly ? 1 : 0);
    const last = headerOnly ? first : current.end - 1;
    const replacement = headerOnly ? 'widths: ' + model.integerWeights(next.weights).join(',') : text;
    this.closeMenu(); this.hideTip();
    const ending = editor.getLine(last).endsWith('\r') ? '\r' : '';
    editor.transaction({ changes: [{ from: { line: first, ch: 0 }, to: { line: last, ch: editor.getLine(last).length }, text: replacement + ending }] }, 'easy-columns');
    editor.focus();
    this.schedule();
    return true;
  }

  action(snapshot, name, index) {
    if (snapshot.group.columns.length + (name === 'add' ? 1 : name === 'remove' ? -1 : 0) > model.WEIGHT_TOTAL) {
      new Notice(this.t('limit')); return false;
    }
    return this.commit(snapshot, model.applyAction(snapshot.group, name, index), name === 'equal');
  }

  editorMenu(menu, editor, info) {
    const tableContext = this.tableMenuContext;
    this.tableMenuContext = null;
    if (editor.cm?.dom?.closest?.('table') || (tableContext && Date.now() - tableContext.time < 1000)) {
      this.textContext = null;
      return;
    }
    const text = editor.getValue();
    const all = model.groups(text);
    const line = editor.getCursor().line;
    let group = all.find(g => line >= g.start && line < g.end);
    const context = this.textContext;
    this.textContext = null;
    if (context && Date.now() - context.time < 1000 && context.view?.editor === editor) {
      if (!context.snapshot || context.snapshot.document !== text) return;
      group = context.snapshot.group;
    }
    if (group) {
      if (group.valid) menu.addItem(item => item.setTitle(this.t('equalize')).setIcon('columns').onClick(() => {
        const view = this.app.workspace.getLeavesOfType('markdown').map(l => l.view).find(v => v.editor === editor);
        if (view) this.action({ view, file: view.file, group, document: text }, 'equal');
      }));
      return;
    }
    const plan = this.creationPlan(editor);
    if (plan) menu.addItem(item => item.setTitle(this.t('add')).setIcon('columns').onClick(() => this.createColumns(editor, plan)));
  }

  registerAddColumnCommand() {
    this.addColumnCommand = this.addCommand({
      id: 'add-column', name: this.t('add'), icon: 'columns',
      editorCheckCallback: (checking, editor, context) => {
        if (context?.getMode && context.getMode() !== 'source') return false;
        const plan = this.creationPlan(editor);
        if (!plan) return false;
        return checking || this.createColumns(editor, plan);
      }
    });
  }

  creationPlan(editor) {
    if (editor.cm?.dom?.closest?.('table') || editor.listSelections().length !== 1) return null;
    const text = editor.getValue();
    const line = editor.getCursor().line;
    if (model.groups(text).some(group => line >= group.start && line < group.end)) return null;
    const from = editor.getCursor('from'), to = editor.getCursor('to');
    const selected = from.line !== to.line || from.ch !== to.ch;
    let range;
    if (selected) {
      range = model.selectedBlock(text, from, to);
    } else {
      const block = model.creationBlock(text, line);
      if (block) {
        const start = { line: block.start, ch: 0 }, end = { line: block.end - 1, ch: editor.getLine(block.end - 1).replace(/\r$/, '').length };
        range = model.selectedBlock(text, start, end);
        if (range && block.listIndent > 0) {
          range.content = model.unindent(range.source, block.listIndent);
        }
      }
    }
    return range ? { text, range } : null;
  }

  createColumns(editor, { text, range }) {
    if (editor.getValue() !== text) {
      new Notice(this.t('changed')); return false;
    }
    const created = { weights: [1050, 1050], columns: [model.emptyColumn((range.content ?? range.source).replace(/\r\n/g, '\n')), model.emptyColumn()], newline: text.includes('\r\n') ? '\r\n' : '\n' };
    editor.transaction({ changes: [{ from: range.from, to: range.to, text: range.before + model.serialize(created) + range.after }] }, 'easy-columns');
    return true;
  }

  contextMenu(event) {
    this.tableMenuContext = event.target.closest?.('table') ? { time: Date.now() } : null;
    if (event.target.closest?.('.ec-edge')) {
      event.preventDefault(); event.stopImmediatePropagation();
      this.textContext = null; this.closeMenu(); this.hideTip();
      return;
    }
    const line = event.target.closest?.('.ec-line');
    if (line) {
      event.preventDefault(); event.stopImmediatePropagation();
      const snapshot = this.snapshot(line.ecRecord);
      if (snapshot) this.openMenu(snapshot, line.ecIndex, line, event.clientY);
      return;
    }
    const el = event.target.closest?.(GROUP);
    this.textContext = el ? { snapshot: this.snapshot(this.records.get(el)), view: this.viewFor(el), time: Date.now() } : null;
    this.closeMenu(); this.hideTip();
  }

  pointerDown(event) {
    this.hideTip();
    if (this.blockReadingTask(event)) return;
    if (this.menu && !this.menu.contains(event.target)) this.closeMenu();
    else if (this.confirmButton && event.target !== this.confirmButton) this.resetConfirmation();
    const line = event.target.closest?.('.ec-line, .ec-edge');
    if (line) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.button === 0 && line.classList.contains('ec-inner')) this.startDrag(event, line);
    }
  }

  doubleClick(event) {
    const line = event.target.closest?.('.ec-line.ec-inner');
    if (!line) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const snapshot = this.snapshot(line.ecRecord);
    if (snapshot) this.action(snapshot, 'swap', line.ecIndex);
  }

  openMenu(snapshot, index, line, pointerY) {
    this.closeMenu(); this.hideTip();
    const menu = document.createElement('div'); menu.className = 'ec-menu'; menu.setAttribute('role', 'group');
    const add = this.button('+', this.t('add'), () => this.action(snapshot, 'add', index));
    const remove = this.button('×', this.t('chooseDelete'), () => {
      this.resetConfirmation(); choices.hidden = !choices.hidden;
    });
    const choices = document.createElement('div'); choices.className = 'ec-delete-choices'; choices.hidden = true;
    const choose = (columnIndex, arrow, label) => {
      const button = this.button(arrow, label, () => {
        if (this.confirmButton === button || !snapshot.group.columns[columnIndex].text.trim()) {
          this.action(snapshot, 'remove', columnIndex); return;
        }
        this.resetConfirmation(); this.confirmButton = button;
        button.dataset.original = arrow; this.setButtonSymbol(button, '✓'); button.classList.add('ec-confirm');
        button.setAttribute('aria-label', this.t('confirmDelete'));
        button.dataset.label = label;
      });
      button.className = columnIndex < index ? 'ec-remove-left' : 'ec-remove-right';
      choices.appendChild(button);
    };
    if (index > 0) choose(index - 1, '‹', this.t('deleteLeft'));
    if (index < snapshot.group.columns.length) choose(index, '›', this.t('deleteRight'));
    const row = document.createElement('div'); row.className = 'ec-delete-row';
    row.appendChild(remove); row.appendChild(choices); menu.appendChild(add); menu.appendChild(row);
    menu.addEventListener('pointerdown', e => e.preventDefault());
    this.layer.appendChild(menu); this.menu = menu;
    const anchor = line.getBoundingClientRect();
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(anchor.left + (anchor.width - rect.width) / 2, window.innerWidth - rect.width - 4))}px`;
    const top = Math.max(4, anchor.top);
    const bottom = Math.min(window.innerHeight - 4, anchor.bottom);
    const y = pointerY + rect.height <= bottom ? pointerY : pointerY - rect.height;
    const position = bottom - top >= rect.height ? Math.max(top, Math.min(y, bottom - rect.height)) : y;
    menu.style.top = `${Math.max(4, Math.min(position, window.innerHeight - rect.height - 4))}px`;
  }

  button(text, label, callback) {
    const button = document.createElement('button'); this.setButtonSymbol(button, text); button.setAttribute('aria-label', label);
    button.addEventListener('click', callback); return button;
  }

  setButtonSymbol(button, symbol) {
    const paths = {
      '+': 'M6 12H18M12 6V18',
      '×': 'M7 7L17 17M17 7L7 17',
      '‹': 'M15 6L9 12L15 18',
      '›': 'M9 6L15 12L9 18',
      '✓': 'M4 12L10 18L20 6'
    };
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', paths[symbol]);
    svg.appendChild(path);
    button.replaceChildren(svg);
  }

  resetConfirmation() {
    if (!this.confirmButton) return;
    this.setButtonSymbol(this.confirmButton, this.confirmButton.dataset.original);
    this.confirmButton.setAttribute('aria-label', this.confirmButton.dataset.label);
    this.confirmButton.classList.remove('ec-confirm'); this.confirmButton = null;
  }

  closeMenu() { this.resetConfirmation(); this.menu?.remove(); this.menu = null; }

  tooltip(event) {
    const line = event.target.closest?.('.ec-line.ec-inner');
    if (this.settings?.showTooltips === false || !line || line.hidden || this.menu || this.cancelDrag || event.buttons) { this.hideTip(); return; }
    this.tipY = event.clientY;
    if (this.tipLine !== line) {
      this.hideTip();
      this.tipLine = line; this.tipY = event.clientY;
      this.tipTimer = setTimeout(() => {
        this.tipTimer = null;
        if (this.settings?.showTooltips === false || !line.isConnected || line.hidden || this.menu || this.cancelDrag) { this.hideTip(); return; }
        this.showTip(line, this.tipY);
      }, TIP_DELAY_MS);
      return;
    }
    if (this.tip) this.showTip(line, this.tipY);
  }

  showTip(line, pointerY) {
    if (!this.tip) {
      this.tip = document.createElement('div'); this.tip.className = 'tooltip ec-tip';
      this.tip.setAttribute('role', 'tooltip');
      this.tip.textContent = this.t('tip');
      const arrow = document.createElement('div'); arrow.className = 'tooltip-arrow';
      this.tip.appendChild(arrow); this.layer.appendChild(this.tip);
    }
    const rect = this.tip.getBoundingClientRect();
    const anchor = line.getBoundingClientRect();
    const center = anchor.left + anchor.width / 2;
    const left = Math.max(4, Math.min(center - rect.width / 2, window.innerWidth - rect.width - 4));
    const above = pointerY + 16 + rect.height > window.innerHeight - 4;
    this.tip.classList.toggle('mod-top', above);
    this.tip.style.setProperty('--ec-tip-arrow-left', `${Math.max(8, Math.min(center - left, rect.width - 8))}px`);
    this.tip.style.left = `${left}px`;
    this.tip.style.top = `${Math.max(4, above ? pointerY - 16 - rect.height : pointerY + 16)}px`;
  }

  hideTip() {
    clearTimeout(this.tipTimer); this.tipTimer = null; this.tipLine = null;
    this.tip?.remove(); this.tip = null;
  }

  blockReadingTask(event) {
    const target = event.target;
    if (target.closest?.('.markdown-reading-view, .markdown-preview-view') && target.closest(GROUP) &&
        target.closest('input[type="checkbox"], label')) {
      event.preventDefault(); event.stopImmediatePropagation(); return true;
    }
    return false;
  }

  startDrag(event, line) {
    if (this.cancelDrag) return;
    const record = line.ecRecord, index = line.ecIndex;
    const snapshot = this.snapshot(record);
    if (!snapshot) return;
    this.closeMenu();
    const original = snapshot.group.weights;
    if (original.length > model.WEIGHT_TOTAL) {
      new Notice(this.t('limit')); return;
    }
    const initial = model.integerWeights(original);
    const left = record.cells[index - 1].getBoundingClientRect();
    const right = record.cells[index].getBoundingClientRect();
    const available = left.width + right.width;
    if (available <= 2) return;
    const minimum = Math.min(40, available / 4);
    let weights = [...initial], frame = 0, changed = false;
    const paint = () => {
      frame = 0;
      record.content.style.setProperty('--ec-columns', weights.map(w => `minmax(0, ${w}fr)`).join(' '));
      this.schedule();
    };
    const move = e => {
      if (e.pointerId !== event.pointerId) return;
      const pixels = Math.max(minimum, Math.min(available - minimum, left.width + e.clientX - event.clientX));
      weights = model.resizeWeights(initial, index, pixels / available, minimum / available);
      changed = weights.some((w, i) => w !== initial[i]);
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const cleanup = () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('pointermove', move, true); document.removeEventListener('pointerup', finish, true);
      document.removeEventListener('pointercancel', cancel, true); document.removeEventListener('keydown', key, true);
      record.content.style.setProperty('--ec-columns', original.map(w => `minmax(0, ${w}fr)`).join(' '));
      document.body.classList.remove('ec-dragging'); this.cancelDrag = null; this.schedule();
    };
    const cancel = () => cleanup();
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } };
    const finish = e => {
      if (e.pointerId !== event.pointerId) return;
      move(e); cleanup();
      if (changed && record.el.isConnected) this.commit(snapshot, { ...snapshot.group, weights }, true);
    };
    this.cancelDrag = cancel; document.body.classList.add('ec-dragging');
    document.addEventListener('pointermove', move, true); document.addEventListener('pointerup', finish, true);
    document.addEventListener('pointercancel', cancel, true); document.addEventListener('keydown', key, true);
  }
}

module.exports = EasyColumns;
