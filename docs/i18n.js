var i18n = {
    en: {
        nav_how: "How It Works",
        nav_data: "Capabilities",
        badge: "✦ ContextPack · JudgeLoop · Evidence-Native Harness",
        hero_gradient: "Give your coding agent",
        hero_rest: "a real harness.",
        subtitle: "Salacia builds context, runs the agent in a bounded workspace, judges the result, and only then promotes the patch.",
        copy: "click to copy",
        compat: "Claude Code · Codex · Cursor · Cline · OpenCode · Antigravity",
        feature1_val: "ContextPack",
        feature1_label: "repo map · working set · history · guardrails",
        feature2_val: "JudgeLoop",
        feature2_label: "accept · reject · blocked",
        feature3_val: "Evidence",
        feature3_label: "runtime · eval · release gate share one report shape",
        problem_label: "The Shift",
        problem_title: "This is not another coding agent.",
        problem_subtitle: "Salacia is the harness between your repository and the agent you already use.",
        without: "Agent alone",
        w1: "It must rediscover the repo every run",
        w2: "Execution and judgment are mixed together",
        w3: "“Looks good” becomes the promotion policy",
        w4: "Benchmarks and product runs speak different languages",
        with: "Agent + Salacia",
        s1: "ContextPack gives it a bounded map",
        s2: "JudgeLoop decides accept/reject/blocked",
        s3: "Verification is mandatory, not optional",
        s4: "Runtime, eval, and release reuse the same evidence",
        how_label: "How It Works",
        how_title: "Four steps. One harness.",
        how_subtitle: "The public flow is now `init -> design -> run -> judge/trace`.",
        step0_title: "Write `program.md`",
        step0_desc: "Declare the goal, mutable surface, verification, and promotion policy.",
        step1_title: "Build context",
        step1_desc: "Compile the program into a blueprint and build a bounded ContextPack.",
        step2_title: "Run the agent",
        step2_desc: "Dispatch the agent in an isolated workspace with the generated context.",
        step3_title: "Judge and inspect",
        step3_desc: "Accept, reject, or block the patch, then inspect the trace and evidence.",
        cta_title: "Your repo stays the source of truth.<br>Your agent gets a <span class=\"purple\">harness</span>.",
        cta_desc: "Open source. Apache 2.0. Built for coding agents and the teams that run them.",
        cta_gh: "⭐ Star on GitHub",
        cta_npm: "📦 View on npm",
        page_title: "Salacia — The Harness Between Your Repo and Your Coding Agent"
    },
    zh: {
        nav_how: "怎么工作",
        nav_data: "核心能力",
        badge: "✦ ContextPack · JudgeLoop · Evidence-Native Harness",
        hero_gradient: "给你的 coding agent",
        hero_rest: "一个真正的 harness。",
        subtitle: "Salacia 先构建上下文，再在受控工作区里运行 agent，最后用 judge 决定是否晋升补丁，而不是直接相信“看起来没问题”。",
        copy: "复制",
        compat: "Claude Code · Codex · Cursor · Cline · OpenCode · Antigravity",
        feature1_val: "ContextPack",
        feature1_label: "repo map · working set · history · guardrails",
        feature2_val: "JudgeLoop",
        feature2_label: "accept · reject · blocked",
        feature3_val: "Evidence",
        feature3_label: "runtime · eval · release gate 共享同一种报告结构",
        problem_label: "定位变化",
        problem_title: "这不是另一个 coding agent。",
        problem_subtitle: "Salacia 是你的仓库和现有 agent 之间的 harness。",
        without: "只有 agent",
        w1: "每次都要重新摸索仓库",
        w2: "执行和判断混在一起",
        w3: "“看起来行”就成了晋升标准",
        w4: "benchmark 和产品运行说的是两套语言",
        with: "Agent + Salacia",
        s1: "ContextPack 给它一个有边界的地图",
        s2: "JudgeLoop 明确决定 accept/reject/blocked",
        s3: "验证是强制项，不是可选项",
        s4: "runtime、eval、release 复用同一套 evidence",
        how_label: "怎么工作",
        how_title: "四步完成，一条 harness 主链。",
        how_subtitle: "新的公开主流程是 `init -> design -> run -> judge/trace`。",
        step0_title: "写 `program.md`",
        step0_desc: "先定义目标、可改范围、验证命令和晋升策略。",
        step1_title: "构建上下文",
        step1_desc: "把 program 编译成 blueprint，再构建有预算的 ContextPack。",
        step2_title: "运行 agent",
        step2_desc: "在隔离工作区里，让 agent 带着上下文执行。",
        step3_title: "判断并追踪",
        step3_desc: "决定 accept / reject / blocked，然后查看 trace 和 evidence。",
        cta_title: "你的仓库仍然是事实源。<br>你的 agent 得到一条 <span class=\"purple\">harness</span>。",
        cta_desc: "开源 · Apache 2.0 · 面向 coding agents 和运行它们的团队",
        cta_gh: "⭐ GitHub",
        cta_npm: "📦 npm",
        page_title: "Salacia — 你的仓库和 coding agent 之间的 harness"
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
