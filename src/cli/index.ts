#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  createContractFromVibe,
  loadContract,
  saveContract,
  validateContract
} from "../core/contract.js";
import { runConvergence } from "../core/converge.js";
import { initRepository } from "../core/init.js";
import { ensureSalaciaDirs, latestFileInDir } from "../core/paths.js";
import { derivePlan, loadPlan, savePlan } from "../core/plan.js";
import { generateSpecMarkdown, saveSpec } from "../core/spec.js";
import type { Stage } from "../core/types.js";
import { findAdapter, adapterMatrix } from "../adapters/registry.js";
import { SnapshotManager } from "../guardian/snapshot.js";
import { RollbackEngine } from "../guardian/rollback.js";
import { detectDrift } from "../guardian/drift.js";
import { runVerification } from "../guardian/verify.js";
import { runHarnessInitializer } from "../harness/initializer.js";
import { runIncrementalExecution } from "../harness/incremental.js";
import { buildSalaciaMcpServerDescription, runSalaciaMcpServer } from "../protocols/mcp-server.js";

const program = new Command();
program.name("salacia").description("Salacia v0.1 - repo-first Agentic Engineering OS").version("0.1.0");

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
  const [planPath, contractPath] = await Promise.all([
    latestFileInDir(paths.plans, ".json"),
    latestFileInDir(paths.contracts, ".yaml")
  ]);
  return { planPath, contractPath };
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
  .option("--json", "json output", false)
  .action(async (vibe: string, opts: { json: boolean }) => {
    const paths = await ensureSalaciaDirs(process.cwd());
    const contract = createContractFromVibe(vibe);
    const valid = validateContract(contract);
    if (!valid.valid) {
      emit({ ok: false, errors: valid.errors }, true);
      process.exit(1);
    }

    const ts = Date.now();
    const contractPath = path.join(paths.contracts, `${ts}.yaml`);
    await saveContract(contract, contractPath);

    const plan = derivePlan(contract);
    const planPath = path.join(paths.plans, `${ts}.json`);
    await savePlan(plan, planPath);

    const spec = generateSpecMarkdown(contract, plan);
    const specPath = path.join(paths.specs, `${ts}.md`);
    await saveSpec(spec, specPath);

    const harnessInit = await runHarnessInitializer(plan, process.cwd());

    emit(
      {
        ok: true,
        contractPath,
        specPath,
        planPath,
        progressPath: harnessInit.progressFile,
        featureCount: harnessInit.featureCount
      },
      opts.json
    );
  });

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
      const summary = await runIncrementalExecution(adapter, plan, {
        cwd,
        dryRun: opts.dryRun,
        stage: "exec",
        mode: opts.mode,
        externalAdvisors: opts.external
      });

      const executionPath = path.join(paths.journal, `execution-${Date.now()}-${adapter.name}.json`);
      await fs.writeFile(executionPath, JSON.stringify(summary, null, 2), "utf8");

      const contract = await loadContract(contractPath);
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
