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

### Send Selected Markdown With File Paths

Select Markdown text and use `Ctrl+Enter` (`Cmd+Enter` on macOS) to send it, or `Alt+Enter` to prefill the configured chat target. The editor context menu provides the same commands.

To copy instead, press `Shift+Enter` or use **Prompto: 复制选中内容（解析路径模板）** from the editor context menu or Command Palette. It resolves the same path templates and writes the result to the clipboard without opening Chat or a terminal, regardless of `prompto.deliveryTarget`. Success is shown briefly in the status bar; invalid templates leave the clipboard unchanged. `Alt+Enter` and `Shift+Enter` also apply on macOS. Without a selection, these shortcuts are active only inside an explicitly enabled executable section (see below). `Ctrl+C` is unchanged. You can customize `prompto.copySelectionToClipboard` in Keyboard Shortcuts.

Use `{{path:relative/path}}` to resolve a path relative to the selected text's source file directory:

```markdown
Refer to `{{path:../data/data.json}}` for the response format.
```

For a source file at `D:/project/docs/task.md`, this sends:

```markdown
Refer to `D:/project/data/data.json` for the response format.
```

Use a single leading `/` to resolve from the source document's workspace folder instead:

```markdown
Refer to `{{path: /test/notes/task.md}}`.
```

With workspace root `D:/project`, this produces `D:/project/test/notes/task.md`, regardless of the source document's directory. In multi-root workspaces, the folder containing the source document is used, not the first workspace folder. This is a workspace-root convention, not a POSIX absolute path.

- Multiple templates, spaces, and non-ASCII file names are supported. Output paths use `/` separators.
- Windows drive paths such as `D:/data/file.json` and UNC paths such as `//server/share/file.json` retain their absolute-path behavior.
- `./`, `../`, and paths without a leading slash remain relative to the saved source file's directory.
- `/...` requires a saved document inside a workspace folder. Missing workspace context or paths escaping that folder (such as `/../outside.json`) stop delivery with an error. `/` alone resolves to the workspace root.
- Files do not have to exist. Templates produce path text, not file attachments, and do not modify the source document.
- Empty, unclosed, nested, multiline, or URL path templates stop delivery with an error. Home directory shortcuts and drive-relative paths are also rejected.
- Environment variables are not expanded. Ordinary backtick paths remain unchanged; named variables are resolved separately as described below.
- Path templates apply to selection and executable-section commands, including section CodeLens, but not inline `promptContent` CodeLens, Flow, or saved prompt execution.

### Execute Markdown Sections Without Selecting Text

Opt in once at the top of a Markdown document:

```markdown
<!-- md-meta
scope: document
prompto:
    sectionLevels: [1]
    vars:
        taskName: Login page
-->

# Implement
Please implement {{taskName}}.

## Requirements
Include loading and error states.

# Review
Please review {{taskName}}.
```

- Each enabled heading displays **发送到聊天**, **预填到聊天**, and **复制** CodeLens actions. Click once to deliver that section, even if a different editor has focus or text is selected elsewhere.
- With no selection, put the cursor anywhere inside a section and press `Ctrl+Enter` to send, `Alt+Enter` to prefill, or `Shift+Enter` to copy. On macOS, use `Cmd+Enter` to send. Existing selections always take priority over cursor-based section execution.
- Content starts below the heading and ends before the next heading of the same or higher level, or at the end of the document. Subheadings remain part of the content. The section title and actual `md-meta` blocks are not delivered; metadata examples inside fenced code remain literal content.
- `[1]` enables only top-level tasks. `[1, 2]` enables both levels; cursor execution uses the nearest enabled section. Integers 1-6 are supported, including YAML block lists. An omitted or empty `sectionLevels` disables this feature. Only document-level `prompto.sectionLevels` is used, not `defaults` or shared context settings.
- Headings inside fenced code or HTML comments do not create section boundaries. A heading with its own inline `promptContent` keeps its existing Run Prompto entry rather than receiving duplicate section actions.
- Sections reuse the selection rendering pipeline: current unsaved document content, document variables, shared context, conditions, string functions, and path templates. The clicked action or shortcut determines output mode; document delivery settings override workspace defaults for this execution only. No source text is rewritten.
- Empty sections, cancelled input, invalid templates, and missing context stop delivery without replacing the clipboard or sending partial content. Outside an enabled section, unselected shortcuts retain their normal editor behavior.

### Deliver to an Existing Copilot Session

Named-session delivery uses `agent-desktop` locally, without another model or API key. It uses the existing Copilot session and its normal usage. The first implementation targets local Windows VS Code with the tested Chinese Copilot UI; remote extension hosts and other platforms are not supported.

Install `agent-desktop` globally (`npm install -g agent-desktop`) and enable screen reader support in **user settings** yourself. Desktop delivery is enabled by default; an explicit user setting `prompto.desktop.enabled: false` disables it:

```json
{
    "prompto.desktop.enabled": true,
    "editor.accessibilitySupport": "on"
}
```

Prompto never changes screen reader settings. It first observes the current chat title without interacting with the desktop. If the exact requested title is already active, it uses the existing `workbench.action.chat.open` API for prefill/submit, without selecting sessions, opening lists, focusing input, or simulating typing. Title confirmation still requires a read-only agent-desktop observation; no public current-Copilot-title API is assumed. Desktop-operation authorization is requested only when an actual switch/input is needed, once per target application per extension-host run. If automatic executable discovery fails, set `prompto.desktop.executablePath` to the absolute native `.exe` under the installed package's `bin` directory, not its `.cmd` or `.ps1` wrapper. Native launching was checked with agent-desktop 1.2.0.

Add an exact existing session title to the source document:

```markdown
<!-- md-meta
scope: document
prompto:
        deliveryTarget: githubCopilotChat
        chatSession:
                title: 测试切换会话
        sectionLevels: [1]
-->

# Task
Please review this task.
```

- `chatSession` is document-only; node/action configuration, `defaults.prompto.chatSession`, blank titles, templates, multiline titles, and unknown session fields are rejected. Selection, section, prompt-file, and inline node/action execution pass the source document session through the delivery pipeline. Node/action output modes and targets retain their override priority. Copilot accepts only `title`; Qoder requires `workspace` and `title`. An incompatible target override is rejected before desktop operations; Claude Code does not support named sessions.
- No `chatSession` preserves the existing Copilot/Claude Code delivery path; Qoder requires explicit addressing and never falls back to the active chat. Copy always bypasses desktop operations. An already-active Copilot exact title goes through the VS Code API with `isPartialQuery` selecting prefill vs submit; API completion is reported separately from independently verified desktop delivery. Other sessions use desktop selection/input and retain draft and new-user-message verification.
- Keep one matching workspace window restored and focused. For a different active title, Prompto clicks the **left back arrow beside the title** (observed as `返回 (Ctrl+N)`) to open the main session list, not the right sidebar toggle. It allows up to three fresh observations for rendering and verifies that the title picker has disappeared before selecting the unique requested row. Already on the main list means no back click. Sidebar visibility is left untouched; failed navigation/lookup does not retry the arrow or fall back to sidebar toggling. Prompto does not create sessions, search unloaded history, or pick a different window/chat on failure.
- Any existing draft, including whitespace, is replaced: focus the chat input, select all existing text, type the rendered prompt, and verify the entire new draft before submission. This deliberately discards the old draft. An in-progress response still blocks delivery. Prompto never clears uncertain content or automatically retries. A repeated request while desktop delivery is busy is rejected rather than queued across both applications.
- Native desktop input is limited to **10,000 UTF-8 bytes**, checked before desktop actions; the already-active-session VS Code API path does not use this stdin limit. Larger native input is rejected, not truncated or split. Desktop text travels over standard input, not a Shell command. After typing, the complete draft must match the rendered text before submission.
- Copilot and Qoder desktop input share a multiline plan: each text line is typed through stdin, with an explicit `Shift+Enter` for every line break instead of embedding LF in a `type` call. Leading, consecutive and trailing line breaks and indentation are preserved; only CRLF/CR is normalized to LF. Every prefix is read back exactly, and a failed line break or changed focus stops delivery without sending or retrying. More lines require more CLI calls and observations. The already-active Copilot VS Code API path remains unchanged.
- During execution, the status bar shows a spinning Prompto indicator, the current stage, and elapsed seconds. Hover to see the target session and most recent CLI command duration. The indicator and refresh timer are removed on completion, failure, or authorization cancellation.
- Desktop delivery is sequential: each CLI call launches a native process, and accessibility snapshots traverse the UI tree. The first observation is window-wide; subsequent reads use a fresh chat-container reference only when one is actually available, with a read-only full-window fallback if it becomes stale. Noninteractive chat containers may have no reference and require full-window reads. Already-active targets need just one title observation before API delivery. Final session, focus, draft, and new-message checks remain intact for the native path. Smaller call counts are tested, but end-to-end speedup still needs live acceptance measurements.
- Verified desktop success, API dispatch completion, definitely undelivered, and uncertain results have separate handling. API dispatch completion does not claim independently observed message receipt. Uncertain results require manual inspection; failures never automatically retry the API, transfer to another chat/input mechanism, or copy to the clipboard. Prompto does not log raw snapshots or message bodies.
- Automated tests cover multiline Chinese, Unicode, and delivery guards through a simulated CLI. The original short-text desktop flow was verified interactively; the integrated extension's multiline/long-text prefill and send still require live acceptance testing. Reload the updated extension in an Extension Development Host or package/install the updated VSIX before testing.

### Deliver to an Existing Qoder Task

Qoder CN uses the same local Windows `agent-desktop` execution and safety flow, with its own task adapter. Keep exactly one Qoder CN window restored and visible, and expand the target workspace so the task link is visible. It may initially be in the background when delivery is triggered from VS Code. After explicit authorization, Prompto focuses the target input once and independently verifies that the same Qoder window is now foreground before editing. Failed focus, ambiguity or later focus loss stops delivery without automatic refocusing. Minimized windows must be restored manually. The tested process is `Qoder CN.exe`, not its launcher. No additional model or API key is required, and Prompto does not alter Qoder settings.

```markdown
<!-- md-meta
scope: document
prompto:
    deliveryTarget: qoder
    outputMode: chatPrefill
    chatSession:
        workspace: 数据服务
        title: 很高兴认识你
    sectionLevels: [1]
-->

# Test
请只回复：收到。不要修改文件或执行命令。
```

- `workspace` is the exact workspace name inside Qoder, not the VS Code source workspace. Both it and `title` must be non-empty single-line literals. The task must already exist. Missing, duplicate or invisible targets stop delivery; visible duplicate titles across workspaces are conservatively rejected because a title alone cannot prove active workspace identity.
- The adapter clicks a task link at most once and independently checks the active task menu inside the conversation region. It does not confuse the sidebar's identically named menu with the active task. Multiple Qoder windows, collapsed/unloaded task lists and ambiguous identities are not automatically resolved.
- Even an already-active Qoder task uses desktop input, never the VS Code chat API. In the tested Qoder UI, inserting a whole multiline string dropped LF characters. The adapter instead types each line through UTF-8 stdin and inserts explicit `Shift+Enter` line breaks, verifying every prefix and the complete draft. Leading, blank and trailing lines are preserved; only CRLF/CR normalization to LF is allowed. The total prompt limit remains 10,000 UTF-8 bytes, not a per-line allowance. More lines require more CLI calls and observations.
- `chatPrefill` leaves the verified draft without sending. `chatSubmit` performs a final target, focus and draft check, clicks the send button once, and verifies a new exact user message plus an empty input. Draft text and AI echoes do not count as user messages. If user-message attribution or count changes cannot be proved, the result is uncertain, not success; Prompto never resends. An AI acknowledgement is not required for production success.
- Authorization is separate from Copilot and includes bringing Qoder to the foreground. Before authorization there are only read-only observations, never task clicks or input focus. Copy bypasses all desktop operations. The status bar identifies the target application/workspace/session and reports stage and elapsed time without logging draft text.
- Live CLI prototypes verified same-workspace cross-task navigation, nonempty draft replacement, exact multiline readback, one submission and a short response. Automated tests validate the integrated adapter. Reload or install the updated extension before live integration acceptance; this implementation does not claim cross-workspace navigation or all Qoder versions/locales have been tested.

Desktop delivery code is separated into `DesktopDriver` (native CLI/types), `DesktopChatDeliveryService` (shared guarded workflow), and `CopilotDesktopAdapter` / `QoderDesktopAdapter` (application-specific window, navigation, input and message identification). `PromptDeliveryService` owns routing, authorization, concurrency and VS Code status UI. Existing Copilot session metadata and the active-terminal Claude Code path remain compatible.

### Document Variables for Selected Text

Define reusable string values once at the top of a Markdown document:

```markdown
<!-- md-meta
scope: document
prompto:
    vars:
        projectName: Customer Portal
        taskName: Login page
-->

# Start
Please implement {{taskName}} for {{projectName}}.

# Review
Please review {{taskName}} for {{projectName}}.
```

Select only the desired body text, then send, prefill, or copy using the existing shortcuts. Definitions do not need to be selected. Changing a value updates subsequent deliveries throughout this document, including unsaved edits; the source text is never rewritten.

- Use one document-level block with explicit `scope: document`. Node/action variables and `defaults` are not inherited by selection commands.
- Names use letters, digits, and underscores, starting with a letter or underscore. Values must be string leaves or nested mappings; invalid leaves are reported instead of silently ignored. Quote numbers and booleans, and use `""` for an empty string. Multiline strings use YAML `|`.
- Each undefined name prompts once per delivery. The answer is temporary; cancelling stops delivery without changing the clipboard or opening Chat.
- `selectedText` and `fileName` are reserved built-ins and cannot be redefined. They represent the selected text and source file name.
- Replacement is single-pass: variable values are literal text, not recursively evaluated templates. Path templates in the original selection are resolved before named variables.
- Document variables are local to the current document, not shared across workspaces. Selection and executable-section rendering do not change saved-prompt, inline `promptContent` CodeLens, or Flow execution.

### Nested Variable Namespaces

Use nested definitions to separate similarly named module and task fields:

```markdown
<!-- md-meta
scope: document
prompto:
    vars:
        module:
            name: quality
            type: cline
        task:
            name: Sample query
            type: design
        moduleName: legacy flat variable
-->

Module: {{module.name}} / {{module.type}}
Task: {{task.name}}
{{upper module.name}}
{{#if (eq task.type "design")}}Analyze requirements first.{{/if}}
```

- Define nested mappings, then reference string leaves with dots. Do not write dotted definition keys such as `module.name: quality`. Existing flat variables remain valid and are not automatically renamed.
- Every path segment follows the variable-name rules. Arrays, empty groups, nulls, and numeric/boolean leaves are rejected; quote numbers and booleans as before.
- `__proto__`, `prototype`, and `constructor` are forbidden path segments. Built-in roots `selectedText` and `fileName` cannot be redefined or accessed as groups.
- Shared and local definitions are flattened into a controlled variable table. Local overrides replace matching leaves only: overriding `module.type` preserves shared `module.name`. Empty string overrides remain valid.
- A path cannot be both a string and a group across sources. For example, shared `module: quality` conflicts with local `module: {nested fields}` and stops delivery.
- Groups themselves are not string values: reference `module.name`, not `module`. String properties such as `module.name.length` and array indices are not supported. Missing leaf references prompt with their full dotted names and share the existing per-delivery cache.
- Dotted references apply to selected text, conditions, and string functions. Results stay literal and non-recursive. No JavaScript object/property traversal is performed.

### Comments Inside md-meta

Use YAML `#` comments inside the existing HTML metadata block:

```markdown
<!-- md-meta
scope: document # document-level settings
prompto:
    vars:
        # Current module
        moduleName: quality # used in generated names
        # taskName: temporarily disabled
        message: "hello # world" # the quoted hash is literal
        tag: quality#v1 # no whitespace before the first hash
        instructions: | # comment on the block header
            # This line is literal string content.
            Please analyze the requirements.
-->
```

- A line whose first non-whitespace character is `#` is ignored. Outside quotes, `#` starts a trailing comment only at the start of a line or after whitespace.
- Hashes inside single/double quotes, or without preceding whitespace in plain values, remain part of the value. Escaped double quotes and doubled single quotes do not terminate comment protection.
- Indented multiline string bodies are literal: their `#` characters and comment-looking lines are preserved. Comments outside the body are ignored.
- Rules apply to document metadata and shared contexts, including mappings and arrays. Comments do not change types: quote numeric and boolean variable values as before.
- Commenting out a local variable removes only that definition. A shared value with the same name becomes effective; otherwise an existing text reference still prompts for a missing value.
- To disable an entire configuration branch, comment out both its parent and child lines. Do not nest HTML comments inside `md-meta`.

### Shared Context Variables

Keep reusable values in a Markdown context file, for example `.prompto/contexts/quality.md`. Its first non-empty line must open a document-scoped `md-meta` block:

```markdown
<!-- md-meta
scope: document
prompto:
    vars:
        moduleName: quality
        phase: design
-->
```

Reference it from each consuming document and optionally override values locally:

```markdown
<!-- md-meta
scope: document
prompto:
    context: /.prompto/contexts/quality.md
    vars:
        taskName: Sample query
-->

Please handle {{moduleName}} / {{taskName}} in phase {{phase}}.
```

| Context reference | Base directory |
| --- | --- |
| `/.prompto/contexts/quality.md` | Source document's workspace folder |
| `./quality.md` | Source document's directory |
| `../contexts/quality.md` | Source document's directory, moving up one level |

- Contexts apply to selection send, prefill, and copy. Local `vars` override shared values by full leaf path, including intentional empty strings, without discarding sibling fields. String/group structure conflicts stop delivery. Built-ins cannot be overridden in either source.
- The source document must be saved. `/...` additionally requires workspace membership and cannot escape that workspace; `./` and `../` also work for saved documents outside a workspace. References are literal file paths, not variable templates.
- Every delivery reads the latest context document through VS Code, including unsaved edits in open files. Nothing is copied back into consuming documents, and already delivered text does not change.
- A context requires `scope: document`, a valid `prompto.vars` mapping, and string values. Quote numbers and booleans. Missing files, invalid metadata, or reserved names stop delivery with a context-specific error, not a variable input prompt.
- Each document references at most one context. Shared contexts cannot reference other contexts; only their variables are loaded, not prompt routing, body text, or defaults.
- `phase` is an ordinary shared variable usable in existing conditions. Change it manually to affect all consumers; sending does not automatically advance it. Separate tasks with different phases should reference different contexts.
- Saved prompts, CodeLens, and Flow are unchanged.

### Conditional Selected Text

Define `mode: design` in the document's `prompto.vars`, then select a complete conditional block:

```markdown
Please handle {{taskName}}.

{{#if (eq mode "design")}}
Analyze requirements and compare approaches. Do not edit code yet.
{{else}}
Implement the agreed approach and run the relevant tests.
{{/if}}
```

- `eq` (equal) and `ne` (not equal) compare a named string leaf to a quoted string, exactly and case-sensitively. For flags, use `(eq enabled "true")`; bare truthiness checks are not supported.
- `and` requires every operand to be true; `or` requires at least one. Each accepts two or more condition expressions, with combinations limited to eight expression levels. Evaluation is left-to-right and short-circuiting: skipped operands never request missing values. Cancelling an evaluated operand still aborts delivery.
- `else` is optional, and nested `if` blocks are supported. Standalone control lines are removed from the output.
- Only the selected branch resolves its nested conditions, paths, and text variables. Unselected branches never prompt for missing values or fail on invalid paths.
- Missing condition variables prompt once per delivery, sharing the same temporary value with text references. Cancelling stops delivery.
- Keep opening and closing directives together in the selection. Malformed or unsupported syntax stops delivery before prompting. Selecting just branch body text processes it normally.
- The supported subset is `{{name}}` (including dotted leaf paths), existing `{{path:...}}`, `if` with `eq`/`ne` comparisons and `and`/`or` combinations, and the string functions below. Loops, partials, arbitrary property access, triple braces, and other helpers or expressions are rejected. All expressions are syntax-checked before prompting, even in skipped branches or operands.
- Values are inserted literally, without HTML escaping or recursive template execution. Evaluation order is conditions, retained source paths, then text variables. Empty results are not delivered.
- Conditions apply to selection send, prefill, and copy only; saved prompts, CodeLens, and Flow are unchanged.

Examples:

```markdown
{{#if (ne defaultQueryKey "")}}
Query key: {{defaultQueryKey}}
{{/if}}

{{#if (and (ne defaultQueryKey "") (eq task.type "design"))}}
Both conditions match.
{{/if}}

{{#if (or (eq task.type "design") (eq task.type "review"))}}
Either condition matches.
{{/if}}
```

### String Functions for Selected Text

With document variable `var1: hello word`:

| Template | Output |
| --- | --- |
| `{{slice var1 6}}` | `word` |
| `{{slice var1 0 5}}` | `hello` |
| `{{slice var1 -4}}` | `word` |
| `{{upper var1}}` | `HELLO WORD` |
| `{{lower var1}}` | `hello word` |
| `{{upper (slice var1 6)}}` | `WORD` |

`{{trim var1}}` removes leading and trailing whitespace, preserving internal spaces. Functions do not change the document's variable definitions.

- The first argument must be a named string leaf (including dotted paths such as `module.name` and built-ins) or another supported string function. Compositions are limited to eight function levels.
- `slice` requires a start index and accepts an optional exclusive end index. Indices must be safe integer literals, not quoted strings, booleans, decimal fractions, or variables. Negative indices, clamping, and UTF-16 indexing follow JavaScript `String.slice` semantics.
- Functions execute only in retained condition branches, after source paths have been resolved. Missing variables use the existing temporary input prompt and are shared with conditions and plain references; cancelling aborts delivery.
- Function results are inserted as literal Markdown, without HTML escaping or recursive template/path processing. Empty final results are not delivered.
- Unknown functions and invalid arguments stop delivery before prompting, including invalid syntax in inactive branches. JavaScript method syntax such as `{{var1.substr(6)}}` is not supported.
- String functions are output expressions only; conditions use `eq`/`ne` with optional `and`/`or` combinations, not string-function calls or arbitrary expressions. Send, prefill, and copy are supported; saved prompts, CodeLens, and Flow are unchanged.

## ⚙️ Settings

- **`prompto.outputMode`** - Controls what happens after selecting a prompt:
    - `chatPrefill` (default) - fill the prompt into the configured chat target without sending it
    - `chatSubmit` - fill and send the prompt immediately
    - `clipboard` - copy the prompt to the clipboard
- **`prompto.deliveryTarget`** - Chooses where prompts are delivered:
    - `githubCopilotChat` (default) - deliver to GitHub Copilot Chat
    - `qoder` - deliver to an existing Qoder CN task using document `chatSession.workspace` and `chatSession.title`
    - `claudeCode` - paste the prompt into the active terminal, intended for Claude Code
- **`prompto.promptsDirectory`** - Workspace-relative folder where prompt markdown files are stored. Defaults to `.prompto`.
- **`prompto.desktop.enabled`** - User/machine setting, default `true`. Set to `false` to disable named-session desktop delivery; first use still asks permission for focus and draft replacement.
- **`prompto.desktop.executablePath`** - Optional absolute native agent-desktop `.exe` path. Empty uses local PATH/global npm discovery.

## 🔧 Prompt Format

Each prompt is a simple markdown file:

```markdown
# My Prompt Name

<!-- md-meta
version: 1
prompto:
    outputMode: chatSubmit
    deliveryTarget: githubCopilotChat
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

When prompt metadata includes `prompto.outputMode`, it overrides the workspace-level `prompto.outputMode` for that prompt. When prompt metadata includes `prompto.deliveryTarget`, it overrides the workspace-level `prompto.deliveryTarget` for that prompt.

Markdown prompt blocks define prompt text inline with `prompto.promptContent`:

```markdown
## Review This Snippet

<!-- md-meta
version: 1
prompto:
    outputMode: clipboard
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

The block body becomes `{{selectedText}}`. The former `prompto.prompt` file-reference property is no longer supported. Saved prompt files remain available through the prompt picker.

Markdown files can also define explicit inline actions in the body with `scope: action`:

```markdown
<!-- md-meta
version: 1
scope: action
prompto:
    title: Summarize This Section
    outputMode: chatSubmit
    promptContent: |
        Summarize the current context and report:
        1. Key points
        2. Risks
        3. Next steps
    deliveryTarget: claudeCode
-->

This paragraph is only the action anchor for CodeLens display.
```

Action blocks are separate from heading-based prompt blocks. They do not provide `{{selectedText}}`, do not inherit outer block routing, and require their own explicit metadata. Their metadata can override both `outputMode` and `deliveryTarget` for that action only.

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

When triggering **Prompto: Use Prompt**, select the saved prompt manually from the picker. Header variables do not select prompt files.

## 🧩 Executable Markdown Blocks

You can turn a markdown section into a clickable Prompto block by combining a heading with an `md-meta` metadata comment.

```markdown
## Review This Function
<!-- md-meta
version: 1
prompto:
    promptContent: |
        Review this function for risks and suggest fixes:
        {{selectedText}}
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

Only `md-meta` metadata syntax is supported.

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
