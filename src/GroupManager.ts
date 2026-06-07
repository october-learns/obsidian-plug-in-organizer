import { Plugin } from 'obsidian';
import {
  DEFAULT_DATA, GROUP_COLORS, 
  ManagedPlugin, PluginGroup, PluginManagerData, SortMode,
} from './types';

export class GroupManager {
  private plugin: Plugin;
  data: PluginManagerData;

  constructor(plugin: Plugin) {
    this.plugin = plugin;
    this.data   = { ...DEFAULT_DATA };
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  async load(): Promise<void> {
    const saved = await this.plugin.loadData() as Partial<PluginManagerData> | null;
    if (!saved) {
      this.data = { ...DEFAULT_DATA };
      return;
    }
    this.data = {
      ...DEFAULT_DATA,
      ...saved,
      groups: saved.groups ?? [],
    };
  }

  async save(): Promise<void> {
    await this.plugin.saveData(this.data);
  }

  // ─── Group CRUD ────────────────────────────────────────────────────────────

  async createGroup(name: string): Promise<PluginGroup> {

    const usedColors = new Set(this.data.groups.map(g => g.color));
    const color = GROUP_COLORS.find(c => !usedColors.has(c)) ?? GROUP_COLORS[0];

    // Shift every existing group down so the new group lands at the top
    for (const g of this.data.groups) {
      g.order++;
    }

    const group: PluginGroup = {
      id: `group-${Date.now()}`,
      name: name.trim() || 'New Group',
      collapsed: false,
      order: 0, // always first
      pluginIds: [],
      color,
      plugins: []
    };
    this.data.groups.unshift(group); // keep array order in sync with sorted order
    await this.save();
    return group;
  }

  async deleteGroup(groupId: string): Promise<void> {
    const group = this.getGroupById(groupId);
    if (!group) return;
    // Move all its plugins back to ungrouped
    for (const pid of group.pluginIds) {
      if (!this.data.ungroupedOrder.includes(pid)) {
        this.data.ungroupedOrder.push(pid);
      }
    }

    // Remove from array, then renumber order in-place (preserves object references)
    this.data.groups = this.data.groups.filter(g => g.id !== groupId);
    this.data.groups.forEach((g, i) => { g.order = i; });
    await this.save();
  }

  async renameGroup(groupId: string, newName: string): Promise<void>  {
    const group = this.getGroupById(groupId);
    if (!group) return;
    group.name = newName.trim() || group.name;
    await this.save();
  }

  async setGroupColor(groupId: string, color: string): Promise<void>  {
    const group = this.getGroupById(groupId);
    if (!group) return;
    group.color = color;
    await this.save();
  }


  /** SET collapsed state directly — never call toggle twice on same group. */
  async setGroupCollapsed(groupId: string, collapsed: boolean): Promise<void> {
    const group = this.getGroupById(groupId);
    if (!group) return;
    group.collapsed = collapsed;
    await this.save();
  }

  async reorderGroups(fromIndex: number, toIndex: number): Promise<void> {
    // Always sort before reordering so indices match DOM order
    const sorted = [...this.data.groups].sort((a, b) => a.order - b.order);
    const [moved] = sorted.splice(fromIndex, 1);
    sorted.splice(toIndex, 0, moved);
    // Update order in-place on the SAME objects (preserves GroupSection references)
    sorted.forEach((g, i) => { g.order = i; });

    await this.save();
  }

  // ─── Plugin ↔ Group assignment ─────────────────────────────────────────────

  /** Move a plugin into a group (removes from any existing group / ungrouped). */
  async addPluginToGroup(pluginId: string, groupId: string): Promise<void>  {
    this.removePluginFromAllGroups(pluginId);
    const group = this.getGroupById(groupId);
    if (!group) return;
    if (!group.pluginIds.includes(pluginId)) {
      group.pluginIds.push(pluginId);
    }
    await this.save();
  }

  /** Remove a plugin from its current group → goes to ungrouped. */
  async removePluginFromGroup(pluginId: string): Promise<void>  {
    this.removePluginFromAllGroups(pluginId);
    if (!this.data.ungroupedOrder.includes(pluginId)) {
      this.data.ungroupedOrder.push(pluginId);
    }
    await this.save();
  }

  async reorderPluginsInGroup(groupId: string, fromIndex: number, toIndex: number): Promise<void>  {
    const group = this.getGroupById(groupId);
    if (!group) return;
    const ids = [...group.pluginIds];
    const [moved] = ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, moved);
    group.pluginIds = ids;
    await this.save();
  }

  async reorderUngrouped(fromIndex: number, toIndex: number): Promise<void>  {
    const ids = [...this.data.ungroupedOrder];
    const [moved] = ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, moved);
    this.data.ungroupedOrder = ids;
    await this.save();
  }

  // ─── Query helpers ─────────────────────────────────────────────────────────

  getGroupById(id: string): PluginGroup | undefined {
    return this.data.groups.find(g => g.id === id);
  }

  getGroupForPlugin(pluginId: string): PluginGroup | undefined {
    return this.data.groups.find(g => g.pluginIds.includes(pluginId));
  }

  getGroupsSorted(): PluginGroup[] {
    return [...this.data.groups].sort((a, b) => a.order - b.order);
  }

  async syncWithInstalled(installedPlugins: ManagedPlugin[]): Promise<void>  {
    const installedIds = new Set(installedPlugins.map(p => p.id));

    // Remove stale IDs from all groups
    for (const group of this.data.groups) {
      group.pluginIds = group.pluginIds.filter(id => installedIds.has(id));
    }

    // Remove stale IDs from ungrouped
    this.data.ungroupedOrder = this.data.ungroupedOrder.filter(id => installedIds.has(id));

    // Add new plugins that aren't tracked anywhere yet
    const trackedIds = new Set([
      ...this.data.groups.flatMap(g => g.pluginIds),
      ...this.data.ungroupedOrder,
    ]);
    for (const p of installedPlugins) {
      if (!trackedIds.has(p.id)) {
        this.data.ungroupedOrder.push(p.id);
      }
    }

    await this.save();
  }

  /** Return ordered plugin IDs for the ungrouped section. */
  getUngroupedIds(): string[] {
    return this.data.ungroupedOrder;
  }

  async setSortMode(mode: SortMode): Promise<void>  {
    this.data.sortMode = mode;
    await this.save();
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private removePluginFromAllGroups(pluginId: string): void {
    for (const group of this.data.groups) {
      group.pluginIds = group.pluginIds.filter(id => id !== pluginId);
    }
    this.data.ungroupedOrder = this.data.ungroupedOrder.filter(id => id !== pluginId);
  }
}
