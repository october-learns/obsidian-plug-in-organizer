import { App, Modal, setIcon , ButtonComponent , ToggleComponent} from 'obsidian';
import { ManagedPlugin, PluginGroup } from './types';
import {
  openPluginHotkeys,
  openPluginSettings,
  togglePlugin,
} from './pluginAccess';
// import { el, formatDonateLabel } from './domHelpers';

/** Create an element with optional class list and inner text */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classes: string[] = [],
  text?: string
): HTMLElementTagNameMap[K] {
  const node = activeDocument.createElement(tag);
  if (classes.length) node.addClass(...classes);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Format a URL to a display-friendly donate label */
export function formatDonateLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const known: Record<string, string> = {
      'buymeacoffee.com': 'Buy Me a Coffee',
      'ko-fi.com':        'Ko-fi',
      'patreon.com':      'Patreon',
      'github.com':       'GitHub Sponsors',
      'paypal.me':        'PayPal',
      'paypal.com':       'PayPal',
    };
    return known[host] ?? 'Donate';
  } catch {
    return 'Donate';
  }
}

export interface PluginCardOptions {
  app: App;
  plugin: ManagedPlugin;
  groups: PluginGroup[];
  currentGroupId: string | null; // null = ungrouped
  onToggle: (plugin: ManagedPlugin) => void;
  onUninstall: (plugin: ManagedPlugin) => void;
  onMoveToGroup: (pluginId: string, groupId: string | null) => void;
  onOpenSettings: () => void; // called after opening settings so the tab can close
}

export class PluginCard {
  private opts: PluginCardOptions;
  el: HTMLElement;

  constructor(opts: PluginCardOptions) {
    this.opts = opts;
    this.el   = this.render();
  }

  private render(): HTMLElement {
    const { plugin, app } = this.opts;

    const card = el('div', ['po-plugin-card']);
    card.setAttribute('data-plugin-id', plugin.id);
    card.setAttribute('data-plugin-type', plugin.type);
    
    card.createDiv({ cls: 'po-plugin-card-spacer' });

    // ── Info block ─────────────────────────────────────────────────────────
    const info = card.createDiv({ cls: 'po-plugin-info' });
    const titleRow = info.createDiv({ cls: 'po-plugin-title-row' });
    titleRow.createSpan({
      cls: `po-type-badge po-type-badge--${plugin.type}`,
      text: plugin.type === 'core' ? 'CORE' : 'COMMUNITY',
    });
    
    titleRow.createSpan({ cls: 'po-plugin-name', text: plugin.name });

    if (plugin.version) { 
      titleRow.createSpan({ cls: 'po-plugin-version', text: `v${plugin.version}` });
    }
    
    if (plugin.author) { 
      titleRow.createSpan({ cls: 'po-plugin-author', text: `by ${plugin.author}` });
    }
    
    if (plugin.description) { 
      info.createDiv({ cls: 'po-plugin-description', text: plugin.description });
    }

    // ── Action buttons ─────────────────────────────────────────────────────
    const actions = card.createDiv({ cls: 'po-plugin-actions' });

    // Settings button
    if (plugin.hasSettings) {
      const settingsBtn = this.iconButton(actions, 'settings', 'Options');
      settingsBtn.addEventListener('click', () => {
        openPluginSettings(app, plugin.id);
        this.opts.onOpenSettings();
      });
    }

    // Hotkeys button
    const hotkeysBtn = this.iconButton(actions, 'keyboard', 'Hotkeys');
    hotkeysBtn.addEventListener('click', () => {
      openPluginHotkeys(app, plugin.name);
      this.opts.onOpenSettings();
    });


    if (plugin.hasDonate && plugin.donateUrl) {

      const donateBtn = this.iconButton(actions, 'heart', formatDonateLabel(plugin.donateUrl));
      donateBtn.addEventListener('click', () => {
        const modal = new Modal(app);
        modal.titleEl.setText(`Donate to support ${plugin.name}`);

        const content = modal.contentEl;

        content.createEl('p', { text: 'Plugin developers are community volunteers who make amazing things out of passion. If you find this plugin useful, please consider funding its development.' });
        content.createEl('p', { text: '100% of your contribution will go to the plugin developer; Obsidian does not take a cut. The funding platform they choose might charge a fee.' });
        content.createEl('p', { text: 'Thanks for your generous support!' });

        content.createEl('hr');

        // Donate links
        const linksDiv = content.createDiv();

        const donateLinks = plugin.donateUrl as unknown as Record<string, string>;

        Object.keys(donateLinks).forEach((type) => {
          const url = donateLinks[type];
          const p = linksDiv.createEl('p');
          p.createSpan({ text: `${type}: ` });
          p.createEl('a', {
            text: url,
            href: url,
            cls: 'external-link',
          });
        });

        // Done button
        const buttonRow = content.createDiv({ cls: 'modal-button-container' });
        new ButtonComponent(buttonRow)
          .setButtonText('Done')
          .setCta()
          .onClick(() => modal.close());

        modal.open();
      });
    }

    // Move-to-group button
    if (this.opts.groups.length > 0) {
      const moveBtn = this.iconButton(actions, 'folder-plus', 'Move to group');
      moveBtn.addEventListener('click', (e) => {
        this.showGroupMenu(e, moveBtn);
      });
    }

    // Uninstall button (community only)
    if (plugin.type === 'community') {
      const uninstallBtn = this.iconButton(actions, 'trash-2', 'Uninstall');
      uninstallBtn.addClass('po-btn--danger');
      uninstallBtn.addEventListener('click', () => {

        const pluginM = (app as unknown as { plugins: { uninstallPlugin: (id: string) => Promise<void> } }).plugins;

        const modal = new Modal(app);
        modal.titleEl.setText('Uninstall plugin');
        
        modal.contentEl.createEl('p', {
          text: 'Are you sure you want to uninstall this plugin? This will delete the folder of the plugin.'
        });

        const buttonRow = modal.contentEl.createDiv({ cls: 'modal-button-container' });

        new ButtonComponent(buttonRow)
          .setButtonText('Uninstall')
          .setClass('mod-warning')
          .setCta()
          .onClick(() => {
            modal.close();
            pluginM.uninstallPlugin(plugin.id)
              .then(() => {
                this.opts.onUninstall(plugin);
              })
              .catch((error) => {
                console.error('Failed to uninstall plugin:', error);
              });
          });

        new ButtonComponent(buttonRow)
          .setButtonText('Cancel')
          .onClick(() => modal.close());

        modal.open();
      });
    }

    // Toggle
    const toggleComponent = new ToggleComponent(actions)
      .setValue(plugin.enabled)
      .onChange(() => {
        togglePlugin(app, plugin)
          .then(() => {
            plugin.enabled = !plugin.enabled;
            card.toggleClass('po-plugin-card--disabled', !plugin.enabled);
            this.opts.onToggle(plugin);
          })
          .catch((error) => {
            console.error("Failed to toggle plugin:", error);
          });
      });

    return card;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private iconButton(parent: HTMLElement, icon: string, title: string): HTMLElement {
    const btn = parent.createDiv({ cls: 'po-icon-btn', title });
    setIcon(btn, icon);
    return btn;
  }

  private showGroupMenu(e: MouseEvent, anchor: HTMLElement): void {
    const { groups, currentGroupId, plugin, onMoveToGroup } = this.opts;

    // Build a tiny floating menu
    const existing = activeDocument.querySelector('.po-group-menu');
    existing?.remove();

    const menu = activeDocument.body.createDiv({ cls: 'po-group-menu' });

    // "Remove from group" option if currently in a group
    if (currentGroupId !== null) {
      const item = menu.createDiv({ cls: 'po-group-menu-item' });
      const dot = item.createSpan({ cls: 'po-group-menu-dot'  });
      // dot.style.background = '#888888';
      dot.addClass('po-ungroup-color-dot');
      item.createSpan({ text: 'Remove from group' });

      item.addEventListener('click', () => {
        onMoveToGroup(plugin.id, null);
        menu.remove();
      });
    }

    // move to another group 
    for (const group of groups) {
      if (group.id === currentGroupId) continue;
      const item = menu.createDiv({ cls: 'po-group-menu-item' });
      if (group.color) {
        const dot = item.createSpan({ cls: 'po-group-menu-dot' });
        dot.style.background = group.color;
      }
      item.createSpan({ text: group.name });

      item.addEventListener('click', () => {
        onMoveToGroup(plugin.id, group.id);
        menu.remove();
      });
    }

    // Position menu near the button
    const rect = anchor.getBoundingClientRect();
    menu.style.top  = `${rect.bottom + window.scrollY + 4}px`;
    menu.style.left = `${rect.left  + window.scrollX}px`;

    // Close on outside click
    const close = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        activeDocument.removeEventListener('mousedown', close);
      }
    };
    window.setTimeout(() => activeDocument.addEventListener('mousedown', close), 0);
  }
}
