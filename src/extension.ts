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

    await navigatePromptDirectory(promptoDir, "");
  } catch (error) {
    vscode.window.showErrorMessage(`Error showing prompt picker: ${error}`);
  }
}

async function navigatePromptDirectory(
  currentPath: string,
  relativePath: string
): Promise<void> {
  try {
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

    if (
      quickPickItems.length === 0 ||
      (quickPickItems.length === 1 && quickPickItems[0].isBack)
    ) {
      vscode.window.showInformationMessage(
        "No prompts or directories found in this location."
      );
      return;
    }

    const breadcrumb = relativePath ? `/${relativePath}` : "/";
    const title = `Prompto Navigator${breadcrumb}`;

    const selectedItem = await vscode.window.showQuickPick(quickPickItems, {
      title: title,
      placeHolder: "Select a prompt to use or navigate to a directory",
      matchOnDescription: true,
      matchOnDetail: true,
    });

    if (selectedItem) {
      if (selectedItem.isBack) {
        const parentPath = path.dirname(currentPath);
        const parentRelativePath = path.dirname(relativePath);
        await navigatePromptDirectory(
          parentPath,
          parentRelativePath === "." ? "" : parentRelativePath
        );
      } else if (selectedItem.isDirectory && selectedItem.directoryPath) {
        const newRelativePath = relativePath
          ? path.join(relativePath, path.basename(selectedItem.directoryPath))
          : path.basename(selectedItem.directoryPath);
        await navigatePromptDirectory(
          selectedItem.directoryPath,
          newRelativePath
        );
      } else if (selectedItem.promptPath) {
        await usePrompt(selectedItem.promptPath);
      }
    }
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

    const customVariables = content.match(/\{\{(\w+)\}\}/g);
    if (customVariables) {
      for (const variable of customVariables) {
        const varName = variable.replace(/\{\{|\}\}/g, "");
        if (varName !== "selectedText" && varName !== "fileName") {
          const value = await vscode.window.showInputBox({
            title: `Variable: ${varName}`,
            placeHolder: `Enter value for ${varName}`,
            prompt: `The prompt contains a variable ${variable}. What value should be used?`,
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
