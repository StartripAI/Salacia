const i18n = {
    en: {
        nav_how: "How It Works",
        nav_data: "Benchmarks",
        badge: "\u2726 SWE-bench Verified \xb7 117 Tasks Tested",
        hero_gradient: "Stop wasting tokens",
        hero_rest: "on bad prompts.",
        subtitle: "Salacia is the runtime that makes any AI coding agent smarter, faster, and cheaper.",
        copy: "click to copy",
        compat: "Works with Claude Code \xb7 Codex \xb7 Cursor \xb7 Cline \xb7 any agent",
        stat_bugs: "More Bugs Solved",
        stat_fl: "FL Accuracy",
        stat_win: "Win Ratio",
        stat_tasks: "Tasks Tested",
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
        how_title: "Three commands. That\u2019s it.",
        how_subtitle: "From vibe to verified fix in under a minute.",
        step1_title: "Plan",
        step1_desc: "Parse your intent into a contract with fault-localized context.",
        step2_title: "Execute",
        step2_desc: "Dispatch to your agent with targeted files and test guidance.",
        step3_title: "Validate",
        step3_desc: "Verify against the contract, not just \u201cit compiled.\u201d",
        cta_title: "Your code runs on Node.<br>Your AI agent runs on <span class=\"purple\">Salacia</span>.",
        cta_desc: "One command. Apache 2.0 licensed. Works with any agent.",
        cta_gh: "\u2b50 Star on GitHub",
        cta_npm: "\ud83d\udce6 View on npm",
        page_title: "Salacia \u2014 The Runtime for AI Coding Agents"
    },
    zh: {
        nav_how: "\u600e\u4e48\u7528",
        nav_data: "\u6570\u636e",
        badge: "\u2726 117 \u4e2a\u771f\u5b9e bug \u00b7 \u5b9e\u6d4b\u6709\u6548",
        hero_gradient: "AI \u5199\u4ee3\u7801",
        hero_rest: "\u522b\u8ba9\u5b83\u778e\u731c\u3002",
        subtitle: "Cursor / Claude Code \u4e0d\u591f\u806a\u660e\uff1f\u52a0\u4e00\u5c42 Salacia\uff0c\u5e2e\u5b83\u627e\u5bf9\u6587\u4ef6\u3001\u5c11\u8d70\u5f2f\u8def\u3001\u7701\u4e0b token\u3002",
        copy: "\u590d\u5236",
        compat: "Claude Code \xb7 Codex \xb7 Cursor \xb7 Cline \xb7 \u968f\u4fbf\u63a5",
        stat_bugs: "\u591a\u4fee\u4e86\u8fd9\u4e48\u591a",
        stat_fl: "\u4e00\u6b21\u5c31\u627e\u5bf9\u6587\u4ef6",
        stat_win: "\u52a0\u4e86\u6bd4\u4e0d\u52a0\u5f3a",
        stat_tasks: "\u4e2a\u771f\u5b9e bug \u8dd1\u8fc7",
        problem_label: "\u4f60\u9047\u5230\u8fc7\u5417",
        problem_title: "AI \u6539\u4e86\u534a\u5929\uff0c\u6539\u9519\u6587\u4ef6\u4e86\u3002",
        problem_subtitle: "Salacia \u6cbb\u7684\u5c31\u662f\u8fd9\u4e2a\u3002",
        without: "\u88f8\u8dd1 Cursor / Claude",
        w1: "\u6ee1\u4ed3\u5e93\u4e71\u7ffb token \u54d7\u54d7\u70e7",
        w2: "\u8bd5 10 \u8f6e\u8fd8\u6ca1\u4fee\u5bf9",
        w3: "\u770b\u9519\u6587\u4ef6\u5199\u9519\u4ee3\u7801",
        w4: "\u80fd\u7f16\u8bd1\u5c31\u7b97\u4ea4\u5dee\u4e86",
        with: "\u52a0\u4e00\u5c42 Salacia",
        s1: "\u76f4\u5954 2-3 \u4e2a\u5173\u952e\u6587\u4ef6",
        s2: "3-5 \u8f6e\u641e\u5b9a",
        s3: "93% \u6982\u7387\u4e00\u6b21\u627e\u5bf9",
        s4: "\u4e0d\u662f\u80fd\u8dd1\u5c31\u884c \u662f\u771f\u7684\u5bf9",
        how_label: "\u5c31\u8fd9\u4e09\u6b65",
        how_title: "\u4e09\u6761\u547d\u4ee4 \u6ca1\u4e86\u3002",
        how_subtitle: "\u8bf4\u4eba\u8bdd \u2192 \u627e\u5230 bug \u2192 \u9a8c\u8bc1\u901a\u8fc7\u3002\u4e00\u5206\u949f\u3002",
        step1_title: "\u8bf4",
        step1_desc: "\u7528\u81ea\u7136\u8bed\u8a00\u63cf\u8ff0\u4f60\u8981\u5e72\u5565\u3002Salacia \u81ea\u52a8\u5206\u6790\u4ed3\u5e93\u3001\u5b9a\u4f4d bug \u6587\u4ef6\u3002",
        step2_title: "\u8dd1",
        step2_desc: "\u628a\u5b9a\u4f4d\u597d\u7684\u4e0a\u4e0b\u6587\u5582\u7ed9\u4f60\u7684 AI agent\u3002\u5b83\u76f4\u63a5\u6539\uff0c\u4e0d\u7528\u778e\u627e\u3002",
        step3_title: "\u9a8c",
        step3_desc: "\u81ea\u52a8\u8dd1\u6d4b\u8bd5\uff0c\u6309\u5408\u7ea6\u9a8c\u8bc1\u3002\u4e0d\u662f\u201c\u80fd\u8dd1\u201d\u800c\u662f\u201c\u771f\u7684\u5bf9\u201d\u3002",
        cta_title: "\u522b\u6362 agent\u3002<br>\u7ed9\u5b83\u52a0\u4e00\u5c42 <span class=\"purple\">Salacia</span> \u5c31\u884c\u3002",
        cta_desc: "\u4e00\u6761\u547d\u4ee4\u4e0a\u624b \u00b7 \u5f00\u6e90\u514d\u8d39 \u00b7 \u4f60\u73b0\u5728\u7528\u7684 agent \u90fd\u80fd\u63a5",
        cta_gh: "\u2b50 GitHub",
        cta_npm: "\ud83d\udce6 npm",
        page_title: "Salacia \u2014 \u8ba9 AI \u5199\u4ee3\u7801\u4e0d\u518d\u778e\u731c"
    }
};

let currentLang = 'en';

function applyLang(lang) {
    currentLang = lang;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.getElementById('langToggle').textContent = lang === 'zh' ? 'EN' : '\u4e2d\u6587';

    const strings = i18n[lang];
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
        var key = el.getAttribute('data-i18n');
        if (strings[key] !== undefined) el.textContent = strings[key];
    });

    var ctaEl = document.getElementById('ctaTitle');
    if (ctaEl) ctaEl.innerHTML = strings.cta_title;

    document.title = strings.page_title;
    localStorage.setItem('salacia-lang', lang);
}

function toggleLang() {
    applyLang(currentLang === 'en' ? 'zh' : 'en');
}

// Copy button
document.getElementById('copyBtn').addEventListener('click', function () {
    navigator.clipboard.writeText('npx salacia init');
    this.classList.add('copied');
    var hint = this.querySelector('.copy-hint');
    hint.textContent = currentLang === 'zh' ? '\u5df2\u590d\u5236 \u2713' : 'Copied!';
});

// Auto-detect language
(function () {
    var saved = localStorage.getItem('salacia-lang');
    if (saved) { applyLang(saved); return; }
    var bl = (navigator.language || 'en').toLowerCase();
    applyLang(bl.indexOf('zh') === 0 ? 'zh' : 'en');
})();
