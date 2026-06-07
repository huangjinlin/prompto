# 📋 准备
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
  id: daily-prepare
  title: 准备
  entry: prepare.entry
-->

## 🌀 启动claudeCode
<!-- md-meta
version: 1
flow:
  id: prepare.entry
  kind: start
  next: prepare.readClaude
-->
## 📖 读取任务
<!-- md-meta
version: 1
flow:
  id: prepare.readClaude
  kind:  action
  next: prepare.finish
-->
## ✅ 完成
<!-- md-meta
version: 1
flow:
  id: prepare.finish
  kind: end
-->

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

## 📤 汇报入口

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

## 是否有交易日

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
根据交易日历和实盘记录判断今天是否有交易。

## 🟢 有交易日

<!-- md-meta
version: 1
flow:
  id: report.trade
  kind: action
  next: report.finish
prompto:
  prompt: 检查日报/检查日报(有交易)
outline:
  status: done
-->
1. 检查日报是否正常`01-我/实盘反馈/第10周/汇报/简版汇报-v1-20260605.md`
2. 检查偏差是否正常`01-我/实盘反馈/第10周/偏差/偏差-20260605.md`

## 🔴 无交易日

<!-- md-meta
version: 1
flow:
  id: report.noTrade
  kind:  action
  next: report.finish
prompto:
  prompt: 检查日报/检查日报(无交易)
outline:
  status: todo
-->
1. 检查日报是否正常`01-我/实盘反馈/第10周/汇报/简版汇报-v1-20260605.md`
<!-- md-meta
version: 1
scope: action
prompto:
  title: 测试1
  promptContent: |
    Summarize the current context.
-->
动作1。
<!-- md-meta
version: 1
scope: action
prompto:
  title: 测试2
  promptContent: |
    Summarize the current context.
-->
动作2。

## ✅ 完成

<!-- md-meta
version: 1
flow:
  id: report.finish
  kind: end
outline:
  status: done
-->
流程完成。
