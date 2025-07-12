import * as vscode from "vscode";
import {
  Prompt,
  Category,
  PromptCollection,
  PromptBuilder,
  CategoryBuilder,
} from "../models/Prompt";

export class StorageService {
  private context: vscode.ExtensionContext;
  private readonly PROMPTS_KEY = "prompto.prompts";
  private readonly CATEGORIES_KEY = "prompto.categories";

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.initializeDefaultData();
  }

  // Prompts Management
  async getPrompts(): Promise<Prompt[]> {
    const prompts = this.context.globalState.get<Prompt[]>(
      this.PROMPTS_KEY,
      []
    );
    return prompts.map((p: any) => ({
      ...p,
      createdAt: new Date(p.createdAt),
      updatedAt: new Date(p.updatedAt),
      lastUsed: p.lastUsed ? new Date(p.lastUsed) : undefined,
    }));
  }

  async savePrompt(prompt: Prompt): Promise<void> {
    const prompts = await this.getPrompts();
    const existingIndex = prompts.findIndex((p) => p.id === prompt.id);

    if (existingIndex >= 0) {
      prompts[existingIndex] = { ...prompt, updatedAt: new Date() };
    } else {
      prompts.push(prompt);
    }

    await this.context.globalState.update(this.PROMPTS_KEY, prompts);
  }

  async deletePrompt(id: string): Promise<void> {
    const prompts = await this.getPrompts();
    const filteredPrompts = prompts.filter((p) => p.id !== id);
    await this.context.globalState.update(this.PROMPTS_KEY, filteredPrompts);
  }

  async getPromptById(id: string): Promise<Prompt | undefined> {
    const prompts = await this.getPrompts();
    return prompts.find((p) => p.id === id);
  }

  async getPromptsByCategory(categoryId: string): Promise<Prompt[]> {
    const prompts = await this.getPrompts();
    return prompts.filter((p) => p.categoryId === categoryId);
  }

  async searchPrompts(query: string): Promise<Prompt[]> {
    const prompts = await this.getPrompts();
    const lowercaseQuery = query.toLowerCase();

    return prompts.filter(
      (p) =>
        p.title.toLowerCase().includes(lowercaseQuery) ||
        p.content.toLowerCase().includes(lowercaseQuery) ||
        p.description?.toLowerCase().includes(lowercaseQuery) ||
        p.tags.some((tag) => tag.toLowerCase().includes(lowercaseQuery))
    );
  }

  async markPromptAsUsed(id: string): Promise<void> {
    const prompts = await this.getPrompts();
    const prompt = prompts.find((p) => p.id === id);

    if (prompt) {
      prompt.lastUsed = new Date();
      prompt.useCount++;
      await this.savePrompt(prompt);
    }
  }

  async getRecentPrompts(limit: number = 10): Promise<Prompt[]> {
    const prompts = await this.getPrompts();
    return prompts
      .filter((p) => p.lastUsed)
      .sort(
        (a, b) => (b.lastUsed?.getTime() || 0) - (a.lastUsed?.getTime() || 0)
      )
      .slice(0, limit);
  }

  async getFavoritePrompts(): Promise<Prompt[]> {
    const prompts = await this.getPrompts();
    return prompts.filter((p) => p.isFavorite);
  }

  async getMostUsedPrompts(limit: number = 10): Promise<Prompt[]> {
    const prompts = await this.getPrompts();
    return prompts.sort((a, b) => b.useCount - a.useCount).slice(0, limit);
  }

  // Categories Management
  async getCategories(): Promise<Category[]> {
    const categories = this.context.globalState.get<Category[]>(
      this.CATEGORIES_KEY,
      []
    );
    return categories.map((c: any) => ({
      ...c,
      createdAt: new Date(c.createdAt),
      updatedAt: new Date(c.updatedAt),
    }));
  }

  async saveCategory(category: Category): Promise<void> {
    const categories = await this.getCategories();
    const existingIndex = categories.findIndex((c) => c.id === category.id);

    if (existingIndex >= 0) {
      categories[existingIndex] = { ...category, updatedAt: new Date() };
    } else {
      categories.push(category);
    }

    await this.context.globalState.update(this.CATEGORIES_KEY, categories);
  }

  async deleteCategory(id: string): Promise<void> {
    const categories = await this.getCategories();
    const prompts = await this.getPrompts();

    // Remove category reference from prompts
    const updatedPrompts = prompts.map((p) =>
      p.categoryId === id ? { ...p, categoryId: undefined } : p
    );

    // Remove child categories
    const filteredCategories = categories.filter(
      (c) => c.id !== id && c.parentId !== id
    );

    await this.context.globalState.update(
      this.CATEGORIES_KEY,
      filteredCategories
    );
    await this.context.globalState.update(this.PROMPTS_KEY, updatedPrompts);
  }

  async getCategoryById(id: string): Promise<Category | undefined> {
    const categories = await this.getCategories();
    return categories.find((c) => c.id === id);
  }

  async getRootCategories(): Promise<Category[]> {
    const categories = await this.getCategories();
    return categories
      .filter((c) => !c.parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async getChildCategories(parentId: string): Promise<Category[]> {
    const categories = await this.getCategories();
    return categories
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  // Import/Export
  async exportData(): Promise<PromptCollection> {
    const prompts = await this.getPrompts();
    const categories = await this.getCategories();

    return {
      prompts,
      categories,
      version: "1.0.0",
      exportedAt: new Date(),
    };
  }

  async importData(
    collection: PromptCollection,
    merge: boolean = false
  ): Promise<void> {
    if (merge) {
      // Merge with existing data
      const existingPrompts = await this.getPrompts();
      const existingCategories = await this.getCategories();

      // Avoid duplicates by ID
      const newPrompts = collection.prompts.filter(
        (p) => !existingPrompts.some((ep) => ep.id === p.id)
      );
      const newCategories = collection.categories.filter(
        (c) => !existingCategories.some((ec) => ec.id === c.id)
      );

      await this.context.globalState.update(this.PROMPTS_KEY, [
        ...existingPrompts,
        ...newPrompts,
      ]);
      await this.context.globalState.update(this.CATEGORIES_KEY, [
        ...existingCategories,
        ...newCategories,
      ]);
    } else {
      // Replace all data
      await this.context.globalState.update(
        this.PROMPTS_KEY,
        collection.prompts
      );
      await this.context.globalState.update(
        this.CATEGORIES_KEY,
        collection.categories
      );
    }
  }

  // Utility Methods
  async clearAllData(): Promise<void> {
    await this.context.globalState.update(this.PROMPTS_KEY, []);
    await this.context.globalState.update(this.CATEGORIES_KEY, []);
    this.initializeDefaultData();
  }

  private async initializeDefaultData(): Promise<void> {
    const prompts = await this.getPrompts();
    const categories = await this.getCategories();

    // Create default categories if none exist
    if (categories.length === 0) {
      const defaultCategories = [
        new CategoryBuilder()
          .setName("General")
          .setDescription("General purpose prompts")
          .setIcon("folder")
          .setSortOrder(1)
          .build(),
        new CategoryBuilder()
          .setName("Development")
          .setDescription("Code-related prompts")
          .setIcon("code")
          .setSortOrder(2)
          .build(),
        new CategoryBuilder()
          .setName("Documentation")
          .setDescription("Documentation and writing prompts")
          .setIcon("book")
          .setSortOrder(3)
          .build(),
        new CategoryBuilder()
          .setName("Review")
          .setDescription("Code review and analysis prompts")
          .setIcon("search")
          .setSortOrder(4)
          .build(),
      ];

      for (const category of defaultCategories) {
        await this.saveCategory(category);
      }
    }

    // Create default prompts if none exist
    if (prompts.length === 0) {
      const categories = await this.getCategories();
      const generalCategory = categories.find((c) => c.name === "General");
      const devCategory = categories.find((c) => c.name === "Development");
      const docCategory = categories.find((c) => c.name === "Documentation");
      const reviewCategory = categories.find((c) => c.name === "Review");

      const defaultPrompts = [
        new PromptBuilder()
          .setTitle("Explain Code")
          .setContent(
            "Please explain this code step by step:\n\n{{selectedText}}\n\nInclude:\n- What it does\n- How it works\n- Any potential issues or improvements"
          )
          .setDescription("Explains selected code in detail")
          .setCategory(devCategory?.id || "")
          .addTag("explanation")
          .addTag("code")
          .addVariable({
            name: "selectedText",
            description: "The selected code to explain",
            type: "selection",
            required: true,
          })
          .build(),

        new PromptBuilder()
          .setTitle("Code Review")
          .setContent(
            "Please review this code for:\n\n{{selectedText}}\n\nFocus on:\n- Code quality and readability\n- Performance issues\n- Security vulnerabilities\n- Best practices\n- Suggestions for improvement"
          )
          .setDescription("Comprehensive code review")
          .setCategory(reviewCategory?.id || "")
          .addTag("review")
          .addTag("quality")
          .addVariable({
            name: "selectedText",
            description: "The code to review",
            type: "selection",
            required: true,
          })
          .build(),

        new PromptBuilder()
          .setTitle("Write Documentation")
          .setContent(
            "Create comprehensive documentation for:\n\n{{selectedText}}\n\nInclude:\n- Purpose and functionality\n- Parameters and return values\n- Usage examples\n- Notes and warnings"
          )
          .setDescription("Generate documentation for code")
          .setCategory(docCategory?.id || "")
          .addTag("documentation")
          .addTag("comments")
          .addVariable({
            name: "selectedText",
            description: "The code to document",
            type: "selection",
            required: true,
          })
          .build(),

        new PromptBuilder()
          .setTitle("Create Unit Tests")
          .setContent(
            "Create comprehensive unit tests for this function:\n\n{{selectedText}}\n\nInclude:\n- Happy path tests\n- Edge cases\n- Error scenarios\n- Mock dependencies if needed\n\nUse {{testFramework}} as the testing framework."
          )
          .setDescription("Generate unit tests for functions")
          .setCategory(devCategory?.id || "")
          .addTag("testing")
          .addTag("unit-tests")
          .addVariable({
            name: "selectedText",
            description: "The code to test",
            type: "selection",
            required: true,
          })
          .addVariable({
            name: "testFramework",
            description: "Testing framework to use",
            type: "selection",
            required: false,
            defaultValue: "Jest",
            options: ["Jest", "Mocha", "Jasmine", "Vitest", "Pytest"],
          })
          .build(),
      ];

      for (const prompt of defaultPrompts) {
        await this.savePrompt(prompt);
      }
    }
  }
}
