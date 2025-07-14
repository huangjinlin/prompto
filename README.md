# Prompto - AI Prompt Manager

A smarter way to manage your AI prompts in Cursor, Windsurf and beyond.

Keep your prompts tidy, searchable, and ready to use — all from a clean file-based workflow in VS Code.

## ✨ Features

- **📁 File-based Storage**: Prompts stored as `.md` files in `.prompto` directory
- **🗂️ Flexible Organization**: Create any directory structure you want
- **⚡ Quick Access**: Use `Ctrl+Alt+P` to instantly select and use any prompt
- **📝 Natural Editing**: Edit prompts using editors's markdown editor
- **🔧 Variable Support**: Dynamic variables like `{{selectedText}}`, `{{fileName}}`

## 🚀 Quick Start

### 1. Create Your First Prompt

1. **Press `Ctrl+Alt+P`** → "No prompts found" message appears
2. **Command Palette** → `Prompto: Add New Prompt`
3. **Enter prompt name** → File opens for editing
4. **Write your prompt** and **save** (Ctrl+S)

### 2. Use a Prompt

1. **Press `Ctrl+Alt+P`** → Prompt picker appears
2. **Select a prompt** → Content is copied to clipboard
3. **Paste and use** your prompt in the chat

## 📁 File Structure

Your prompts are organized in the `.prompto` directory, e.g.:

```
.prompto/
├── code-review.md
└── react/
    └── new-react-component.md
    └── react-component-quality.md
```

## 📝 Commands

### Essential Commands

- **`Prompto: Use Prompt`** (`Ctrl+Alt+P`) - Quick picker to select and use any prompt
- **`Prompto: Add New Prompt`** - Create a new prompt file

## 🔧 Prompt Format

Each prompt is a simple markdown file:

```markdown
# My Prompt Name

Your prompt content goes here...

Use {{selectedText}} to include selected code.
Use {{fileName}} to include the current file name.
Use {{customVariable}} for user input.

<!-- Instructions (ignored when using):
- Write naturally in multiple lines
- Use variables for dynamic content
- Save when finished
-->
```

## 💡 Variables

Prompto supports dynamic variables:

- **`{{selectedText}}`** - Currently selected text in editor
- **`{{fileName}}`** - Name of the current file
- **`{{customVariable}}`** - Prompts for user input

**Example:**

```markdown
# Code Review

Review this {{fileName}} file:

{{selectedText}}

Focus on {{codeAspect}} aspects.
```

When used, you'll be prompted to enter a value for `{{codeAspect}}`.

## 🎯 Example Prompts

### Code Review

```markdown
# Code Review

Please review this code for best practices:

{{selectedText}}

Focus on:

- Performance optimizations
- Security considerations
- Code readability
```

### Create Component

```markdown
# Create React Component

Create a {{componentType}} component:

{{selectedText}}

Requirements:

- TypeScript
- Proper props
- Accessibility
```

## 📋 Workflow

1. **Organize**: Create directories like `frontend/`, `backend/`, `docs/`
2. **Create**: Add prompts as `.md` files in appropriate folders
3. **Use**: Press `Ctrl+Alt+P` to quickly find and use any prompt

## ⚙️ Tips

- **File names** become prompt names (without `.md`)
- **Directory structure** is reflected in the sidebar tree
- **Edit directly** - you can modify `.md` files in editor normally
- **Version control** - commit your `.prompto` directory to share with team
- **Backup** - your prompts are just files, easy to backup/sync

## 📄 License

[WTFPL](https://opensource.org/licenses/MIT)
