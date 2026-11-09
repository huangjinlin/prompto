# 迁移指南：仅支持 md-meta

## 概述

Prompto 已移除旧语法支持，项目代码现在仅支持 `<!-- md-meta -->`。

以下旧语法将不再被解析和执行：

- `<!-- prompto -->`
- `<!-- prompto-action -->`
- `<!-- outline -->`

## 快速迁移示例

### 节点块（heading block）

```md
## Review This Function

<!-- md-meta
version: 1
prompto:
  promptContent: |
    Review the selected function and suggest fixes:
    {{selectedText}}
  deliveryTarget: githubCopilotChat
  outputMode: chatSubmit
-->
函数内容。
```

### 节点块（inline promptContent）

```md
## Review This Snippet

<!-- md-meta
version: 1
prompto:
  promptContent: |
    Review the selected content and report:
    1. Risks
    2. Suggested fixes
  deliveryTarget: claudeCode
-->
粘贴内容。
```

### 动作块（action）

```md
<!-- md-meta
version: 1
scope: action
prompto:
  title: Summarize This Section
  promptContent: |
    Summarize the current context.
-->
这一段是动作锚点。
```

## 常见问题

- `prompto.prompt` 文件引用已移除，旧配置会被忽略；需要将引用文件中的提示词手动迁移到 `prompto.promptContent`
- `md-meta` 内的 `prompto:` 命名空间和 `scope: action` 仍然保留；动作需提供 `title` 与 `promptContent`
- 选区变量块中的 `prompt:` 不再用于选取文件；提示词管理器仍可手动选择文件
- `flow` 节点必须定义 `flow.id` 才能参与流程图渲染
- `outline.status` 推荐使用：`todo`、`doing`、`done`、`blocked`、`cancelled`
