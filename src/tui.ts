import blessed from "blessed";
import { Config } from "./config.js";
import { loadRegistry, Registry } from "./registry.js";
import { SqliteIndex } from "./sqlite_index.js";
import { syncRepos } from "./sync.js";
import { buildIndex } from "./index_builder.js";
import { scanRepo } from "./repo_scan.js";
import fs from "node:fs/promises";
import path from "node:path";

type Screen = "home" | "repos" | "templates" | "inject" | "logs";

interface TUIState {
  currentScreen: Screen;
  selectedIndex: number;
  registry: Registry;
  config: Config;
  logs: string[];
  isLoading: boolean;
  statusMessage: string;
}

export class BTW_TUI {
  private screen: blessed.Widgets.Screen;
  private state: TUIState;
  private container: blessed.Widgets.BoxElement | null = null;
  private header: blessed.Widgets.BoxElement | null = null;
  private footer: blessed.Widgets.BoxElement | null = null;
  private content: blessed.Widgets.BoxElement | null = null;
  private sidebar: blessed.Widgets.ListElement | null = null;

  constructor(private config: Config) {
    this.screen = blessed.screen({
      smartCSR: true,
      title: "BTW - Bring The Workers",
      fullUnicode: true,
    });

    this.state = {
      currentScreen: "home",
      selectedIndex: 0,
      registry: { repos: [], active_repo_id: null },
      config,
      logs: [],
      isLoading: false,
      statusMessage: "Ready",
    };

    this.setupScreen();
    this.setupKeyBindings();
  }

  private setupScreen(): void {
    // Main container
    this.container = blessed.box({
      parent: this.screen,
      width: "100%",
      height: "100%",
      style: {
        bg: "#1a1b26",
      },
    });

    // Header with gradient effect
    this.header = blessed.box({
      parent: this.container,
      top: 0,
      left: 0,
      width: "100%",
      height: 5,
      tags: true,
      style: {
        bg: "#414868",
        fg: "#c0caf5",
      },
    });

    // Sidebar navigation
    this.sidebar = blessed.list({
      parent: this.container,
      top: 5,
      left: 0,
      width: 20,
      height: "100%-8",
      tags: true,
      mouse: true,
      keys: true,
      vi: true,
      border: {
        type: "line",
        fg: "#565f89",
      } as any,
      style: {
        bg: "#24283b",
        fg: "#a9b1d6",
        selected: {
          bg: "#7aa2f7",
          fg: "#1a1b26",
          bold: true,
        },
        border: {
          fg: "#565f89",
        },
      },
      items: [
        " Home",
        " Repos",
        " Templates",
        " Inject",
        " Logs",
      ],
    });

    // Content area with border
    this.content = blessed.box({
      parent: this.container,
      top: 5,
      left: 20,
      width: "100%-20",
      height: "100%-8",
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      border: { 
        type: "line",
        fg: "#565f89",
      } as any,
      scrollbar: {
        ch: "█",
        style: {
          bg: "#7aa2f7",
        },
        track: {
          bg: "#3b4261",
        },
      },
      style: {
        bg: "#1a1b26",
        fg: "#c0caf5",
        border: { 
          fg: "#565f89",
        },
      },
    });

    // Footer status bar
    this.footer = blessed.box({
      parent: this.container,
      bottom: 0,
      width: "100%",
      height: 3,
      tags: true,
      style: {
        bg: "#414868",
        fg: "#c0caf5",
      },
    });

    this.updateHeader();
    this.updateFooter();

    // Sidebar navigation
    this.sidebar.on("select", (item, index) => {
      const screens: Screen[] = ["home", "repos", "templates", "inject", "logs"];
      this.navigateToScreen(screens[index]);
    });

    this.sidebar.focus();
  }

  private setupKeyBindings(): void {
    // Quit
    this.screen.key(["q", "C-c"], () => {
      return process.exit(0);
    });

    // Navigation between screens
    this.screen.key(["1"], () => {
      this.sidebar?.select(0);
      this.navigateToScreen("home");
    });
    this.screen.key(["2"], () => {
      this.sidebar?.select(1);
      this.navigateToScreen("repos");
    });
    this.screen.key(["3"], () => {
      this.sidebar?.select(2);
      this.navigateToScreen("templates");
    });
    this.screen.key(["4"], () => {
      this.sidebar?.select(3);
      this.navigateToScreen("inject");
    });
    this.screen.key(["5"], () => {
      this.sidebar?.select(4);
      this.navigateToScreen("logs");
    });

    // Tab to focus sidebar
    this.screen.key(["tab"], () => {
      this.sidebar?.focus();
    });

    // Escape to go back to home
    this.screen.key(["escape"], () => {
      if (this.state.currentScreen !== "home") {
        this.sidebar?.select(0);
        this.navigateToScreen("home");
      }
    });

    // Refresh
    this.screen.key(["r"], async () => {
      await this.refresh();
    });
  }

  private updateHeader(): void {
    if (!this.header) return;

    const title = `{center}{bold}BTW - Bring The Workers{/bold}{/center}`;
    const screen = `{center}{bold}${this.state.currentScreen.toUpperCase()}{/bold}{/center}`;
    const status = `{center}${this.state.isLoading ? "Loading..." : this.state.statusMessage}{/center}`;

    this.header.setContent(`${title}\n${screen}\n${status}`);
  }

  private updateFooter(): void {
    if (!this.footer) return;

    const shortcuts = [
      "{bold}TAB{/bold}:Menu",
      "{bold}↑↓{/bold}:Navigate",
      "{bold}ENTER{/bold}:Select",
      "{bold}R{/bold}:Refresh",
      "{bold}Q{/bold}:Quit",
    ];

    const footerText = `{center}${shortcuts.join("  │  ")}{/center}`;
    this.footer.setContent(`\n${footerText}`);
  }

  private navigateToScreen(screen: Screen): void {
    this.state.currentScreen = screen;
    this.state.selectedIndex = 0;
    this.updateHeader();
    this.renderCurrentScreen();
  }

  private async refresh(): Promise<void> {
    this.state.isLoading = true;
    this.state.statusMessage = "Refreshing...";
    this.updateHeader();
    this.screen.render();

    try {
      this.state.registry = await loadRegistry(this.config);
      this.state.statusMessage = "Ready";
      this.addLog("Refreshed successfully");
    } catch (err) {
      this.state.statusMessage = `Error: ${String(err)}`;
      this.addLog(`Error refreshing: ${String(err)}`);
    }

    this.state.isLoading = false;
    this.updateHeader();
    this.renderCurrentScreen();
  }

  private addLog(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this.state.logs.unshift(`[${timestamp}] ${message}`);
    if (this.state.logs.length > 100) {
      this.state.logs = this.state.logs.slice(0, 100);
    }
  }

  private renderCurrentScreen(): void {
    switch (this.state.currentScreen) {
      case "home":
        this.renderHomeScreen();
        break;
      case "repos":
        this.renderReposScreen();
        break;
      case "templates":
        this.renderTemplatesScreen();
        break;
      case "inject":
        this.renderInjectScreen();
        break;
      case "logs":
        this.renderLogsScreen();
        break;
    }

    this.screen.render();
  }

  private renderHomeScreen(): void {
    if (!this.content) return;

    this.content.children = [];

    const homeBox = blessed.box({
      parent: this.content,
      top: 1,
      left: 2,
      width: "100%-4",
      height: "100%-2",
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
    });

    const sections: string[] = [];

    sections.push("{center}{bold}{cyan-fg}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{/cyan-fg}{/bold}{/center}");
    sections.push("{center}{bold}{magenta-fg}Welcome to BTW{/magenta-fg}{/bold}{/center}");
    sections.push("{center}Your gateway to skills, agents, and templates{/center}");
    sections.push("{center}{bold}{cyan-fg}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{/cyan-fg}{/bold}{/center}\n");

    // Stats cards
    sections.push("{center}╔══════════════════════════════════════════════════════════════╗{/center}");
    sections.push("{center}║                    {bold}{green-fg}Repository Summary{/green-fg}{/bold}                    ║{/center}");
    sections.push("{center}╠══════════════════════════════════════════════════════════════╣{/center}");
    sections.push(
      `{center}║  📦 Total Repos: {bold}{yellow-fg}${String(this.state.registry.repos.length).padEnd(3)}{/yellow-fg}{/bold}                                        ║{/center}`
    );
    sections.push(
      `{center}║  ⭐ Active Repo: {bold}{cyan-fg}${(this.state.registry.active_repo_id || "none").padEnd(20)}{/cyan-fg}{/bold}               ║{/center}`
    );
    sections.push("{center}╚══════════════════════════════════════════════════════════════╝{/center}\n");

    // Index stats
    try {
      const index = new SqliteIndex(this.config.indexPath);
      const counts = index.counts();
      sections.push("{center}╔══════════════════════════════════════════════════════════════╗{/center}");
      sections.push("{center}║                      {bold}{blue-fg}Index Statistics{/blue-fg}{/bold}                      ║{/center}");
      sections.push("{center}╠══════════════════════════════════════════════════════════════╣{/center}");
      sections.push(
        `{center}║  ⚡ Skills:    {bold}{green-fg}${String(counts.skills).padStart(6)}{/green-fg}{/bold}                                      ║{/center}`
      );
      sections.push(
        `{center}║  🤖 Agents:    {bold}{blue-fg}${String(counts.agents).padStart(6)}{/blue-fg}{/bold}                                      ║{/center}`
      );
      sections.push(
        `{center}║  📄 Templates: {bold}{magenta-fg}${String(counts.templates).padStart(6)}{/magenta-fg}{/bold}                                      ║{/center}`
      );
      sections.push(
        `{center}║  📊 Total:     {bold}{yellow-fg}${String(counts.total).padStart(6)}{/yellow-fg}{/bold}                                      ║{/center}`
      );
      sections.push("{center}╚══════════════════════════════════════════════════════════════╝{/center}\n");
    } catch (err) {
      sections.push("{center}╔══════════════════════════════════════════════════════════════╗{/center}");
      sections.push("{center}║                      {bold}{red-fg}Index Status{/red-fg}{/bold}                         ║{/center}");
      sections.push("{center}╠══════════════════════════════════════════════════════════════╣{/center}");
      sections.push("{center}║  ⚠️  {red-fg}Index not available{/red-fg}                                 ║{/center}");
      sections.push("{center}║  💡 Press {bold}R{/bold} to sync and rebuild index                   ║{/center}");
      sections.push("{center}╚══════════════════════════════════════════════════════════════╝{/center}\n");
    }

    // Recent repos
    if (this.state.registry.repos.length > 0) {
      sections.push("{center}╔══════════════════════════════════════════════════════════════╗{/center}");
      sections.push("{center}║                   {bold}{yellow-fg}Registered Repos{/yellow-fg}{/bold}                      ║{/center}");
      sections.push("{center}╠══════════════════════════════════════════════════════════════╣{/center}");
      for (const repo of this.state.registry.repos.slice(0, 3)) {
        const active = repo.id === this.state.registry.active_repo_id ? " {green-fg}★{/green-fg}" : "";
        sections.push(
          `{center}║  {bold}{cyan-fg}${repo.id}${active}{/cyan-fg}{/bold}${" ".repeat(Math.max(0, 54 - repo.id.length))}║{/center}`
        );
        const url = repo.url.length > 50 ? repo.url.substring(0, 47) + "..." : repo.url;
        sections.push(`{center}║    {gray-fg}${url}{/gray-fg}${" ".repeat(Math.max(0, 56 - url.length))}║{/center}`);
      }
      if (this.state.registry.repos.length > 3) {
        sections.push(
          `{center}║  {gray-fg}... and ${this.state.registry.repos.length - 3} more{/gray-fg}                                            ║{/center}`
        );
      }
      sections.push("{center}╚══════════════════════════════════════════════════════════════╝{/center}\n");
    }

    // Quick actions with emojis
    sections.push("{center}{bold}{cyan-fg}Quick Actions{/cyan-fg}{/bold}{/center}");
    sections.push("{center}┌─────────────────────────────────────────────┐{/center}");
    sections.push("{center}│  {bold}[2]{/bold} 📦 Manage Repositories              │{/center}");
    sections.push("{center}│  {bold}[3]{/bold} 📄 Browse Templates                 │{/center}");
    sections.push("{center}│  {bold}[4]{/bold} 💉 Configure MCP Injection          │{/center}");
    sections.push("{center}│  {bold}[R]{/bold} 🔄 Refresh & Sync                   │{/center}");
    sections.push("{center}│  {bold}[Q]{/bold} 🚪 Exit                             │{/center}");
    sections.push("{center}└─────────────────────────────────────────────┘{/center}");

    homeBox.setContent(sections.join("\n"));
  }

  private renderReposScreen(): void {
    if (!this.content) return;

    this.content.children = [];

    // Title
    const title = blessed.box({
      parent: this.content,
      top: 0,
      left: 2,
      width: "100%-4",
      height: 3,
      content: "{center}{bold}{cyan-fg}Repository Management{/cyan-fg}{/bold}{/center}",
      tags: true,
    });

    // Repo list
    const list = blessed.list({
      parent: this.content,
      top: 3,
      left: 2,
      width: "100%-4",
      height: "100%-6",
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      border: { 
        type: "line",
        fg: "#7aa2f7",
      } as any,
      scrollbar: {
        ch: "█",
        style: {
          bg: "#7aa2f7",
        },
      },
      style: {
        bg: "#24283b",
        fg: "#c0caf5",
        selected: {
          bg: "#7aa2f7",
          fg: "#1a1b26",
          bold: true,
        },
        border: { 
          fg: "#7aa2f7",
        },
      },
    });

    const items: string[] = [];
    if (this.state.registry.repos.length === 0) {
      items.push("{center}{yellow-fg}╔═══════════════════════════════════╗{/yellow-fg}{/center}");
      items.push("{center}{yellow-fg}║  No repositories registered yet  ║{/yellow-fg}{/center}");
      items.push("{center}{yellow-fg}╚═══════════════════════════════════╝{/yellow-fg}{/center}");
      items.push("");
      items.push("{center}Press {bold}[A]{/bold} to add your first repository{/center}");
    } else {
      for (const repo of this.state.registry.repos) {
        const active =
          repo.id === this.state.registry.active_repo_id ? " {green-fg}★ ACTIVE{/green-fg}" : "";
        items.push(
          `╔═══════════════════════════════════════════════════════════════════════╗`
        );
        items.push(`║ {bold}{cyan-fg}${repo.id}${active}{/cyan-fg}{/bold}`);
        items.push(`╠═══════════════════════════════════════════════════════════════════════╣`);
        items.push(`║ 🔗 URL:        {blue-fg}${repo.url}{/blue-fg}`);
        items.push(`║ 🌿 Branch:     ${repo.branch}`);
        items.push(`║ 📁 Path:       {gray-fg}${repo.localPath}{/gray-fg}`);
        items.push(
          `║ 🏷️  Categories: ${repo.categories.length > 0 ? repo.categories.join(", ") : "{gray-fg}none{/gray-fg}"}`
        );
        items.push(
          `╚═══════════════════════════════════════════════════════════════════════╝`
        );
        items.push("");
      }
    }

    list.setItems(items);

    // Actions help
    const help = blessed.box({
      parent: this.content,
      bottom: 0,
      left: 2,
      width: "100%-4",
      height: 3,
      content:
        "{center}{bold}[A]{/bold}dd Repo  {bold}[U]{/bold}se  {bold}[V]{/bold}alidate  {bold}[S]{/bold}ync  {bold}[ESC]{/bold}Home{/center}",
      tags: true,
      style: {
        bg: "#414868",
        fg: "#c0caf5",
      },
    });

    // Key bindings for this screen
    list.key(["a"], () => {
      this.promptAddRepo();
    });

    list.key(["s"], async () => {
      await this.syncRepos();
    });

    list.key(["v"], async () => {
      await this.validateCurrentRepo();
    });

    list.focus();
  }

  private renderTemplatesScreen(): void {
    if (!this.content) return;

    this.content.children = [];

    // Title
    const title = blessed.box({
      parent: this.content,
      top: 0,
      left: 2,
      width: "100%-4",
      height: 3,
      content: "{center}{bold}{magenta-fg}Template Browser{/magenta-fg}{/bold}{/center}",
      tags: true,
    });

    // Template list
    const list = blessed.list({
      parent: this.content,
      top: 3,
      left: 2,
      width: "100%-4",
      height: "100%-6",
      keys: true,
      vi: true,
      mouse: true,
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      border: { 
        type: "line",
        fg: "#bb9af7",
      } as any,
      scrollbar: {
        ch: "█",
        style: {
          bg: "#bb9af7",
        },
      },
      style: {
        bg: "#24283b",
        fg: "#c0caf5",
        selected: {
          bg: "#bb9af7",
          fg: "#1a1b26",
          bold: true,
        },
        border: { 
          fg: "#bb9af7",
        },
      },
    });

    const items: string[] = [];

    try {
      const index = new SqliteIndex(this.config.indexPath);
      const result = index.listTemplates({ limit: 100 });

      if (result.items.length === 0) {
        items.push("{center}{yellow-fg}╔════════════════════════════════╗{/yellow-fg}{/center}");
        items.push("{center}{yellow-fg}║  No templates found in index  ║{/yellow-fg}{/center}");
        items.push("{center}{yellow-fg}╚════════════════════════════════╝{/yellow-fg}{/center}");
        items.push("");
        items.push("{center}Press {bold}[R]{/bold} to sync and update index{/center}");
      } else {
        for (const template of result.items) {
          items.push(`┌${"─".repeat(70)}┐`);
          items.push(
            `│ {bold}{magenta-fg}📄 ${template.id}{/magenta-fg}{/bold} {gray-fg}(${template.repo_id}){/gray-fg}`
          );
          items.push(`├${"─".repeat(70)}┤`);
          items.push(`│ {bold}${template.name}{/bold}`);
          if (template.description) {
            items.push(`│ {gray-fg}${template.description}{/gray-fg}`);
          }
          if (template.categories.length > 0) {
            items.push(
              `│ 🏷️  {green-fg}${template.categories.join(", ")}{/green-fg}`
            );
          }
          if (template.tags.length > 0) {
            items.push(`│ 🔖 ${template.tags.join(", ")}`);
          }
          items.push(`└${"─".repeat(70)}┘`);
          items.push("");
        }
      }
    } catch (err) {
      items.push("{center}{red-fg}╔═══════════════════════════════════════╗{/red-fg}{/center}");
      items.push(`{center}{red-fg}║  Error loading templates: ${String(err).substring(0, 20)}  ║{/red-fg}{/center}`);
      items.push("{center}{red-fg}╚═══════════════════════════════════════╝{/red-fg}{/center}");
      items.push("");
      items.push("{center}Press {bold}[R]{/bold} to sync and rebuild index{/center}");
    }

    list.setItems(items);

    // Actions help
    const help = blessed.box({
      parent: this.content,
      bottom: 0,
      left: 2,
      width: "100%-4",
      height: 3,
      content:
        "{center}{bold}[N]{/bold}ew  {bold}[F]{/bold}etch  {bold}[E]{/bold}dit  {bold}[V]{/bold}alidate  {bold}[ESC]{/bold}Home{/center}",
      tags: true,
      style: {
        bg: "#414868",
        fg: "#c0caf5",
      },
    });

    list.focus();
  }

  private renderInjectScreen(): void {
    if (!this.content) return;

    this.content.children = [];

    const injectBox = blessed.box({
      parent: this.content,
      top: 1,
      left: 2,
      width: "100%-4",
      height: "100%-2",
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
    });

    const sections: string[] = [];

    sections.push("{center}{bold}{green-fg}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{/green-fg}{/bold}{/center}");
    sections.push("{center}{bold}{green-fg}MCP Server Injection{/green-fg}{/bold}{/center}");
    sections.push("{center}{bold}{green-fg}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━{/green-fg}{/bold}{/center}\n");

    sections.push("{center}Configure BTW MCP server in your coding tools{/center}\n");

    sections.push("╔════════════════════════════════════════════════════════════════╗");
    sections.push("║                    {bold}{cyan-fg}Available Targets{/cyan-fg}{/bold}                         ║");
    sections.push("╠════════════════════════════════════════════════════════════════╣");
    sections.push("║                                                                ║");
    sections.push("║  {bold}[C]{/bold} {bold}Codex{/bold} - Configure BTW for Codex                          ║");
    sections.push("║     Press C to start interactive injection                    ║");
    sections.push("║                                                                ║");
    sections.push("║  {bold}[L]{/bold} {bold}Claude{/bold} - Configure BTW for Claude Desktop                  ║");
    sections.push("║     Press L to start interactive injection                    ║");
    sections.push("║                                                                ║");
    sections.push("╚════════════════════════════════════════════════════════════════╝\n");

    sections.push("╔════════════════════════════════════════════════════════════════╗");
    sections.push("║                  {bold}{yellow-fg}What Injection Does{/yellow-fg}{/bold}                       ║");
    sections.push("╠════════════════════════════════════════════════════════════════╣");
    sections.push("║  Detects your tool's configuration file                     ║");
    sections.push("║  Shows you a preview of changes                             ║");
    sections.push("║  Creates a backup before modification                       ║");
    sections.push("║  Adds BTW MCP server entry to config                        ║");
    sections.push("║  Provides revert instructions                               ║");
    sections.push("╚════════════════════════════════════════════════════════════════╝\n");

    sections.push("{center}{bold}{green-fg}Interactive Preview Available in TUI!{/green-fg}{/bold}{/center}");
    sections.push("{center}You'll see exactly what will be changed before confirming{/center}");

    injectBox.setContent(sections.join("\n"));

    // Key bindings for injection
    injectBox.key(["c"], async () => {
      await this.injectInteractive("codex");
    });

    injectBox.key(["l"], async () => {
      await this.injectInteractive("claude");
    });

    injectBox.focus();
  }

  private renderLogsScreen(): void {
    if (!this.content) return;

    this.content.children = [];

    // Title
    const title = blessed.box({
      parent: this.content,
      top: 0,
      left: 2,
      width: "100%-4",
      height: 3,
      content: "{center}{bold}{blue-fg}Activity Logs{/blue-fg}{/bold}{/center}",
      tags: true,
    });

    // Log list
    const logBox = blessed.log({
      parent: this.content,
      top: 3,
      left: 2,
      width: "100%-4",
      height: "100%-4",
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      vi: true,
      mouse: true,
      border: { 
        type: "line",
        fg: "#7dcfff",
      } as any,
      scrollbar: {
        ch: "█",
        style: {
          bg: "#7dcfff",
        },
      },
      style: {
        fg: "#c0caf5",
        bg: "#24283b",
        border: { 
          fg: "#7dcfff",
        },
      },
    });

    if (this.state.logs.length === 0) {
      logBox.log("{center}{yellow-fg}No activity logged yet{/yellow-fg}{/center}");
      logBox.log("{center}Actions will appear here in real-time{/center}");
    } else {
      for (const log of this.state.logs) {
        logBox.log(log);
      }
    }

    logBox.focus();
  }

  private async injectInteractive(target: "codex" | "claude"): Promise<void> {
    this.state.statusMessage = `Detecting ${target} config...`;
    this.updateHeader();
    this.screen.render();

    // Detect config path
    const home = process.env.HOME || process.env.USERPROFILE || "";
    const defaultPaths =
      target === "codex"
        ? [
            path.join(home, ".codex", "config.json"),
            path.join(home, ".config", "codex", "config.json"),
          ]
        : [
            path.join(home, ".config", "claude", "config.json"),
            path.join(home, "Library", "Application Support", "Claude", "config.json"),
          ];

    let configPath: string | null = null;
    for (const p of defaultPaths) {
      try {
        await fs.access(p);
        configPath = p;
        break;
      } catch {
        // Try next path
      }
    }

    if (!configPath) {
      this.showErrorDialog(
        `${target.charAt(0).toUpperCase() + target.slice(1)} config not found`,
        `Could not find ${target} configuration file in standard locations:\n${defaultPaths.join("\n")}`
      );
      this.state.statusMessage = "Ready";
      this.updateHeader();
      return;
    }

    // Read existing config
    let config: Record<string, unknown> = {};
    try {
      const content = await fs.readFile(configPath, "utf-8");
      config = JSON.parse(content);
    } catch (err) {
      this.showErrorDialog(
        "Failed to read config",
        `Error reading ${configPath}:\n${String(err)}`
      );
      this.state.statusMessage = "Ready";
      this.updateHeader();
      return;
    }

    // Prepare BTW MCP server config
    const mcpServers = (config.mcpServers as Record<string, unknown>) || {};

    // Check if already configured
    if (mcpServers.btw) {
      this.showInfoDialog(
        "Already Configured",
        `BTW MCP server is already configured in ${target}!\n\nConfig file: ${configPath}`
      );
      this.state.statusMessage = "Ready";
      this.updateHeader();
      return;
    }

    const btwConfig = {
      command: "node",
      args: [path.join(this.config.reposRoot, "..", "dist", "index.js")],
      env: {},
    };

    // Show preview and confirm
    const confirmed = await this.showInjectPreview(target, configPath, btwConfig);

    if (!confirmed) {
      this.addLog(`Injection cancelled by user`);
      this.state.statusMessage = "Ready";
      this.updateHeader();
      return;
    }

    // Backup original config
    this.state.statusMessage = "Creating backup...";
    this.updateHeader();
    this.screen.render();

    const backupPath = `${configPath}.backup.${Date.now()}`;
    try {
      await fs.copyFile(configPath, backupPath);
      this.addLog(`Created backup: ${backupPath}`);
    } catch (err) {
      this.showErrorDialog("Backup failed", `Could not create backup:\n${String(err)}`);
      this.state.statusMessage = "Ready";
      this.updateHeader();
      return;
    }

    // Apply changes
    this.state.statusMessage = "Applying changes...";
    this.updateHeader();
    this.screen.render();

    try {
      mcpServers.btw = btwConfig;
      config.mcpServers = mcpServers;
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      this.addLog(`Configured BTW MCP server in ${target}`);
      this.addLog(`  Config: ${configPath}`);
      this.addLog(`  Backup: ${backupPath}`);

      this.showSuccessDialog(
        "Injection Successful!",
        `BTW MCP server has been configured for ${target}.\n\n` +
          `Config: ${configPath}\n` +
          `Backup: ${backupPath}\n\n` +
          `To revert:\ncp ${backupPath} ${configPath}`
      );
    } catch (err) {
      this.showErrorDialog(
        "Injection failed",
        `Failed to write config:\n${String(err)}\n\nYour backup is safe at:\n${backupPath}`
      );
    }

    this.state.statusMessage = "Ready";
    this.updateHeader();
  }

  private async showInjectPreview(
    target: string,
    configPath: string,
    btwConfig: Record<string, unknown>
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const overlay = blessed.box({
        parent: this.screen,
        top: "center",
        left: "center",
        width: "80%",
        height: "80%",
        border: { 
          type: "line",
          fg: "#7aa2f7",
        } as any,
        style: {
          bg: "#1a1b26",
          fg: "#c0caf5",
          border: { 
            fg: "#7aa2f7",
          },
        },
        shadow: true,
      });

      const title = blessed.box({
        parent: overlay,
        top: 0,
        left: 1,
        width: "100%-2",
        height: 1,
        content: `{center}{bold}{green-fg}Injection Preview - ${target.toUpperCase()}{/green-fg}{/bold}{/center}`,
        tags: true,
      });

      const preview = blessed.box({
        parent: overlay,
        top: 2,
        left: 1,
        width: "100%-2",
        height: "100%-7",
        content: "",
        tags: true,
        scrollable: true,
        alwaysScroll: true,
        keys: true,
        vi: true,
        mouse: true,
        scrollbar: {
          ch: "█",
          style: {
            bg: "#7aa2f7",
          },
        },
      });

      const previewText: string[] = [];
      previewText.push("{bold}{yellow-fg}Configuration File:{/yellow-fg}{/bold}");
      previewText.push(`  ${configPath}\n`);
      previewText.push("{bold}{yellow-fg}Changes to be made:{/yellow-fg}{/bold}");
      previewText.push("{green-fg}+ Adding BTW MCP Server configuration:{/green-fg}\n");
      previewText.push("{cyan-fg}" + JSON.stringify({ mcpServers: { btw: btwConfig } }, null, 2) + "{/cyan-fg}\n");
      previewText.push("{bold}{yellow-fg}Actions:{/yellow-fg}{/bold}");
      previewText.push("  1. Backup current config");
      previewText.push("  2. Add BTW MCP server entry");
      previewText.push("  3. Save updated config\n");
      previewText.push("{bold}Do you want to proceed?{/bold}");

      preview.setContent(previewText.join("\n"));

      const confirmBtn = blessed.button({
        parent: overlay,
        bottom: 2,
        left: "center",
        shrink: true,
        width: 20,
        height: 3,
        content: "Confirm",
        align: "center",
        valign: "middle",
        mouse: true,
        keys: true,
        style: {
          bg: "#9ece6a",
          fg: "#1a1b26",
          bold: true,
          focus: {
            bg: "#73daca",
            bold: true,
          },
        },
        border: {
          type: "line",
        },
      });

      const cancelBtn = blessed.button({
        parent: overlay,
        bottom: 2,
        right: "25%",
        shrink: true,
        width: 20,
        height: 3,
        content: "Cancel",
        align: "center",
        valign: "middle",
        mouse: true,
        keys: true,
        style: {
          bg: "#f7768e",
          fg: "#1a1b26",
          bold: true,
          focus: {
            bg: "#ff9e64",
            bold: true,
          },
        },
        border: {
          type: "line",
        },
      });

      overlay.key(["escape"], () => {
        overlay.destroy();
        this.screen.render();
        resolve(false);
      });

      confirmBtn.on("press", () => {
        overlay.destroy();
        this.screen.render();
        resolve(true);
      });

      cancelBtn.on("press", () => {
        overlay.destroy();
        this.screen.render();
        resolve(false);
      });

      confirmBtn.focus();
      this.screen.render();
    });
  }

  private showSuccessDialog(title: string, message: string): void {
    const dialog = blessed.box({
      parent: this.screen,
      top: "center",
      left: "center",
      width: "60%",
      height: "50%",
      border: { 
        type: "line",
        fg: "#9ece6a",
      } as any,
      style: {
        bg: "#1a1b26",
        fg: "#c0caf5",
        border: { 
          fg: "#9ece6a",
        },
      },
      shadow: true,
    });

    const titleBox = blessed.box({
      parent: dialog,
      top: 0,
      left: 1,
      width: "100%-2",
      height: 3,
      content: `{center}{bold}{green-fg}${title}{/green-fg}{/bold}{/center}`,
      tags: true,
    });

    const messageBox = blessed.box({
      parent: dialog,
      top: 3,
      left: 2,
      width: "100%-4",
      height: "100%-8",
      content: message,
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
    });

    const okBtn = blessed.button({
      parent: dialog,
      bottom: 1,
      left: "center",
      shrink: true,
      width: 15,
      height: 3,
      content: "OK",
      align: "center",
      valign: "middle",
      
      mouse: true,
      keys: true,
      style: {
        bg: "#9ece6a",
        fg: "#1a1b26",
        focus: {
          bg: "#73daca",
          bold: true,
        },
      },
    });

    dialog.key(["escape", "enter"], () => {
      dialog.destroy();
      this.screen.render();
    });

    okBtn.on("press", () => {
      dialog.destroy();
      this.screen.render();
    });

    okBtn.focus();
    this.screen.render();
  }

  private showErrorDialog(title: string, message: string): void {
    const dialog = blessed.box({
      parent: this.screen,
      top: "center",
      left: "center",
      width: "60%",
      height: "50%",
      border: { 
        type: "line",
        fg: "#f7768e",
      } as any,
      style: {
        bg: "#1a1b26",
        fg: "#c0caf5",
        border: { 
          fg: "#f7768e",
        },
      },
      shadow: true,
    });

    const titleBox = blessed.box({
      parent: dialog,
      top: 0,
      left: 1,
      width: "100%-2",
      height: 3,
      content: `{center}{bold}{red-fg}${title}{/red-fg}{/bold}{/center}`,
      tags: true,
    });

    const messageBox = blessed.box({
      parent: dialog,
      top: 3,
      left: 2,
      width: "100%-4",
      height: "100%-8",
      content: message,
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
    });

    const okBtn = blessed.button({
      parent: dialog,
      bottom: 1,
      left: "center",
      shrink: true,
      width: 15,
      height: 3,
      content: "OK",
      align: "center",
      valign: "middle",
      
      mouse: true,
      keys: true,
      style: {
        bg: "#f7768e",
        fg: "#1a1b26",
        focus: {
          bg: "#ff9e64",
          bold: true,
        },
      },
    });

    dialog.key(["escape", "enter"], () => {
      dialog.destroy();
      this.screen.render();
    });

    okBtn.on("press", () => {
      dialog.destroy();
      this.screen.render();
    });

    okBtn.focus();
    this.screen.render();
  }

  private showInfoDialog(title: string, message: string): void {
    const dialog = blessed.box({
      parent: this.screen,
      top: "center",
      left: "center",
      width: "60%",
      height: "50%",
      border: { 
        type: "line",
        fg: "#7aa2f7",
      } as any,
      style: {
        bg: "#1a1b26",
        fg: "#c0caf5",
        border: { 
          fg: "#7aa2f7",
        },
      },
      shadow: true,
    });

    const titleBox = blessed.box({
      parent: dialog,
      top: 0,
      left: 1,
      width: "100%-2",
      height: 3,
      content: `{center}{bold}{blue-fg}${title}{/blue-fg}{/bold}{/center}`,
      tags: true,
    });

    const messageBox = blessed.box({
      parent: dialog,
      top: 3,
      left: 2,
      width: "100%-4",
      height: "100%-8",
      content: message,
      tags: true,
      scrollable: true,
      mouse: true,
      keys: true,
      vi: true,
    });

    const okBtn = blessed.button({
      parent: dialog,
      bottom: 1,
      left: "center",
      shrink: true,
      width: 15,
      height: 3,
      content: "OK",
      align: "center",
      valign: "middle",
      
      mouse: true,
      keys: true,
      style: {
        bg: "#7aa2f7",
        fg: "#1a1b26",
        focus: {
          bg: "#7dcfff",
          bold: true,
        },
      },
    });

    dialog.key(["escape", "enter"], () => {
      dialog.destroy();
      this.screen.render();
    });

    okBtn.on("press", () => {
      dialog.destroy();
      this.screen.render();
    });

    okBtn.focus();
    this.screen.render();
  }

  private async promptAddRepo(): Promise<void> {
    // Create a form for adding repo
    const form = blessed.form({
      parent: this.screen,
      keys: true,
      left: "center",
      top: "center",
      width: 70,
      height: 16,
      border: { 
        type: "line",
        fg: "#7aa2f7",
      } as any,
      style: {
        bg: "#1a1b26",
        fg: "#c0caf5",
        border: { 
          fg: "#7aa2f7",
        },
      },
      label: " {bold}{cyan-fg}Add Repository{/cyan-fg}{/bold} ",
      tags: true,
      shadow: true,
    });

    blessed.text({
      parent: form,
      top: 1,
      left: 2,
      content: "{bold}Repository URL:{/bold}",
      tags: true,
    });

    const urlInput = blessed.textbox({
      parent: form,
      name: "url",
      top: 2,
      left: 2,
      width: "100%-4",
      height: 3,
      inputOnFocus: true,
      border: { 
        type: "line",
      },
      style: {
        bg: "#24283b",
        fg: "#c0caf5",
        focus: {
          bg: "#24283b",
          border: { 
            fg: "#7aa2f7",
          },
        },
      },
    });

    blessed.text({
      parent: form,
      top: 6,
      left: 2,
      content: "{bold}Branch{/bold} {gray-fg}(default: main){/gray-fg}:",
      tags: true,
    });

    const branchInput = blessed.textbox({
      parent: form,
      name: "branch",
      top: 7,
      left: 2,
      width: "100%-4",
      height: 3,
      inputOnFocus: true,
      border: { 
        type: "line",
      },
      style: {
        bg: "#24283b",
        fg: "#c0caf5",
        focus: {
          bg: "#24283b",
          border: { 
            fg: "#7aa2f7",
          },
        },
      },
    });

    const submitBtn = blessed.button({
      parent: form,
      mouse: true,
      keys: true,
      shrink: true,
      bottom: 1,
      left: 3,
      width: 18,
      height: 3,
      content: "Add Repo",
      align: "center",
      valign: "middle",
      style: {
        bg: "#9ece6a",
        fg: "#1a1b26",
        bold: true,
        focus: {
          bg: "#73daca",
          bold: true,
        },
      },
    });

    const cancelBtn = blessed.button({
      parent: form,
      mouse: true,
      keys: true,
      shrink: true,
      bottom: 1,
      right: 3,
      width: 18,
      height: 3,
      content: "Cancel",
      align: "center",
      valign: "middle",
      style: {
        bg: "#f7768e",
        fg: "#1a1b26",
        bold: true,
        focus: {
          bg: "#ff9e64",
          bold: true,
        },
      },
    });

    form.key(["escape"], () => {
      form.destroy();
      this.screen.render();
    });

    submitBtn.on("press", async () => {
      const url = urlInput.value || "";
      const branch = branchInput.value || "main";

      if (!url) {
        this.addLog("Error: URL is required");
        form.destroy();
        this.screen.render();
        return;
      }

      form.destroy();
      this.state.statusMessage = "Adding repo...";
      this.updateHeader();
      this.screen.render();

      this.addLog(`Adding repo: ${url} (branch: ${branch})`);

      // TODO: Implement actual repo add logic
      // For now, just log it
      this.state.statusMessage = "Repo added (implementation pending)";
      this.updateHeader();

      await this.refresh();
    });

    cancelBtn.on("press", () => {
      form.destroy();
      this.screen.render();
    });

    urlInput.focus();
    this.screen.render();
  }

  private async syncRepos(): Promise<void> {
    this.state.statusMessage = "Syncing repos...";
    this.updateHeader();
    this.screen.render();

    try {
      const syncResult = await syncRepos(this.config, this.state.registry);
      const index = new SqliteIndex(this.config.indexPath);
      await buildIndex(this.config, this.state.registry, index);

      this.addLog(`Synced ${syncResult.updatedRepos.length} repos`);
      this.state.statusMessage = "Sync complete";
    } catch (err) {
      this.addLog(`Sync error: ${String(err)}`);
      this.state.statusMessage = "Sync failed";
    }

    this.updateHeader();
    this.renderCurrentScreen();
  }

  private async validateCurrentRepo(): Promise<void> {
    if (!this.state.registry.active_repo_id) {
      this.addLog("⚠ No active repo to validate");
      return;
    }

    const repo = this.state.registry.repos.find(
      (r) => r.id === this.state.registry.active_repo_id
    );

    if (!repo) {
      this.addLog("Active repo not found in registry");
      return;
    }

    this.state.statusMessage = "Validating...";
    this.updateHeader();
    this.screen.render();

    try {
      const result = await scanRepo(repo.id, repo.localPath, false);

      if (result.errors.length === 0) {
        this.addLog(`Repo ${repo.id} is valid`);
      } else {
        this.addLog(`Repo ${repo.id} has ${result.errors.length} errors`);
        for (const error of result.errors) {
          this.addLog(`  - ${error}`);
        }
      }

      this.state.statusMessage = "Validation complete";
    } catch (err) {
      this.addLog(`Validation error: ${String(err)}`);
      this.state.statusMessage = "Validation failed";
    }

    this.updateHeader();
    this.renderCurrentScreen();
  }

  async run(): Promise<void> {
    // Load initial data
    try {
      this.state.registry = await loadRegistry(this.config);
      this.addLog("Loaded registry");
    } catch (err) {
      this.addLog(`Error loading registry: ${String(err)}`);
    }

    // Render initial screen
    this.renderCurrentScreen();
    this.screen.render();

    // Keep process running
    await new Promise(() => {
      // Event loop keeps running
    });
  }
}
