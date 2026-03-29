var i18n = {
    en: {
        nav_how: "How It Works",
        nav_data: "Capabilities",
        badge: "✦ ContextPack · JudgeLoop · Promotion by Evidence",
        hero_gradient: "Turn coding agents",
        hero_rest: "into governed engineering runs.",
        subtitle: "Salacia is the operating harness for AI coding agents: it builds the right context, enforces boundaries, verifies the outcome, and only then promotes the patch.",
        copy: "click to copy",
        compat: "Claude Code · Codex · Cursor · Cline · OpenCode · Antigravity",
        feature1_val: "ContextPack",
        feature1_label: "repo map · working set · history · guardrails",
        feature2_val: "JudgeLoop",
        feature2_label: "accept · reject · blocked",
        feature3_val: "Evidence",
        feature3_label: "runtime · eval · release gate speak one language",
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
        cta_title: "Smarter agents help.<br><span class=\"purple\">Governed runs</span> scale.",
        cta_desc: "Open source. Apache 2.0. Built for teams that want coding agents to behave like engineering systems, not demos.",
        cta_gh: "⭐ Star on GitHub",
        cta_npm: "📦 View on npm",
        page_title: "Salacia — The Operating Harness for AI Coding Agents"
    },
    zh: {
        nav_how: "怎么工作",
        nav_data: "核心能力",
        badge: "✦ ContextPack · JudgeLoop · Promotion by Evidence",
        hero_gradient: "把 coding agent",
        hero_rest: "变成可治理的工程运行。",
        subtitle: "Salacia 是 AI coding agents 的 operating harness：先给对的上下文，设清楚边界，跑完强制验证，最后才决定补丁能不能晋升。",
        copy: "复制",
        compat: "Claude Code · Codex · Cursor · Cline · OpenCode · Antigravity",
        feature1_val: "ContextPack",
        feature1_label: "repo map · working set · history · guardrails",
        feature2_val: "JudgeLoop",
        feature2_label: "accept · reject · blocked",
        feature3_val: "Evidence",
        feature3_label: "runtime · eval · release gate 说同一种语言",
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
        cta_title: "更聪明的 agent 很重要。<br><span class=\"purple\">可治理的运行</span> 才能规模化。",
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
