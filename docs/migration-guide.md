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
  prompt: review/code-review
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

- `md-meta` 中仍然不应同时定义 `prompto.prompt` 与 `prompto.promptContent`
- `flow` 节点必须定义 `flow.id` 才能参与流程图渲染
- `outline.status` 推荐使用：`todo`、`doing`、`done`、`blocked`、`cancelled`
