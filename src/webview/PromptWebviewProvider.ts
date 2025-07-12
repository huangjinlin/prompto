import * as vscode from "vscode";
import { StorageService } from "../services/StorageService";
import {
  Prompt,
  Category,
  PromptBuilder,
  CategoryBuilder,
} from "../models/Prompt";

export class PromptWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "prompto.webview";
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly storageService: StorageService
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "addPrompt":
          await this.handleAddPrompt(data.prompt);
          break;
        case "editPrompt":
          await this.handleEditPrompt(data.prompt);
          break;
        case "deletePrompt":
          await this.handleDeletePrompt(data.promptId);
          break;
        case "addCategory":
          await this.handleAddCategory(data.category);
          break;
        case "editCategory":
          await this.handleEditCategory(data.category);
          break;
        case "deleteCategory":
          await this.handleDeleteCategory(data.categoryId);
          break;
        case "loadPrompt":
          await this.handleLoadPrompt(data.promptId);
          break;
        case "loadCategory":
          await this.handleLoadCategory(data.categoryId);
          break;
        case "loadData":
          await this.handleLoadData();
          break;
        case "searchPrompts":
          await this.handleSearchPrompts(data.query);
          break;
        case "testPrompt":
          await this.handleTestPrompt(data.prompt);
          break;
      }
    });

    // Load initial data
    this.handleLoadData();
  }

  private async handleAddPrompt(promptData: any): Promise<void> {
    try {
      const prompt = new PromptBuilder()
        .setTitle(promptData.title)
        .setContent(promptData.content)
        .setDescription(promptData.description)
        .setCategory(promptData.categoryId)
        .setFavorite(promptData.isFavorite || false)
        .build();

      // Add tags
      if (promptData.tags && Array.isArray(promptData.tags)) {
        promptData.tags.forEach((tag: string) => {
          prompt.tags.push(tag);
        });
      }

      // Add variables
      if (promptData.variables && Array.isArray(promptData.variables)) {
        prompt.variables = promptData.variables;
      }

      await this.storageService.savePrompt(prompt);
      vscode.window.showInformationMessage("Prompt added successfully!");

      // Refresh tree view
      vscode.commands.executeCommand("prompto.refreshTree");

      // Send success message to webview
      this._view?.webview.postMessage({
        type: "promptAdded",
        prompt: prompt,
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Error adding prompt: ${error}`);
    }
  }

  private async handleEditPrompt(promptData: any): Promise<void> {
    try {
      const existingPrompt = await this.storageService.getPromptById(
        promptData.id
      );
      if (!existingPrompt) {
        vscode.window.showErrorMessage("Prompt not found");
        return;
      }

      const updatedPrompt: Prompt = {
        ...existingPrompt,
        title: promptData.title,
        content: promptData.content,
        description: promptData.description,
        categoryId: promptData.categoryId,
        tags: promptData.tags || [],
        variables: promptData.variables || [],
        isFavorite: promptData.isFavorite || false,
        updatedAt: new Date(),
      };

      await this.storageService.savePrompt(updatedPrompt);
      vscode.window.showInformationMessage("Prompt updated successfully!");

      vscode.commands.executeCommand("prompto.refreshTree");

      this._view?.webview.postMessage({
        type: "promptUpdated",
        prompt: updatedPrompt,
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Error updating prompt: ${error}`);
    }
  }

  private async handleDeletePrompt(promptId: string): Promise<void> {
    try {
      await this.storageService.deletePrompt(promptId);
      vscode.window.showInformationMessage("Prompt deleted successfully!");

      vscode.commands.executeCommand("prompto.refreshTree");

      this._view?.webview.postMessage({
        type: "promptDeleted",
        promptId: promptId,
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Error deleting prompt: ${error}`);
    }
  }

  private async handleAddCategory(categoryData: any): Promise<void> {
    try {
      const category = new CategoryBuilder()
        .setName(categoryData.name)
        .setDescription(categoryData.description)
        .setParent(categoryData.parentId)
        .setColor(categoryData.color)
        .setIcon(categoryData.icon)
        .build();

      await this.storageService.saveCategory(category);
      vscode.window.showInformationMessage("Category added successfully!");

      vscode.commands.executeCommand("prompto.refreshTree");

      this._view?.webview.postMessage({
        type: "categoryAdded",
        category: category,
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Error adding category: ${error}`);
    }
  }

  private async handleEditCategory(categoryData: any): Promise<void> {
    try {
      const existingCategory = await this.storageService.getCategoryById(
        categoryData.id
      );
      if (!existingCategory) {
        vscode.window.showErrorMessage("Category not found");
        return;
      }

      const updatedCategory: Category = {
        ...existingCategory,
        name: categoryData.name,
        description: categoryData.description,
        parentId: categoryData.parentId,
        color: categoryData.color,
        icon: categoryData.icon,
        updatedAt: new Date(),
      };

      await this.storageService.saveCategory(updatedCategory);
      vscode.window.showInformationMessage("Category updated successfully!");

      vscode.commands.executeCommand("prompto.refreshTree");

      this._view?.webview.postMessage({
        type: "categoryUpdated",
        category: updatedCategory,
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Error updating category: ${error}`);
    }
  }

  private async handleDeleteCategory(categoryId: string): Promise<void> {
    try {
      await this.storageService.deleteCategory(categoryId);
      vscode.window.showInformationMessage("Category deleted successfully!");

      vscode.commands.executeCommand("prompto.refreshTree");

      this._view?.webview.postMessage({
        type: "categoryDeleted",
        categoryId: categoryId,
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Error deleting category: ${error}`);
    }
  }

  private async handleLoadPrompt(promptId: string): Promise<void> {
    try {
      const prompt = await this.storageService.getPromptById(promptId);
      if (prompt) {
        this._view?.webview.postMessage({
          type: "promptLoaded",
          prompt: prompt,
        });
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error loading prompt: ${error}`);
    }
  }

  private async handleLoadCategory(categoryId: string): Promise<void> {
    try {
      const category = await this.storageService.getCategoryById(categoryId);
      if (category) {
        this._view?.webview.postMessage({
          type: "categoryLoaded",
          category: category,
        });
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error loading category: ${error}`);
    }
  }

  private async handleLoadData(): Promise<void> {
    try {
      const [prompts, categories] = await Promise.all([
        this.storageService.getPrompts(),
        this.storageService.getCategories(),
      ]);

      this._view?.webview.postMessage({
        type: "dataLoaded",
        data: {
          prompts,
          categories,
        },
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Error loading data: ${error}`);
    }
  }

  private async handleSearchPrompts(query: string): Promise<void> {
    try {
      const prompts = await this.storageService.searchPrompts(query);
      this._view?.webview.postMessage({
        type: "searchResults",
        prompts: prompts,
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Error searching prompts: ${error}`);
    }
  }

  private async handleTestPrompt(promptData: any): Promise<void> {
    try {
      // Process variables in prompt content
      let processedContent = promptData.content;

      if (promptData.variables && Array.isArray(promptData.variables)) {
        for (const variable of promptData.variables) {
          const placeholder = `{{${variable.name}}}`;
          const value =
            variable.testValue || variable.defaultValue || `[${variable.name}]`;
          processedContent = processedContent.replace(
            new RegExp(placeholder, "g"),
            value
          );
        }
      }

      this._view?.webview.postMessage({
        type: "promptTested",
        processedContent: processedContent,
      });
    } catch (error) {
      vscode.window.showErrorMessage(`Error testing prompt: ${error}`);
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Prompto Manager</title>
    <style>
        :root {
            --vscode-font-family: var(--vscode-font-family);
            --vscode-font-size: var(--vscode-font-size);
            --vscode-foreground: var(--vscode-foreground);
            --vscode-background: var(--vscode-background);
            --vscode-button-background: var(--vscode-button-background);
            --vscode-button-foreground: var(--vscode-button-foreground);
            --vscode-button-hoverBackground: var(--vscode-button-hoverBackground);
            --vscode-input-background: var(--vscode-input-background);
            --vscode-input-foreground: var(--vscode-input-foreground);
            --vscode-input-border: var(--vscode-input-border);
            --vscode-inputOption-activeBorder: var(--vscode-inputOption-activeBorder);
            --vscode-focusBorder: var(--vscode-focusBorder);
            --vscode-textLink-foreground: var(--vscode-textLink-foreground);
            --vscode-errorForeground: var(--vscode-errorForeground);
        }

        * {
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-background);
            margin: 0;
            padding: 10px;
        }

        .container {
            max-width: 100%;
            margin: 0 auto;
        }

        .tabs {
            display: flex;
            border-bottom: 1px solid var(--vscode-input-border);
            margin-bottom: 20px;
        }

        .tab {
            padding: 10px 20px;
            cursor: pointer;
            border: none;
            background: none;
            color: var(--vscode-foreground);
            font-size: var(--vscode-font-size);
            font-family: var(--vscode-font-family);
            transition: all 0.2s;
        }

        .tab:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .tab.active {
            border-bottom: 2px solid var(--vscode-focusBorder);
            color: var(--vscode-textLink-foreground);
        }

        .tab-content {
            display: none;
        }

        .tab-content.active {
            display: block;
        }

        .form-group {
            margin-bottom: 15px;
        }

        label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
        }

        input, textarea, select {
            width: 100%;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            border-radius: 2px;
        }

        input:focus, textarea:focus, select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        textarea {
            resize: vertical;
            min-height: 100px;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        }

        .textarea-large {
            min-height: 200px;
        }

        button {
            padding: 8px 16px;
            border: none;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            cursor: pointer;
            border-radius: 2px;
            margin-right: 10px;
            margin-bottom: 10px;
        }

        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .button-secondary {
            background-color: transparent;
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-foreground);
        }

        .button-danger {
            background-color: var(--vscode-errorForeground);
            color: white;
        }

        .tags-input {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin-bottom: 10px;
        }

        .tag {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .tag-remove {
            cursor: pointer;
            font-weight: bold;
        }

        .variables-container {
            border: 1px solid var(--vscode-input-border);
            padding: 10px;
            border-radius: 2px;
            margin-bottom: 15px;
        }

        .variable-item {
            display: flex;
            gap: 10px;
            margin-bottom: 10px;
            align-items: center;
        }

        .variable-item input {
            flex: 1;
        }

        .variable-item select {
            width: 120px;
        }

        .variable-item button {
            padding: 4px 8px;
            margin: 0;
        }

        .search-container {
            display: flex;
            gap: 10px;
            margin-bottom: 20px;
        }

        .search-container input {
            flex: 1;
        }

        .prompt-list {
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            max-height: 300px;
            overflow-y: auto;
        }

        .prompt-item {
            padding: 10px;
            border-bottom: 1px solid var(--vscode-input-border);
            cursor: pointer;
        }

        .prompt-item:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .prompt-item:last-child {
            border-bottom: none;
        }

        .prompt-title {
            font-weight: bold;
            margin-bottom: 5px;
        }

        .prompt-description {
            font-size: 12px;
            opacity: 0.7;
        }

        .preview-container {
            border: 1px solid var(--vscode-input-border);
            padding: 10px;
            border-radius: 2px;
            background-color: var(--vscode-input-background);
            white-space: pre-wrap;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 12px;
            max-height: 200px;
            overflow-y: auto;
        }

        .hidden {
            display: none;
        }

        .success {
            color: #4CAF50;
            background-color: rgba(76, 175, 80, 0.1);
            padding: 10px;
            border-radius: 2px;
            margin-bottom: 15px;
        }

        .error {
            color: var(--vscode-errorForeground);
            background-color: rgba(244, 67, 54, 0.1);
            padding: 10px;
            border-radius: 2px;
            margin-bottom: 15px;
        }

        .checkbox-container {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .checkbox-container input[type="checkbox"] {
            width: auto;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="tabs">
            <button class="tab active" onclick="showTab('prompts')">Prompts</button>
            <button class="tab" onclick="showTab('categories')">Categories</button>
            <button class="tab" onclick="showTab('search')">Search</button>
        </div>

        <!-- Prompts Tab -->
        <div id="prompts" class="tab-content active">
            <div id="prompt-form">
                <h3 id="prompt-form-title">Add New Prompt</h3>
                <div id="prompt-message"></div>
                
                <div class="form-group">
                    <label for="prompt-title">Title *</label>
                    <input type="text" id="prompt-title" required>
                </div>

                <div class="form-group">
                    <label for="prompt-description">Description</label>
                    <textarea id="prompt-description" placeholder="Brief description of what this prompt does"></textarea>
                </div>

                <div class="form-group">
                    <label for="prompt-content">Content *</label>
                    <textarea id="prompt-content" class="textarea-large" placeholder="Enter your prompt here. Use {{variableName}} for variables." required></textarea>
                </div>

                <div class="form-group">
                    <label for="prompt-category">Category</label>
                    <select id="prompt-category">
                        <option value="">Select a category...</option>
                    </select>
                </div>

                <div class="form-group">
                    <label>Tags</label>
                    <div class="tags-input" id="tags-container"></div>
                    <input type="text" id="tag-input" placeholder="Add tags (press Enter)">
                </div>

                <div class="form-group">
                    <div class="checkbox-container">
                        <input type="checkbox" id="prompt-favorite">
                        <label for="prompt-favorite">Mark as favorite</label>
                    </div>
                </div>

                <div class="form-group">
                    <label>Variables</label>
                    <div class="variables-container">
                        <div id="variables-list"></div>
                        <button type="button" onclick="addVariable()" class="button-secondary">Add Variable</button>
                    </div>
                </div>

                <div class="form-group">
                    <button type="button" onclick="testPrompt()">Test Prompt</button>
                    <button type="button" onclick="savePrompt()">Save Prompt</button>
                    <button type="button" onclick="resetPromptForm()" class="button-secondary">Reset</button>
                    <button type="button" onclick="deleteCurrentPrompt()" class="button-danger hidden" id="delete-prompt-btn">Delete</button>
                </div>

                <div id="prompt-preview" class="hidden">
                    <label>Preview:</label>
                    <div class="preview-container" id="preview-content"></div>
                </div>
            </div>

            <div id="prompt-list">
                <h4>Recent Prompts</h4>
                <div class="prompt-list" id="recent-prompts"></div>
            </div>
        </div>

        <!-- Categories Tab -->
        <div id="categories" class="tab-content">
            <div id="category-form">
                <h3 id="category-form-title">Add New Category</h3>
                <div id="category-message"></div>
                
                <div class="form-group">
                    <label for="category-name">Name *</label>
                    <input type="text" id="category-name" required>
                </div>

                <div class="form-group">
                    <label for="category-description">Description</label>
                    <textarea id="category-description" placeholder="Brief description of this category"></textarea>
                </div>

                <div class="form-group">
                    <label for="category-parent">Parent Category</label>
                    <select id="category-parent">
                        <option value="">No parent (root category)</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="category-icon">Icon</label>
                    <select id="category-icon">
                        <option value="folder">📁 Folder</option>
                        <option value="code">💻 Code</option>
                        <option value="book">📚 Book</option>
                        <option value="star">⭐ Star</option>
                        <option value="heart">❤️ Heart</option>
                        <option value="lightbulb">💡 Lightbulb</option>
                        <option value="rocket">🚀 Rocket</option>
                        <option value="gear">⚙️ Gear</option>
                        <option value="file">📄 File</option>
                        <option value="tag">🏷️ Tag</option>
                    </select>
                </div>

                <div class="form-group">
                    <label for="category-color">Color</label>
                    <input type="color" id="category-color" value="#007ACC">
                </div>

                <div class="form-group">
                    <button type="button" onclick="saveCategory()">Save Category</button>
                    <button type="button" onclick="resetCategoryForm()" class="button-secondary">Reset</button>
                    <button type="button" onclick="deleteCurrentCategory()" class="button-danger hidden" id="delete-category-btn">Delete</button>
                </div>
            </div>
        </div>

        <!-- Search Tab -->
        <div id="search" class="tab-content">
            <div class="search-container">
                <input type="text" id="search-input" placeholder="Search prompts...">
                <button type="button" onclick="searchPrompts()">Search</button>
            </div>
            
            <div id="search-results" class="prompt-list"></div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentPrompt = null;
        let currentCategory = null;
        let allPrompts = [];
        let allCategories = [];

        // Initialize
        window.addEventListener('load', () => {
            loadData();
            setupEventListeners();
        });

        function setupEventListeners() {
            // Tag input
            document.getElementById('tag-input').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                }
            });

            // Search input
            document.getElementById('search-input').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    searchPrompts();
                }
            });

            // Auto-detect variables in prompt content
            document.getElementById('prompt-content').addEventListener('input', (e) => {
                autoDetectVariables(e.target.value);
            });
        }

        function showTab(tabName) {
            // Hide all tabs
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

            // Show selected tab
            document.querySelector(\`button[onclick="showTab('$\{tabName}')\"]\`).classList.add('active');
            document.getElementById(tabName).classList.add('active');
        }

        function loadData() {
            vscode.postMessage({ type: 'loadData' });
        }

        function savePrompt() {
            const title = document.getElementById('prompt-title').value.trim();
            const content = document.getElementById('prompt-content').value.trim();
            
            if (!title || !content) {
                showMessage('prompt-message', 'Title and content are required', 'error');
                return;
            }

            const promptData = {
                id: currentPrompt?.id,
                title,
                content,
                description: document.getElementById('prompt-description').value.trim(),
                categoryId: document.getElementById('prompt-category').value || undefined,
                tags: getTags(),
                variables: getVariables(),
                isFavorite: document.getElementById('prompt-favorite').checked
            };

            if (currentPrompt) {
                vscode.postMessage({ type: 'editPrompt', prompt: promptData });
            } else {
                vscode.postMessage({ type: 'addPrompt', prompt: promptData });
            }
        }

        function saveCategory() {
            const name = document.getElementById('category-name').value.trim();
            
            if (!name) {
                showMessage('category-message', 'Category name is required', 'error');
                return;
            }

            const categoryData = {
                id: currentCategory?.id,
                name,
                description: document.getElementById('category-description').value.trim(),
                parentId: document.getElementById('category-parent').value || undefined,
                icon: document.getElementById('category-icon').value,
                color: document.getElementById('category-color').value
            };

            if (currentCategory) {
                vscode.postMessage({ type: 'editCategory', category: categoryData });
            } else {
                vscode.postMessage({ type: 'addCategory', category: categoryData });
            }
        }

        function resetPromptForm() {
            currentPrompt = null;
            document.getElementById('prompt-form-title').textContent = 'Add New Prompt';
            document.getElementById('delete-prompt-btn').classList.add('hidden');
            document.getElementById('prompt-form').reset();
            document.getElementById('tags-container').innerHTML = '';
            document.getElementById('variables-list').innerHTML = '';
            document.getElementById('prompt-preview').classList.add('hidden');
            clearMessage('prompt-message');
        }

        function resetCategoryForm() {
            currentCategory = null;
            document.getElementById('category-form-title').textContent = 'Add New Category';
            document.getElementById('delete-category-btn').classList.add('hidden');
            document.getElementById('category-form').reset();
            clearMessage('category-message');
        }

        function deleteCurrentPrompt() {
            if (!currentPrompt) return;
            
            if (confirm('Are you sure you want to delete this prompt?')) {
                vscode.postMessage({ type: 'deletePrompt', promptId: currentPrompt.id });
            }
        }

        function deleteCurrentCategory() {
            if (!currentCategory) return;
            
            if (confirm('Are you sure you want to delete this category? All prompts in this category will become uncategorized.')) {
                vscode.postMessage({ type: 'deleteCategory', categoryId: currentCategory.id });
            }
        }

        function testPrompt() {
            const content = document.getElementById('prompt-content').value.trim();
            if (!content) {
                showMessage('prompt-message', 'Enter prompt content first', 'error');
                return;
            }

            const variables = getVariables();
            vscode.postMessage({ 
                type: 'testPrompt', 
                prompt: { content, variables } 
            });
        }

        function searchPrompts() {
            const query = document.getElementById('search-input').value.trim();
            if (!query) return;

            vscode.postMessage({ type: 'searchPrompts', query });
        }

        function addTag() {
            const input = document.getElementById('tag-input');
            const tag = input.value.trim();
            
            if (!tag) return;

            const container = document.getElementById('tags-container');
            const tagElement = document.createElement('div');
            tagElement.className = 'tag';
            tagElement.innerHTML = \`
                <span>$\{tag}</span>
                <span class="tag-remove" onclick="removeTag(this)">×</span>
            \`;
            container.appendChild(tagElement);
            input.value = '';
        }

        function removeTag(element) {
            element.parentElement.remove();
        }

        function getTags() {
            const tags = [];
            document.querySelectorAll('.tag span:first-child').forEach(tag => {
                tags.push(tag.textContent);
            });
            return tags;
        }

        function addVariable() {
            const container = document.getElementById('variables-list');
            const variableElement = document.createElement('div');
            variableElement.className = 'variable-item';
            variableElement.innerHTML = \`
                <input type="text" placeholder="Variable name" class="var-name">
                <select class="var-type">
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="boolean">Boolean</option>
                    <option value="date">Date</option>
                    <option value="selection">Selection</option>
                    <option value="file">File</option>
                    <option value="context">Context</option>
                </select>
                <input type="text" placeholder="Default value" class="var-default">
                <input type="text" placeholder="Test value" class="var-test">
                <button type="button" onclick="removeVariable(this)" class="button-danger">Remove</button>
            \`;
            container.appendChild(variableElement);
        }

        function removeVariable(element) {
            element.parentElement.remove();
        }

        function getVariables() {
            const variables = [];
            document.querySelectorAll('.variable-item').forEach(item => {
                const name = item.querySelector('.var-name').value.trim();
                const type = item.querySelector('.var-type').value;
                const defaultValue = item.querySelector('.var-default').value.trim();
                const testValue = item.querySelector('.var-test').value.trim();
                
                if (name) {
                    variables.push({
                        name,
                        type,
                        defaultValue: defaultValue || undefined,
                        testValue: testValue || undefined,
                        required: true
                    });
                }
            });
            return variables;
        }

        function autoDetectVariables(content) {
            const matches = content.match(/\{\{([^}]+)\}\}/g);
            if (!matches) return;

            const currentVariables = getVariables().map(v => v.name);
            const detectedVariables = matches.map(match => match.replace(/[{}]/g, ''));
            
            detectedVariables.forEach(varName => {
                if (!currentVariables.includes(varName)) {
                    addVariable();
                    const lastVariable = document.querySelector('.variable-item:last-child');
                    if (lastVariable) {
                        lastVariable.querySelector('.var-name').value = varName;
                    }
                }
            });
        }

        function loadPrompt(prompt) {
            currentPrompt = prompt;
            document.getElementById('prompt-form-title').textContent = 'Edit Prompt';
            document.getElementById('delete-prompt-btn').classList.remove('hidden');
            
            document.getElementById('prompt-title').value = prompt.title;
            document.getElementById('prompt-content').value = prompt.content;
            document.getElementById('prompt-description').value = prompt.description || '';
            document.getElementById('prompt-category').value = prompt.categoryId || '';
            document.getElementById('prompt-favorite').checked = prompt.isFavorite;
            
            // Load tags
            const tagsContainer = document.getElementById('tags-container');
            tagsContainer.innerHTML = '';
            prompt.tags.forEach(tag => {
                const tagElement = document.createElement('div');
                tagElement.className = 'tag';
                tagElement.innerHTML = \`
                    <span>$\{tag}</span>
                    <span class="tag-remove" onclick="removeTag(this)">×</span>
                \`;
                tagsContainer.appendChild(tagElement);
            });
            
            // Load variables
            const variablesContainer = document.getElementById('variables-list');
            variablesContainer.innerHTML = '';
            prompt.variables.forEach(variable => {
                addVariable();
                const lastVariable = document.querySelector('.variable-item:last-child');
                if (lastVariable) {
                    lastVariable.querySelector('.var-name').value = variable.name;
                    lastVariable.querySelector('.var-type').value = variable.type;
                    lastVariable.querySelector('.var-default').value = variable.defaultValue || '';
                }
            });
            
            showTab('prompts');
        }

        function loadCategory(category) {
            currentCategory = category;
            document.getElementById('category-form-title').textContent = 'Edit Category';
            document.getElementById('delete-category-btn').classList.remove('hidden');
            
            document.getElementById('category-name').value = category.name;
            document.getElementById('category-description').value = category.description || '';
            document.getElementById('category-parent').value = category.parentId || '';
            document.getElementById('category-icon').value = category.icon || 'folder';
            document.getElementById('category-color').value = category.color || '#007ACC';
            
            showTab('categories');
        }

        function populateCategories() {
            const promptCategorySelect = document.getElementById('prompt-category');
            const categoryParentSelect = document.getElementById('category-parent');
            
            // Clear existing options (except first one)
            promptCategorySelect.innerHTML = '<option value="">Select a category...</option>';
            categoryParentSelect.innerHTML = '<option value="">No parent (root category)</option>';
            
            allCategories.forEach(category => {
                const option1 = document.createElement('option');
                option1.value = category.id;
                option1.textContent = category.name;
                promptCategorySelect.appendChild(option1);
                
                const option2 = document.createElement('option');
                option2.value = category.id;
                option2.textContent = category.name;
                categoryParentSelect.appendChild(option2);
            });
        }

        function displayPrompts(prompts, containerId) {
            const container = document.getElementById(containerId);
            container.innerHTML = '';
            
            prompts.forEach(prompt => {
                const promptElement = document.createElement('div');
                promptElement.className = 'prompt-item';
                promptElement.innerHTML = \`
                    <div class="prompt-title">$\{prompt.title}</div>
                    <div class="prompt-description">$\{prompt.description || 'No description'}</div>
                \`;
                promptElement.addEventListener('click', () => loadPrompt(prompt));
                container.appendChild(promptElement);
            });
        }

        function showMessage(containerId, message, type) {
            const container = document.getElementById(containerId);
            container.innerHTML = \`<div class="$\{type}">$\{message}</div>\`;
        }

        function clearMessage(containerId) {
            document.getElementById(containerId).innerHTML = '';
        }

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'dataLoaded':
                    allPrompts = message.data.prompts;
                    allCategories = message.data.categories;
                    populateCategories();
                    displayPrompts(allPrompts.slice(0, 10), 'recent-prompts');
                    break;
                    
                case 'promptAdded':
                    showMessage('prompt-message', 'Prompt added successfully!', 'success');
                    resetPromptForm();
                    loadData();
                    break;
                    
                case 'promptUpdated':
                    showMessage('prompt-message', 'Prompt updated successfully!', 'success');
                    resetPromptForm();
                    loadData();
                    break;
                    
                case 'promptDeleted':
                    showMessage('prompt-message', 'Prompt deleted successfully!', 'success');
                    resetPromptForm();
                    loadData();
                    break;
                    
                case 'categoryAdded':
                    showMessage('category-message', 'Category added successfully!', 'success');
                    resetCategoryForm();
                    loadData();
                    break;
                    
                case 'categoryUpdated':
                    showMessage('category-message', 'Category updated successfully!', 'success');
                    resetCategoryForm();
                    loadData();
                    break;
                    
                case 'categoryDeleted':
                    showMessage('category-message', 'Category deleted successfully!', 'success');
                    resetCategoryForm();
                    loadData();
                    break;
                    
                case 'searchResults':
                    displayPrompts(message.prompts, 'search-results');
                    break;
                    
                case 'promptTested':
                    document.getElementById('preview-content').textContent = message.processedContent;
                    document.getElementById('prompt-preview').classList.remove('hidden');
                    break;
            }
        });
    </script>
</body>
</html>`;
  }
}
