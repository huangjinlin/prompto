# 统一 Markdown 元信息实施计划

## 1. 目标

本计划用于指导以下两个项目落地统一 Markdown 元信息规范 v1：

- Prompto
- Markdown Outline Viewer

整个实施过程以“Markdown 仍然是单一真源”为前提。两个项目消费同一份文档契约，但各自只负责自己拥有的命名空间。

## 2. 总体策略

推荐按四个阶段推进：

1. 先冻结规范与兼容策略
2. 先升级 Prompto 的解析与归一化层
3. 再升级 Markdown Outline Viewer 的解析与展示层
4. 最后在稳定的解析层之上建设流程图与更强的创作体验

顺序不能反。解析层稳定之前，不应先做重交互 UI。

## 3. 跨项目公共工作

### 3.1 冻结规范

输入文档：

- `docs/unified-markdown-metadata-spec.md`

行动项：

- 确认标准宿主块名为 `md-meta`
- 确认保留命名空间为 `prompto`、`flow`、`outline`
- 确认保留根字段为 `version`、`scope`、`defaults`
- 确认旧语法 `prompto`、`prompto-action`、`outline` 的归一化规则

完成标准：

- 两个项目都把规范文档视为唯一元信息契约来源

### 3.2 建立共享样例集

行动项：

- 建立一组共享 Markdown 样例，覆盖 document、node、action 三种作用域
- 加入旧语法样例与混合语法样例
- 为每个样例定义期望的归一化 JSON 输出

建议：

- 先在 Prompto 中建立样例集，再根据需要同步到大纲项目

完成标准：

- 两个项目可以基于同一批样例验证解析结果是否一致

### 3.3 定义统一归一化模型

行动项：

- 定义一份跨语言一致的内存结构
- 保证 TypeScript 与 Python 的字段命名尽量对齐

推荐的归一化结构：

```ts
type MarkdownMetaEnvelope = {
  version: number;
  scope: "document" | "node" | "action";
  defaults?: Record<string, unknown>;
  namespaces: Record<string, unknown>;
};
```

完成标准：

- TypeScript 与 Python 对同一份样例文档产生等价的归一化输出

## 4. Prompto 实施计划

### 4.1 阶段 P1：抽离独立元信息层

当前相关文件：

- `src/services/MarkdownPromptBlockService.ts`
- `src/extension.ts`

行动项：

- 新增独立的元信息解析服务，不继续在 prompt block service 中堆平铺正则解析
- 定义文档、节点、动作三种作用域的归一化模型
- 在过渡期同时支持 `md-meta` 与旧 `prompto`、`prompto-action`
- 保持现有文档行为不变

建议新增文件：

- `src/models/MarkdownMeta.ts`
- `src/services/MarkdownMetaParserService.ts`
- `src/services/MarkdownMetaNormalizerService.ts`

重构目标：

- 让 `src/services/MarkdownPromptBlockService.ts` 消费归一化后的元信息，而不是直接消费平铺 `key: value`
- 该文件只保留块定位、正文切片等职责，不再承担命名空间语义判断

完成标准：

- Prompto 能同时读取 `md-meta` 与旧 `prompto`、`prompto-action`
- 现有 CodeLens 功能在旧文档上不回退
- 新文档可以把 `prompto` 数据写到命名空间结构里

### 4.2 阶段 P2：升级执行管线到命名空间模型

当前相关文件：

- `src/extension.ts`
- `src/services/PromptDeliveryService.ts`

行动项：

- 把类似 `variables.outputMode` 这样的直接字段读取，改成命名空间访问
- 将归一化后的 `prompto` 命名空间映射回当前执行上下文
- 变量替换与投放逻辑继续复用现有实现

关键要求：

- 不要重写 prompt 投放逻辑，直接复用 `src/services/PromptDeliveryService.ts`

完成标准：

- 用户视角下的 prompt 执行行为不变
- 新语法与旧语法都会汇入同一条执行链路

### 4.3 阶段 P3：升级创作辅助能力

当前相关文件：

- `src/providers/MarkdownPromptMetadataCompletionProvider.ts`
- `README.md`

行动项：

- 补全建议改为优先输出 `md-meta` 示例
- 增加 `prompto`、`flow`、`outline`、`defaults`、`scope` 的补全能力
- 对冲突字段、错误放置位置、重复宿主块增加诊断
- 更新用户文档与迁移说明

完成标准：

- 用户不用记住全部字段也能写新语法
- 错误元信息能尽早在编辑器内暴露

### 4.4 阶段 P4：构建 Flow 提取服务

行动项：

- 新增一个服务，把 `flow` 命名空间与标题结构转换成稳定图模型
- 校验节点引用、分支目标与入口节点
- 定义 `next` 省略时的回退行为

建议新增文件：

- `src/services/MarkdownFlowService.ts`

推荐图模型：

```ts
type FlowNode = {
  id: string;
  title: string;
  kind: "start" | "action" | "decision" | "end";
  line: number;
};

type FlowEdge = {
  from: string;
  to: string;
  label?: string;
};
```

完成标准：

- 任意一份符合规范的 Markdown 文档都能稳定转换为图结构
- 图结构的产生不依赖 UI 层

### 4.5 阶段 P5：建设 Flow Webview 与执行入口

当前可复用能力：

- `src/services/PromptDeliveryService.ts`
- `src/extension.ts`

行动项：

- 新增流程预览命令与 Webview
- 图节点必须来自 Markdown 结构解析结果，而不是用户手写 Mermaid
- 节点点击后回到现有执行链路
- 节点二级操作至少支持：定位原文、预览组装结果、执行 prompt

建议新增文件：

- `src/webview/PromptFlowWebviewProvider.ts`
- `media/prompt-flow.js`
- `media/prompt-flow.css`

需要调整：

- `package.json` 中的 commands 与 menus 贡献点

完成标准：

- 用户能打开由 Markdown 自动生成的流程图
- 点击节点可触发与 CodeLens 一致的 prompt 执行路径

### 4.6 阶段 P6：迁移与回归验证

行动项：

- 提供使用 `md-meta` 的示例文档
- 增补从 `prompto`、`prompto-action` 迁移的文档说明
- 为旧语法与新语法都建立回归测试

完成标准：

- 用户可以渐进迁移，不必一次性改完全部历史文档

## 5. Markdown Outline Viewer 实施计划

### 5.1 阶段 O0：先恢复可维护源码结构

当前相关文件：

- `out/extension.js`
- `out/extensionAPI.js`
- `out/markdownOutlineWebview.js`
- `package.json`

当前风险：

- 工作区中只看到了编译产物，没有看到原始 `src/` 目录
- `package.json` 仍然声明了 `tsc -p ./` 的编译脚本，但工作区中未发现 `tsconfig.json`

行动项：

- 在大改行为之前，先恢复或重建 `src/` 目录
- 明确 `out/` 只作为构建产物，不再作为主要维护入口
- 补齐 `tsconfig.json`，恢复可编译基线

建议新增文件：

- `src/extension.ts`
- `src/extensionAPI.ts`
- `src/markdownOutlineWebview.ts`
- `tsconfig.json`

完成标准：

- 后续元信息改造都发生在源码层，而不是直接改生成文件

### 5.2 阶段 O1：扩展 Python 解析器支持统一元信息

当前相关文件：

- `python/markdown_parser.py`

行动项：

- 在标题解析之外，新增 `md-meta` 解析
- 将归一化后的元信息挂载到每个标题项上
- 将旧 `outline` 注释块归一化到 `outline` 命名空间
- 如有必要，输出文档级默认值

建议扩展的解析结果：

- `flat_outline[*].metadata`
- `document_metadata`

关键原则：

- 大纲项目只消费 `outline` 命名空间，不要在展示逻辑里耦合 `prompto` 和 `flow`

完成标准：

- 解析器能返回每个标题节点的生效 `outline.status`

### 5.3 阶段 O2：在大纲 UI 中消费状态

当前相关文件：

- `media/main.js`

行动项：

- 让 UI 读取 `outline.status`
- 在标题旁展示状态徽标、颜色或图标
- 对未知或缺失状态做优雅降级

可能同时涉及：

- `media/main.css`
- 恢复后的 TypeScript Webview 源码

完成标准：

- 大纲状态来自统一元信息，而不是继续依赖单独的临时语法

### 5.4 阶段 O3：兼容与诊断

行动项：

- 继续兼容旧 `<!-- outline -->` 语法
- 对同一标题绑定多个宿主块给出警告
- 对错误放置位置与错误格式给出诊断

完成标准：

- 旧文档仍能正常展示
- 新语法拥有更完整的校验反馈

## 6. 推荐执行顺序

1. 冻结规范与共享样例
2. 在 Prompto 中实现 `md-meta` 解析与旧语法归一化
3. 在 Markdown Outline Viewer 中实现 `md-meta` 解析与旧语法归一化
4. 回到 Prompto，补齐创作辅助与诊断
5. 在 Prompto 中建设 Flow 提取服务
6. 在 Prompto 中建设 Flow Webview 与节点执行交互
7. 补充迁移文档、示例文档与回归验证

这个顺序的核心是先稳定数据契约，再建设图形交互。

## 7. 里程碑验收标准

### 里程碑 A：共享契约稳定

- 规范文档冻结
- 样例集可用
- 两边认可同一套归一化模型

### 里程碑 B：双解析器稳定

- Prompto 能解析 `md-meta` 与旧 prompt 语法
- Markdown Outline Viewer 能解析 `md-meta` 与旧 outline 语法
- 两边面对同一份样例文档得到等价结果

### 里程碑 C：创作体验稳定

- Prompto 补全与诊断支持新语法
- 示例与迁移说明可用

### 里程碑 D：Flow 体验交付

- Prompto 能从 Markdown 自动生成流程图
- 图节点交互能回到现有 prompt 执行链路

## 8. 风险与缓解

| 风险 | 影响 | 缓解方式 |
| --- | --- | --- |
| TypeScript 与 Python 解析结果漂移 | 高 | 建立共享样例与归一化输出断言 |
| 旧语法长期成为默认入口，导致新规范失效 | 中 | 继续兼容旧语法，但文档、补全、示例一律转向 `md-meta` |
| Markdown Outline Viewer 继续从编译产物直接演进 | 高 | 把恢复 `src/` 与 `tsconfig.json` 作为 O0 前置条件 |
| 在解析层稳定之前就先做流程图 UI | 高 | 明确把流程图交互放到 P5，而不是 P1 |

## 9. 最小首切片

如果要先做一条最小但有价值的交付，建议顺序如下：

1. 在 Prompto 中加入 `md-meta` 解析与旧语法归一化
2. 在 Prompto 中更新补全与文档
3. 在 Markdown Outline Viewer 中加入 `md-meta` 解析与 `outline.status` 展示

在这个首切片完成之前，不建议先开工 Flow Webview。
# 统一 Markdown 元信息实施计划

## 1. 目标

本计划用于指导以下两个项目落地统一 Markdown 元信息规范 v1：

- Prompto
- Markdown Outline Viewer

整个实施过程以“Markdown 仍然是单一真源”为前提。两个项目消费同一份文档契约，但各自只负责自己拥有的命名空间。

## 2. 总体策略

推荐按四个阶段推进：

1. 先冻结规范与兼容策略
2. 先升级 Prompto 的解析与归一化层
3. 再升级 Markdown Outline Viewer 的解析与展示层
4. 最后在稳定的解析层之上建设流程图与更强的创作体验

顺序不能反。解析层稳定之前，不应先做重交互 UI。

## 3. 跨项目公共工作

### 3.1 冻结规范

输入文档：

- `docs/unified-markdown-metadata-spec.md`

行动项：

- 确认标准宿主块名为 `md-meta`
- 确认保留命名空间为 `prompto`、`flow`、`outline`
- 确认保留根字段为 `version`、`scope`、`defaults`
- 确认旧语法 `prompto`、`prompto-action`、`outline` 的归一化规则

完成标准：

- 两个项目都把规范文档视为唯一元信息契约来源

### 3.2 建立共享样例集

行动项：

- 建立一组共享 Markdown 样例，覆盖 document、node、action 三种作用域
- 加入旧语法样例与混合语法样例
- 为每个样例定义期望的归一化 JSON 输出

建议：

- 先在 Prompto 中建立样例集，再根据需要同步到大纲项目

完成标准：

- 两个项目可以基于同一批样例验证解析结果是否一致

### 3.3 定义统一归一化模型

行动项：

- 定义一份跨语言一致的内存结构
- 保证 TypeScript 与 Python 的字段命名尽量对齐

推荐的归一化结构：

```ts
type MarkdownMetaEnvelope = {
  version: number;
  scope: "document" | "node" | "action";
  defaults?: Record<string, unknown>;
  namespaces: Record<string, unknown>;
};
```

完成标准：

- TypeScript 与 Python 对同一份样例文档产生等价的归一化输出

## 4. Prompto 实施计划

### 4.1 阶段 P1：抽离独立元信息层

当前相关文件：

- `src/services/MarkdownPromptBlockService.ts`
- `src/extension.ts`

行动项：

- 新增独立的元信息解析服务，不继续在 prompt block service 中堆平铺正则解析
- 定义文档、节点、动作三种作用域的归一化模型
- 在过渡期同时支持 `md-meta` 与旧 `prompto`、`prompto-action`
- 保持现有文档行为不变

建议新增文件：

- `src/models/MarkdownMeta.ts`
- `src/services/MarkdownMetaParserService.ts`
- `src/services/MarkdownMetaNormalizerService.ts`

重构目标：

- 让 `src/services/MarkdownPromptBlockService.ts` 消费归一化后的元信息，而不是直接消费平铺 `key: value`
- 该文件只保留块定位、正文切片等职责，不再承担命名空间语义判断

完成标准：

- Prompto 能同时读取 `md-meta` 与旧 `prompto`、`prompto-action`
- 现有 CodeLens 功能在旧文档上不回退
- 新文档可以把 `prompto` 数据写到命名空间结构里

### 4.2 阶段 P2：升级执行管线到命名空间模型

当前相关文件：

- `src/extension.ts`
- `src/services/PromptDeliveryService.ts`

行动项：

- 把类似 `variables.outputMode` 这样的直接字段读取，改成命名空间访问
- 将归一化后的 `prompto` 命名空间映射回当前执行上下文
- 变量替换与投放逻辑继续复用现有实现

关键要求：

- 不要重写 prompt 投放逻辑，直接复用 `src/services/PromptDeliveryService.ts`

完成标准：

- 用户视角下的 prompt 执行行为不变
- 新语法与旧语法都会汇入同一条执行链路

### 4.3 阶段 P3：升级创作辅助能力

当前相关文件：

- `src/providers/MarkdownPromptMetadataCompletionProvider.ts`
- `README.md`

行动项：

- 补全建议改为优先输出 `md-meta` 示例
- 增加 `prompto`、`flow`、`outline`、`defaults`、`scope` 的补全能力
- 对冲突字段、错误放置位置、重复宿主块增加诊断
- 更新用户文档与迁移说明

完成标准：

- 用户不用记住全部字段也能写新语法
- 错误元信息能尽早在编辑器内暴露

### 4.4 阶段 P4：构建 Flow 提取服务

行动项：

- 新增一个服务，把 `flow` 命名空间与标题结构转换成稳定图模型
- 校验节点引用、分支目标与入口节点
- 定义 `next` 省略时的回退行为

建议新增文件：

- `src/services/MarkdownFlowService.ts`

推荐图模型：

```ts
type FlowNode = {
  id: string;
  title: string;
  kind: "start" | "action" | "decision" | "end";
  line: number;
};

type FlowEdge = {
  from: string;
  to: string;
  label?: string;
};
```

完成标准：

- 任意一份符合规范的 Markdown 文档都能稳定转换为图结构
- 图结构的产生不依赖 UI 层

### 4.5 阶段 P5：建设 Flow Webview 与执行入口

当前可复用能力：

- `src/services/PromptDeliveryService.ts`
- `src/extension.ts`

行动项：

- 新增流程预览命令与 Webview
- 图节点必须来自 Markdown 结构解析结果，而不是用户手写 Mermaid
- 节点点击后回到现有执行链路
- 节点二级操作至少支持：定位原文、预览组装结果、执行 prompt

建议新增文件：

- `src/webview/PromptFlowWebviewProvider.ts`
- `media/prompt-flow.js`
- `media/prompt-flow.css`

需要调整：

- `package.json` 中的 commands 与 menus 贡献点

完成标准：

- 用户能打开由 Markdown 自动生成的流程图
- 点击节点可触发与 CodeLens 一致的 prompt 执行路径

### 4.6 阶段 P6：迁移与回归验证

行动项：

- 提供使用 `md-meta` 的示例文档
- 增补从 `prompto`、`prompto-action` 迁移的文档说明
- 为旧语法与新语法都建立回归测试

完成标准：

- 用户可以渐进迁移，不必一次性改完全部历史文档

## 5. Markdown Outline Viewer 实施计划

### 5.1 阶段 O0：先恢复可维护源码结构

当前相关文件：

- `out/extension.js`
- `out/extensionAPI.js`
- `out/markdownOutlineWebview.js`
- `package.json`

当前风险：

- 工作区中只看到了编译产物，没有看到原始 `src/` 目录
- `package.json` 仍然声明了 `tsc -p ./` 的编译脚本，但工作区中未发现 `tsconfig.json`

行动项：

- 在大改行为之前，先恢复或重建 `src/` 目录
- 明确 `out/` 只作为构建产物，不再作为主要维护入口
- 补齐 `tsconfig.json`，恢复可编译基线

建议新增文件：

- `src/extension.ts`
- `src/extensionAPI.ts`
- `src/markdownOutlineWebview.ts`
- `tsconfig.json`

完成标准：

- 后续元信息改造都发生在源码层，而不是直接改生成文件

### 5.2 阶段 O1：扩展 Python 解析器支持统一元信息

当前相关文件：

- `python/markdown_parser.py`

行动项：

- 在标题解析之外，新增 `md-meta` 解析
- 将归一化后的元信息挂载到每个标题项上
- 将旧 `outline` 注释块归一化到 `outline` 命名空间
- 如有必要，输出文档级默认值

建议扩展的解析结果：

- `flat_outline[*].metadata`
- `document_metadata`

关键原则：

- 大纲项目只消费 `outline` 命名空间，不要在展示逻辑里耦合 `prompto` 和 `flow`

完成标准：

- 解析器能返回每个标题节点的生效 `outline.status`

### 5.3 阶段 O2：在大纲 UI 中消费状态

当前相关文件：

- `media/main.js`

行动项：

- 让 UI 读取 `outline.status`
- 在标题旁展示状态徽标、颜色或图标
- 对未知或缺失状态做优雅降级

可能同时涉及：

- `media/main.css`
- 恢复后的 TypeScript Webview 源码

完成标准：

- 大纲状态来自统一元信息，而不是继续依赖单独的临时语法

### 5.4 阶段 O3：兼容与诊断

行动项：

- 继续兼容旧 `<!-- outline -->` 语法
- 对同一标题绑定多个宿主块给出警告
- 对错误放置位置与错误格式给出诊断

完成标准：

- 旧文档仍能正常展示
- 新语法拥有更完整的校验反馈

## 6. 推荐执行顺序

1. 冻结规范与共享样例
2. 在 Prompto 中实现 `md-meta` 解析与旧语法归一化
3. 在 Markdown Outline Viewer 中实现 `md-meta` 解析与旧语法归一化
4. 回到 Prompto，补齐创作辅助与诊断
5. 在 Prompto 中建设 Flow 提取服务
6. 在 Prompto 中建设 Flow Webview 与节点执行交互
7. 补充迁移文档、示例文档与回归验证

这个顺序的核心是先稳定数据契约，再建设图形交互。

## 7. 里程碑验收标准

### 里程碑 A：共享契约稳定

- 规范文档冻结
- 样例集可用
- 两边认可同一套归一化模型

### 里程碑 B：双解析器稳定

- Prompto 能解析 `md-meta` 与旧 prompt 语法
- Markdown Outline Viewer 能解析 `md-meta` 与旧 outline 语法
- 两边面对同一份样例文档得到等价结果

### 里程碑 C：创作体验稳定

- Prompto 补全与诊断支持新语法
- 示例与迁移说明可用

### 里程碑 D：Flow 体验交付

- Prompto 能从 Markdown 自动生成流程图
- 图节点交互能回到现有 prompt 执行链路

## 8. 风险与缓解

| 风险 | 影响 | 缓解方式 |
| --- | --- | --- |
| TypeScript 与 Python 解析结果漂移 | 高 | 建立共享样例与归一化输出断言 |
| 旧语法长期成为默认入口，导致新规范失效 | 中 | 继续兼容旧语法，但文档、补全、示例一律转向 `md-meta` |
| Markdown Outline Viewer 继续从编译产物直接演进 | 高 | 把恢复 `src/` 与 `tsconfig.json` 作为 O0 前置条件 |
| 在解析层稳定之前就先做流程图 UI | 高 | 明确把流程图交互放到 P5，而不是 P1 |

## 9. 最小首切片

如果要先做一条最小但有价值的交付，建议顺序如下：

1. 在 Prompto 中加入 `md-meta` 解析与旧语法归一化
2. 在 Prompto 中更新补全与文档
3. 在 Markdown Outline Viewer 中加入 `md-meta` 解析与 `outline.status` 展示

在这个首切片完成之前，不建议先开工 Flow Webview。
