import * as vscode from "vscode";
import { StorageService } from "./StorageService";
import { Prompt, Category } from "../models/Prompt";
import { deliverPromptContent } from "./PromptDeliveryService";
import { getSelectedTextVariableContext } from "./SelectedTextVariableService";

export class QuickPickerService {
  constructor(private storageService: StorageService) {}

  async showQuickPicker(): Promise<void> {
    const items = await this.createQuickPickItems();

    if (items.length === 0) {
      vscode.window.showInformationMessage(
        "No prompts available. Add some prompts first!"
      );
      return;
    }

    const quickPick = vscode.window.createQuickPick();
    quickPick.items = items;
    quickPick.placeholder = "Search and select a prompt to use...";
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.canSelectMany = false;

    quickPick.onDidChangeSelection(
      async (selection: readonly vscode.QuickPickItem[]) => {
        if (selection.length > 0) {
          const selected = selection[0] as PromptQuickPickItem;
          await this.handlePromptSelection(selected);
          quickPick.hide();
        }
      }
    );

    quickPick.onDidHide(() => {
      quickPick.dispose();
    });

    quickPick.show();
  }

  async showCategoryPicker(): Promise<string | undefined> {
    const categories = await this.storageService.getCategories();

    if (categories.length === 0) {
      vscode.window.showInformationMessage("No categories available.");
      return undefined;
    }

    const items: vscode.QuickPickItem[] = [
      {
        label: "$(folder) All Categories",
        description: "Show all prompts",
        detail: "No category filter",
      },
      ...categories.map((category) => ({
        label: `$(${category.icon || "folder"}) ${category.name}`,
        description: category.description || "",
        detail: `${category.parentId ? "Sub-category" : "Root category"}`,
        id: category.id,
      })),
    ];

    const selected = await vscode.window.showQuickPick(items, {
      title: "Select Category",
      placeHolder: "Choose a category to filter prompts...",
    });

    return selected ? (selected as any).id : undefined;
  }

  async showPromptsByCategory(categoryId?: string): Promise<void> {
    let prompts: Prompt[];

    if (categoryId) {
      prompts = await this.storageService.getPromptsByCategory(categoryId);
    } else {
      prompts = await this.storageService.getPrompts();
    }

    if (prompts.length === 0) {
      vscode.window.showInformationMessage(
        "No prompts found in this category."
      );
      return;
    }

    const items = prompts.map((prompt) =>
      this.createPromptQuickPickItem(prompt)
    );

    const selected = await vscode.window.showQuickPick(items, {
      title: "Select Prompt",
      placeHolder: "Choose a prompt to use...",
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selected) {
      await this.handlePromptSelection(selected);
    }
  }

  async showFavoritePrompts(): Promise<void> {
    const prompts = await this.storageService.getFavoritePrompts();

    if (prompts.length === 0) {
      vscode.window.showInformationMessage("No favorite prompts found.");
      return;
    }

    const items = prompts.map((prompt) =>
      this.createPromptQuickPickItem(prompt)
    );

    const selected = await vscode.window.showQuickPick(items, {
      title: "Favorite Prompts",
      placeHolder: "Choose a favorite prompt...",
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selected) {
      await this.handlePromptSelection(selected);
    }
  }

  async showRecentPrompts(): Promise<void> {
    const prompts = await this.storageService.getRecentPrompts(20);

    if (prompts.length === 0) {
      vscode.window.showInformationMessage("No recent prompts found.");
      return;
    }

    const items = prompts.map((prompt) =>
      this.createPromptQuickPickItem(prompt)
    );

    const selected = await vscode.window.showQuickPick(items, {
      title: "Recent Prompts",
      placeHolder: "Choose a recent prompt...",
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selected) {
      await this.handlePromptSelection(selected);
    }
  }

  async showMostUsedPrompts(): Promise<void> {
    const prompts = await this.storageService.getMostUsedPrompts(20);

    if (prompts.length === 0) {
      vscode.window.showInformationMessage("No frequently used prompts found.");
      return;
    }

    const items = prompts.map((prompt) =>
      this.createPromptQuickPickItem(prompt)
    );

    const selected = await vscode.window.showQuickPick(items, {
      title: "Most Used Prompts",
      placeHolder: "Choose a frequently used prompt...",
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selected) {
      await this.handlePromptSelection(selected);
    }
  }

  async searchPrompts(query?: string): Promise<void> {
    let searchQuery = query;

    if (!searchQuery) {
      searchQuery = await vscode.window.showInputBox({
        title: "Search Prompts",
        placeHolder: "Enter search terms...",
        prompt: "Search in titles, descriptions, content, and tags",
      });
    }

    if (!searchQuery) {
      return;
    }

    const prompts = await this.storageService.searchPrompts(searchQuery);

    if (prompts.length === 0) {
      vscode.window.showInformationMessage(
        `No prompts found matching "${searchQuery}"`
      );
      return;
    }

    const items = prompts.map((prompt) =>
      this.createPromptQuickPickItem(prompt, true)
    );

    const selected = await vscode.window.showQuickPick(items, {
      title: `Search Results for "${searchQuery}"`,
      placeHolder: "Choose a prompt...",
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selected) {
      await this.handlePromptSelection(selected);
    }
  }

  private async createQuickPickItems(): Promise<PromptQuickPickItem[]> {
    const [prompts, categories] = await Promise.all([
      this.storageService.getPrompts(),
      this.storageService.getCategories(),
    ]);

    const categoryMap = new Map<string, Category>();
    categories.forEach((cat) => categoryMap.set(cat.id, cat));

    return prompts.map((prompt) =>
      this.createPromptQuickPickItem(prompt, false, categoryMap)
    );
  }

  private createPromptQuickPickItem(
    prompt: Prompt,
    showScore: boolean = false,
    categoryMap?: Map<string, Category>
  ): PromptQuickPickItem {
    const category =
      categoryMap?.get(prompt.categoryId || "") ||
      (prompt.categoryId ? { name: "Unknown Category" } : null);

    let label = `$(${prompt.isFavorite ? "star-full" : "file-text"}) ${
      prompt.title
    }`;

    if (prompt.variables.length > 0) {
      label = `$(symbol-variable) ${prompt.title}`;
    }

    const parts: string[] = [];

    if (category) {
      parts.push(`📁 ${category.name}`);
    }

    if (prompt.tags.length > 0) {
      parts.push(`🏷️ ${prompt.tags.join(", ")}`);
    }

    if (prompt.useCount > 0) {
      parts.push(`📊 Used ${prompt.useCount} times`);
    }

    return {
      label,
      description:
        prompt.description || prompt.content.substring(0, 100) + "...",
      detail: parts.length > 0 ? parts.join(" • ") : undefined,
      alwaysShow: showScore,
      prompt,
    };
  }

  private async handlePromptSelection(
    item: PromptQuickPickItem
  ): Promise<void> {
    try {
      const prompt = item.prompt;

      // Mark as used
      await this.storageService.markPromptAsUsed(prompt.id);

      // Process variables if any
      let processedContent = prompt.content;
      if (prompt.variables.length > 0) {
        const processed = await this.processPromptVariables(prompt);
        if (processed !== null) {
          processedContent = processed;
        } else {
          // User cancelled
          return;
        }
      }

      await deliverPromptContent(prompt.title, processedContent);
    } catch (error) {
      vscode.window.showErrorMessage(`Error using prompt: ${error}`);
    }
  }

  private async processPromptVariables(prompt: Prompt): Promise<string | null> {
    let content = prompt.content;
    const selectedTextContext = getSelectedTextVariableContext();

    for (const variable of prompt.variables) {
      const placeholder = `{{${variable.name}}}`;

      if (!content.includes(placeholder)) {
        continue;
      }

      let value: string | undefined;

      if (
        variable.name !== "selectedText" &&
        variable.name !== "fileName" &&
        selectedTextContext.variables[variable.name] !== undefined
      ) {
        value = selectedTextContext.variables[variable.name];
      }

      switch (variable.type) {
        case "text":
          if (value === undefined) {
            value = await vscode.window.showInputBox({
              title: `Enter ${variable.name}`,
              placeHolder:
                variable.description || `Enter value for ${variable.name}`,
              value: variable.defaultValue,
              prompt: `Variable: ${variable.name}`,
            });
          }
          break;

        case "number":
          if (value === undefined) {
            value = await vscode.window.showInputBox({
              title: `Enter ${variable.name}`,
              placeHolder:
                variable.description || `Enter number for ${variable.name}`,
              value: variable.defaultValue,
              prompt: `Variable: ${variable.name}`,
              validateInput: (input: string) => {
                const num = parseFloat(input);
                return isNaN(num) ? "Please enter a valid number" : null;
              },
            });
          }
          break;

        case "boolean":
          if (value === undefined) {
            const booleanOptions = [
              { label: "true", description: "True value" },
              { label: "false", description: "False value" },
            ];
            const booleanChoice = await vscode.window.showQuickPick(
              booleanOptions,
              {
                title: `Select ${variable.name}`,
                placeHolder:
                  variable.description || `Select boolean for ${variable.name}`,
              }
            );
            value = booleanChoice?.label;
          }
          break;

        case "date":
          if (value === undefined) {
            value = await vscode.window.showInputBox({
              title: `Enter ${variable.name}`,
              placeHolder:
                variable.description ||
                `Enter date for ${variable.name} (YYYY-MM-DD)`,
              value:
                variable.defaultValue || new Date().toISOString().split("T")[0],
              prompt: `Variable: ${variable.name}`,
            });
          }
          break;

        case "selection":
          if (value === undefined) {
            if (variable.options && variable.options.length > 0) {
              const selectionOptions = variable.options.map((option) => ({
                label: option,
                description: `Option: ${option}`,
              }));
              const selectionChoice = await vscode.window.showQuickPick(
                selectionOptions,
                {
                  title: `Select ${variable.name}`,
                  placeHolder:
                    variable.description || `Select option for ${variable.name}`,
                }
              );
              value = selectionChoice?.label;
            } else {
              value = await vscode.window.showInputBox({
                title: `Enter ${variable.name}`,
                placeHolder:
                  variable.description || `Enter value for ${variable.name}`,
                value: variable.defaultValue,
                prompt: `Variable: ${variable.name}`,
              });
            }
          }
          break;

        case "file":
          if (value === undefined) {
            const fileUris = await vscode.window.showOpenDialog({
              canSelectFiles: true,
              canSelectFolders: false,
              canSelectMany: false,
              title: `Select file for ${variable.name}`,
            });
            value = fileUris?.[0]?.fsPath;
          }
          break;

        case "context":
          value = await this.getContextValue(variable.name, selectedTextContext);
          break;

        default:
          if (value === undefined) {
            value = await vscode.window.showInputBox({
              title: `Enter ${variable.name}`,
              placeHolder:
                variable.description || `Enter value for ${variable.name}`,
              value: variable.defaultValue,
              prompt: `Variable: ${variable.name}`,
            });
          }
      }

      if (value === undefined) {
        // User cancelled
        return null;
      }

      // Replace all occurrences of the placeholder with the value
      content = content.replace(new RegExp(placeholder, "g"), value);
    }

    return content;
  }

  private async getContextValue(
    variableName: string,
    selectedTextContext = getSelectedTextVariableContext()
  ): Promise<string> {
    const editor = vscode.window.activeTextEditor;

    switch (variableName) {
      case "selectedText":
        return selectedTextContext.selectedText;

      case "fileName":
        return editor?.document.fileName.split("/").pop() || "";

      case "filePath":
        return editor?.document.fileName || "";

      case "currentLine":
        const line = editor?.selection.active.line;
        return line !== undefined && editor
          ? editor.document.lineAt(line).text
          : "";

      case "lineNumber":
        const lineNum = editor?.selection.active.line;
        return lineNum !== undefined ? (lineNum + 1).toString() : "";

      case "workspace":
        return vscode.workspace.workspaceFolders?.[0]?.name || "";

      case "language":
        return editor?.document.languageId || "";

      default:
        return "";
    }
  }

}

interface PromptQuickPickItem extends vscode.QuickPickItem {
  prompt: Prompt;
  label: string;
  description?: string;
  detail?: string;
  alwaysShow?: boolean;
}
