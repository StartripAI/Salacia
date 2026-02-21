#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import {
  createContractFromIntentIR,
  loadContract,
  saveContract,
  validateContract
} from "../core/contract.js";
import { runConvergence } from "../core/converge.js";
import { initRepository } from "../core/init.js";
import { ensureSalaciaDirs, latestFileInDir } from "../core/paths.js";
import { derivePlanFromIntent, loadPlan, savePlan } from "../core/plan.js";
import { generateSpecMarkdown, saveSpec } from "../core/spec.js";
import type { DisambiguationQuestion, IntentIR, Stage } from "../core/types.js";
import { findAdapter, adapterMatrix } from "../adapters/registry.js";
import { evaluateConsistency } from "../guardian/consistency.js";
import { SnapshotManager } from "../guardian/snapshot.js";
import { RollbackEngine } from "../guardian/rollback.js";
import { detectDrift } from "../guardian/drift.js";
import { runVerification } from "../guardian/verify.js";
import { runHarnessInitializer } from "../harness/initializer.js";
import { runIncrementalExecution } from "../harness/incremental.js";
import { compilePromptInput } from "../prompt/compile.js";
import { applyDisambiguationAnswer } from "../prompt/disambiguate.js";
import { runMetamorphicTests } from "../prompt/metamorphic.js";
import { optimizePrompts } from "../prompt/optimize.js";
import { buildSalaciaMcpServerDescription, runSalaciaMcpServer } from "../protocols/mcp-server.js";

const program = new Command();
program.name("salacia").description("Salacia v0.1.1 - repo-first Agentic Engineering OS").version("0.1.1");

function emit(data: unknown, asJson: boolean): void {
  if (asJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (typeof data === "string") {
    console.log(data);
    return;
  }

  console.log(JSON.stringify(data, null, 2));
}

async function latestArtifacts(cwd: string): Promise<{ planPath: string | null; contractPath: string | null }> {
  const paths = await ensureSalaciaDirs(cwd);
  const contractPath = await latestFileInDir(paths.contracts, ".yaml");
  const planPath = await (async () => {
    const files = await fs.readdir(paths.plans).catch(() => []);
    const candidates = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map(async (file) => {
          const full = path.join(paths.plans, file);
          const stat = await fs.stat(full).catch(() => null);
          if (!stat) return null;
          const raw = await fs.readFile(full, "utf8").catch(() => "");
          if (!raw) return null;
          try {
            const parsed = JSON.parse(raw) as Partial<{ contractId: string; steps: unknown[] }>;
            const looksLikePlan = typeof parsed.contractId === "string" && Array.isArray(parsed.steps);
            return looksLikePlan ? { full, mtimeMs: stat.mtimeMs } : null;
          } catch {
            return null;
          }
        })
    );

    const filtered = candidates.filter((item): item is { full: string; mtimeMs: number } => item !== null);
    filtered.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return filtered[0]?.full ?? null;
  })();

  return { planPath, contractPath };
}

function isInteractiveSession(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI);
}

async function persistIntentIR(intent: IntentIR, cwd: string): Promise<string> {
  const paths = await ensureSalaciaDirs(cwd);
  const intentPath = path.join(paths.plans, `intent-ir-${Date.now()}.json`);
  await fs.writeFile(intentPath, JSON.stringify(intent, null, 2), "utf8");
  return intentPath;
}

async function askSingleQuestion(question: DisambiguationQuestion): Promise<string | null> {
  if (!isInteractiveSession()) {
    return null;
  }

  const rl = createInterface({ input, output });
  try {
    const options = question.options
      .map((option, index) => `${index + 1}. ${option.label}${option.recommended ? " (recommended)" : ""}`)
      .join("\n");

    const answer = await rl.question(`${question.prompt}\n${options}\nSelect 1-${question.options.length}: `);
    const parsed = Number.parseInt(answer.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > question.options.length) {
      return question.options.find((option) => option.recommended)?.id ?? question.options[0]?.id ?? null;
    }

    return question.options[parsed - 1]?.id ?? null;
  } finally {
    rl.close();
  }
}

program
  .command("init")
  .description("Initialize .salacia runtime in current repository")
  .option("--json", "json output", false)
  .action(async (opts: { json: boolean }) => {
    const result = await initRepository(process.cwd());
    emit({ initialized: true, created: result.created }, opts.json);
  });

program
  .command("plan")
  .description("Generate Contract + Spec + Plan from vibe input")
  .argument("<vibe>")
  .option("--explain", "emit diagnostics and correction evidence", false)
  .option("--json", "json output", false)
  .action(async (vibe: string, opts: { explain: boolean; json: boolean }) => {
    const cwd = process.cwd();
    const paths = await ensureSalaciaDirs(cwd);
    const compiled = await compilePromptInput(vibe, { cwd });
    let intent = compiled.ir;

    if (compiled.question) {
      const answer = await askSingleQuestion(compiled.question);
      if (!answer) {
        emit(
          {
            ok: false,
            code: "disambiguation-required",
            question: compiled.question,
            diagnostics: compiled.diagnostics
          },
          true
        );
        process.exit(2);
      }

      intent = applyDisambiguationAnswer(intent, compiled.question, answer);
      const secondPass = runMetamorphicTests(compiled.baseline, intent);
      if (!secondPass.passed) {
        emit(
          {
            ok: false,
            code: "metamorphic-failed-after-disambiguation",
            checks: secondPass.checks
          },
          true
        );
        process.exit(1);
      }
    }

    if (!compiled.metamorphic.passed) {
      emit(
        {
          ok: false,
          code: "metamorphic-failed",
          diagnostics: compiled.diagnostics,
          checks: compiled.metamorphic.checks
        },
        true
      );
      process.exit(1);
    }

    const contract = createContractFromIntentIR(intent);
    const valid = validateContract(contract);
    if (!valid.valid) {
      emit({ ok: false, errors: valid.errors }, true);
      process.exit(1);
    }

    const ts = Date.now();
    const contractPath = path.join(paths.contracts, `${ts}.yaml`);
    await saveContract(contract, contractPath);

    const plan = derivePlanFromIntent(contract, intent);
    const planPath = path.join(paths.plans, `${ts}.json`);
    await savePlan(plan, planPath);

    const spec = generateSpecMarkdown(contract, plan);
    const specPath = path.join(paths.specs, `${ts}.md`);
    await saveSpec(spec, specPath);

    const intentPath = await persistIntentIR(intent, cwd);
    const harnessInit = await runHarnessInitializer(plan, process.cwd());

    emit(
      {
        ok: true,
        intentPath,
        contractPath,
        specPath,
        planPath,
        progressPath: harnessInit.progressFile,
        featureCount: harnessInit.featureCount,
        ...(opts.explain
          ? {
              diagnostics: compiled.diagnostics,
              corrected: compiled.corrected,
              context: compiled.context
            }
          : {})
      },
      opts.json
    );
  });

program
  .command("prompt")
  .description("Prompt compiler, metamorphic test, and optimizer")
  .argument("<action>", "compile|test|optimize")
  .argument("[input]", "prompt input (for compile)")
  .option("--input <path>", "input file path for prompt test")
  .option("--from-journal", "optimize from journal evidence", false)
  .option("--json", "json output", false)
  .action(
    async (
      action: string,
      rawInput: string | undefined,
      opts: { input?: string; fromJournal: boolean; json: boolean }
    ) => {
      const cwd = process.cwd();
      if (action === "compile") {
        const inputText = rawInput?.trim();
        if (!inputText) {
          emit({ ok: false, error: "compile action requires prompt input argument" }, true);
          process.exit(1);
        }

        const compiled = await compilePromptInput(inputText, { cwd });
        let intent = compiled.ir;
        let answerUsed: string | null = null;

        if (compiled.question) {
          const answer = await askSingleQuestion(compiled.question);
          if (!answer) {
            const intentPath = await persistIntentIR(intent, cwd);
            emit(
              {
                ok: false,
                code: "disambiguation-required",
                intentPath,
                question: compiled.question,
                diagnostics: compiled.diagnostics
              },
              true
            );
            process.exit(2);
          }
          answerUsed = answer;
          intent = applyDisambiguationAnswer(intent, compiled.question, answer);
        }

        const metamorphic = runMetamorphicTests(compiled.baseline, intent);
        const intentPath = await persistIntentIR(intent, cwd);
        const ok = metamorphic.passed;

        emit(
          {
            ok,
            intentPath,
            question: compiled.question,
            answerUsed,
            diagnostics: compiled.diagnostics,
            metamorphic
          },
          opts.json || true
        );
        if (!ok) process.exit(1);
        return;
      }

      if (action === "test") {
        if (!opts.input) {
          emit({ ok: false, error: "test action requires --input <intent-ir.json>" }, true);
          process.exit(1);
        }

        const targetPath = path.resolve(opts.input);
        const raw = await fs.readFile(targetPath, "utf8");
        const ir = JSON.parse(raw) as IntentIR;
        const source = await compilePromptInput(ir.source, { cwd });
        const metamorphic = runMetamorphicTests(source.baseline, ir);
        emit(
          {
            ok: metamorphic.passed,
            input: targetPath,
            checks: metamorphic.checks
          },
          opts.json || true
        );
        if (!metamorphic.passed) process.exit(1);
        return;
      }

      if (action === "optimize") {
        const report = await optimizePrompts({ cwd, fromJournal: opts.fromJournal });
        emit(
          {
            ok: report.accepted > 0,
            report
          },
          opts.json || true
        );
        if (report.accepted === 0) process.exit(1);
        return;
      }

      emit({ ok: false, error: "Unknown prompt action. Use compile|test|optimize." }, true);
      process.exit(1);
    }
  );

program
  .command("converge")
  .description("Run advisor convergence for plan or execution artifacts")
  .requiredOption("--stage <stage>", "plan or exec")
  .requiredOption("--input <path>", "input file path")
  .option("--external", "run Claude/Gemini external scripts", false)
  .option("--json", "json output", false)
  .action(
    async (opts: { stage: Stage; input: string; external: boolean; json: boolean }) => {
      const decision = await runConvergence({
        stage: opts.stage,
        inputPath: path.resolve(opts.input),
        external: opts.external,
        cwd: process.cwd()
      });

      emit(decision, opts.json || true);
      if (decision.winner === "reject") process.exit(2);
      if (decision.requiresHumanApproval) process.exit(3);
    }
  );

program
  .command("validate")
  .description("Run drift detection and verification loop for latest contract")
  .option("--json", "json output", false)
  .action(async (opts: { json: boolean }) => {
    const { contractPath } = await latestArtifacts(process.cwd());
    if (!contractPath) {
      emit({ ok: false, error: "No contract found. Run salacia plan first." }, true);
      process.exit(1);
    }

    const contract = await loadContract(contractPath);
    const drift = await detectDrift(contract, process.cwd());
    const verification = await runVerification(contract, process.cwd());

    const payload = { ok: verification.success && drift.protectedPathTouches.length === 0, drift, verification };
    emit(payload, opts.json || true);
    if (!payload.ok) process.exit(1);
  });

program
  .command("guard")
  .description("Run guardian subsystem checks")
  .argument("<action>", "consistency")
  .option("--json", "json output", false)
  .action(async (action: string, opts: { json: boolean }) => {
    if (action !== "consistency") {
      emit({ ok: false, error: "Unknown guard action. Use consistency." }, true);
      process.exit(1);
    }

    const cwd = process.cwd();
    const { planPath, contractPath } = await latestArtifacts(cwd);
    if (!planPath || !contractPath) {
      emit({ ok: false, error: "Missing plan or contract. Run salacia plan first." }, true);
      process.exit(1);
    }

    const [plan, contract] = await Promise.all([loadPlan(planPath), loadContract(contractPath)]);
    const report = await evaluateConsistency(contract, plan, cwd, {
      autoSnapshotOnHighRisk: true
    });
    emit({ ok: report.ok, report }, opts.json || true);
    if (!report.ok) process.exit(1);
  });

program
  .command("execute")
  .description("Dispatch latest plan to a target adapter with convergence stage gates")
  .requiredOption("--adapter <name>", "adapter name")
  .option("--dry-run", "do not run mutating tools", false)
  .option("--mode <mode>", "adapter mode (auto|cli|sdk)", "auto")
  .option("--external", "run external advisors in convergence", false)
  .option("--json", "json output", false)
  .action(
    async (opts: {
      adapter: string;
      dryRun: boolean;
      mode: "auto" | "cli" | "sdk";
      external: boolean;
      json: boolean;
    }) => {
      const cwd = process.cwd();
      const paths = await ensureSalaciaDirs(cwd);
      const { planPath, contractPath } = await latestArtifacts(cwd);
      if (!planPath || !contractPath) {
        emit({ ok: false, error: "Missing plan or contract. Run salacia plan first." }, true);
        process.exit(1);
      }

      const adapter = findAdapter(opts.adapter);
      if (!adapter) {
        emit({ ok: false, error: `Adapter not found: ${opts.adapter}` }, true);
        process.exit(1);
      }

      const preDecision = await runConvergence({
        stage: "plan",
        inputPath: planPath,
        external: opts.external,
        cwd
      });
      if (preDecision.winner !== "approve") {
        emit({ ok: false, stage: "plan", convergence: preDecision }, true);
        process.exit(3);
      }

      const plan = await loadPlan(planPath);
      const contract = await loadContract(contractPath);
      const summary = await runIncrementalExecution(adapter, plan, {
        cwd,
        dryRun: opts.dryRun,
        stage: "exec",
        mode: opts.mode,
        externalAdvisors: opts.external
      }, contract);

      const executionPath = path.join(paths.journal, `execution-${Date.now()}-${adapter.name}.json`);
      await fs.writeFile(executionPath, JSON.stringify(summary, null, 2), "utf8");

      const verification = await runVerification(contract, cwd);
      const verifyPath = path.join(paths.journal, `verify-${Date.now()}-${adapter.name}.json`);
      await fs.writeFile(verifyPath, JSON.stringify(verification, null, 2), "utf8");

      const execEvidencePath = path.join(paths.journal, `exec-evidence-${Date.now()}-${adapter.name}.json`);
      await fs.writeFile(
        execEvidencePath,
        JSON.stringify(
          {
            summary,
            verification,
            executionPath,
            verifyPath
          },
          null,
          2
        ),
        "utf8"
      );

      const postDecision = await runConvergence({
        stage: "exec",
        inputPath: execEvidencePath,
        external: opts.external,
        cwd
      });

      const ok = summary.failed === 0 && verification.success && postDecision.winner === "approve";
      const payload = {
        ok,
        adapter: adapter.name,
        convergence: {
          plan: preDecision,
          exec: postDecision
        },
        execution: {
          summary,
          executionPath,
          verifyPath,
          execEvidencePath
        }
      };

      emit(payload, opts.json || true);
      if (!ok) process.exit(1);
    }
  );

program
  .command("snapshot")
  .description("Create a reversible snapshot")
  .option("--label <label>", "snapshot label", "manual")
  .option("--json", "json output", false)
  .action(async (opts: { label: string; json: boolean }) => {
    const manager = new SnapshotManager(process.cwd());
    const snapshot = await manager.createSnapshot(opts.label);
    emit({ ok: true, snapshot }, opts.json || true);
  });

program
  .command("rollback")
  .description("Rollback to a snapshot by id")
  .argument("[snapshotId]")
  .option("--json", "json output", false)
  .action(async (snapshotId: string | undefined, opts: { json: boolean }) => {
    const manager = new SnapshotManager(process.cwd());
    const rollback = new RollbackEngine(manager);

    let target = snapshotId;
    if (!target) {
      const snapshots = await manager.listSnapshots();
      target = snapshots[0]?.id;
      if (!target) {
        emit({ ok: false, error: "No snapshots found" }, true);
        process.exit(1);
      }
    }

    await rollback.rollback(target);
    emit({ ok: true, snapshotId: target }, opts.json || true);
  });

program
  .command("status")
  .description("Show current Salacia status")
  .option("--json", "json output", false)
  .action(async (opts: { json: boolean }) => {
    const paths = await ensureSalaciaDirs(process.cwd());
    const [contracts, specs, plans, snapshots] = await Promise.all([
      fs.readdir(paths.contracts).catch(() => []),
      fs.readdir(paths.specs).catch(() => []),
      fs.readdir(paths.plans).catch(() => []),
      fs.readdir(paths.snapshots).catch(() => [])
    ]);

    emit(
      {
        ok: true,
        counts: {
          contracts: contracts.length,
          specs: specs.length,
          plans: plans.length,
          snapshots: snapshots.length
        }
      },
      opts.json || true
    );
  });

program
  .command("adapters")
  .description("List/check/matrix adapter availability")
  .argument("<action>", "list|check|matrix")
  .option("--json", "json output", false)
  .action(async (action: string, opts: { json: boolean }) => {
    const matrix = await adapterMatrix(process.cwd());

    if (action === "list" || action === "matrix") {
      emit({ ok: true, matrix }, opts.json || true);
      return;
    }

    if (action === "check") {
      const failures = matrix.filter((row) => row.kind === "executor" && !row.available);
      emit({ ok: failures.length === 0, matrix, failures }, opts.json || true);
      if (failures.length > 0) process.exit(1);
      return;
    }

    emit({ ok: false, error: "Unknown action. Use list|check|matrix." }, true);
    process.exit(1);
  });

program
  .command("doctor")
  .description("Show compatibility matrix and host diagnostics")
  .option("--matrix", "print matrix details", false)
  .option("--json", "json output", false)
  .action(async (opts: { matrix: boolean; json: boolean }) => {
    const matrix = await adapterMatrix(process.cwd());
    const report = {
      ok: true,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      codexOnWindows: "Use WSL for Codex CLI on Windows",
      codexAppNote: "Codex App is macOS Apple Silicon only",
      matrix: opts.matrix ? matrix : undefined
    };
    emit(report, opts.json || true);
  });

program
  .command("mcp-server")
  .description("Run Salacia MCP server over stdio")
  .action(async () => {
    await runSalaciaMcpServer(process.cwd());
  });

program
  .command("mcp-describe")
  .description("Print Salacia MCP server metadata")
  .option("--json", "json output", false)
  .action(async (opts: { json: boolean }) => {
    const description = await buildSalaciaMcpServerDescription();
    emit(description, opts.json || true);
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(error);
  process.exit(1);
});
