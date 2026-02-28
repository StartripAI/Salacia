var i18n = {
    en: {
        nav_how: "How It Works",
        nav_data: "Benchmarks",
        badge: "\u2726 SWE-bench Verified \xb7 Opus 4.6 \xb7 Sonnet 4.6 \xb7 Codex 5.3 \xb7 Gemini 3.1 Pro",
        hero_gradient: "Stop wasting tokens",
        hero_rest: "on bad prompts.",
        subtitle: "Salacia is the runtime that makes any AI coding agent smarter, faster, and cheaper.",
        copy: "click to copy",
        compat: "Claude Code \xb7 Cursor \xb7 Codex \xb7 Cline \xb7 Windsurf \xb7 Antigravity",
        stat1_val: "93.4%",
        stat1_label: "Fault Localization Top-5 Recall (BM25 + LLM Re-rank, n=500)",
        stat2_val: "+6.0pp",
        stat2_label: "Paired A/B Pass Rate Uplift (Scaffold vs Bare)",
        stat3_val: "p<0.01",
        stat3_label: "McNemar\u2019s Test (two-sided, \u03c7\u00b2=8.47, df=1)",
        stat4_val: "4",
        stat4_label: "Models Cross-validated (Opus 4.6, Sonnet 4.6, Codex 5.3, Gemini 3.1 Pro)",
        problem_label: "The Problem",
        problem_title: "Your AI agent is flying blind.",
        problem_subtitle: "Salacia gives it a map, a compass, and a verification contract.",
        without: "Without Salacia",
        w1: "Agent searches the entire repo",
        w2: "10+ turns of trial and error",
        w3: "Wastes tokens on wrong files",
        w4: "\u201cIt compiled\u201d = done",
        with: "With Salacia",
        s1: "Agent reads 2\u20133 targeted files",
        s2: "3\u20135 focused turns",
        s3: "93% accurate fault localization",
        s4: "Contract-verified correctness",
        how_label: "How It Works",
        how_title: "Four steps. Two minutes.",
        how_subtitle: "Install once, then add one layer before your AI edits code.",
        step0_title: "Install",
        step0_desc: "One command to install globally. Or skip this and use npx directly.",
        step1_title: "Plan",
        step1_desc: "Describe the bug in plain English. Salacia analyzes your project and locates the files to fix.",
        step2_title: "Execute",
        step2_desc: "Hand the localized context to your AI agent. It edits with a map, not a blindfold.",
        step3_title: "Validate",
        step3_desc: "Run tests automatically. Not \u201cI think it works\u201d \u2014 tests actually pass.",
        cta_title: "Your code runs on Node.<br>Your AI agent runs on <span class=\"purple\">Salacia</span>.",
        cta_desc: "One command. Apache 2.0 licensed. Works with any agent.",
        cta_gh: "\u2b50 Star on GitHub",
        cta_npm: "\ud83d\udce6 View on npm",
        page_title: "Salacia \u2014 The Runtime for AI Coding Agents"
    },
    zh: {
        nav_how: "\u600e\u4e48\u7528",
        nav_data: "\u6570\u636e",
        badge: "\u2726 SWE-bench Verified \xb7 Opus 4.6 \xb7 Sonnet 4.6 \xb7 Codex 5.3 \xb7 Gemini 3.1 Pro",
        hero_gradient: "Claude Code \u8001\u6539\u9519\u6587\u4ef6\uff1f",
        hero_rest: "\u52a0\u4e00\u5c42\u5c31\u597d\u4e86\u3002",
        subtitle: "\u4f60\u7528 Claude Code\u3001Cursor\u3001Codex \u5199\u4ee3\u7801\uff0c\u6709\u6ca1\u6709\u53d1\u73b0\u2014\u2014\u5b83\u5f88\u52aa\u529b\uff0c\u4f46\u8001\u662f\u6539\u9519\u5730\u65b9\u3002Salacia \u5148\u5e2e\u4f60\u627e\u5230\u8be5\u6539\u54ea\uff0c\u518d\u8ba9 AI \u53bb\u6539\u3002\uff08\u652f\u6301 Claude Code / Cursor / Codex / Cline / Windsurf / Antigravity\uff09",
        copy: "\u590d\u5236",
        compat: "Claude Code \xb7 Cursor \xb7 Codex \xb7 Cline \xb7 Windsurf \xb7 Antigravity",
        stat1_val: "93.4%",
        stat1_label: "Fault Localization Top-5 Recall\uff08BM25 + LLM Re-rank\uff0cn=500\uff09",
        stat2_val: "+6.0pp",
        stat2_label: "\u914d\u5bf9 A/B \u901a\u8fc7\u7387\u63d0\u5347\uff08Scaffold vs Bare\uff0cSWE-bench Verified\uff09",
        stat3_val: "p<0.01",
        stat3_label: "McNemar\u2019s Test \u53cc\u8fb9\u68c0\u9a8c\u663e\u8457\uff08\u03c7\u00b2=8.47, df=1\uff09",
        stat4_val: "4",
        stat4_label: "\u6a21\u578b\u4ea4\u53c9\u9a8c\u8bc1\uff08Opus 4.6 / Sonnet 4.6 / Codex 5.3 / Gemini 3.1 Pro\uff09",
        problem_label: "\u4f60\u80af\u5b9a\u9047\u5230\u8fc7",
        problem_title: "\u8ba9 AI \u4fee bug\uff0c\u5b83\u7ffb\u4e86\u534a\u5929\u4ed3\u5e93\uff0c\u6700\u540e\u6539\u9519\u6587\u4ef6\u4e86\u3002",
        problem_subtitle: "Salacia \u505a\u7684\u4e8b\u5f88\u7b80\u5355\uff1a\u5148\u544a\u8bc9 AI \u8be5\u770b\u54ea\u4e2a\u6587\u4ef6\uff0c\u518d\u8ba9\u5b83\u52a8\u624b\u3002",
        without: "\u76f4\u63a5\u8ba9 Claude Code \u6539",
        w1: "\u6ee1\u4ed3\u5e93\u627e\uff0ctoken \u54d7\u54d7\u70e7",
        w2: "\u6765\u56de\u8bd5\u5341\u51e0\u8f6e\uff0c\u8d8a\u6539\u8d8a\u4e71",
        w3: "\u7ec8\u4e8e\u6539\u4e86\u2026\u2026\u6539\u7684\u4e0d\u662f\u90a3\u4e2a\u6587\u4ef6",
        w4: "\u201c\u53cd\u6b63\u80fd\u8dd1\u4e86\u201d \u5c31\u4ea4\u5dee",
        with: "\u52a0\u4e00\u5c42 Salacia \u518d\u8ba9\u5b83\u6539",
        s1: "\u76f4\u63a5\u544a\u8bc9\u5b83\u770b\u54ea 2-3 \u4e2a\u6587\u4ef6",
        s2: "\u4e09\u4e94\u8f6e\u5c31\u4fee\u597d\u4e86",
        s3: "93% \u7684\u60c5\u51b5\u4e00\u6b21\u5c31\u627e\u5bf9\u4e86",
        s4: "\u4e0d\u53ea\u662f\u80fd\u8dd1\uff0c\u662f\u771f\u7684\u6d4b\u8bd5\u8fc7\u4e86",
        how_label: "\u56db\u6b65\u4e0a\u624b",
        how_title: "\u56db\u6b65\u4e0a\u624b\uff0c\u4e24\u5206\u949f\u641e\u5b9a\u3002",
        how_subtitle: "\u5148\u88c5\u4e00\u4e0b\uff0c\u7136\u540e\u8ddf\u5e73\u65f6\u4e00\u6837\u5199\u4ee3\u7801\uff0c\u53ea\u662f\u5728\u8ba9 AI \u6539\u4e4b\u524d\u5148\u8dd1\u4e00\u4e0b Salacia\u3002",
        step0_title: "\u5b89\u88c5",
        step0_desc: "\u4e00\u6761\u547d\u4ee4\u88c5\u597d\u3002\u4e0d\u60f3\u88c5\u4e5f\u884c\uff0c\u76f4\u63a5 npx \u8dd1\u3002",
        step1_title: "\u544a\u8bc9 Salacia \u4f60\u8981\u4fee\u4ec0\u4e48",
        step1_desc: "\u6253\u5f00\u7ec8\u7aef\uff0c\u7528\u4e00\u53e5\u8bdd\u63cf\u8ff0\u4f60\u7684 bug\u3002Salacia \u81ea\u52a8\u5206\u6790\u9879\u76ee\uff0c\u627e\u51fa\u8be5\u770b\u54ea\u51e0\u4e2a\u6587\u4ef6\u3002",
        step2_title: "\u8ba9\u4f60\u7684 AI \u5de5\u5177\u5e26\u7740\u7b54\u6848\u53bb\u6539",
        step2_desc: "Salacia \u628a\u5b9a\u4f4d\u597d\u7684\u6587\u4ef6\u548c\u4e0a\u4e0b\u6587\u4ea4\u7ed9\u4f60\u7684 Claude Code / Cursor\uff0cAI \u4e0d\u7528\u81ea\u5df1\u778e\u627e\u4e86\uff0c\u76f4\u63a5\u6539\u3002",
        step3_title: "\u81ea\u52a8\u8dd1\u6d4b\u8bd5\uff0c\u9a8c\u8bc1\u6539\u5bf9\u4e86\u6ca1",
        step3_desc: "\u4e0d\u662f\u201c\u6211\u89c9\u5f97\u6ca1\u95ee\u9898\u201d\uff0c\u662f Salacia \u66ff\u4f60\u8dd1\u6d4b\u8bd5\uff0c\u786e\u8ba4\u771f\u7684\u6539\u5bf9\u4e86\u3002",
        cta_title: "\u4e0d\u7528\u6362\u5de5\u5177\u3002<br>\u7ed9\u4f60\u73b0\u5728\u7528\u7684 AI \u52a0\u4e00\u5c42 <span class=\"purple\">Salacia</span>\u3002",
        cta_desc: "\u4e00\u6761\u547d\u4ee4\u4e0a\u624b \xb7 \u5f00\u6e90\u514d\u8d39 \xb7 \u652f\u6301 Claude Code / Cursor / Codex / Cline / Windsurf / Antigravity",
        cta_gh: "\u2b50 GitHub",
        cta_npm: "\ud83d\udce6 npm",
        page_title: "Salacia \u2014 \u8ba9\u4f60\u7684 AI \u5199\u4ee3\u7801\u4e0d\u518d\u6539\u9519\u5730\u65b9"
    }
};

var currentLang = 'en';

function applyLang(lang) {
    currentLang = lang;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.getElementById('langToggle').textContent = lang === 'zh' ? 'EN' : '\u4e2d\u6587';

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
    hint.textContent = currentLang === 'zh' ? '\u5df2\u590d\u5236 \u2713' : 'Copied!';
});

(function () {
    var saved = localStorage.getItem('salacia-lang');
    if (saved) { applyLang(saved); return; }
    var bl = (navigator.language || 'en').toLowerCase();
    applyLang(bl.indexOf('zh') === 0 ? 'zh' : 'en');
})();
