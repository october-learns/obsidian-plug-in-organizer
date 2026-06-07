import { App } from 'obsidian';
import { ManagedPlugin } from './types';

// ─── Internal API type hints (not exported by obsidian.d.ts) ─────────────────

interface InternalPlugin {
  id: string;
  name: string;
  enabled: boolean;
  instance: {
    name: string;
    description: string;
    [key: string]: unknown;
  };

  enable: (save: boolean) => Promise<void>;   
  disable: (save: boolean) => Promise<void>;  
}

interface CommunityPlugin {
  manifest: {
    id: string;
    name: string;
    version: string;
    author: string;
    description: string;
    authorUrl?: string;
    fundingUrl?: string;
  };
  [key: string]: unknown;

  enable: (save: boolean) => Promise<void>;   
  disable: (save: boolean) => Promise<void>;  
}

interface ObsidianInternals {
  internalPlugins: {
    plugins: Record<string, InternalPlugin>;
    getPluginById(id: string): InternalPlugin | null;
  };
  plugins: {
    plugins: Record<string, CommunityPlugin>;   // enabled plugins only (loaded instances)
    manifests: Record<string, CommunityPlugin['manifest']>; // ALL installed plugins
    enabledPlugins: Set<string>;
    enablePlugin(id: string): Promise<void>;
    disablePlugin(id: string): Promise<void>;
    uninstallPlugin(id: string): Promise<void>;
    getPlugin(id: string): CommunityPlugin | null;
  };
  setting: {
    open(): void;
    openTabById(id: string): void;
    settingTabs: Array<{ id: string; name: string }>;
    pluginTabs:  Array<{ id: string; name: string }>;
  };
}

// Exported so main.ts can use it without unsafe `as any` casts
export function internals(app: App): ObsidianInternals {
  return app as unknown as ObsidianInternals;
}

// ─── Read all plugins ─────────────────────────────────────────────────────────

/**
 * Returns a normalised list of ALL plugins (core + community).
 * Never throws — returns empty array on any error.
 */
export function getAllPlugins(app: App): ManagedPlugin[] {
  const result: ManagedPlugin[] = [];

  // ── Core (internal) plugins ──────────────────────────────────────────────
  try {
    const { plugins } = internals(app).internalPlugins;
    for (const id of Object.keys(plugins)) {
      const p = plugins[id];
      if (!p) continue;
      result.push({
        id,
        name:        p.instance?.name  ?? formatId(id),
        version:     '',                // core plugins have no version string
        author:      'Obsidian',
        description: p.instance?.description ?? '',
        enabled:     p.enabled,
        type:        'core',
        hasDonate:   false,
        hasSettings: hasSettingsTab(app, id),
      });
    }
  } catch (e) {
    console.warn('[Plugin Organizer] Could not read core plugins:', e);
  }

  // ── Community plugins ────────────────────────────────────────────────────
  try {
    const { manifests, enabledPlugins } = internals(app).plugins;
    for (const id of Object.keys(manifests)) {
      const m = manifests[id];
      if (!m) continue;
      result.push({
        id,
        name:        m.name,
        version:     m.version      ?? '',
        author:      m.author       ?? '',
        description: m.description  ?? '',
        enabled:     enabledPlugins.has(id),
        type:        'community',
        hasDonate:   !!m.fundingUrl,
        donateUrl:   m.fundingUrl,
        hasSettings: hasSettingsTab(app, id),
      });
    }
  } catch (e) {
    console.warn('[Plugin Organizer] Could not read community plugins:', e);
  }

  return result;
}

export function getPlugin(app: App, id: string): ManagedPlugin | null {
  return getAllPlugins(app).find(p => p.id === id) ?? null;
}

// ─── Enable / Disable ────────────────────────────────────────────────────────

export async function togglePlugin(app: App, plugin: ManagedPlugin): Promise<void> {
  try {
    if (plugin.type === 'core') {
      const internalPlugins = (app as unknown as {
        internalPlugins: {
          getPluginById: (id: string) => {
            enabled: boolean;
            enable: (save: boolean) => Promise<void>;
            disable: (save: boolean) => Promise<void>;
          } | null
        }
      }).internalPlugins;

      const p = internalPlugins.getPluginById(plugin.id);
      if (!p) {
        console.warn(`[Plugin Organizer] Core plugin not found: ${plugin.id}`);
        return;
      }
      if (plugin.enabled) {
        await p.disable(true);  // true = save to config
      } else {
        await p.enable(true);   // true = save to config
      }

    } else {
      const pluginRegistry = (app as unknown as {
        plugins: {
          enablePlugin: (id: string) => Promise<void>;
          disablePlugin: (id: string) => Promise<void>;
        }
      }).plugins;

      if (plugin.enabled) {
        await pluginRegistry.disablePlugin(plugin.id);
      } else {
        await pluginRegistry.enablePlugin(plugin.id);
      }
    }
  } catch (e) {
    console.error('[Plugin Organizer] togglePlugin error:', e);
  }
}

// ─── Uninstall (community only) ───────────────────────────────────────────────

export async function uninstallPlugin(app: App, id: string): Promise<void> {
  try {
    await internals(app).plugins.uninstallPlugin(id);
  } catch (e) {
    console.error('[Plugin Organizer] uninstallPlugin error:', e);
  }
}

// ─── Open settings / hotkeys ─────────────────────────────────────────────────

export function openPluginSettings(app: App, id: string): void {
  try {
    internals(app).setting.openTabById(id);
  } catch (e) {
    console.warn('[Plugin Organizer] openPluginSettings error:', e);
  }
}

export function openPluginHotkeys(app: App, pluginName: string): void {
  try {
    const s = internals(app).setting;
    s.openTabById('hotkeys');
    window.setTimeout(() => {
      const input = activeDocument.querySelector<HTMLInputElement>(
        '.hotkey-search-input, .setting-search-input'
      );
      if (input) {
        input.value = pluginName;
        input.dispatchEvent(new Event('input'));
      }
    }, 100);
  } catch (e) {
    console.warn('[Plugin Organizer] openPluginHotkeys error:', e);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Check whether Obsidian has registered a settings tab for the given plugin id. */
function hasSettingsTab(app: App, id: string): boolean {
  try {
    const s = internals(app).setting;
    const tabs = [...(s.settingTabs ?? []), ...(s.pluginTabs ?? [])];
    return tabs.some(t => t.id === id);
  } catch {
    return false;
  }
}

/** Convert a kebab-case id to a Title Case display name */
function formatId(id: string): string {
  return id
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}