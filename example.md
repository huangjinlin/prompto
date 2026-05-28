# Prompto Markdown 元信息语法示例

这个文件整理当前已经支持的 markdown 相关语法，方便评审和回归测试。

注意：这里描述的是“当前已支持”的语法，包含已经实现的 `prompto-action`。

## 1. Prompt 文件语法

适用场景：保存在 `.prompto` 目录下的 prompt markdown 文件。

```markdown
# 我的 Prompt

<!-- prompto
outputMode: chatSubmit
deliveryTarget: githubCopilotChat
-->

请基于下面内容进行代码评审：
{{selectedText}}
```

规则：

- 第一行可以是 `# 标题`。
- 可选的 prompt 元信息块使用 `<!-- prompto ... -->`。
- 当前 prompt 文件元信息主要用于投递配置。
- 元信息之后的正文就是 prompt 内容。

当前支持的 prompt 文件元信息键：

- `outputMode`: `chatPrefill` | `chatSubmit` | `clipboard`
- `deliveryTarget`: `githubCopilotChat` | `claudeCode`

## 2. Markdown 标题块语法：引用已保存的 prompt 文件

适用场景：在普通 markdown 文档里，通过标题 + 元信息块生成一个可执行入口。

```markdown
## 代码评审

<!-- prompto
prompt: code-review
outputMode: chatSubmit
deliveryTarget: githubCopilotChat
-->

这里的正文会作为 `{{selectedText}}` 提供给 prompt。
```

规则：

- 必须从一个 markdown 标题开始，例如 `## 代码评审`。
- 标题下方的 `<!-- prompto ... -->` 元信息块用于声明这个 block 的配置。
- 当存在 `prompt` 时，会去 `.prompto` 目录解析对应 prompt 文件。
- 当前标题行会出现 CodeLens。
- block 正文会作为 `selectedText` 提供给 prompt。

## 3. Markdown 标题块语法：直接内联 prompt 内容

适用场景：不想单独维护 prompt 文件，直接在 block 元信息里写 prompt 模板。

```markdown
## Review This Snippet

<!-- prompto
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

这里是待评审内容。
```

规则：

- `promptContent` 表示直接提供待执行 prompt 内容。
- 支持单行写法，也支持 `|` 多行写法。
- 多行写法中的内容需要缩进，缩进后的文本会被拼成真正的 prompt 内容。
- `prompt` 和 `promptContent` 不能同时使用。
- block 正文仍然作为 `{{selectedText}}` 的来源。

单行写法示例：

```markdown
## 总结

<!-- prompto
promptContent: 请总结下面内容，并给出三个行动项：{{selectedText}}
-->

这里是要总结的内容。
```

## 4. Markdown 标题块中可用的常见元信息键

下面这些键当前可以放在 markdown 标题块的 `<!-- prompto -->` 中：

```markdown
## 示例

<!-- prompto
prompt: code-review
promptContent: |
    请总结 {{selectedText}}
outputMode: chatSubmit
deliveryTarget: githubCopilotChat
customVariable: 架构评审
-->
```

说明：

- `prompt`：引用 `.prompto` 中的 prompt 文件。
- `promptContent`：直接提供 prompt 正文。
- `outputMode`：覆盖工作区 `prompto.outputMode`。
- `deliveryTarget`：覆盖工作区 `prompto.deliveryTarget`。
- 其他键值对：可作为自定义变量，供 prompt 中的 `{{变量名}}` 使用。

注意：当前实现里，`prompt` 和 `promptContent` 是互斥的；如果都提供，会报错。

## 5. 变量语法

当前支持的变量占位符：

- `{{selectedText}}`
- `{{fileName}}`
- `{{customVariable}}`

示例：

```markdown
# 代码评审

请从 {{codeAspect}} 角度评审 {{fileName}}：

{{selectedText}}
```

如果 `{{customVariable}}` 没有现成值，Prompto 会弹输入框询问。

## 6. 选中文本头部变量语法

适用场景：在编辑器中选择一段文本时，先用头部变量块提供变量值，再运行 `Prompto: Use Prompt`。

```text
---
codeAspect: performance
audience: senior engineers
---
function under review goes here
```

规则：

- 头尾都用单独一行的 `---` 包起来。
- 头部中的 `key: value` 会作为变量值提供给 prompt。
- 头部之后剩余的正文会成为 `{{selectedText}}`。

## 7. 选中文本头部直接指定 prompt

适用场景：不先打开 picker，直接在选中的头部变量块里指定一个 prompt 文件。

```text
---
prompt: react/new-react-component
componentName: UserCard
---
请基于这里的上下文生成组件。
```

规则：

- `prompt` 会被当成 prompt 文件引用。
- 其他键值对仍然作为自定义变量。
- 头部之后的正文仍然是 `{{selectedText}}`。

## 8. 当前优先级规则

### prompt 来源

1. 选中文本头部里的 `prompt`
2. markdown 标题块里的 `prompt` 或 `promptContent`
3. markdown 正文 action 里的 `prompt` 或 `promptContent`
4. 手动从 picker 中选择 prompt

### deliveryTarget 来源

1. markdown prompt 文件元信息中的 `deliveryTarget`
2. markdown 标题块元信息中的 `deliveryTarget`
3. markdown 正文 action 元信息中的 `deliveryTarget`
4. 工作区设置 `prompto.deliveryTarget`

### outputMode 来源

1. markdown prompt 文件元信息中的 `outputMode`
2. markdown 标题块元信息中的 `outputMode`
3. markdown 正文 action 元信息中的 `outputMode`
4. 工作区设置 `prompto.outputMode`

说明：

- 标题块执行时，block 自身的 `deliveryTarget` 会覆盖工作区设置。
- 正文 action 执行时，action 自身的 `deliveryTarget` 会覆盖工作区设置。
- prompt 文件执行时，prompt 文件元信息中的 `deliveryTarget` 会覆盖工作区设置。

## 9. 正文 Action 语法

适用场景：在 markdown 正文中声明多个显式投放入口，不依赖标题 block，也不提供 `selectedText`。

```markdown
<!-- prompto-action
title: 总结当前上下文
outputMode: clipboard
promptContent: |
    请总结当前上下文，输出：
    1. 核心结论
    2. 风险
    3. 下一步建议
deliveryTarget: claudeCode
-->

这一行只是 action 的锚点，用来承载 CodeLens。
```

规则：

- `prompto-action` 是独立语法，不属于标题 block。
- `title` 必填，CodeLens 直接显示这个标题。
- `prompt` 和 `promptContent` 二选一。
- `outputMode` 可以覆盖工作区 `prompto.outputMode`。
- action 默认没有 `selectedText`；如果 prompt 中写了 `{{selectedText}}`，会按空字符串处理，不会弹提示框。
- action 不继承父标题 block 的 `deliveryTarget`。
- action 的 CodeLens 优先显示在元信息后的第一条非空正文行；如果后面没有正文，则回退到元信息起始行。

使用 `prompt` 的示例：

```markdown
<!-- prompto-action
title: 使用保存的 Prompt
prompt: code-review
outputMode: chatSubmit
deliveryTarget: githubCopilotChat
-->

点击这里运行保存的 prompt。
```

## 10. 当前不属于已支持语法的内容

下面这些内容目前不是正式支持的语法：

- 自动从正文任意位置生成多个 CodeLens
- 正文 action 自动继承父标题 block 的投递配置
- 不写元信息、直接从普通段落推断出 prompt 行为

`prompto-action` 已作为一套独立规则实现，不会扩写现有 `prompto` 标题块语义。