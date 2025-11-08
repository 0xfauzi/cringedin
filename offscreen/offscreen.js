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

let pipelineInstance = null;
let loadError = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== 'offscreen') {
    return false;
  }

  if (message.action === 'STUDENT_LOAD') {
    ensurePipeline()
      .then(sendResponse)
      .catch((error) => {
        console.error('Offscreen: load failed', error);
        sendResponse({ ready: false, error: error.message });
      });
    return true; // Async response.
  }

  if (message.action === 'STUDENT_INFER') {
    ensurePipeline()
      .then(async (status) => {
        if (!status.ready) {
          sendResponse({ success: false, error: status.error || 'Student model not loaded.' });
          return;
        }
        const result = await runInference(message.payload || {});
        sendResponse(result);
      })
      .catch((error) => {
        console.error('Offscreen: inference failed', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  return false;
});

async function ensurePipeline() {
  if (pipelineInstance) {
    return { ready: true };
  }
  if (loadError) {
    return { ready: false, error: loadError.message || String(loadError) };
  }
  if (typeof window.transformers === 'undefined') {
    loadError = new Error(
      'Transformers.js not found. Place dist/transformers.min.js inside lib/ and reload the extension.'
    );
    return { ready: false, error: loadError.message };
  }

  try {
    const { pipeline, env } = window.transformers;
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = chrome.runtime.getURL('models');
    env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('lib/');

    pipelineInstance = await pipeline('text-classification', chrome.runtime.getURL('models/student'), {
      quantized: true,
      local_files_only: true,
      multi_label: true,
      return_all_scores: true,
      function_to_apply: 'sigmoid'
    });

    console.log('Offscreen: student pipeline loaded.');
    return { ready: true };
  } catch (error) {
    console.error('Offscreen: failed to initialize pipeline', error);
    loadError = error;
    return { ready: false, error: error.message };
  }
}

async function runInference(payload) {
  if (!pipelineInstance) {
    return { success: false, error: 'Student pipeline not ready.' };
  }
  const text = (payload.text || '').trim();
  if (!text) {
    return { success: false, error: 'Empty text.' };
  }

  try {
    const start = performance.now();
    const outputs = await pipelineInstance(text, {
      topk: LABEL_KEYS.length,
      function_to_apply: 'sigmoid',
      return_all_scores: true
    });
    const elapsed = performance.now() - start;
    const probabilityMap = extractScores(outputs);
    const finalProbs = ensureLabelMap(probabilityMap);
    const topReasons = buildRationales(finalProbs, text);
    const cringeProb = computeCringeProb(finalProbs);

    return {
      success: true,
      labels: finalProbs,
      cringeProb,
      topReasons,
      runtimeMs: elapsed
    };
  } catch (error) {
    console.error('Offscreen: inference execution failed', error);
    return { success: false, error: error.message || String(error) };
  }
}

function extractScores(outputs) {
  const map = {};
  if (!outputs) return map;

  const list = Array.isArray(outputs) && Array.isArray(outputs[0]) ? outputs[0] : outputs;

  if (Array.isArray(list)) {
    list.forEach((entry) => {
      if (!entry) return;
      const label = normalizeLabel(entry.label);
      if (!label) return;
      map[label] = entry.score;
    });
  }

  return map;
}

function normalizeLabel(label) {
  if (!label) return null;
  const normalized = label
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
  const match = LABEL_KEYS.find((key) => key.toLowerCase() === normalized);
  return match || normalized;
}

function ensureLabelMap(map) {
  const result = {};
  LABEL_KEYS.forEach((label) => {
    const value = typeof map[label] === 'number' ? map[label] : 0;
    result[label] = clamp(value);
  });
  return result;
}

function clamp(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function computeCringeProb(probabilities) {
  if (typeof probabilities.overall_cringe === 'number' && probabilities.overall_cringe > 0) {
    return clamp(probabilities.overall_cringe);
  }
  // Combine per-label probabilities assuming independence.
  const product = LABEL_KEYS.filter((label) => label !== 'overall_cringe').reduce((acc, label) => {
    return acc * (1 - clamp(probabilities[label]));
  }, 1);
  return clamp(1 - product);
}

function buildRationales(probabilities, text) {
  const ranked = LABEL_KEYS.filter((label) => label !== 'overall_cringe')
    .map((label) => ({ label, score: probabilities[label] || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .filter((entry) => entry.score >= 0.35);

  return ranked.map((entry) => {
    const pretty = entry.label.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
    return `${pretty.trim()} (${entry.score.toFixed(2)})`;
  });
}

