# 迁移指南：从旧语法到 md-meta

## 概述

Prompto 现在支持两种元信息语法：

- **旧语法**：`<!-- prompto -->`、`<!-- prompto-action -->`，继续支持，不会删除
- **新语法**：`<!-- md-meta -->`，推荐用于新文档

两种语法可以共存于同一文档，互不影响。

## 迁移对照表

### prompto 块 → md-meta 节点块

**旧语法：**

```md
## Review This Function

<!-- prompto
prompt: review/code-review
deliveryTarget: githubCopilotChat
outputMode: chatSubmit
-->
函数内容。
```

**新语法：**

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

**变化：**
- `<!-- prompto` → `<!-- md-meta`
- 增加 `version: 1`
- 字段缩进到 `prompto:` 命名空间下

### prompto 块（inline promptContent）→ md-meta 节点块

**旧语法：**

```md
## Review This Snippet

<!-- prompto
promptContent: |
    Review the selected content and report:
    1. Risks
    2. Suggested fixes
deliveryTarget: claudeCode
-->
粘贴内容。
```

**新语法：**

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

### prompto-action 块 → md-meta 动作块

**旧语法：**

```md
<!-- prompto-action
title: Summarize This Section
promptContent: |
    Summarize the current context.
-->
这一段是动作锚点。
```

**新语法：**

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

**变化：**
- `<!-- prompto-action` → `<!-- md-meta`
- 增加 `version: 1` 和 `scope: action`
- 字段缩进到 `prompto:` 命名空间下


## 新增能力

迁移到 md-meta 后，你可以额外使用以下能力：

### 流程图（flow 命名空间）

```md
<!-- md-meta
version: 1
flow:
  id: my.node
  kind: action
  next: next.node
-->
```

### 大纲状态（outline 命名空间）

```md
<!-- md-meta
version: 1
outline:
  status: done
-->
```

### 文档级默认值（defaults）

```md
<!-- md-meta
version: 1
defaults:
  prompto:
    deliveryTarget: githubCopilotChat
  outline:
    status: todo
-->
```

### 多命名空间并存

```md
<!-- md-meta
version: 1
prompto:
  prompt: review/check
flow:
  id: check.node
  kind: action
outline:
  status: doing
-->
```

## 迁移建议

1. **不需要一次性迁移**：旧语法继续正常工作
2. **新文档用新语法**：新建的文档直接用 md-meta
3. **旧文档按需迁移**：需要 flow 或 outline 功能时再迁移
4. **混合文档可以共存**：同一文档中可以有旧语法节点和新语法节点

## 注意事项

- md-meta 块中 `prompt` 和 `promptContent` 不应同时出现
- 旧 prompto 块中同时出现两者时，默认取 `promptContent`
- flow 节点必须定义 `id` 才能参与流程图渲染
- outline 的 `status` 推荐使用 `todo`、`doing`、`done`、`blocked`、`cancelled`
