import { App, PluginSettingTab, setIcon , Plugin} from 'obsidian';
import { GroupManager } from './GroupManager';
import { internals } from './pluginAccess';
import { GroupSection } from './GroupSection';
import { ManagedPlugin, SortMode } from './types';
import { getAllPlugins } from './pluginAccess';

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), ms);
  };
}

export class PluginManagerTab extends PluginSettingTab {
  private manager:  GroupManager;
  private plugins:  ManagedPlugin[] = [];
  private sections: GroupSection[]  = [];
  private searchQuery = '';

  constructor(app: App, plugin: PluginOrganizerPlugin, manager: GroupManager) {
    super(app, plugin);
    this.manager = manager;
  }

  // Called by Obsidian when the tab is shown
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('po-settings-container');

    // Refresh plugin list every time the tab opens
    this.plugins = getAllPlugins(this.app);
    void this.manager.syncWithInstalled(this.plugins);

    this.renderToolbar(containerEl);
    this.renderGroups(containerEl);
  }

  // Called by Obsidian when the tab is hidden
  hide(): void {
    this.cleanup();
  }

  // ─── Toolbar ───────────────────────────────────────────────────────────────

  
  private renderToolbar(parent: HTMLElement): void {
    const toolbar = parent.createDiv({ cls: 'po-toolbar' });

    const controls = toolbar.createDiv({ cls: 'po-toolbar-controls' });

    // Search
    const searchWrap = controls.createDiv({ cls: 'po-search-wrap' });
    setIcon(searchWrap.createDiv({ cls: 'po-search-icon' }), 'search');
    const searchInput = searchWrap.createEl('input', {
      type:        'text',
      placeholder: 'Search plugins…',
    });
    searchInput.addClass('po-search-input');
    searchInput.value = this.searchQuery;

    const debouncedSearch = debounce((e: unknown) => {
      this.searchQuery = (e as InputEvent & { target: HTMLInputElement }).target.value.toLowerCase();
      this.applySearch();
    }, 150);
    searchInput.addEventListener('input', debouncedSearch);

    // Sort button — icon-based custom dropdown
    this.renderSortControl(controls);

    // New group button
    const newGroupBtn = controls.createEl('button', { cls: 'po-btn po-btn--primary' });
    setIcon(newGroupBtn.createSpan(), 'folder-plus');
    newGroupBtn.createSpan({ text: ' New Group' });
    newGroupBtn.addEventListener('click', () => {
      void this.manager.createGroup('New Group').then(group => {
        this.refreshGroupList();
        // After re-render, find the new section and trigger inline rename
        window.requestAnimationFrame(() => {
          const section = this.sections.find(s => s.groupId === group.id);
          section?.beginRename();
        });
      });
    });
  }

  // ─── Sort control ──────────────────────────────────────────────────────────

  private readonly SORT_MODES: Array<{ value: SortMode; icon: string; label: string }> = [
    { value: 'name-asc',  icon: 'arrow-up',        label: 'Name A – Z'    },
    { value: 'name-desc', icon: 'arrow-down',      label: 'Name Z – A'    },
    { value: 'type',      icon: 'tag',             label: 'Community first'           },
    { value: 'enabled',   icon: 'power',           label: 'Recently enable'  },
  ];

  private renderSortControl(parent: HTMLElement): void {

    const current = this.SORT_MODES.find(m => m.value === this.manager.data.sortMode)
    ?? this.SORT_MODES[0]
    ?? { value: 'name' as SortMode, icon: 'arrow-down', label: 'Name' };

    const btn = parent.createDiv({ cls: 'po-sort-btn', title: `Sort: ${current.label}` });
    const btnIcon = btn.createDiv({ cls: 'po-sort-btn-icon' });
    setIcon(btnIcon, current.icon);
    btn.createDiv({ cls: 'po-sort-btn-label', text: current.label });
    setIcon(btn.createDiv({ cls: 'po-sort-btn-chevron' }), 'chevron-down');

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = activeDocument.querySelector('.po-sort-menu');
      if (existing) { existing.remove(); return; }   // toggle

      const menu = activeDocument.body.createDiv({ cls: 'po-sort-menu' });

      for (const mode of this.SORT_MODES) {
        const item = menu.createDiv({ cls: 'po-sort-menu-item' });
        if (mode.value === this.manager.data.sortMode) item.addClass('po-sort-menu-item--active');

        const iconEl = item.createDiv({ cls: 'po-sort-menu-item-icon' });
        setIcon(iconEl, mode.icon);
        item.createSpan({ text: mode.label });

        item.addEventListener('click', () => {
          void this.manager.setSortMode(mode.value);
          this.refreshGroupList();
          menu.remove();
          // Update trigger button to reflect new selection
          btnIcon.empty();
          setIcon(btnIcon, mode.icon);
          btn.querySelector<HTMLElement>('.po-sort-btn-label')!.textContent = mode.label;
          btn.setAttribute('title', `Sort: ${mode.label}`);
        });
      }

      const rect = btn.getBoundingClientRect();
      menu.style.top  = `${rect.bottom + window.scrollY + 4}px`;
      menu.style.left = `${rect.left   + window.scrollX}px`;

      const close = (ev: MouseEvent) => {
        if (!menu.contains(ev.target as Node) && ev.target !== btn) {
          menu.remove();
          activeDocument.removeEventListener('mousedown', close);
        }
      };
      window.setTimeout(() => activeDocument.addEventListener('mousedown', close), 0);
    });
  }

  // ─── Group list ────────────────────────────────────────────────────────────

  private renderGroups(parent: HTMLElement): void {
    this.cleanup();

    const groupsContainer = parent.createDiv({ cls: 'po-groups-container' });
    groupsContainer.setAttribute('id', 'po-groups-container');

    const sortedGroups = this.manager.getGroupsSorted();
    const allPluginsMap = new Map(this.plugins.map(p => [p.id, p]));

    // ── Named groups ────────────────────────────────────────────────────────
    for (const group of sortedGroups) {
      const groupPlugins = this.resolvePlugins(group.pluginIds, allPluginsMap);

      const section = new GroupSection({
        app:      this.app,
        group,
        plugins:  this.sortPlugins(groupPlugins),
        allGroups: sortedGroups,
        onRename:         (id, name) => { void this.manager.renameGroup(id, name); },
        onDelete:         (id) => { void this.manager.deleteGroup(id); this.refreshGroupList(); },
        onColorChange:    (id, color) => { void this.manager.setGroupColor(id, color); },
        onToggleCollapse: (id, collapsed) => { void this.manager.setGroupCollapsed(id, collapsed); },
        onReorderPlugins: (gid, from, to) => { void this.manager.reorderPluginsInGroup(gid, from, to); },
        onMoveToGroup:    (pid, gid) => { void this.movePlugin(pid, gid); } ,
        onPluginToggle:   (p) => this.handlePluginToggle(p),
        onPluginUninstall:(p) => this.handlePluginUninstall(p),
        onOpenSettings:   () => { /* tab stays open */ },
      });
      groupsContainer.appendChild(section.el);
      this.sections.push(section);
    }

    // ── Ungrouped ────────────────────────────────────────────────────────────
    if (this.manager.data.showUngrouped) {
      const ungroupedIds     = this.manager.getUngroupedIds();
      const ungroupedPlugins = this.resolvePlugins(ungroupedIds, allPluginsMap);

      const ungroupedSection = new GroupSection({
        app:      this.app,
        group: {
          id: '__ungrouped__',
          name: 'Ungrouped',
          collapsed: false,
          order: 9999,
          pluginIds: ungroupedIds,
          plugins: []
        },
        plugins:    this.sortPlugins(ungroupedPlugins),
        allGroups:  sortedGroups,
        isUngrouped: true,
        onRename:         () => {},
        onDelete:         () => {},
        onColorChange:    () => {},
        onToggleCollapse: () => {},
        onReorderPlugins: (_, from, to) => { void this.manager.reorderUngrouped(from, to); },
        onMoveToGroup:    (pid, gid) => { void this.movePlugin(pid, gid); },
        onPluginToggle:   (p) => this.handlePluginToggle(p),
        onPluginUninstall:(p) => this.handlePluginUninstall(p),
        onOpenSettings:   () => {},
      });
      groupsContainer.appendChild(ungroupedSection.el);
      this.sections.push(ungroupedSection);
    }

    // Apply any active search
    if (this.searchQuery) this.applySearch();
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private resolvePlugins(
    ids: string[],
    map: Map<string, ManagedPlugin>
  ): ManagedPlugin[] {
    return ids.flatMap((id: string) => {
      const p = map.get(id);
      return p ? [p] : [];
    });
  }

  private sortPlugins(plugins: ManagedPlugin[]): ManagedPlugin[] {
    const mode = this.manager.data.sortMode;
    return [...plugins].sort((a, b) => {
      if (mode === 'name-asc')  return a.name.localeCompare(b.name);
      if (mode === 'name-desc') return b.name.localeCompare(a.name);
      if (mode === 'type')      return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
      if (mode === 'enabled')   return (b.enabled ? 1 : 0) - (a.enabled ? 1 : 0);
      return 0;
    });
  }

  private async movePlugin(pluginId: string, groupId: string | null): Promise<void> {
    if (groupId === null) {
      void this.manager.removePluginFromGroup(pluginId);
    } else {
      await this.manager.addPluginToGroup(pluginId, groupId);
    }
    this.refreshGroupList();
  }

  private handlePluginToggle(plugin: ManagedPlugin): void {
    // Update the local plugins array so re-renders are accurate
    const p = this.plugins.find(x => x.id === plugin.id);
    if (p) p.enabled = plugin.enabled;
  }

  private handlePluginUninstall(plugin: ManagedPlugin): void {
    this.plugins = this.plugins.filter(p => p.id !== plugin.id);
    void this.manager.syncWithInstalled(this.plugins);
    this.refreshGroupList();
  }

  private applySearch(): void {
    const q = this.searchQuery;
    this.containerEl.querySelectorAll<HTMLElement>('.po-plugin-card').forEach(card => {
      const id   = card.getAttribute('data-plugin-id') ?? '';
      const name = card.querySelector('.po-plugin-name')?.textContent?.toLowerCase() ?? '';
      const desc = card.querySelector('.po-plugin-description')?.textContent?.toLowerCase() ?? '';
      const visible = !q || name.includes(q) || id.includes(q) || desc.includes(q);
      card.style.display = visible ? '' : 'none';
    });

    // Hide group sections that have no visible cards
    this.containerEl.querySelectorAll<HTMLElement>('.po-group-section').forEach(section => {
      if (!q) { section.style.display = ''; return; }
      const visibleCards = section.querySelectorAll<HTMLElement>(
        '.po-plugin-card:not([style*="display: none"])'
      );
      section.style.display = visibleCards.length === 0 ? 'none' : '';
    });
  }

  
  private refreshGroupList(): void {
    // Re-render just the groups container, preserving the toolbar
    const container = this.containerEl.querySelector<HTMLElement>('#po-groups-container');
    if (container) {
      this.cleanup();
      container.remove();
    }
    this.renderGroups(this.containerEl);
  }

  private cleanup(): void {
    this.sections.forEach(s => s.destroy());
    this.sections = [];
  }
}


export default class PluginOrganizerPlugin extends Plugin {
  manager!: GroupManager;

  async onload() {
    this.manager = new GroupManager(this);
    await this.manager.load();

    this.addSettingTab(new PluginManagerTab(this.app, this, this.manager));

    // Add a ribbon icon for quick access
    this.addRibbonIcon('layout-grid', 'Plugin organizer', () => {
      internals(this.app).setting.open();
      internals(this.app).setting.openTabById('plugin-organizer');
    });

    // Register a command to open the tab
    this.addCommand({
      id:   'open-setting',
      name: 'Open setting',
      callback: () => {
        internals(this.app).setting.open();
        internals(this.app).setting.openTabById('plugin-organizer');
      },
    });

  }

}
