import { App, setIcon } from 'obsidian';
import { ManagedPlugin, PluginGroup } from './types';
import { PluginCard } from './PluginCard';
import { GROUP_COLORS } from './types';

export interface GroupSectionOptions {
  app: App;
  group: PluginGroup;
  plugins: ManagedPlugin[];
  allGroups: PluginGroup[];
  isUngrouped?: boolean;
  onRename:         (groupId: string, name: string) => void;
  onDelete:         (groupId: string) => void;
  onColorChange:    (groupId: string, color: string) => void;
  onToggleCollapse: (groupId: string, newCollapsed: boolean) => void;
  onReorderPlugins: (groupId: string, from: number, to: number) => void;
  onMoveToGroup:    (pluginId: string, groupId: string | null) => void;
  onPluginToggle:   (plugin: ManagedPlugin) => void;
  onPluginUninstall:(plugin: ManagedPlugin) => void;
  onOpenSettings:   () => void;
}

export class GroupSection {
  public readonly groupId: string;

  private opts: GroupSectionOptions;
  el: HTMLElement;
  private arrowEl: HTMLElement | null = null;
  private listEl:  HTMLElement | null = null;

  constructor(opts: GroupSectionOptions) {
    this.opts    = opts;
    this.groupId = opts.group.id;
    this.el      = this.render();
  }

  destroy(): void {
    // this.cleanupDnd?.();
  }

  public beginRename(): void {
    const nameEl = this.el.querySelector<HTMLElement>('.po-group-name');
    if (nameEl) this.startRename(nameEl);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  private render(): HTMLElement {
    const { group, plugins, isUngrouped } = this.opts;

    const section = activeDocument.createElement('div');
    section.addClass('po-group-section');
    section.setAttribute('data-group-id', group.id);

    if (!isUngrouped && group.color) {
      section.style.setProperty('--group-color', group.color);
    }

    section.appendChild(this.renderHeader());

    if (!group.collapsed) {
      const list = this.renderPluginList(plugins);
      this.listEl = list;
      section.appendChild(list);
    }

    return section;
  }

  // ─── Header ────────────────────────────────────────────────────────────────

  private renderHeader(): HTMLElement {
    const { group, plugins, isUngrouped } = this.opts;

    const header = activeDocument.createElement('div');
    header.addClass('po-group-header');

    // ── Store arrow ref so toggleCollapse can swap the icon ─────────
    this.arrowEl = header.createDiv({ cls: 'po-group-arrow' });
    setIcon(this.arrowEl, group.collapsed ? 'chevron-right' : 'chevron-down');

    // ── color dot — clickable for named groups, static grey for ungrouped ──
    if (!isUngrouped) {
      const dot = header.createDiv({ cls: 'po-group-color-dot' });
      dot.style.background = group.color ?? '#7c3aed';
      dot.setAttribute('title', 'Change colour');
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showColorPicker(dot);
      });
    } else {
      // Static grey dot — non-interactive
      const dot = header.createDiv({ cls: 'po-group-color-dot po-group-color-dot--static' });
      // dot.style.background = '#888888';
      dot.classList.add('po-ungroup-color-dot');
    }

    // ── Group name ────────────────────────────────────────────────────────────
    const nameEl = header.createDiv({ cls: 'po-group-name' });
    nameEl.textContent = isUngrouped ? 'Ungrouped' : group.name;

    if (!isUngrouped) {
      nameEl.setAttribute('title', 'Click to rename');
      nameEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startRename(nameEl);
      });
    }

    // ── badge immediately after name, before spacer ─────────────────
    const badge = header.createSpan({ cls: 'po-group-badge' });
    badge.textContent = String(plugins.length);

    // Spacer — pushes delete button to the right
    header.createDiv({ cls: 'po-group-spacer' });

    // ── Delete button (named groups only) ─────────────────────────────────────
    if (!isUngrouped) {
      const deleteBtn = header.createDiv({ cls: 'po-group-btn', title: 'Delete group' });
      setIcon(deleteBtn, 'trash-2');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.opts.onDelete(group.id);
      });
    }

    // ── Collapse on header click — update DOM directly ──────────────
    header.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (
        target.closest('.po-group-btn')        ||
        target.closest('.po-group-color-dot')  ||
        target.closest('.po-group-name-input') ||
        target.closest('.po-group-name')
      ) return;
      this.toggleCollapse();
    });

    return header;
  }

  // ── Toggle collapse by mutating DOM directly (no full re-render) ──
  private toggleCollapse(): void {
    const { group } = this.opts;
    group.collapsed = !group.collapsed;

    // Swap the arrow icon
    if (this.arrowEl) {
      this.arrowEl.empty();
      setIcon(this.arrowEl, group.collapsed ? 'chevron-right' : 'chevron-down');
    }

    if (group.collapsed) {
      this.listEl?.remove();
      this.listEl = null;
    } else {
      const list = this.renderPluginList(this.opts.plugins);
      this.listEl = list;
      this.el.appendChild(list);
    }

    // Persist collapsed state
    this.opts.onToggleCollapse(group.id, group.collapsed);
  }

  // ─── Plugin list ───────────────────────────────────────────────────────────

  private renderPluginList(plugins: ManagedPlugin[]): HTMLElement {
    const list = activeDocument.createElement('div');
    list.addClass('po-plugin-list');

    if (plugins.length === 0) {
      const empty = list.createDiv({ cls: 'po-group-empty' });
      setIcon(empty.createDiv({ cls: 'po-group-empty-icon' }), 'inbox');
      empty.createDiv({ cls: 'po-group-empty-text', text: 'No plugins in this group' });
      return list;
    }

    for (const p of plugins) {
      const card = new PluginCard({
        app:            this.opts.app,
        plugin:         p,
        groups:         this.opts.allGroups,
        currentGroupId: this.opts.isUngrouped ? null : this.opts.group.id,
        onToggle:       this.opts.onPluginToggle,
        onUninstall:    this.opts.onPluginUninstall,
        onMoveToGroup:  this.opts.onMoveToGroup,
        onOpenSettings: this.opts.onOpenSettings,
      });
      list.appendChild(card.el);
    }

    return list;
  }

  // ─── Inline rename ─────────────────────────────────────────────────────────

  private startRename(nameEl: HTMLElement): void {
    const original = this.opts.group.name;
    const input = activeDocument.createElement('input');
    input.addClass('po-group-name-input');
    input.type  = 'text';
    input.value = original;

    const finish = () => {
      const newName = input.value.trim() || original;
      this.opts.group.name = newName;          // keep in-memory copy in sync
      this.opts.onRename(this.opts.group.id, newName);
      nameEl.textContent = newName;
      input.replaceWith(nameEl);
    };

    input.addEventListener('blur',    finish);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { finish(); }
      if (e.key === 'Escape') { input.value = original; finish(); }
    });

    nameEl.replaceWith(input);
    input.focus();
    input.select();
  }

  // ─── Colour picker ─────────────────────────────────────────────────────────

  private showColorPicker(anchor: HTMLElement): void {
    const existing = activeDocument.querySelector('.po-color-picker-popup');
    existing?.remove();

    const popup = activeDocument.body.createDiv({ cls: 'po-color-picker-popup' });

    for (const color of GROUP_COLORS) {
      const swatch = popup.createDiv({ cls: 'po-color-swatch' });
      swatch.style.background = color;
      if (color === this.opts.group.color) swatch.addClass('po-color-swatch--active');
      swatch.addEventListener('click', () => {
        this.opts.group.color = color;
        this.opts.onColorChange(this.opts.group.id, color);
        anchor.style.background = color;
        this.el.style.setProperty('--group-color', color);
        popup.remove();
      });
    }

    const rect = anchor.getBoundingClientRect();
    popup.style.top  = `${rect.bottom + window.scrollY + 6}px`;
    popup.style.left = `${rect.left   + window.scrollX}px`;

    const close = (ev: MouseEvent) => {
      if (!popup.contains(ev.target as Node)) {
        popup.remove();
        activeDocument.removeEventListener('mousedown', close);
      }
    };
    window.setTimeout(() => activeDocument.addEventListener('mousedown', close), 0);
  }
}
