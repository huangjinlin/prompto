export interface Prompt {
  id: string;
  title: string;
  content: string;
  description?: string;
  categoryId?: string;
  tags: string[];
  variables: PromptVariable[];
  isActive: boolean;
  isFavorite: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastUsed?: Date;
  useCount: number;
  author?: string;
  version?: string;
}

export interface PromptVariable {
  name: string;
  description?: string;
  defaultValue?: string;
  type:
    | "text"
    | "number"
    | "boolean"
    | "date"
    | "selection"
    | "file"
    | "context";
  required: boolean;
  options?: string[]; // For selection type
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  parentId?: string;
  color?: string;
  icon?: string;
  isExpanded: boolean;
  createdAt: Date;
  updatedAt: Date;
  sortOrder: number;
}

export interface PromptCollection {
  prompts: Prompt[];
  categories: Category[];
  version: string;
  exportedAt: Date;
}

export class PromptBuilder {
  private prompt: Partial<Prompt>;

  constructor() {
    this.prompt = {
      id: this.generateId(),
      title: "",
      content: "",
      tags: [],
      variables: [],
      isActive: true,
      isFavorite: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      useCount: 0,
    };
  }

  setTitle(title: string): PromptBuilder {
    this.prompt.title = title;
    return this;
  }

  setContent(content: string): PromptBuilder {
    this.prompt.content = content;
    return this;
  }

  setDescription(description: string): PromptBuilder {
    this.prompt.description = description;
    return this;
  }

  setCategory(categoryId: string): PromptBuilder {
    this.prompt.categoryId = categoryId;
    return this;
  }

  addTag(tag: string): PromptBuilder {
    this.prompt.tags = [...(this.prompt.tags || []), tag];
    return this;
  }

  addVariable(variable: PromptVariable): PromptBuilder {
    this.prompt.variables = [...(this.prompt.variables || []), variable];
    return this;
  }

  setFavorite(isFavorite: boolean): PromptBuilder {
    this.prompt.isFavorite = isFavorite;
    return this;
  }

  build(): Prompt {
    if (!this.prompt.title || !this.prompt.content) {
      throw new Error("Title and content are required");
    }

    return {
      ...this.prompt,
      updatedAt: new Date(),
    } as Prompt;
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}

export class CategoryBuilder {
  private category: Partial<Category>;

  constructor() {
    this.category = {
      id: this.generateId(),
      name: "",
      isExpanded: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      sortOrder: 0,
    };
  }

  setName(name: string): CategoryBuilder {
    this.category.name = name;
    return this;
  }

  setDescription(description: string): CategoryBuilder {
    this.category.description = description;
    return this;
  }

  setParent(parentId: string): CategoryBuilder {
    this.category.parentId = parentId;
    return this;
  }

  setColor(color: string): CategoryBuilder {
    this.category.color = color;
    return this;
  }

  setIcon(icon: string): CategoryBuilder {
    this.category.icon = icon;
    return this;
  }

  setSortOrder(sortOrder: number): CategoryBuilder {
    this.category.sortOrder = sortOrder;
    return this;
  }

  build(): Category {
    if (!this.category.name) {
      throw new Error("Category name is required");
    }

    return {
      ...this.category,
      updatedAt: new Date(),
    } as Category;
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
}
