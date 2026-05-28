# Prompto Action 正式设计约束

状态：已确认边界，已按最小实现落地

## 目标

在不改变现有 `prompto` 标题块语义的前提下，为 markdown 正文增加可显式声明的多个投放入口。

`prompto-action` 的价值不是复用现有规则，而是把“正文动作入口”隔离成一套独立规则，避免现有标题 block 被重新解释。

## 非目标

- 不自动从正文推断动作入口。
- 不自动从附近段落提取 `selectedText`。
- 不隐式继承父标题 block 的 `deliveryTarget` 或 prompt 来源。
- 不改变现有 `prompto` block 的标题 CodeLens 行为。

## 建议语法

```markdown
<!-- prompto-action
title: 总结当前段落
promptContent: |
  请总结当前上下文，输出：
  1. 核心结论
  2. 风险
  3. 下一步建议
deliveryTarget: claudeCode
-->
```

## 正式规则清单

1. `prompto-action` 是独立语法，不复用现有 `<!-- prompto -->`。
2. `prompto-action` 只在显式锚点上生效，不对任意正文段落做自动推断。
3. 一个 action 必须有独立的 `anchorLine`，执行时按 action 定位，不按标题定位。
4. 一个 action 必须有 `title`，CodeLens 文案直接取 `title`。
5. `prompt` 和 `promptContent` 二选一；同时出现时直接报错，不做优先级回退。
6. `prompt` 表示引用已保存的 prompt 文件；`promptContent` 表示内联 prompt 正文模板。
7. action 默认没有 `selectedText`，其语义等价于 `selectedTextMode = none`。
8. action 场景下如果 prompt 中包含 `{{selectedText}}`，默认静默替换为空字符串，不弹出 “No text selected” 交互。
9. action 的 `deliveryTarget` 只读取 action 自身元信息，不继承外层 block。
10. action 应复用现有变量替换和投递链路，但不能复用“标题 block = selectedText”这层上下文构造。
11. CodeLens 只渲染在 action 锚点对应位置，不在 action 元信息块内部重复渲染。
12. 如果 action 后面有正文，CodeLens 优先显示在 action 后第一条非空正文行；如果没有正文，再回退到 action 元信息起始行。
13. action 元信息本身不能被计入父标题 block 的 body，避免污染现有 `selectedText` 语义。
14. `prompto-action` 需要独立命令入口，例如 `prompto.runMarkdownAction`，不要复用现有 `prompto.runMarkdownBlock`。
15. 一期不做 action 嵌套，不做 action 之间的组合执行，不做批量执行。

## 推荐数据模型

```ts
interface MarkdownPromptAction {
  anchorLine: number;
  title: string;
  promptReference?: string;
  inlinePromptContent?: string;
  deliveryOptions: PromptDeliveryOptions;
  selectedTextMode: "none";
}
```

## 反例清单

### 反例 1：把正文入口塞进现有 `prompto` 标题块

```markdown
## 代码评审

<!-- prompto
prompt: review
-->

这里是一段正文。
这里再偷偷生成一个 CodeLens。
```

问题：现有标题 block 的身份、执行入口、`selectedText` 语义都依赖标题行。把正文入口塞进去会让同一个 block 同时承担两类角色，规则会变脏。

### 反例 2：正文 action 自动继承父 block 路由

```markdown
## 父标题

<!-- prompto
deliveryTarget: githubCopilotChat
-->

<!-- prompto-action
title: 子动作
promptContent: 请处理这里的内容
-->
```

问题：表面省配置，实际增加调试成本。看到 action 时无法仅靠 action 自身判断它会投到哪里。

### 反例 3：正文 action 自动抓最近一段作为 `selectedText`

```markdown
这是一段普通文字。

<!-- prompto-action
title: 总结
promptContent: 总结：{{selectedText}}
-->
```

问题：用户无法稳定预测到底抓哪一段文本，尤其在插入空行、注释、列表后行为会飘。

### 反例 4：`prompt` 和 `promptContent` 同时存在但偷偷选一个

```markdown
<!-- prompto-action
title: 冲突示例
prompt: review
promptContent: 请直接总结
-->
```

问题：这种冲突如果不显式报错，会让“到底执行了哪一个来源”变得难以追踪。

### 反例 5：对任何正文段落都自动生成 CodeLens

```markdown
普通段落 A

普通段落 B

普通段落 C
```

问题：视觉噪音高，而且用户无法判断哪些位置是稳定入口，哪些只是普通文本。

## 评审结论建议

如果推进 `prompto-action`，建议一期只接受下面这组边界：

- 独立语法
- 独立命令
- 显式锚点
- 无 `selectedText`
- 无继承
- `prompt`/`promptContent` 互斥

这组边界能够把新增复杂度限制在 action 分支内，而不是扩散到现有标题 block 规则。