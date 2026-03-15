# 小红书文章：Salacia Harness

---

## 标题（二选一）

**A:** 你的AI写代码还在盲猜？我给它装了一双眼 👀
**B:** SWE-bench 提了 7 个点，就靠这一层"外挂" 🚀

---

## 正文

哥们 SWE-bench 500 道真实 GitHub Bug，裸跑 Codex 5.4 Pro 解决率 71.6%，加了一层 Salacia Harness 直接到 79.2%，多解了 38 个 issue ✅

纯分享，没套路，走过路过点个赞给个 star 🙏

---

### 背景

最近在搞 AI coding agent 的方向，发现一个离谱的事：

不管你用 Codex、Claude Code 还是 Cursor，它们的"Plan 模式"听着很高级——**但本质是让模型自己猜该改哪些文件**。

10 万行代码的项目，模型靠自己阅读理解找目标文件？翻到一半忘了前面看的啥？大家应该都遇到过这种情况 🤦

所以我做了 Salacia，**一层套在任何 AI coding agent 外面的 harness** — 模型开始思考之前，先用确定性工具帮它看清楚战场。

---

### Plan 模式 vs Harness，到底差在哪？

说白了就一句话 👇

> **Plan 模式 = 让模型自己想该怎么做**
> **Salacia Harness = 在模型想之前，先帮它看清楚该改哪**

| 维度 | Plan 模式 | Salacia Harness |
|------|-----------|-----------------|
| 文件定位 | 模型猜，逐个读 | ripgrep 搜索 + PageRank 排名 🎯 |
| 代码结构 | 靠 context window | Tree-sitter AST 符号图 🗺️ |
| 范围控制 | 模型自律（容易跑偏） | Contract 合约 + 保护路径 📋 |
| 失败恢复 | 没有 | 快照回退 → 带反馈重试 🔄 |
| 确定性 | 概率推理（每次不一样） | 预计算完全确定性 ✅ |

重点来了：**两者不是替代关系，是叠加关系** ⬇️

```
Salacia Harness（预计算 + 后验证 + 重试）
  └── Codex Plan Mode（模型自己推理）
        └── Codex 执行（写代码）
```

模型自身的 plan 能力还在，Salacia 只是在它之前多做一步"侦查"，之后多做一步"验收"。

---

### Benchmark 数据

SWE-bench Verified，500 个真实 GitHub issue，确定性测试评估 👇

| 指标 | Codex 5.4 Pro（裸跑）| Codex 5.4 Pro + Salacia |
|------|---------------------|------------------------|
| 解决率 | 71.6% | **79.2%** ✅ |
| Pass@3 | 74.2% | **83.8%** |
| 额外解决 | — | +38 个 issue |
| 由重试挽救 | — | 12 个 |
| 回退（regressions）| — | **0** 个 |

+7.6 pp 的提升全部来自三个地方：
1. **Fault Localization**（ripgrep + PageRank）帮模型精准定位目标文件 → 减少"空补丁"
2. **结构化 Prompt**（Intent IR + Contract）防止模型跑偏做无关修改
3. **Rollback + Retry**（快照回退 + 带失败信息重试）给模型第二次机会

真实案例：pylint-7080（24,770 字符的超长 issue）
- 裸跑 Codex → **空补丁**（太复杂了不知道从哪下手）
- Salacia → ripgrep 定位 3 个关键文件 → 符号图理解依赖 → Codex 生成正确补丁 → **测试通过** ✅

---

### Salacia 到底做了什么（5 层工程）

#### 🎯 模型启动前（Pre-pass）

1. **Fault Localization** — 用 ripgrep 从 issue 提取关键词搜代码，PageRank 排名相关文件
2. **Repo Map** — Tree-sitter 解析 AST，构建函数/类符号图
3. **Intent IR** — 从 issue 文本提取结构化意图：目标、约束、验收标准、风险
4. **Contract** — 定义修改范围（in-scope files）+ 保护路径（不许碰的文件）

全部注入 prompt → 模型第一个 token 就已经知道该找哪些文件

#### ✅ 模型完成后（Post-pass）

5. **Verify & Retry** — 跑本地测试 → 合约合规检查 → 如果失败 → git 快照回退 → 把失败信息注入 prompt 重试

---

### 怎么用

```bash
npx salacia harness
```

支持的 Agent：Codex、Claude Code、Aider、Cursor

不改你的工作流，不替换你的模型，**一层包裹，即插即用**。

---

### 关于我

做过医疗 AI + 数据工程，现在做 AI coding infrastructure。之前也开源了 [Open-Revise](https://github.com/StartripAI/Open-Revise-industry)（面向学术/工作的 revision infrastructure），感兴趣也可以看看。

Salacia 仓库：**https://github.com/StartripAI/Salacia**

欢迎 ⭐ Star、Fork、Issue，有问题评论区聊 💬

---

## 标签

```
#AI编程 #CodingAgent #Codex #ClaudeCode #Cursor #开源 #SWEbench #HarnessEngineering #AITools #程序员
```

---

## 封面图建议

用 Salacia 营销页截图（benchmark 对比那张），左上角加 emoji 标题：
"🎯 裸跑 71.6% → 加一层 79.2%"
