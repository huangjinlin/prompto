# 统一 Markdown 元信息规范 v1

## 1. 状态

- 状态：已冻结
- 版本：1
- 冻结日期：2026-06-06
- 规范宿主块：`md-meta`
- 主要消费者：Prompto、Markdown Outline Viewer、后续基于 Markdown 的扩展

## 2. 目标

本规范用于定义一套低耦合、可持续扩展的 Markdown 元信息格式。

这套格式需要满足以下目标：

- 让 Markdown 内容继续作为单一真源
- 允许多个扩展从同一个元信息块中读取不同功能域的数据
- 避免随着功能增长而出现平铺字段冲突
- 支持文档级默认值与局部覆盖

本规范不定义具体 UI 细节，只定义文档层面的契约。图形界面、执行逻辑、资源管理器展示都应建立在这份契约之上。

## 3. 设计原则

1. 一个宿主块，多个命名空间。
2. 每个扩展只读取自己拥有的命名空间。
3. 未知命名空间和未知字段不得导致整块解析失败。
4. 根级字段必须极少且保留。
5. 语法必须同时便于 TypeScript 与 Python 实现。

## 4. 术语

- 宿主块：承载元信息的 HTML 注释块
- 命名空间：某个功能域拥有的顶级配置区，如 `prompto`、`flow`、`outline`
- 文档作用域：作用于整个 Markdown 文档的元信息
- 节点作用域：绑定在某个标题节点上的元信息
- 动作作用域：绑定在某个非标题锚点上的元信息
- 生效元信息：将默认值与局部覆盖合并后得到的最终配置

## 5. 宿主块

规范推荐的新宿主块格式如下：

```md
<!-- md-meta
version: 1
... YAML 子集内容 ...
-->
```

规则如下：

- 起始行去除前后空白后，必须是 `<!-- md-meta`
- 结束行去除前后空白后，必须是 `-->`
- 中间内容按本规范定义的 YAML 子集解析

## 6. 作用域与放置位置

### 6.1 文档作用域

文档作用域用于声明默认值和文档级配置。

推荐放置位置：

- 文档第一个标题之前
- 或主标题之后、正文之前

示例：

```md
# 每日操作

<!-- md-meta
version: 1
defaults:
  prompto:
    deliveryTarget: githubCopilotChat
    outputMode: chatPrefill
  flow:
    direction: TB
  outline:
    status: todo
flow:
  id: daily-operations
  title: 每日操作流程
  entry: report.entry
-->
```

### 6.2 节点作用域

节点作用域用于给某个标题节点补充结构、执行、展示相关的元信息。

推荐放置位置：

- 紧跟标题之下
- 标题与元信息块之间允许空行
- 元信息块必须出现在该节点正文之前

示例：

```md
## 有交易日

<!-- md-meta
version: 1
flow:
  id: report.trade
  kind: action
  next: report.finish
prompto:
  prompt: review/check-trade-day
outline:
  status: doing
-->
```

### 6.3 动作作用域

动作作用域用于给非标题锚点绑定动作元信息。

动作作用域必须显式声明 `scope: action`。

推荐放置位置：

- 紧贴目标段落、列表项或其他动作锚点之前

示例：

```md
<!-- md-meta
version: 1
scope: action
prompto:
  title: 总结本节
  promptContent: |
    请总结当前小节。
    内容如下：
    {{selectedText}}
-->

这一段文本就是动作锚点。
```

## 7. 根对象结构

根对象必须是一个映射对象，包含少量保留字段与多个命名空间分区。

v1 的保留根字段如下：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `version` | integer | 是 | 规范版本号 |
| `scope` | string | 否 | `document`、`node` 或 `action` |
| `defaults` | mapping | 否 | 作用于下层作用域的默认值 |

规则如下：

- 根级不允许直接放业务字段
- 功能字段必须放在命名空间下
- 未知根字段应尽量报诊断，但不应阻断整块解析

## 8. YAML 子集

本规范采用受限 YAML 子集。

允许的结构：

- 映射
- 数组
- 字符串
- 布尔值
- 数字
- `null`
- 使用 `|` 或 `>` 的多行字符串

v1 不允许的结构：

- anchors 与 aliases
- 自定义 tags
- merge keys
- 多文档 YAML

这样做的目的是让 TypeScript 与 Python 都能稳定实现，不把规范绑定到某一个复杂 YAML 方言上。

## 9. 命名空间规则

### 9.1 标准命名空间

本规范保留以下标准命名空间：

- `prompto`
- `flow`
- `outline`

### 9.2 自定义命名空间

允许扩展自定义命名空间。

规则如下：

- 使用小写 kebab-case
- 如果该命名空间不是共享规范的一部分，建议带团队或项目级前缀
- 消费方必须忽略自己不拥有的命名空间

示例：

- `kanban`
- `acme-review`
- `myteam-sync`

### 9.3 未知字段

对于已知命名空间内的未知字段：

- 解析器应忽略它们
- 实现层可在条件允许时给出警告或诊断
- 不得因为单个未知字段导致整块元信息失效

## 10. 合并与优先级

某个作用域的生效元信息，按以下顺序合并：

1. 消费者内部默认值
2. 文档级 `defaults`
3. 文档级命名空间配置
4. 当前局部作用域命名空间配置

规则如下：

- 映射对象按键深度合并
- 数组采用整体替换，不做拼接
- `null` 表示清除继承来的值
- v1 不定义标题节点之间的隐式继承
- v1 只定义文档级到局部作用域的继承

示例：

```md
<!-- md-meta
version: 1
defaults:
  outline:
    status: todo
-->

## 已完成条目
<!-- md-meta
version: 1
outline:
  status: done
-->

## 中性条目
<!-- md-meta
version: 1
outline:
  status: null
-->
```

在这个示例中：

- `已完成条目` 的生效状态是 `done`
- `中性条目` 会清除继承来的 `todo`

## 11. 标准命名空间契约

### 11.1 `prompto`

`prompto` 命名空间用于定义提示词组装与投放行为。

| 字段 | 类型 | 作用域 | 说明 |
| --- | --- | --- | --- |
| `prompt` | string | node, action | 已保存 prompt 文件的引用 |
| `promptContent` | string | node, action | 内联 prompt 内容 |
| `deliveryTarget` | string | document, node, action | 投放目标，如 `githubCopilotChat` |
| `outputMode` | string | document, node, action | `chatPrefill`、`chatSubmit`、`clipboard` |
| `title` | string | action | 动作作用域展示标题 |

规则如下：

- `prompt` 与 `promptContent` 不应在同一作用域同时出现
- `title` 推荐用于动作作用域，在标题节点作用域中可被忽略

示例：

```yaml
prompto:
  prompt: review/check-trade-day
  deliveryTarget: githubCopilotChat
  outputMode: chatSubmit
```

### 11.2 `flow`

`flow` 命名空间用于定义从 Markdown 结构中派生出的流程图语义。

文档作用域字段：

| 字段 | 类型 | 作用域 | 说明 |
| --- | --- | --- | --- |
| `id` | string | document | 稳定流程 id |
| `title` | string | document | 流程标题 |
| `direction` | string | document | `TB`、`LR`、`BT`、`RL` |
| `entry` | string | document | 入口节点 id |

节点作用域字段：

| 字段 | 类型 | 作用域 | 说明 |
| --- | --- | --- | --- |
| `id` | string | node | 稳定节点 id |
| `kind` | string | node | `start`、`action`、`decision`、`end` |
| `next` | string | node | 默认下一跳节点 id |
| `group` | string | node | 可选的逻辑分组 |
| `branches` | sequence | node | 显式分支定义 |

单个分支项结构：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `label` | string | 是 | 分支边展示文案 |
| `to` | string | 是 | 目标节点 id |

规则如下：

- 参与流程图渲染的节点必须定义 `flow.id`
- `branches` 只允许出现在 `kind: decision` 节点上
- `branches` 与 `next` 可以并存，但推荐消费顺序为先 `branches` 再 `next`
- `entry` 若存在，必须指向合法节点 id

示例：

```yaml
flow:
  id: trade.check
  kind: decision
  branches:
    - label: 有交易
      to: report.trade
    - label: 无交易
      to: report.noTrade
```

### 11.3 `outline`

`outline` 命名空间用于定义大纲面板等展示相关的元信息。

| 字段 | 类型 | 作用域 | 说明 |
| --- | --- | --- | --- |
| `status` | string | document, node | 在大纲 UI 中展示的状态 |

推荐状态值：

- `todo`
- `doing`
- `done`
- `blocked`
- `cancelled`

规则如下：

- 消费方可以允许更多字符串状态值
- 遇到未知状态时应优雅降级，而不是报错中断

示例：

```yaml
outline:
  status: done
```

## 12. 校验规则

实现层应尽量校验以下内容：

- 宿主块是否正确闭合
- 内容是否符合支持的 YAML 子集
- `version` 是否存在且受支持
- 同一锚点是否定义了多个相互竞争的宿主块
- `prompto.prompt` 与 `prompto.promptContent` 是否同时存在（应报诊断警告）
- 在具备全文件视图时，`flow.entry`、`flow.next`、`flow.branches[*].to` 是否能解析到合法节点

当环境允许时，校验失败应尽量以诊断形式呈现给用户。

## 13. 完整示例

```md
# 每日操作

<!-- md-meta
version: 1
defaults:
  prompto:
    deliveryTarget: githubCopilotChat
    outputMode: chatPrefill
  flow:
    direction: TB
  outline:
    status: todo
flow:
  id: daily-operations
  title: 每日操作流程
  entry: report.entry
-->

## 汇报入口
<!-- md-meta
version: 1
flow:
  id: report.entry
  kind: start
  next: trade.check
outline:
  status: doing
-->
进入汇报检查流程。

## 是否有交易
<!-- md-meta
version: 1
flow:
  id: trade.check
  kind: decision
  branches:
    - label: 有交易
      to: report.trade
    - label: 无交易
      to: report.noTrade
-->
根据记录判断今日类型。

## 有交易日
<!-- md-meta
version: 1
flow:
  id: report.trade
  kind: action
  next: report.finish
prompto:
  prompt: review/check-trade-day
outline:
  status: done
-->
1. 检查日报。
2. 检查偏差。

## 无交易日
<!-- md-meta
version: 1
flow:
  id: report.noTrade
  kind: action
  next: report.finish
prompto:
  prompt: review/check-no-trade-day
-->
1. 检查日报。

## 完成
<!-- md-meta
version: 1
flow:
  id: report.finish
  kind: end
outline:
  status: done
-->
流程完成。
```

## 14. 编写建议

1. 同一个锚点只放一个 `md-meta` 宿主块。
2. 新能力只放在命名空间下，不新增根级业务字段。
3. 节点一旦被 flow 引用，就保持 `flow.id` 稳定。
4. 对共享配置优先使用文档级 `defaults`。

## 15. 冻结记录

- 冻结日期：2026-06-06
- 规范版本：v1
- 宿主块名：`md-meta`
- 保留根字段：`version`、`scope`、`defaults`
- 标准命名空间：`prompto`、`flow`、`outline`
- 后续新增命名空间：走自定义命名空间规则（小写 kebab-case，消费方忽略不认识的）
- prompto 字段：`prompt`、`promptContent`、`deliveryTarget`、`outputMode`、`title`
- prompto 互斥规则：`prompt` 与 `promptContent` 不应同时出现
- flow 分支结构：采用 YAML 数组对象 `[{label, to}]`
- flow 消费顺序：`branches` 优先于 `next`
- outline v1 字段：仅 `status`，后续扩展走 v2
- outline 推荐状态值：`todo`、`doing`、`done`、`blocked`、`cancelled`，可为空，未知值优雅降级
