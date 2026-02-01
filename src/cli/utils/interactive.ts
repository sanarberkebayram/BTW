/**
 * BTW - Interactive CLI Utilities
 * Terminal UI components for interactive workflow selection
 */

import chalk from 'chalk';
import * as readline from 'readline';

/**
 * Item in the interactive list
 */
export interface ListItem {
  /** Unique identifier */
  id: string;
  /** Display label */
  label: string;
  /** Description (shown on right) */
  description?: string;
  /** Whether this item is currently active/injected */
  isActive: boolean;
  /** Additional metadata */
  meta?: Record<string, unknown>;
}

/**
 * Result of interactive selection
 */
export interface SelectionResult {
  /** Selected item ID (null if cancelled) */
  id: string | null;
  /** Action to perform */
  action: 'toggle' | 'cancel';
}

/**
 * Options for the interactive list
 */
export interface InteractiveListOptions {
  /** Title shown above the list */
  title?: string;
  /** Help text shown below the list */
  helpText?: string;
  /** Empty state message */
  emptyMessage?: string;
  /** Label for active state */
  activeLabel?: string;
  /** Label for inactive state */
  inactiveLabel?: string;
}

/**
 * Interactive list selector for terminal
 */
export class InteractiveList {
  private items: ListItem[];
  private selectedIndex: number = 0;
  private options: InteractiveListOptions;
  private rl: readline.Interface | null = null;
  private resolve: ((result: SelectionResult) => void) | null = null;

  constructor(items: ListItem[], options: InteractiveListOptions = {}) {
    this.items = items;
    this.options = {
      title: options.title || 'Select an item',
      helpText: options.helpText || '[↑/↓] Navigate  [Enter] Toggle  [Esc/q] Quit',
      emptyMessage: options.emptyMessage || 'No items available',
      activeLabel: options.activeLabel || 'injected',
      inactiveLabel: options.inactiveLabel || 'not injected',
    };
  }

  /**
   * Render the current state of the list
   */
  private render(): void {
    // Clear screen and move cursor to top
    console.clear();

    // Print title
    console.log(chalk.bold.cyan(`\n  ${this.options.title}\n`));

    // Handle empty state
    if (this.items.length === 0) {
      console.log(chalk.gray(`  ${this.options.emptyMessage}`));
      console.log();
      console.log(chalk.gray(`  ${this.options.helpText}`));
      return;
    }

    // Print items
    this.items.forEach((item, index) => {
      const isSelected = index === this.selectedIndex;
      const cursor = isSelected ? chalk.cyan('❯') : ' ';
      const status = item.isActive
        ? chalk.green(`[${this.options.activeLabel}]`)
        : chalk.gray(`[${this.options.inactiveLabel}]`);

      const label = isSelected ? chalk.bold(item.label) : item.label;
      const description = item.description ? chalk.gray(` - ${item.description}`) : '';

      console.log(`  ${cursor} ${status} ${label}${description}`);
    });

    // Print help text
    console.log();
    console.log(chalk.gray(`  ${this.options.helpText}`));
  }

  /**
   * Handle keypress events
   */
  private handleKeypress(key: Buffer): void {
    const keyStr = key.toString();

    // Handle special keys
    if (key[0] === 27) {
      // Escape sequence
      if (key[1] === 91) {
        // Arrow keys
        if (key[2] === 65) {
          // Up arrow
          this.moveUp();
          return;
        } else if (key[2] === 66) {
          // Down arrow
          this.moveDown();
          return;
        }
        // Unknown escape sequence, ignore
        return;
      }
      // Plain Escape (not followed by '[' which is 91)
      this.cancel();
      return;
    }

    // Handle regular keys
    switch (keyStr) {
      case '\r': // Enter
      case '\n':
        this.select();
        break;
      case 'q':
      case 'Q':
        this.cancel();
        break;
      case 'j':
        this.moveDown();
        break;
      case 'k':
        this.moveUp();
        break;
    }
  }

  /**
   * Move selection up
   */
  private moveUp(): void {
    if (this.items.length === 0) return;
    this.selectedIndex = (this.selectedIndex - 1 + this.items.length) % this.items.length;
    this.render();
  }

  /**
   * Move selection down
   */
  private moveDown(): void {
    if (this.items.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % this.items.length;
    this.render();
  }

  /**
   * Select current item
   */
  private select(): void {
    if (this.items.length === 0) {
      this.cancel();
      return;
    }

    const selectedItem = this.items[this.selectedIndex];
    this.cleanup();

    if (this.resolve) {
      this.resolve({
        id: selectedItem.id,
        action: 'toggle',
      });
    }
  }

  /**
   * Cancel selection
   */
  private cancel(): void {
    this.cleanup();

    if (this.resolve) {
      this.resolve({
        id: null,
        action: 'cancel',
      });
    }
  }

  /**
   * Cleanup terminal state
   */
  private cleanup(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.removeAllListeners('data');
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  /**
   * Update items and re-render
   */
  updateItems(items: ListItem[]): void {
    this.items = items;
    // Keep selected index in bounds
    if (this.selectedIndex >= items.length) {
      this.selectedIndex = Math.max(0, items.length - 1);
    }
    this.render();
  }

  /**
   * Run the interactive list and wait for selection
   */
  async run(): Promise<SelectionResult> {
    return new Promise((resolve) => {
      this.resolve = resolve;

      // Check if we have a TTY
      if (!process.stdin.isTTY) {
        console.error(chalk.red('Error: Interactive mode requires a TTY'));
        resolve({ id: null, action: 'cancel' });
        return;
      }

      // Set up raw mode to capture keypresses
      process.stdin.setRawMode(true);
      process.stdin.resume();

      // Handle Ctrl+C
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      this.rl.on('SIGINT', () => {
        this.cancel();
      });

      // Listen for keypresses
      process.stdin.on('data', (key: Buffer) => {
        // Handle Ctrl+C
        if (key[0] === 3) {
          this.cancel();
          return;
        }
        this.handleKeypress(key);
      });

      // Initial render
      this.render();
    });
  }
}

/**
 * Show an interactive workflow selector
 * Runs in a loop until user presses Escape
 */
export async function runInteractiveSelector(
  getItems: () => Promise<ListItem[]>,
  onToggle: (id: string, currentlyActive: boolean) => Promise<void>,
  options: InteractiveListOptions = {}
): Promise<void> {
  // Initial load
  let items = await getItems();

  const list = new InteractiveList(items, options);

  // Run selection loop
  while (true) {
    const result = await list.run();

    if (result.action === 'cancel' || result.id === null) {
      // Clear and exit
      console.clear();
      console.log(chalk.gray('Exited interactive mode.\n'));
      break;
    }

    // Find the item and toggle it
    const item = items.find((i) => i.id === result.id);
    if (item) {
      try {
        await onToggle(result.id, item.isActive);
      } catch (error) {
        // Show error briefly
        console.clear();
        console.log(chalk.red(`\nError: ${error instanceof Error ? error.message : error}\n`));
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Refresh items
    items = await getItems();
    list.updateItems(items);
  }
}
