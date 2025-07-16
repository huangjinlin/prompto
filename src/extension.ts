import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { PromptTreeProvider } from "./providers/PromptTreeProvider";

let treeProvider: PromptTreeProvider;

export function activate(context: vscode.ExtensionContext) {
  console.log("🚀 Prompto extension is now active!");

  treeProvider = new PromptTreeProvider();
  vscode.window.registerTreeDataProvider("promptoTree", treeProvider);
  registerCommands(context);
}

export function deactivate() {
  console.log("👋 Prompto extension is now deactivated!");
}

function registerCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "prompto.usePrompt",
      async (promptPath?: string) => {
        if (promptPath) {
          await usePrompt(promptPath);
        } else {
          await showPromptPicker();
        }
      }
    ),

    vscode.commands.registerCommand(
      "prompto.addPrompt",
      async (categoryPath?: string) => {
        await showAddPromptDialog(categoryPath);
      }
    )
  );
}

async function showPromptPicker(): Promise<void> {
  try {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage("No workspace folder found");
      return;
    }

    const promptoDir = path.join(workspaceFolder.uri.fsPath, ".prompto");
    if (!fs.existsSync(promptoDir)) {
      vscode.window.showInformationMessage(
        "No .prompto directory found. Create your first prompt using 'Prompto: Add New Prompt'"
      );
      return;
    }

    await navigatePromptDirectoryWithGlobalSearch(promptoDir, "");
  } catch (error) {
    vscode.window.showErrorMessage(`Error showing prompt picker: ${error}`);
  }
}

function getAllPromptsRecursive(
  dir: string,
  relativeBase: string = ""
): Array<{ label: string; detail: string; promptPath: string }> {
  let results: Array<{ label: string; detail: string; promptPath: string }> =
    [];
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const itemPath = path.join(dir, item);
    const relPath = relativeBase ? path.join(relativeBase, item) : item;
    if (fs.statSync(itemPath).isDirectory()) {
      results = results.concat(getAllPromptsRecursive(itemPath, relPath));
    } else if (item.endsWith(".md")) {
      results.push({
        label: path.basename(item, ".md"),
        detail: relPath,
        promptPath: itemPath,
      });
    }
  }
  return results;
}

async function navigatePromptDirectoryWithGlobalSearch(
  currentPath: string,
  relativePath: string
): Promise<void> {
  try {
    const allPrompts = getAllPromptsRecursive(currentPath, relativePath).map(
      (p) => ({
        label: `$(file-text) ${p.label}`,
        description: undefined,
        detail: p.detail,
        promptPath: p.promptPath,
        isDirectory: false,
        isBack: false,
      })
    );

    const items = fs.readdirSync(currentPath);
    const quickPickItems: Array<{
      label: string;
      description?: string;
      detail?: string;
      isDirectory?: boolean;
      promptPath?: string;
      directoryPath?: string;
      isBack?: boolean;
    }> = [];

    if (relativePath !== "") {
      quickPickItems.push({
        label: "$(arrow-left) Back",
        description: "Go back to parent directory",
        detail: "Navigate back",
        isBack: true,
      });
    }

    const directories = items
      .filter((item) => {
        const itemPath = path.join(currentPath, item);
        return fs.statSync(itemPath).isDirectory();
      })
      .sort();

    directories.forEach((dir) => {
      quickPickItems.push({
        label: `$(folder) ${dir}`,
        description: "Directory",
        detail: `Navigate to ${path.join(relativePath, dir) || dir}`,
        isDirectory: true,
        directoryPath: path.join(currentPath, dir),
      });
    });

    const files = items
      .filter((item) => {
        const itemPath = path.join(currentPath, item);
        return fs.statSync(itemPath).isFile() && item.endsWith(".md");
      })
      .sort();

    files.forEach((file) => {
      const name = path.basename(file, ".md");
      const fileRelativePath = relativePath
        ? path.join(relativePath, file)
        : file;
      quickPickItems.push({
        label: `$(file-text) ${name}`,
        description: "Prompt",
        detail: `Use prompt: ${fileRelativePath}`,
        promptPath: path.join(currentPath, file),
      });
    });

    const breadcrumb = relativePath ? `/${relativePath}` : "/";
    const title = `Prompto Navigator${breadcrumb}`;

    const quickPick = vscode.window.createQuickPick();
    quickPick.title = title;
    quickPick.placeholder = "Select a prompt to use or navigate to a directory";
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.items = quickPickItems;

    quickPick.onDidChangeValue((value) => {
      if (value.trim() === "") {
        quickPick.items = quickPickItems;
      } else {
        const filter = value.toLowerCase();
        quickPick.items = allPrompts.filter(
          (item) =>
            item.label.toLowerCase().includes(filter) ||
            (item.detail && item.detail.toLowerCase().includes(filter))
        );
      }
    });

    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      quickPick.hide();
      if (!selected) return;
      if ((selected as any).isBack) {
        const parentPath = path.dirname(currentPath);
        const parentRelativePath = path.dirname(relativePath);
        await navigatePromptDirectoryWithGlobalSearch(
          parentPath,
          parentRelativePath === "." ? "" : parentRelativePath
        );
      } else if (
        (selected as any).isDirectory &&
        (selected as any).directoryPath
      ) {
        const newRelativePath = relativePath
          ? path.join(
              relativePath,
              path.basename((selected as any).directoryPath)
            )
          : path.basename((selected as any).directoryPath);
        await navigatePromptDirectoryWithGlobalSearch(
          (selected as any).directoryPath,
          newRelativePath
        );
      } else if ((selected as any).promptPath) {
        await usePrompt((selected as any).promptPath);
      }
    });

    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
  } catch (error) {
    vscode.window.showErrorMessage(`Error navigating directory: ${error}`);
  }
}

function getPromptContent(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const lines = content.split("\n");
    let promptContent = "";
    let inComment = false;

    for (const line of lines) {
      if (line.startsWith("# ")) {
        continue;
      }

      if (line.includes("<!--")) {
        inComment = true;
      }
      if (line.includes("-->")) {
        inComment = false;
        continue;
      }

      if (!inComment && !line.startsWith("Write your prompt content here...")) {
        promptContent += line + "\n";
      }
    }

    return promptContent.trim();
  } catch (error) {
    return "";
  }
}

async function processPromptVariables(content: string): Promise<string | null> {
  try {
    let processedContent: string = content;

    // Handle selectedText
    if (content.includes("{{selectedText}}")) {
      const editor = vscode.window.activeTextEditor;
      const selectedText =
        editor?.selection && !editor.selection.isEmpty
          ? editor.document.getText(editor.selection)
          : "";

      if (!selectedText) {
        const useEmpty = await vscode.window.showQuickPick(
          ["Use empty value", "Cancel"],
          {
            title: "No text selected",
            placeHolder:
              "The prompt contains {{selectedText}} but no text is selected",
          }
        );

        if (useEmpty !== "Use empty value") {
          return null;
        }
      }

      processedContent = processedContent.replace(
        /\{\{selectedText\}\}/g,
        selectedText
      );
    }

    // Handle fileName
    if (content.includes("{{fileName}}")) {
      const editor = vscode.window.activeTextEditor;
      const fileName = editor?.document.fileName
        ? path.basename(editor.document.fileName)
        : "";
      processedContent = processedContent.replace(
        /\{\{fileName\}\}/g,
        fileName
      );
    }

    // Find all custom variables (excluding selectedText and fileName)
    const customVariables = content.match(/\{\{(\w+)\}\}/g);
    if (customVariables) {
      // Deduplicate variable names
      const uniqueVars = Array.from(
        new Set(
          customVariables
            .map((variable) => variable.replace(/\{\{|\}\}/g, ""))
            .filter(
              (varName) => varName !== "selectedText" && varName !== "fileName"
            )
        )
      );

      // Prompt for each unique variable
      for (const varName of uniqueVars) {
        const value = await vscode.window.showInputBox({
          title: `Variable: ${varName}`,
          placeHolder: `Enter value for ${varName}`,
          prompt: `The prompt contains a variable {{${varName}}}. What value should be used?`,
        });

        if (value === undefined) {
          return null;
        }

        processedContent = processedContent.replace(
          new RegExp(`\\{\\{${varName}\\}\\}`, "g"),
          value || ""
        );
      }
    }

    return processedContent;
  } catch (error) {
    vscode.window.showErrorMessage(`Error processing variables: ${error}`);
    return null;
  }
}

async function usePrompt(promptPath: string): Promise<void> {
  try {
    const promptName = path.basename(promptPath, ".md");
    const content = getPromptContent(promptPath);

    if (!content) {
      vscode.window.showErrorMessage("Prompt is empty");
      return;
    }

    let processedContent: string = content;
    if (content.includes("{{")) {
      const result = await processPromptVariables(content);
      if (result === null) return;
      processedContent = result;
    }

    await vscode.env.clipboard.writeText(processedContent);

    vscode.window.showInformationMessage(
      `✅ Prompt "${promptName}" copied to clipboard!`
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Error using prompt: ${error}`);
  }
}

async function showAddPromptDialog(categoryPath?: string): Promise<void> {
  try {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage(
        "No workspace folder found. Please open a project first."
      );
      return;
    }

    const promptName = await vscode.window.showInputBox({
      title: "New Prompt",
      placeHolder: "Enter prompt name",
      prompt: "What would you like to name this prompt?",
      validateInput: (input: string) => {
        return input.trim() ? null : "Prompt name is required";
      },
    });

    if (!promptName) return;

    const promptoDir = path.join(workspaceFolder.uri.fsPath, ".prompto");
    let targetDir = promptoDir;

    if (categoryPath) {
      const relativePath = path.relative(promptoDir, categoryPath);
      targetDir = path.join(promptoDir, relativePath);
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const fileName = `${promptName
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase()}.md`;
    const filePath = path.join(targetDir, fileName);

    if (fs.existsSync(filePath)) {
      const overwrite = await vscode.window.showWarningMessage(
        `A prompt named "${promptName}" already exists. Do you want to overwrite it?`,
        { modal: true },
        "Overwrite"
      );
      if (!overwrite) return;
    }

    const templateContent = `# ${promptName}

Write your prompt content here...

<!-- Instructions (will be ignored when using the prompt):
- Use multiple lines naturally
- Add {{selectedText}} for dynamic content
- Be specific and detailed
- Save the file when finished
-->
`;

    fs.writeFileSync(filePath, templateContent, "utf8");

    const doc = await vscode.workspace.openTextDocument(filePath);
    const editor = await vscode.window.showTextDocument(doc, {
      preview: false,
      viewColumn: vscode.ViewColumn.One,
    });

    const position = new vscode.Position(2, 0);
    editor.selection = new vscode.Selection(position, position);

    treeProvider.refresh();
  } catch (error) {
    vscode.window.showErrorMessage(`Error creating prompt: ${error}`);
  }
}
