# Prompto - AI Prompt Manager

A smarter way to manage your AI prompts in Cursor (or any AI solution for VS Code).

Keep your prompts tidy, searchable, and ready to use — all from a clean file-based workflow.

## ✨ Features

- **📁 File-based Storage**: Prompts stored as `.md` files in the configured prompt directory
- **🗂️ Flexible Organization**: Create any directory structure you want
- **⚡ Quick Access**: Use `Ctrl+Alt+P` to instantly select and use any prompt in your configured chat target
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
2. **Select a prompt** → Content is delivered to your configured chat target
3. **Review and send** your prompt when ready

## 📁 File Structure

Your prompts are organized in the configured prompt directory. By default this is `.prompto`, e.g.:

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
- **`Prompto: Prefill Active Terminal`** - Paste the selected prompt into the current terminal without sending it
- **`Prompto: Add New Prompt`** - Create a new prompt file

## ⚙️ Settings

- **`prompto.outputMode`** - Controls what happens after selecting a prompt:
    - `chatPrefill` (default) - fill the prompt into the configured chat target without sending it
    - `chatSubmit` - fill and send the prompt immediately
    - `clipboard` - copy the prompt to the clipboard
- **`prompto.deliveryTarget`** - Chooses where prompts are delivered:
    - `githubCopilotChat` (default) - deliver to GitHub Copilot Chat
    - `continue` - deliver to Continue through the Prompto control command in your Continue fork
    - `claudeCode` - paste the prompt into the active terminal, intended for Claude Code
- **`prompto.continueSessionId`** - Optional Continue session ID to focus before delivery. Leave empty to use the current Continue session. This takes priority over `prompto.continueSessionTitle`.
- **`prompto.continueSessionTitle`** - Optional Continue session title to resolve before delivery. Used only when `prompto.continueSessionId` is empty, and it must match exactly one Continue session title.
- **`prompto.promptsDirectory`** - Workspace-relative folder where prompt markdown files are stored. Defaults to `.prompto`.

## 🔧 Prompt Format

Each prompt is a simple markdown file:

```markdown
# My Prompt Name

<!-- prompto
deliveryTarget: continue
continueSessionTitle: My Continue Session
-->

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

When prompt metadata includes `deliveryTarget`, it overrides the workspace-level `prompto.deliveryTarget` for that prompt. When the resolved target is `continue`, prompt metadata can also override workspace-level Continue targeting for that prompt. `continueSessionId` takes precedence over `continueSessionTitle`.

Markdown prompt blocks can either reference a saved prompt file with `prompt`, or define prompt text inline with `promptContent`:

```markdown
## Review This Snippet

<!-- prompto
deliveryTarget: claudeCode
promptContent: |
    Review the selected content and report:
    1. Risks
    2. Suggested fixes
    3. Merge recommendation

    Content:
    {{selectedText}}
-->

Paste or write the content to review here.
```

Use either `prompt` or `promptContent` in a markdown block, but not both. The block body still becomes `{{selectedText}}`.

Markdown files can also define explicit inline actions in the body with `prompto-action`:

```markdown
<!-- prompto-action
title: Summarize This Section
promptContent: |
    Summarize the current context and report:
    1. Key points
    2. Risks
    3. Next steps
deliveryTarget: claudeCode
-->

This paragraph is only the action anchor for CodeLens display.
```

`prompto-action` is separate from heading-based prompt blocks. It does not provide `{{selectedText}}`, does not inherit outer block routing, and requires its own explicit metadata.

## 💡 Variables

Prompto supports dynamic variables:

- **`{{selectedText}}`** - Currently selected text in editor
- **`{{fileName}}`** - Name of the current file
- **`{{customVariable}}`** - Prompts for user input

When using `{{customVariable}}`, you can also define values inside the selected text and avoid the input box:

```text
---
codeAspect: performance
audience: senior engineers
---
function under review goes here
```

In this mode:

- the header block provides values for matching `{{customVariable}}` placeholders
- the remaining body becomes `{{selectedText}}`
- any custom variable not provided in the header still falls back to the input box

You can also select the prompt file directly from the same header block when triggering **Prompto: Use Prompt**:

```text
---
prompt: review/code-review
codeAspect: performance
---
function under review goes here
```

In this mode:

- `prompt` is resolved relative to your configured prompt directory
- the `.md` extension is optional
- if `prompt` is omitted, Prompto still opens the picker as before

## 🧩 Executable Markdown Blocks

You can turn a markdown section into a clickable Prompto block by combining a heading with a `prompto` metadata comment.

```markdown
## Review This Function
<!-- prompto
prompt: review/code-review
codeAspect: performance
-->

function under review goes here
```

In this mode:

- Prompto shows a CodeLens action above the heading
- clicking the action runs the block without manually selecting text
- the section body becomes `{{selectedText}}`
- metadata values are available to matching `{{customVariable}}` placeholders
- the block ends at the next heading of the same or higher level
- lower-level headings remain part of the block body

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
- **Version control** - commit your configured prompt directory to share with team
- **Backup** - your prompts are just files, easy to backup/sync

## 📄 License

[WTFPL](https://opensource.org/licenses/MIT)
