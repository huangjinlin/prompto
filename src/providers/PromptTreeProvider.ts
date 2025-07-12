import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export class PromptTreeProvider
  implements vscode.TreeDataProvider<PromptTreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    PromptTreeItem | undefined | null | void
  > = new vscode.EventEmitter<PromptTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    PromptTreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  constructor() {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PromptTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: PromptTreeItem): Promise<PromptTreeItem[]> {
    if (!element) {
      return this.getRootItems();
    }

    return this.getDirectoryChildren(element);
  }

  private async getRootItems(): Promise<PromptTreeItem[]> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return [];
    }

    const promptoDir = path.join(workspaceFolder.uri.fsPath, ".prompto");
    if (!fs.existsSync(promptoDir)) {
      return [];
    }

    return this.getDirectoryItems(promptoDir);
  }

  private async getDirectoryChildren(
    element: PromptTreeItem
  ): Promise<PromptTreeItem[]> {
    if (element.itemType === "directory") {
      return this.getDirectoryItems(element.fullPath);
    }

    return [];
  }

  private getDirectoryItems(directoryPath: string): PromptTreeItem[] {
    const items: PromptTreeItem[] = [];

    try {
      const dirItems = fs.readdirSync(directoryPath);

      // Sort items: directories first, then files
      const directories = dirItems
        .filter((item) => {
          const itemPath = path.join(directoryPath, item);
          return fs.statSync(itemPath).isDirectory();
        })
        .sort();

      const files = dirItems
        .filter((item) => {
          const itemPath = path.join(directoryPath, item);
          return fs.statSync(itemPath).isFile() && item.endsWith(".md");
        })
        .sort();

      // Add directories
      for (const dir of directories) {
        const dirPath = path.join(directoryPath, dir);
        items.push(
          new PromptTreeItem(
            dir,
            dir,
            `Category: ${dir}`,
            "folder",
            vscode.TreeItemCollapsibleState.Collapsed,
            "directory",
            dirPath
          )
        );
      }

      // Add markdown files
      for (const file of files) {
        const filePath = path.join(directoryPath, file);
        const promptName = path.basename(file, ".md");
        items.push(
          new PromptTreeItem(
            promptName,
            promptName,
            `Prompt: ${promptName}`,
            "file-text",
            vscode.TreeItemCollapsibleState.None,
            "prompt",
            filePath
          )
        );
      }
    } catch (error) {
      console.error("Error reading directory:", error);
    }

    return items;
  }
}

export class PromptTreeItem extends vscode.TreeItem {
  public readonly itemId: string;
  public readonly fullPath: string;
  public readonly itemType: string;

  constructor(
    public readonly label: string,
    itemId: string,
    description: string | undefined,
    icon: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    itemType: string,
    fullPath: string
  ) {
    super(label, collapsibleState);

    this.itemId = itemId;
    this.fullPath = fullPath;
    this.itemType = itemType;
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = itemType;

    // Set command for prompt files
    if (itemType === "prompt") {
      this.command = {
        command: "prompto.usePrompt",
        title: "Use Prompt",
        arguments: [fullPath],
      };
    }

    this.tooltip = this.createTooltip();
  }

  private createTooltip(): string {
    if (this.itemType === "prompt") {
      return `Prompt: ${this.label}\nPath: ${this.fullPath}\nClick to use this prompt`;
    } else if (this.itemType === "directory") {
      return `Category: ${this.label}\nPath: ${this.fullPath}`;
    }
    return this.label;
  }
}
