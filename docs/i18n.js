var i18n = {
    en: {
        nav_how: "How It Works",
        nav_data: "Capabilities",
        nav_usecases: "Use Cases",
        badge: "✦ ContextPack · JudgeLoop · Promotion by Evidence",
        hero_gradient: "Turn coding agents",
        hero_rest: "into governed engineering runs.",
        subtitle: "Salacia is the operating harness for AI coding agents: it builds the right context, enforces boundaries, verifies the outcome, and only then promotes the patch.",
        copy: "click to copy",
        compat: "Claude Code · Codex · Cursor · Cline · OpenCode · Antigravity",
        tag_oss: "Open source",
        tag_cli: "CLI-first",
        tag_eval: "Eval-native",
        tag_release: "Release gates",
        tag_mcp: "MCP-ready",
        hero_cta_primary: "See the repo",
        hero_cta_secondary: "See how a run works",
        panel_label: "Run shape",
        flow_1_title: "Program",
        flow_1_desc: "Goal, mutable surface, verification, promotion policy.",
        flow_2_title: "ContextPack",
        flow_2_desc: "Repo map, working set, history, guardrails.",
        flow_3_title: "Judge",
        flow_3_desc: "Accept, reject, or block with traceable evidence.",
        feature1_val: "ContextPack",
        feature1_label: "repo map · working set · history · guardrails",
        feature2_val: "JudgeLoop",
        feature2_label: "accept · reject · blocked",
        feature3_val: "Evidence",
        feature3_label: "runtime · eval · release gate speak one language",
        showcase_label: "Real Artifact",
        showcase_title: "What the runtime actually emits.",
        showcase_subtitle: "Not a hand-drawn mock. A real trace from a blueprint-backed run.",
        showcase_tag_1: "real trace",
        showcase_tag_2: "judge report",
        showcase_tag_3: "accepted run",
        problem_label: "Why Salacia",
        problem_title: "Agents are impressive. Runs are still fragile.",
        problem_subtitle: "Salacia turns a raw agent loop into an engineering system: bounded context, explicit policy, hard verification, and a real promotion decision.",
        without: "Raw agent run",
        w1: "It re-discovers the repository from scratch every time",
        w2: "Execution and judgment collapse into one opaque loop",
        w3: "A generated patch can quietly become a promoted patch",
        w4: "Product runs and benchmark runs produce incompatible evidence",
        with: "Salacia harnessed run",
        s1: "ContextPack gives the agent a bounded, high-signal map",
        s2: "JudgeLoop turns verification and policy into a hard verdict",
        s3: "Promotion is explicit, not implied",
        s4: "Runtime, eval, and release share one evidence model",
        switch_label: "Choose Your Lens",
        switch_title: "One project, three ways to use it.",
        switch_subtitle: "This is where Salacia stops looking like a demo and starts looking like infrastructure.",
        switch_tab_devs: "For developers",
        switch_tab_builders: "For agent builders",
        switch_tab_teams: "For teams",
        devs_kicker: "Drop it in front of the agent you already use.",
        devs_title: "Stop every run from starting at zero.",
        devs_desc: "Use Salacia when the model is smart enough to solve the task, but still wastes time loading the wrong files, changing too much, or shipping changes without a clear verdict.",
        devs_point_1: "🧭 Bounded context instead of a giant prompt",
        devs_point_2: "🧪 Verification-backed promotion",
        devs_point_3: "📚 Traceable evidence after every run",
        builders_kicker: "Use Salacia as the execution layer.",
        builders_title: "Put a runtime underneath your coding agent.",
        builders_desc: "If you are building an agent, IDE bridge, or internal assistant, Salacia gives you a control plane, a context plane, and a judge loop without forcing you to replace your agent model.",
        builders_point_1: "📦 `program.md` + blueprint as a control plane",
        builders_point_2: "🔌 CLI, MCP, and release-gate surfaces",
        builders_point_3: "⚖️ Judge reports you can consume programmatically",
        teams_kicker: "Turn agent runs into team workflows.",
        teams_title: "Bring eval and release policy closer to production.",
        teams_desc: "Salacia is useful when your problem is no longer “can the model code,” but “how do we make these runs reviewable, comparable, and safe to promote.”",
        teams_point_1: "📈 Runtime, eval, and release share one evidence model",
        teams_point_2: "🛡️ Mutable surface and protected paths are explicit",
        teams_point_3: "🚦 Accept / reject / blocked is a policy output, not a vibe",
        how_label: "How It Works",
        how_title: "From repository to promoted patch.",
        how_subtitle: "One control file. One bounded run. One verdict.",
        step0_title: "Write `program.md`",
        step0_desc: "Declare the goal, mutable surface, verification, and promotion policy in a form the runtime can enforce.",
        step1_title: "Build context",
        step1_desc: "Compile the program into a blueprint and build a bounded ContextPack instead of dumping the whole repo into the prompt.",
        step2_title: "Run the agent",
        step2_desc: "Dispatch the agent in an isolated workspace with the generated context, budget, and guardrails.",
        step3_title: "Judge and inspect",
        step3_desc: "Accept, reject, or block the patch, then inspect the full trace and evidence behind that decision.",
        cta_title: "Smarter agents help.<br><span class=\"accent-text\">Governed runs</span> scale.",
        cta_desc: "Open source. Apache 2.0. Built for teams that want coding agents to behave like engineering systems, not demos.",
        cta_gh: "⭐ Star on GitHub",
        cta_npm: "📦 View on npm",
        page_title: "Salacia — The Operating Harness for AI Coding Agents"
    },
    zh: {
        nav_how: "怎么工作",
        nav_data: "核心能力",
        nav_usecases: "使用场景",
        badge: "✦ ContextPack · JudgeLoop · Promotion by Evidence",
        hero_gradient: "把 coding agent",
        hero_rest: "变成可治理的工程运行。",
        subtitle: "Salacia 是 AI coding agents 的 operating harness：先给对的上下文，设清楚边界，跑完强制验证，最后才决定补丁能不能晋升。",
        copy: "复制",
        compat: "Claude Code · Codex · Cursor · Cline · OpenCode · Antigravity",
        tag_oss: "开源",
        tag_cli: "CLI 优先",
        tag_eval: "Eval 原生",
        tag_release: "Release gates",
        tag_mcp: "MCP 就绪",
        hero_cta_primary: "查看仓库",
        hero_cta_secondary: "看一条 run 怎么走",
        panel_label: "运行结构",
        flow_1_title: "Program",
        flow_1_desc: "目标、可改范围、验证、晋升策略。",
        flow_2_title: "ContextPack",
        flow_2_desc: "Repo map、working set、历史、guardrails。",
        flow_3_title: "Judge",
        flow_3_desc: "基于 evidence 给出 accept、reject 或 blocked。",
        feature1_val: "ContextPack",
        feature1_label: "repo map · working set · history · guardrails",
        feature2_val: "JudgeLoop",
        feature2_label: "accept · reject · blocked",
        feature3_val: "Evidence",
        feature3_label: "runtime · eval · release gate 说同一种语言",
        showcase_label: "真实产物",
        showcase_title: "看看 runtime 真正吐出来的是什么。",
        showcase_subtitle: "不是手画 mock，也不是论文图。是一条 blueprint-backed run 的真实 trace。",
        showcase_tag_1: "真实 trace",
        showcase_tag_2: "judge report",
        showcase_tag_3: "accepted run",
        problem_label: "为什么是 Salacia",
        problem_title: "Agent 已经很强了，但 run 还很脆。",
        problem_subtitle: "Salacia 把一条原始 agent loop 变成工程系统：有边界的上下文、明确策略、硬验证，以及真实的晋升决策。",
        without: "原始 agent run",
        w1: "每次都像第一次进仓库，重新摸索上下文",
        w2: "执行和判断糊成一团，看不清哪里出了问题",
        w3: "生成出来的 patch 会悄悄变成被接受的 patch",
        w4: "产品运行和 benchmark 产出的证据根本对不上",
        with: "Salacia harnessed run",
        s1: "ContextPack 给 agent 一个高信号、有限边界的地图",
        s2: "JudgeLoop 把验证和策略变成硬结论",
        s3: "是否晋升是明确动作，不是默认发生",
        s4: "runtime、eval、release 复用同一套 evidence 模型",
        switch_label: "换个视角看",
        switch_title: "一个项目，三种进入方式。",
        switch_subtitle: "Salacia 不只是 demo 页面上的概念，它应该像基础设施一样被理解。",
        switch_tab_devs: "给开发者",
        switch_tab_builders: "给 agent builders",
        switch_tab_teams: "给团队",
        devs_kicker: "放在你已经在用的 agent 前面。",
        devs_title: "别让每一轮都从零开始。",
        devs_desc: "当模型其实已经能做这件事，但总是先读错文件、改太多、或者跑完没有明确结论时，Salacia 才是缺的那一层。",
        devs_point_1: "🧭 有边界的上下文，而不是超长 prompt",
        devs_point_2: "🧪 有验证支撑的晋升判断",
        devs_point_3: "📚 每次运行都有可追踪 evidence",
        builders_kicker: "把 Salacia 当成执行层。",
        builders_title: "给你的 coding agent 垫一层 runtime。",
        builders_desc: "如果你在做 agent、IDE bridge 或内部开发助手，Salacia 给你 control plane、context plane 和 judge loop，而不是逼你替换模型。",
        builders_point_1: "📦 `program.md` + blueprint 作为控制面",
        builders_point_2: "🔌 CLI、MCP、release-gate 这些表面都现成",
        builders_point_3: "⚖️ Judge report 可以直接被程序消费",
        teams_kicker: "把 agent run 变成团队工作流。",
        teams_title: "让 eval 和 release policy 更接近生产。",
        teams_desc: "当你的问题已经不是“模型会不会写代码”，而是“怎么让这些运行可审查、可比较、可安全晋升”时，Salacia 才真正有价值。",
        teams_point_1: "📈 Runtime、eval、release 共享一套 evidence 模型",
        teams_point_2: "🛡️ Mutable surface 和 protected paths 明确可见",
        teams_point_3: "🚦 Accept / reject / blocked 是策略输出，不是感觉",
        how_label: "怎么工作",
        how_title: "从仓库到可晋升补丁。",
        how_subtitle: "一个控制文件，一次受控运行，一个明确结论。",
        step0_title: "写 `program.md`",
        step0_desc: "把目标、可改范围、验证命令和晋升策略写成 runtime 可以强制执行的控制面。",
        step1_title: "构建上下文",
        step1_desc: "先编译成 blueprint，再构建有预算的 ContextPack，而不是把整个仓库一股脑塞进 prompt。",
        step2_title: "运行 agent",
        step2_desc: "在隔离工作区里，让 agent 带着上下文、预算和 guardrails 执行。",
        step3_title: "判断并追踪",
        step3_desc: "给出 accept / reject / blocked 的明确结果，并把背后的 trace 与 evidence 全部留下来。",
        cta_title: "更聪明的 agent 很重要。<br><span class=\"accent-text\">可治理的运行</span> 才能规模化。",
        cta_desc: "开源 · Apache 2.0 · 面向想把 coding agents 真正接进工程系统的团队",
        cta_gh: "⭐ GitHub",
        cta_npm: "📦 npm",
        page_title: "Salacia — AI Coding Agents 的 Operating Harness"
    }
};

var currentLang = 'en';

function applyLang(lang) {
    currentLang = lang;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.getElementById('langToggle').textContent = lang === 'zh' ? 'EN' : '中文';

    var strings = i18n[lang];
    var els = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) {
        var key = els[i].getAttribute('data-i18n');
        if (strings[key] !== undefined) els[i].textContent = strings[key];
    }

    var ctaEl = document.getElementById('ctaTitle');
    if (ctaEl) ctaEl.innerHTML = strings.cta_title;

    document.title = strings.page_title;
    localStorage.setItem('salacia-lang', lang);
}

function toggleLang() {
    applyLang(currentLang === 'en' ? 'zh' : 'en');
}

document.getElementById('copyBtn').addEventListener('click', function () {
    navigator.clipboard.writeText('npx salacia init');
    this.classList.add('copied');
    var hint = this.querySelector('.copy-hint');
    hint.textContent = currentLang === 'zh' ? '已复制 ✓' : 'Copied!';
});

(function () {
    var saved = localStorage.getItem('salacia-lang');
    if (saved) { applyLang(saved); return; }
    var bl = (navigator.language || 'en').toLowerCase();
    applyLang(bl.indexOf('zh') === 0 ? 'zh' : 'en');
})();
