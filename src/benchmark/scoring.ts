import type {
  BenchmarkDimension,
  BenchmarkDimensionScore,
  BenchmarkProbeResult
} from "../core/types.js";

function cmpNumber(a: number, b: number): number {
  return a - b;
}

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 10) return 10;
  return Number(value.toFixed(4));
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort(cmpNumber);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const left = sorted[mid - 1] ?? 0;
    const right = sorted[mid] ?? 0;
    return (left + right) / 2;
  }
  return sorted[mid] ?? 0;
}

export function computeDimensionScore(functionalPass: 0 | 1, qualityScore: number, reliabilityScore: number): number {
  if (functionalPass === 0) return 0;
  return clampScore(0.5 * clampScore(qualityScore) + 0.5 * clampScore(reliabilityScore));
}

export function aggregateDimensions(probes: BenchmarkProbeResult[]): BenchmarkDimensionScore[] {
  const grouped = new Map<BenchmarkDimension, BenchmarkProbeResult[]>();
  for (const probe of probes) {
    const list = grouped.get(probe.dimension) ?? [];
    list.push(probe);
    grouped.set(probe.dimension, list);
  }

  const dimensions: BenchmarkDimensionScore[] = [];
  for (const [dimension, list] of grouped.entries()) {
    const cases = list.length;
    const functionalPassRate =
      cases === 0 ? 0 : Number((list.reduce((sum, probe) => sum + probe.functionalPass, 0) / cases).toFixed(4));
    const qualityScore =
      cases === 0 ? 0 : clampScore(list.reduce((sum, probe) => sum + probe.qualityScore, 0) / cases);
    const reliabilityScore =
      cases === 0 ? 0 : clampScore(list.reduce((sum, probe) => sum + probe.reliabilityScore, 0) / cases);
    const dimensionScore =
      cases === 0 ? 0 : clampScore(list.reduce((sum, probe) => sum + probe.dimensionScore, 0) / cases);

    dimensions.push({
      dimension,
      cases,
      functionalPassRate,
      qualityScore,
      reliabilityScore,
      dimensionScore
    });
  }

  dimensions.sort((a, b) => a.dimension.localeCompare(b.dimension));
  return dimensions;
}

export function computeOverallScore(dimensions: BenchmarkDimensionScore[]): {
  functionalPassRate: number;
  qualityScore: number;
  reliabilityScore: number;
  score: number;
} {
  if (dimensions.length === 0) {
    return {
      functionalPassRate: 0,
      qualityScore: 0,
      reliabilityScore: 0,
      score: 0
    };
  }

  const count = dimensions.length;
  const functionalPassRate = Number(
    (dimensions.reduce((sum, item) => sum + item.functionalPassRate, 0) / count).toFixed(4)
  );
  const qualityScore = clampScore(dimensions.reduce((sum, item) => sum + item.qualityScore, 0) / count);
  const reliabilityScore = clampScore(dimensions.reduce((sum, item) => sum + item.reliabilityScore, 0) / count);
  const score = clampScore(dimensions.reduce((sum, item) => sum + item.dimensionScore, 0) / count);

  return {
    functionalPassRate,
    qualityScore,
    reliabilityScore,
    score
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrapWinRateCI(
  wins: number[],
  options: { iterations?: number; seed?: number } = {}
): { low: number; high: number } {
  if (wins.length === 0) {
    return { low: 0, high: 0 };
  }

  const iterations = options.iterations ?? 1000;
  const rand = mulberry32(options.seed ?? 1337);
  const samples: number[] = [];

  for (let i = 0; i < iterations; i += 1) {
    let sum = 0;
    for (let j = 0; j < wins.length; j += 1) {
      const pick = Math.floor(rand() * wins.length);
      sum += wins[pick] ?? 0;
    }
    samples.push(sum / wins.length);
  }

  samples.sort(cmpNumber);
  const lowIndex = Math.floor(0.025 * samples.length);
  const highIndex = Math.floor(0.975 * samples.length);
  return {
    low: Number((samples[lowIndex] ?? 0).toFixed(4)),
    high: Number((samples[Math.min(samples.length - 1, highIndex)] ?? 0).toFixed(4))
  };
}
