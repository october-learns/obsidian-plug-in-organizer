export interface PluginGroup {
  plugins: ManagedPlugin[];
  id: string;
  name: string;
  collapsed: boolean;
  order: number;
  pluginIds: string[]; // core + community IDs
  color?: string; 
  icon?: string; 
}

export interface PluginManagerData {
  groups: PluginGroup[];
  ungroupedOrder: string[]; 
  showUngrouped: boolean;
  searchQuery: string;
  sortMode: SortMode;
  version: number; // schema version for future migrations
}

export type SortMode = 'name-asc' | 'name-desc' | 'type' | 'enabled';

export type PluginType = 'core' | 'community';

/** Normalised view of both core and community plugins */
export interface ManagedPlugin {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  enabled: boolean;
  type: PluginType;
  hasDonate: boolean;
  donateUrl?: string;
  hasSettings: boolean; 
}

/** Default data written on first install */
export const DEFAULT_DATA: PluginManagerData = {
  groups: [],
  ungroupedOrder: [],
  showUngrouped: true,
  searchQuery: '',
  sortMode: 'enabled',
  version: 1,
};

/** Colour palette for group headers (cycles if user creates many groups) */
export const GROUP_COLORS = [
  '#7c3aed', // violet
  '#0ea5e9', // sky
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
];
