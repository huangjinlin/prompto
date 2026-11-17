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

Prompto never changes screen reader settings. It first observes the current chat title without interacting with the desktop. If the exact requested title is already active, it uses the existing `workbench.action.chat.open` API for prefill/submit without selecting sessions or simulating typing. Otherwise, agent-desktop selects the unique requested session and confirms its title and idle state; Prompto then checks the window is still foreground and uses the same API once with the complete rendered prompt. It does not type the prompt line by line after switching. Title confirmation still requires agent-desktop observation; no public current-Copilot-title API is assumed. Copilot skips the first-run confirmation dialog for personal use. If automatic executable discovery fails, set `prompto.desktop.executablePath` to the absolute native `.exe` under the installed package's `bin` directory, not its `.cmd` or `.ps1` wrapper. Native launching was checked with agent-desktop 1.2.0. Qoder uses the independent CDP path documented below and does not require agent-desktop or screen reader support.

If native `status` fails with `private file DACL grants an untrusted principal`, desktop snapshots can fail with `INTERNAL` even when window enumeration succeeds. This is an agent-desktop private state-file permission rejection; Qoder CDP does not access that state. Inspect the agent-desktop state directory ACL and remove only the confirmed untrusted grant, preserving the other permissions and state files. Use a separate administrator terminal only if permission repair requires it, then verify `status` from the normal terminal. Do not run desktop delivery elevated, disable its security checks, or delete its state to work around the error. Prompto identifies this known rejection without exposing arbitrary native error messages or retrying input.

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
- No `chatSession` preserves the existing Copilot/Claude Code delivery path; Qoder requires explicit addressing and never falls back to the active chat. Copy always bypasses application operations. Copilot uses the VS Code API with the entire rendered prompt and `isPartialQuery` selecting prefill vs submit, both for an already-active exact title and after desktop selection confirms the requested title. API completion is reported separately from independently verified delivery. Qoder uses CDP input and receipt checks below.
- Keep one matching workspace window restored and focused. For a different active title, Prompto clicks the **left back arrow beside the title** (observed as `返回 (Ctrl+N)`) to open the main session list, not the right sidebar toggle. It allows up to three fresh observations for rendering and verifies that the title picker has disappeared before selecting the unique requested row. Already on the main list means no back click. Sidebar visibility is left untouched; failed navigation/lookup does not retry the arrow or fall back to sidebar toggling. Prompto does not create sessions, search unloaded history, or pick a different window/chat on failure.
- Copilot passes the complete prompt through the existing chat API, rather than physically replacing the draft line by line. Qoder replaces target drafts through CDP with exact readback. An in-progress response blocks delivery. Prompto never clears uncertain content or automatically retries. A repeated request while delivery is busy is rejected rather than queued across Copilot, Qoder and Lingxi.
- Native desktop input is limited to **10,000 UTF-8 bytes**, checked before native input actions. Larger native input is rejected, not truncated or split. Desktop text travels over standard input, not a Shell command. Copilot's API path does not use this stdin limit, including after switching sessions.
- Copilot sends multiline Chinese text, Markdown headings and paths as one API `query`, preserving the complete rendered string without synthetic newline keys. Qoder uses per-line CDP input and Shift+Enter with fresh draft, focus and target checks; neither path modifies the clipboard. Failed actions stop delivery without automatic retry or transport fallback.
- During execution, the status bar shows a spinning Prompto indicator, the current stage, and elapsed seconds. Hover to see the target session and most recent CLI command duration. The indicator and refresh timer are removed on completion or failure. Neither Copilot nor Qoder asks for first-run modal consent.
- Failures include the application, delivery stage, and last native command name. This diagnostic context does not trigger retries or change delivery status: failures before input remain undelivered, while failures after attempted input or submission still require manual inspection.
- Desktop execution writes structured diagnostics to **Output > Prompto Desktop** (a VS Code log output channel). Keep its log level at Info or more verbose to capture the full sequence. VS Code manages the log files and rotation. Each delivery has a request ID, also included in failure notifications, to correlate stages, command names/durations, error codes, known reason categories, action dispositions, window visibility/focus/identity checks, snapshot completeness, and whether input/submission commands were issued. These flags describe attempted commands, not proof of receipt. Logs do not include prompt/chat/draft/clipboard content, task/workspace names, raw snapshots, command arguments, window IDs, arbitrary native error text, or stack traces. Logging failures do not change delivery outcomes. To report a failure, provide the entries for its request ID; **Developer: Open Logs Folder** locates VS Code's saved logs.
- Desktop delivery is sequential: each CLI call launches a native process, and accessibility snapshots traverse the UI tree. The first observation is window-wide; subsequent reads use a fresh chat-container reference only when one is actually available, with a read-only full-window fallback if it becomes stale. Noninteractive chat containers may have no reference and require full-window reads. Already-active targets need just one title observation before API delivery. Final session, focus, draft, and new-message checks remain intact for the native path. Smaller call counts are tested, but end-to-end speedup still needs live acceptance measurements.
- Verified delivery, API dispatch completion, definitely undelivered, and uncertain results have separate handling. API dispatch completion does not claim independently observed message receipt. Uncertain results require manual inspection; failures never automatically retry the API, transfer to another chat/input mechanism, or use clipboard output as a fallback. Prompto does not log raw snapshots or message bodies.
- Automated tests cover multiline Chinese, Unicode, and delivery guards through a simulated CLI. The original short-text desktop flow was verified interactively; the integrated extension's multiline/long-text prefill and send still require live acceptance testing. Reload the updated extension in an Extension Development Host or package/install the updated VSIX before testing.

### Deliver to an Existing Qoder Task

Qoder CN now uses dedicated local CDP instead of `agent-desktop`, UIA, clipboard paste or the VS Code chat API. Fully exit Qoder, including its tray process, then start the tested `Qoder CN.exe` through a separate shortcut with `--remote-debugging-port=9348 --remote-debugging-address=127.0.0.1`. Starting a normal existing instance again does not reliably apply new debugging arguments. Prompto verifies that exactly one listener is bound only to `127.0.0.1`, that its process executable matches the configured path, and that there is exactly one Qoder application page. It never starts, elevates, restarts or closes Qoder automatically and does not fall back to the old adapter on failure.

Keep one Qoder window visible with the target workspace expanded and the task loaded. Save any target draft you need before triggering delivery. Do not edit, navigate or copy attachments into Qoder concurrently. There is no first-run or idle confirmation dialog; judge that generation and pending requests have finished. CDP input focus is independently checked through the editor's `activeElement`; Prompto does not simulate OS window restoration or activation.

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

- `workspace` is the exact workspace name inside Qoder, not the VS Code source workspace. It and `title` must be nonempty single-line literals. Native DOM inspection proves that the target task belongs to the nearest single-workspace group containing the matching `data-work-directory-name`. A sidebar name and an unrelated heading alone are not sufficient. Missing, duplicate, hidden or unloaded targets stop delivery.
- The task's stable `data-session-id`, its `data-active` marker and the current visible heading identify the target. An inactive task is clicked at most once through its verified sidebar link. Subsequent checks bind that task ID, page URL and executable/PID. Frontend `nodeId` values are refreshed after DOM observations; `backendNodeId` identifies the same editor. No task creation, unloaded-history search, automatic workspace expansion or ambiguous-window selection is performed.
- Both modes replace the target draft, including whitespace, without an overwrite confirmation, after verifying the complete selection by DOM boundaries. An empty draft or a single U+200B placeholder may have a collapsed selection if both text readings confirm emptiness and sending is disabled. The editor must remain connected, editable, visible and active. Every line is entered with `Input.insertText`; every newline, including consecutive or trailing newlines, uses Shift+Enter. Ordinary Enter, direct DOM text mutation, clipboard access, internal editor APIs and whole-string multiline insertion are not used. Only CRLF/CR is normalized to LF. Native DOM snapshots provide the exact logical text, preserve BR line breaks, and exclude only Qoder's explicitly marked, aria-hidden, offset-ignored link-caret and favicon decorations. Snapshot raw text must still equal the protected raw-text reading. For ordinary undecorated text, raw and visible readings must also match; link-layout-only visible newlines are not mistaken for content changes. At most one leading or trailing U+200B editor sentinel is tolerated; arbitrary embedded characters are not stripped. Other differences stop the operation without clearing or retrying. Content with embedded U+200B or unsupported control characters is rejected before connecting. Input remains limited to 10,000 UTF-8 bytes; per-line checks have a 120-second operation deadline and may leave a partial draft if it expires.
- Full executable/PID verification is performed when connecting, binding the target, before clearing, at final readback, and before sending or checking receipts. Per-line checks reuse the bound live connection and current document root instead of launching PowerShell or repeatedly refreshing the entire document. They still verify the page ID/URL, workspace/task, fresh editor handle and backend identity, editability, focus, selection, exact text, and generation controls. A stale document or changed page stops the operation without retrying. Full process checks and document refreshes no longer grow with line count for prefill; input remains per-line with Shift+Enter.
- Visible stop/cancel controls, including disabled transition controls, block input. A send button alone is not proof of idleness. `chatPrefill` reports success only after exact full-text readback and an enabled send button. `chatSubmit` rechecks the full draft and unchanged user-message baseline, then clicks the verified send button once. At most three read-only receipt checks require one new unique `[data-message-kind="user"][data-user-message][data-message-id]`, exact `[data-chat-message-text][data-part-type="text"]` body, and an empty input in the same task. Existing messages, drafts, attachments and AI echoes are not receipts; ambiguous or rich-text-transformed message bodies fail closed. An AI response is not required.
- Failures after attempted keyboard input are `uncertain` because selection, clearing or partial text may already have taken effect. Failures after submission may mean the message was sent. Prompto never resends, automatically clears partial drafts, copies as fallback, switches to UIA or falls back to another chat. The clipboard remains untouched. `clipboard` mode is still an explicit independent copy action.
- Set user-level `prompto.qoder.cdpPort` (default `9348`) for connection identity. Leave `prompto.qoder.executablePath` empty to recognize the running port owner's `Qoder CN.exe` directly inside a version directory under `LOCALAPPDATA/Programs/Qoder CN/.qoder-versions`, without pinning a version or choosing the highest installed version. Each delivery still binds the initial PID and exact executable path; a process or path change stops delivery. A non-empty user setting strictly pins an absolute executable path for custom installations; clear an old value after upgrading to restore automatic detection. Check the CDP shortcut target after upgrading. Workspace settings cannot redirect the connection. Local Windows, trusted-workspace and `prompto.desktop.enabled` checks remain in force. Qoder shares the execution lock, status indicator and content-free `Prompto Desktop` request logs with Copilot and Lingxi.
- The live CDP prototype verified replacing an existing draft with 50 characters, four lines and one blank line on Qoder CN 0.5.12. Automated tests additionally cover workspace ownership, task switching, single-send receipts, stale frontend handles and failure/no-retry behavior. Those tests are not live acceptance of the newly integrated routing, automatic ownership/navigation or real sending. Reload the development extension, start with `chatPrefill` in a dedicated task, and separately accept sending before using it on real tasks. No real send was performed during this implementation.
- CDP is privileged even on loopback. Other local programs may access it; do not expose or forward the port. Disconnecting Prompto does not close CDP. Fully exit Qoder and use its original shortcut when debugging access is no longer needed.

`DesktopDriver`, `DesktopChatDeliveryService` and `CopilotDesktopAdapter` retain the Copilot native observation path. `QoderCdpConnection` / `QoderChatDeliveryService` and `LingxiCdpConnection` / `LingxiChatDeliveryService` own their separate CDP paths. The old Qoder desktop adapter is no longer registered or used by production routing. `PromptDeliveryService` owns routing, concurrency and VS Code status UI. Existing metadata and the active-terminal Claude Code path remain compatible.

### Deliver to an Existing Lingxi Project Task

Lingxi uses a separate local CDP connection, not `agent-desktop`. Start it from a dedicated shortcut with `--remote-debugging-port=9347 --remote-debugging-address=127.0.0.1`. Fully exit an existing normal instance, including the tray, before switching shortcuts. Prompto checks the actual loopback listener and owning executable before connecting; it never starts, restarts, elevates or closes Lingxi.

```markdown
<!-- md-meta
scope: document
prompto:
    deliveryTarget: lingxi
    outputMode: chatPrefill
    chatSession:
        project: 数据服务
        title: 很高兴认识你交流问候
    sectionLevels: [1]
-->

# Test
请只回复：收到。不要修改文件或执行命令。
```

- `project` and `title` are exact single-line literals. Keep the project expanded and the existing task loaded in the sidebar. Duplicate or missing projects/tasks stop delivery; `workspace` is not supported for Lingxi. Project tasks are not the same DOM list as recent tasks.
- `chatPrefill` only fills the input. For a guarded send, change the document/queue mode to `chatSubmit` or use the explicit send command. `clipboard` remains a separate explicit copy action.
- Target drafts, including whitespace and a previous prefill, are replaced by default in both modes. Save any draft you need before delivery. Only the addressed task is edited; a different task's draft is not cleared before navigation. A task switch happens at most once, and the exact project/task activation marker and chat route are independently verified. For a nonempty draft, a fixed DOM function creates a range covering the entire focused editor; a fresh identity/draft/control check and protected full-selection getter must pass before one `Input.insertText` replaces it. Empty drafts skip selection. Prompto does not directly clear DOM text or modify Lexical internals, and never uses Enter or a clipboard paste. `chatSubmit` then invokes the verified send button at most once through a fixed DOM function that checks the current route, project/task, input focus, complete draft and send controls immediately before clicking.
- Enabled stop controls reject delivery. Unknown/request-transition controls also reject. A send button alone is not proof of idleness: judge that the task has finished generating and has no pending request before triggering prefill. There is no idle confirmation dialog. Do not operate Lingxi concurrently. The task, editor, controls, `activeElement` and any replacement selection are freshly checked before input; background CSS `:focus` is not treated as a reliable input identity check. Editor identity uses stable `backendNodeId`, not frontend `nodeId`, which can be reassigned by `DOM.getDocument`. Failed selection stops without input; a replacement that accidentally appends is uncertain and never submitted or retried.
- Prompts are limited to 10,000 UTF-8 bytes, with CRLF/CR normalized to LF. Prefill success requires exact multiline draft readback and an enabled send control. Submit also checks unchanged user-message identities before clicking, then performs at most three fresh read-only observations to verify one new `.message-item--user .claw-user-message` with a new unique `data-groupid`, exact `.item__value` text and an empty input in the same task. Existing messages, drafts and AI echoes are not receipts; an AI acknowledgement is not required, and generation may be active after sending. Missing/duplicate identities, changed history, mismatched text or transport failure produce an uncertain result, never a resend. Any failure after input may leave a draft, and any failure after the send request may mean it was sent. There is no automatic retry or clipboard fallback. Lingxi shares the existing desktop execution lock and `Prompto Desktop` request logs, which omit prompt/draft text, project/task names, raw DOM and session IDs.
- Machine/user settings `prompto.lingxi.cdpPort` (default `9347`) and `prompto.lingxi.executablePath` (default installation under `LOCALAPPDATA`) control discovery. `prompto.desktop.enabled=false` also disables Lingxi. Workspace values cannot override the connection identity settings.
- Loopback limits remote access, not access by other local programs. Disconnecting Prompto does not close the debugging port; exit Lingxi to close it and use the original shortcut for normal startup.
- The user accepted real Markdown prefill in the Extension Development Host after the frontend node-ID fix. Read-only checks verified the live send-button and user-message structure; automated tests cover integrated prefill/submit routing, single-click guards, new-message attribution and failures without resend. The updated extension's real submit and queue entry points still need manual acceptance. No real send was performed while implementing submit. This change does not package or install an extension.

### Queue Execution

Open **Prompto: 显示队列** from the command palette, or open the **队列** view in the existing Prompto activity bar. Use the folder button or **Prompto: 选择队列文件** to add one or more local `.yaml` / `.yml` workflows. Create and save files in your editor first; Prompto does not create them automatically. The sidebar lists each workflow's progress, pause/error state and current item above the selected workflow's details. Duplicate file paths are registered only once. The extension remembers registered URIs, the selected URI and per-workflow pause state; item statuses remain in the original YAML, never a separate state copy. Previous single-file selections are restored into the new list.

Click a workflow to view its details without recreating its executor or dispatching anything. Each workflow keeps its own progress, pause state, messages and validation errors. The close icon removes only the selected workflow from the list and disposes its watcher; it does not delete the YAML or cancel previously dispatched AI work. A busy workflow cannot be removed. You may view another workflow while an operation is running, but competing dispatch is rejected before starting its executor or writing `doing`; no automatic dispatch queue is added. After the first operation finishes, explicitly run the other workflow yourself. Removing and re-adding a file restores progress from its YAML, not from hidden execution history.

This first stage manages multiple workflows with unchanged YAML syntax and the existing prompt-document target/session routing. It does not yet add workflow-level target overrides, conversation ownership, dependencies or automatic advancement. Keep workflows targeting the same conversation from overlapping manually, especially because desktop delivery may replace drafts; separate conversations alone also do not isolate concurrent edits to the same code directory.

The queue view shows items in YAML order, each item's effective output mode and the manually confirmed count. **投放下一项** explicitly delivers the first `await` item once. The check button confirms the current `doing` item as `done` without sending the next item. Pause prevents pending dispatch; resume only unpauses. Already-dispatched messages and AI tasks cannot be cancelled by this pause button. A restored `doing` item is never resent automatically.

Click the file name to open the selected YAML in VS Code. Add, delete, reorder, change context or prepare a redo directly in that file. The sidebar watches editor changes, saves and external file changes automatically; there is no separate data tab or sidebar editor. Unsaved changes and invalid YAML disable delivery and confirmation until corrected and saved. Selecting a file, editing, saving and refreshing never dispatch tasks. Status updates still check the original document version and text, and reject concurrent or unsaved changes rather than overwriting them.

```yaml
outputMode: chatPrefill
items:
    - id: check-a
        prompt: ./prompts.md
        section: Check data
        context: ./a/readme.md
        status: done
    - id: check-b
        prompt: ./prompts.md
        section: Check data
        context: ./b/readme.md
        outputMode: chatSubmit
        status: await
```

- `items` is a list with unique, non-empty string IDs. Each item requires `prompt`, `section`, `context` and `status`; paths and section names must be non-empty single-line strings. Rendering requires a saved local queue file and reads the latest prompt/context document buffers through VS Code. Missing files, invalid context metadata, empty content and section lookup errors stop rendering.
- `await` means pending, `doing` identifies the current manually managed item, and `done` means manually confirmed completion, not independently verified AI success. At most one item may be `doing`. Editing these values does not execute or undo any task.
- Optional `outputMode` can be set on each item or at the queue root: item value takes priority, then the queue default, then `chatPrefill`. Supported values are `chatPrefill` (fill without submitting), `chatSubmit` (submit) and `clipboard` (copy). Queue defaults still override the prompt document's output mode; delivery target/session still come from that document. Unknown fields, duplicate YAML keys, invalid values and aliases are rejected.
- Status updates locate an item by ID, including after reordering, and change only the status scalar. Other source bytes, comments, quoting and line endings are preserved. Changing `done` to `await` can prepare an item for a later explicit redo without changing other items.
- File updates reject stale document versions and unsaved editor changes. Rejected edits, save failures or concurrent changes stop the operation rather than overwriting or retrying. The queue file is the data source; no second queue is stored in extension global state.
- Queue `prompt` and `context` references are literal file paths, relative to the queue file's directory unless absolute. URLs, drive-relative paths, home shortcuts and template expressions are rejected. Body `{{path:...}}` expressions retain the existing prompt-file-relative behavior; leading `/` expressions use the workspace containing the prompt, not the queue directory.
- `section` must match exactly one enabled Markdown section by title, using the existing document `prompto.sectionLevels`. Headings inside code fences are ignored; nested headings remain in the selected section. No new heading buttons are added.
- The queue item's context overrides the prompt document's `context` only for this render, including when the prompt has no context field. The original prompt is not rewritten. Existing local `vars` still override shared context values; variables do not leak between items. Missing variables use the existing input callback, and cancellation returns without changing any status.
- Rendering produces the final text and the prompt document's delivery target/session metadata, with the item's effective output mode taking priority. Variable values remain literal, with no recursive template or path evaluation. Execution reuses the existing delivery targets and requires workspace trust.
- `PromptQueueExecutionService.runNext()` selects the first `await` item, finishes rendering and input callbacks, then persists `doing` before invoking delivery once. Cancellation and render errors leave status unchanged. Failed persistence or queue edits before dispatch prevent delivery. A saved `doing` item blocks another run, including after recreating the executor; it is never resent automatically.
- `confirm(id)` marks only the current `doing` item as `done`, based on explicit manual confirmation. It does not send the next item. Verified desktop delivery, API dispatch, copying, definite failure and uncertain outcomes all leave `doing` until manual handling. For a redo, inspect the outcome and edit the intended item's status to `await`; this does not undo prior AI actions.
- `pause()` prevents pending delivery that has not started. If `doing` was already saved, it remains for manual inspection. Pause cannot undo or cancel an already-dispatched message or AI task. `resume()` only unpauses; a separate `runNext()` is required. Overlapping operations are rejected, and version-checked file updates prevent two executors from dispatching the same item twice.
- The result-aware delivery entry reports `verified`, `apiDispatched`, `copied`, `notDelivered` or `uncertain`. It never falls back to clipboard copying or retries an uncertain chat delivery. The original `deliverPromptContent` entry retains its existing signature and fallback behavior. Automated checks use simulated file, clipboard and desktop APIs; live VS Code queue delivery still requires manual acceptance testing.

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

### Markdown Fragment Includes

Reuse a heading's body inside the current task. In the host document:

```markdown
<!-- md-meta
scope: document
prompto:
    sectionLevels: [1]
    deliveryTarget: githubCopilotChat
    chatSession:
        title: Host task
    context: ./project-context.md
    vars:
        taskName: User query endpoint
-->

# Task
Please implement {{taskName}}.

{{include "./common.md" section="API rules"}}

Add focused tests for the implementation.
```

In `common.md`:

```markdown
# API rules
Use the project's existing response format for {{taskName}}.

## Examples
Reference: {{path:./examples/response.json}}

# Other rules
This section is not sent.
```

- Put `{{include "./common.md" section="API rules"}}` on its own line. File and heading must be non-empty literal strings, not variables or expressions. Includes inside fenced code and HTML comments remain literal examples.
- Only the selected heading's body is inserted, excluding its own heading and metadata blocks. Child headings remain until the next same-level or higher-level heading. Missing, duplicate and empty headings are errors. Referenced headings do not need `sectionLevels`; headings in code fences and comments are ignored.
- The destination, complete chat session, context, variables and `fileName` always come from the host task. Referenced metadata is validated but never inherited. Host text before and after the include is preserved. Queue context overrides still apply to that item only.
- Included body templates support the existing variables, string functions and conditions. Only selected condition branches read referenced files or request values. Includes cannot contain another executable include, even in an unselected branch. Variable values and string-function results stay literal, without recursive evaluation.
- The host must be a saved local file. References accept local `.md` and `.markdown` files; `./` and `../` resolve from the host document, never from a YAML queue. URLs, UNC/network paths, home shortcuts, drive-relative paths and template paths are rejected. Leading `/` follows filesystem resolution, not the workspace-root shortcut used by path templates.
- Inside included body text, `{{path:./...}}` resolves from the referenced file and `{{path:/...}}` uses that file's workspace. Host paths and the host context path retain their original base. `selectedText` represents the branch-selected, expanded body with resolved paths before named-variable substitution.
- A file is read once per rendering operation through VS Code, including unsaved edits; the next operation reads its latest buffer. No source file is rewritten. Limits are 32 selected include references and 1 MiB (UTF-8) per referenced file, cumulative included body, expanded body and final output. Desktop target input limits apply independently.
- Includes work with selections, executable sections and YAML queue tasks. Section actions still require document-level `sectionLevels`; the clicked action or shortcut determines output mode. Queue priority remains item outputMode > queue outputMode > chatPrefill.
- Rendering finishes before a queue item is saved as doing. Errors or cancelled values do not write progress or partially dispatch. Successful delivery still waits for manual confirmation without automatic next-item execution.
- `source` and `deliveryFrom` have been removed. Replace their node configuration with a body include and keep target/session settings in the host document. Saved-prompt, inline `promptContent` and Flow execution are unchanged and do not gain include support.
- Reload the extension with F5 and first inspect the expanded result using **Copy** (`Shift+Enter`). Automated tests mock file and delivery APIs; live VS Code acceptance testing is still required.

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
- **`prompto.desktop.enabled`** - User/machine setting, default `true`. Set to `false` to disable named Copilot/Qoder/Lingxi delivery. There is no first-run modal. Lingxi replaces target drafts by default after identity, focus and full-selection checks.
- **`prompto.desktop.executablePath`** - Optional absolute native agent-desktop `.exe` path for named Copilot sessions. Empty uses local PATH/global npm discovery; Qoder does not use this setting.
- **`prompto.qoder.cdpPort`** - User/machine CDP port, default `9348`, accepted only on verified `127.0.0.1`.
- **`prompto.qoder.executablePath`** - User-level absolute Qoder CN `.exe` identity. Empty recognizes the running port owner's executable under `LOCALAPPDATA/Programs/Qoder CN/.qoder-versions/<version>/Qoder CN.exe` without pinning a version. Non-empty strictly pins that path; clear an old value after upgrading for automatic detection. Check the CDP shortcut target separately.

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
