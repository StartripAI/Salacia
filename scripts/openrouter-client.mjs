#!/usr/bin/env node
import fs from 'node:fs';

async function main() {
    const args = process.argv.slice(2);
    let model = 'google/gemini-2.0-flash-001';
    let prompt = '';

    for (let i = 0; i < args.length; i++) {
        if ((args[i] === '-m' || args[i] === '--model') && args[i + 1]) {
            model = args[i + 1];
            i++;
        } else if ((args[i] === '-p' || args[i] === '--prompt') && args[i + 1]) {
            prompt = args[i + 1];
            i++;
        } else if ((args[i] === '-f' || args[i] === '--file') && args[i + 1]) {
            prompt = fs.readFileSync(args[i + 1], 'utf8');
            i++;
        }
    }

    if (!prompt) {
        console.error('Error: Prompt is required. Use -p or --prompt or -f or --file');
        process.exit(1);
    }

    // Enforce Unified Diff format
    const enhancedPrompt = `${prompt}\n\nIMPORTANT: Return your fix output ONLY as a standard Unified Diff inside a \` \` \`diff\` code block. Do not provide Python scripts or other patchers. Ensure paths in the diff start with 'a/' and 'b/'.`;

    const apiKey = process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://openrouter.ai/api/v1';

    if (!apiKey) {
        console.error('Error: API Key is required (GEMINI_API_KEY, OPENROUTER_API_KEY, or OPENAI_API_KEY)');
        process.exit(1);
    }

    try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://github.com/StartripAI/Salacia',
                'X-Title': process.env.OPENROUTER_TITLE || 'Salacia SWE-bench Runner'
            },
            body: JSON.stringify({
                model: model,
                messages: [{ role: 'user', content: enhancedPrompt }]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`OpenRouter API Error: ${response.status} ${response.statusText}\n${errorText}`);
            process.exit(1);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        const usage = data.usage || {};
        console.error(JSON.stringify({
            _salacia_usage: true,
            prompt_tokens: usage.prompt_tokens || 0,
            completion_tokens: usage.completion_tokens || 0,
            total_tokens: usage.total_tokens || 0,
            model: data.model || model
        }));
        process.stdout.write(content);

        // Extract diff and apply if present
        const diffMatch = content.match(/```(?:diff|patch)?\n([\s\S]*?)```/);
        const diff = diffMatch ? diffMatch[1] : (content.includes('--- a/') ? content : null);

        if (diff && (diff.includes('--- a/') || diff.includes('--- original/'))) {
            const diffPath = `.salacia-patch-${Date.now()}.diff`;
            fs.writeFileSync(diffPath, diff);
            console.error(`\nFound patch, applying via 'patch --batch -p1'...`);
            const { execSync } = await import('node:child_process');
            try {
                execSync(`patch --batch -p1 < ${diffPath}`, { stdio: 'inherit' });
                console.error('Patch applied successfully.');
            } catch (err) {
                console.error('Patch application failed. You may need to apply it manually.');
            } finally {
                if (fs.existsSync(diffPath)) fs.unlinkSync(diffPath);
            }
        }
    } catch (error) {
        console.error('Failed to communicate with OpenRouter:', error);
        process.exit(1);
    }
}

main();
