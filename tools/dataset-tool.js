#!/usr/bin/env node
/**
 * Dataset tooling for LinkedIn Cringe Filter
 *
 * Reads collected teacher samples, validates the schema, reports stats,
 * and emits train/val/test JSONL splits suitable for KD training.
 *
 * Usage:
 *   node tools/dataset-tool.js --input path/to/samples.json \
 *     --output ./out/dataset --valRatio 0.1 --testRatio 0.1 \
 *     --positiveThreshold 0.5 --seed 42
 */

const fs = require('fs');
const path = require('path');

const LABEL_KEYS = [
  'humbleBragging',
  'excessiveEmojis',
  'engagementBait',
  'fakeStories',
  'companyCulture',
  'personalAnecdotes',
  'hiringStories',
  'basicDecencyPraising',
  'minorAchievements',
  'buzzwordOveruse',
  'linkedinCliches',
  'virtueSignaling',
  'professionalOversharing',
  'mundaneLifeLessons',
  'overall_cringe'
];

function parseArgs(argv) {
  const args = {
    valRatio: 0.1,
    testRatio: 0.1,
    positiveThreshold: 0.5,
    seed: 42,
    report: 'dataset-report.json'
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input' || arg === '-i') {
      args.input = argv[++i];
    } else if (arg === '--output' || arg === '-o') {
      args.output = argv[++i];
    } else if (arg === '--valRatio') {
      args.valRatio = parseFloat(argv[++i]);
    } else if (arg === '--testRatio') {
      args.testRatio = parseFloat(argv[++i]);
    } else if (arg === '--positiveThreshold') {
      args.positiveThreshold = parseFloat(argv[++i]);
    } else if (arg === '--seed') {
      args.seed = parseInt(argv[++i], 10);
    } else if (arg === '--report') {
      args.report = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!args.input) {
    console.error('❌ Missing required --input path.');
    printHelp();
    process.exit(1);
  }

  if (!args.output) {
    args.output = path.resolve(process.cwd(), 'out', 'dataset');
  }

  if (args.valRatio < 0 || args.testRatio < 0 || args.valRatio + args.testRatio >= 0.9) {
    console.warn('⚠️  valRatio + testRatio should be less than 0.9. Using defaults 0.1/0.1.');
    args.valRatio = 0.1;
    args.testRatio = 0.1;
  }

  if (!(args.seed >= 0)) {
    args.seed = 42;
  }

  return args;
}

function printHelp() {
  console.log(`
LinkedIn Cringe Filter Dataset Tool

Options:
  --input, -i              Path to samples JSON/JSONL file (required)
  --output, -o             Directory for split output (default: ./out/dataset)
  --valRatio               Portion of samples for validation split (default: 0.1)
  --testRatio              Portion of samples for test split (default: 0.1)
  --positiveThreshold      Probability threshold to consider a label positive (default: 0.5)
  --seed                   Seed for deterministic shuffling (default: 42)
  --report                 Filename for JSON stats report (default: dataset-report.json)
  --help, -h               Show this message

Input format:
  [
    {
      "schema_version": "multilabel_v2",
      "post": {...},
      "teacher": { "cringe_prob": 0.5, "labels": {...}, "top_reasons": [...] },
      "context": {...}
    }
  ]

Output:
  - train.jsonl / val.jsonl / test.jsonl written to the output directory
  - dataset-report.json with summary statistics
  - Console summary with key metrics
`);
}

function loadSamples(inputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  const raw = fs.readFileSync(inputPath, 'utf8');
  const ext = path.extname(inputPath).toLowerCase();

  if (ext === '.jsonl' || ext === '.ndjson') {
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line));
  }

  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (parsed?.items && Array.isArray(parsed.items)) {
    return parsed.items;
  }

  throw new Error('Unsupported input format. Expected array or JSONL.');
}

function validateSample(sample) {
  const errors = [];
  if (!sample || typeof sample !== 'object') {
    errors.push('Sample is not an object.');
    return { valid: false, errors };
  }

  if (!sample.post || typeof sample.post !== 'object') {
    errors.push('Missing post metadata.');
  } else {
    if (!sample.post.post_id) errors.push('Missing post.post_id.');
    if (typeof sample.post.text !== 'string' || !sample.post.text.trim()) errors.push('Missing post text.');
  }

  if (!sample.teacher || typeof sample.teacher !== 'object') {
    errors.push('Missing teacher payload.');
  } else {
    if (typeof sample.teacher.cringe_prob !== 'number') {
      errors.push('Missing teacher.cringe_prob.');
    } else if (sample.teacher.cringe_prob < 0 || sample.teacher.cringe_prob > 1) {
      errors.push('teacher.cringe_prob out of range.');
    }

    if (!sample.teacher.labels || typeof sample.teacher.labels !== 'object') {
      errors.push('Missing teacher.labels map.');
    } else {
      LABEL_KEYS.forEach(label => {
        if (typeof sample.teacher.labels[label] !== 'number') {
          errors.push(`Missing probability for label "${label}".`);
        } else if (sample.teacher.labels[label] < 0 || sample.teacher.labels[label] > 1) {
          errors.push(`Label "${label}" probability out of range.`);
        }
      });
    }
  }

  return { valid: errors.length === 0, errors };
}

function dedupeSamples(samples) {
  const seen = new Set();
  const deduped = [];
  samples.forEach(sample => {
    const key = `${sample.post?.post_id || 'unknown'}::${sample.context?.prompt_hash || 'nohash'}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(sample);
    }
  });
  return deduped;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ t >>> 15, t | 1);
    r ^= r + Math.imul(r ^ r >>> 7, r | 61);
    return ((r ^ r >>> 14) >>> 0) / 4294967296;
  };
}

function shuffled(array, rng) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function activeLabels(sample, threshold) {
  const labels = [];
  LABEL_KEYS.forEach(label => {
    const value = sample.teacher.labels[label];
    if (typeof value === 'number' && value >= threshold) {
      labels.push(label);
    }
  });
  return labels;
}

function computeStats(samples, threshold) {
  const totals = {
    count: samples.length,
    charLens: [],
    tokenLens: [],
    labelPositives: LABEL_KEYS.reduce((acc, label) => ({ ...acc, [label]: 0 }), {}),
    labelProbSums: LABEL_KEYS.reduce((acc, label) => ({ ...acc, [label]: 0 }), {}),
    entropy: []
  };

  samples.forEach(sample => {
    const text = sample.post?.text || '';
    totals.charLens.push(text.length);
    totals.tokenLens.push(sample.post?.token_len || 0);

    LABEL_KEYS.forEach(label => {
      const prob = sample.teacher.labels[label];
      totals.labelProbSums[label] += prob;
      if (prob >= threshold) {
        totals.labelPositives[label] += 1;
      }
    });

    const labelEntropies = LABEL_KEYS.map(label => binaryEntropy(sample.teacher.labels[label]));
    const averageEntropy = labelEntropies.reduce((sum, value) => sum + value, 0) / LABEL_KEYS.length;
    totals.entropy.push(averageEntropy);
  });

  return totals;
}

function binaryEntropy(p) {
  if (p <= 0 || p >= 1) return 0;
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
}

function formatSummary(stats, threshold) {
  const summary = {
    totalSamples: stats.count,
    positiveThreshold: threshold,
    charLength: describeNumeric(stats.charLens),
    tokenLength: describeNumeric(stats.tokenLens),
    entropy: describeNumeric(stats.entropy),
    labels: {}
  };

  LABEL_KEYS.forEach(label => {
    summary.labels[label] = {
      positives: stats.labelPositives[label],
      positiveRate: stats.labelPositives[label] / Math.max(1, stats.count),
      meanProbability: stats.labelProbSums[label] / Math.max(1, stats.count)
    };
  });

  return summary;
}

function describeNumeric(values) {
  if (!values || values.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0 };
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const sum = values.reduce((acc, v) => acc + v, 0);
  const mean = sum / values.length;
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    median
  };
}

function stratifiedSplit(samples, ratios, threshold, rng) {
  const splits = {
    train: [],
    val: [],
    test: []
  };

  const labelCounts = {
    train: LABEL_KEYS.reduce((acc, label) => ({ ...acc, [label]: 0 }), {}),
    val: LABEL_KEYS.reduce((acc, label) => ({ ...acc, [label]: 0 }), {}),
    test: LABEL_KEYS.reduce((acc, label) => ({ ...acc, [label]: 0 }), {})
  };

  const sampleCounts = { train: 0, val: 0, test: 0 };

  const totalLabelCounts = LABEL_KEYS.reduce((acc, label) => {
    acc[label] = samples.reduce((sum, sample) => {
      return sum + (sample.teacher.labels[label] >= threshold ? 1 : 0);
    }, 0);
    return acc;
  }, {});

  const targets = {
    train: LABEL_KEYS.reduce((acc, label) => ({ ...acc, [label]: totalLabelCounts[label] * ratios.train }), {}),
    val: LABEL_KEYS.reduce((acc, label) => ({ ...acc, [label]: totalLabelCounts[label] * ratios.val }), {}),
    test: LABEL_KEYS.reduce((acc, label) => ({ ...acc, [label]: totalLabelCounts[label] * ratios.test }), {})
  };

  const ordered = shuffled(samples, rng);
  const totalSamples = ordered.length;

  ordered.forEach(sample => {
    const positives = activeLabels(sample, threshold);
    const splitKeys = Object.keys(ratios);

    let bestSplit = splitKeys[0];
    let bestScore = Number.POSITIVE_INFINITY;

    splitKeys.forEach(split => {
      let score = 0;
      positives.forEach(label => {
        const target = targets[split][label] || 1;
        score += (labelCounts[split][label] + 1) / (target + 1e-6);
      });
      score += (sampleCounts[split] + 1) / (ratios[split] * totalSamples + 1e-6);
      if (score < bestScore) {
        bestScore = score;
        bestSplit = split;
      }
    });

    splits[bestSplit].push(sample);
    sampleCounts[bestSplit] += 1;
    positives.forEach(label => {
      labelCounts[bestSplit][label] += 1;
    });
  });

  return { splits, labelCounts, sampleCounts };
}

function writeJsonl(filePath, samples) {
  const lines = samples.map(sample => JSON.stringify(sample));
  fs.writeFileSync(filePath, lines.join('\n') + '\n', 'utf8');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function main() {
  const args = parseArgs(process.argv);
  const ratios = {
    val: args.valRatio,
    test: args.testRatio,
    train: 1 - args.valRatio - args.testRatio
  };

  console.log('📥 Loading samples from', args.input);
  const rawSamples = loadSamples(args.input);
  console.log(`   Loaded ${rawSamples.length} samples.`);

  const deduped = dedupeSamples(rawSamples);
  if (deduped.length !== rawSamples.length) {
    console.log(`   Removed ${rawSamples.length - deduped.length} duplicates.`);
  }

  let valid = [];
  const issues = [];
  deduped.forEach((sample, index) => {
    const { valid: isValid, errors } = validateSample(sample);
    if (isValid) {
      valid.push(sample);
    } else {
      issues.push({ index, errors });
    }
  });

  if (issues.length > 0) {
    console.warn(`⚠️  Found ${issues.length} invalid samples. They will be skipped.`);
    issues.slice(0, 5).forEach(issue => {
      console.warn(`   Sample #${issue.index} issues: ${issue.errors.join('; ')}`);
    });
    if (issues.length > 5) {
      console.warn('   ...');
    }
  }

  if (valid.length === 0) {
    console.error('❌ No valid samples to process.');
    process.exit(1);
  }

  const stats = computeStats(valid, args.positiveThreshold);
  const summary = formatSummary(stats, args.positiveThreshold);

  const rng = mulberry32(args.seed);
  const { splits, labelCounts, sampleCounts } = stratifiedSplit(valid, ratios, args.positiveThreshold, rng);

  ensureDir(args.output);
  writeJsonl(path.join(args.output, 'train.jsonl'), splits.train);
  writeJsonl(path.join(args.output, 'val.jsonl'), splits.val);
  writeJsonl(path.join(args.output, 'test.jsonl'), splits.test);

  const reportPath = path.join(args.output, args.report);
  fs.writeFileSync(reportPath, JSON.stringify({
    summary,
    splits: {
      counts: sampleCounts,
      labelCounts
    },
    config: {
      valRatio: args.valRatio,
      testRatio: args.testRatio,
      positiveThreshold: args.positiveThreshold,
      seed: args.seed
    }
  }, null, 2), 'utf8');

  console.log('✅ Dataset splits written to', args.output);
  console.log('   Train:', splits.train.length);
  console.log('   Val  :', splits.val.length);
  console.log('   Test :', splits.test.length);
  console.log('📊 Report saved to', reportPath);

  console.log('\nLabel overview (positives / mean probability):');
  LABEL_KEYS.forEach(label => {
    const pos = summary.labels[label].positives;
    const rate = (summary.labels[label].positiveRate * 100).toFixed(1);
    const meanProb = summary.labels[label].meanProbability.toFixed(3);
    console.log(` - ${label}: ${pos} positives (${rate}%), mean probability ${meanProb}`);
  });
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('❌ Dataset tooling failed:', error);
    process.exit(1);
  }
}

