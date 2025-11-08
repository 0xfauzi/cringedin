console.log('🚨 LINKEDIN CRINGE FILTER: Service worker loaded!');
// Service worker for handling API requests with priority queue and efficient caching
let apiKey = '';
let cringeConfig = null;
let inferenceMode = INFERENCE_MODES.TEACHER;
let studentReady = false;
let lastStudentError = null;
const API_ENDPOINT = 'https://api.openai.com/v1/responses';
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
const SAMPLE_SCHEMA_VERSION = 'multilabel_v2';
const SAMPLE_STORAGE_KEY = 'teacherSamples';
const SAMPLE_STORAGE_LIMIT = 500;
const OPENAI_SEED = 42;
const OPENAI_MODEL = 'gpt-4.1';
const INFERENCE_MODES = {
  TEACHER: 'teacher',
  STUDENT: 'student'
};
const RESPONSE_SCHEMA = {
  name: 'CringeTeacher_Multilabel_v2',
  strict: true,
  schema: {
    type: 'object',
    required: ['cringe_prob', 'labels'],
    additionalProperties: false,
    properties: {
      cringe_prob: { type: 'number', minimum: 0, maximum: 1 },
      labels: {
        type: 'object',
        required: LABEL_KEYS,
        additionalProperties: false,
        properties: LABEL_KEYS.reduce((acc, key) => {
          acc[key] = { type: 'number', minimum: 0, maximum: 1 };
          return acc;
        }, {})
      },
      top_reasons: {
        type: 'array',
        items: { type: 'string' },
        minItems: 0,
        maxItems: 3
      }
    }
  }
};
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CACHE_SIZE = 1000; // Maximum cached results

// Priority queue for API requests
class PriorityQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  add(item) {
    // Add item and sort by priority (higher priority first)
    this.queue.push(item);
    this.queue.sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0));
    this.process();
  }

  async process() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      try {
        const result = await analyzePost(item.data);
        item.resolve(result);
      } catch (error) {
        item.reject(error);
      }
    }
    this.processing = false;
  }
}

const requestQueue = new PriorityQueue();

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.target === 'offscreen') {
    // Message intended for the offscreen document; ignore in the service worker.
    return false;
  }

  if (request.type === 'SET_API_KEY') {
    apiKey = request.apiKey;
    chrome.storage.local.set({ apiKey });
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'ANALYZE_POST') {
    // Handle with priority queue
    new Promise((resolve, reject) => {
      requestQueue.add({
        data: request.data,
        priority: request.data.priority || false,
        resolve,
        reject
      });
    })
    .then(sendResponse)
    .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.type === 'GET_STATS') {
    chrome.storage.local.get(['stats'], (result) => {
      sendResponse(result.stats || { analyzed: 0, cringeDetected: 0 });
    });
    return true;
  }

  if (request.type === 'CLEAR_CACHE') {
    clearOldCache(true);
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'RESET_STATS') {
    // Reset statistics to zero
    chrome.storage.local.set({ 
      stats: { analyzed: 0, cringeDetected: 0, fromCache: 0 } 
    }, () => {
      console.log('🚨 LINKEDIN CRINGE FILTER: Statistics reset');
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.type === 'CRINGE_CONFIG_CHANGED') {
    cringeConfig = request.config;
    // Clear cache when config changes since analysis criteria changed
    clearOldCache(true);
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'THRESHOLD_CHANGED') {
    cringeThreshold = request.threshold;
    // Clear cache when threshold changes since analysis aggressiveness changed
    clearOldCache(true);
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'SET_INFERENCE_MODE') {
    const mode = request.mode;
    if (!Object.values(INFERENCE_MODES).includes(mode)) {
      sendResponse({ success: false, error: 'Invalid inference mode.' });
      return true;
    }
    inferenceMode = mode;
    studentReady = false; // Force reload on next use.
    chrome.storage.local.set({ inferenceMode: mode });
    sendResponse({ success: true, mode });
    return true;
  }

  if (request.type === 'GET_INFERENCE_STATE') {
    sendResponse({
      inferenceMode,
      studentReady,
      lastStudentError
    });
    return true;
  }
});

// Initialize API key, cringe config, and threshold from storage
let cringeThreshold = 0.7; // Default threshold
chrome.storage.local.get(['apiKey', 'cringeConfig', 'threshold', 'inferenceMode'], (result) => {
  if (result.apiKey) {
    apiKey = result.apiKey;
  }
  if (result.cringeConfig) {
    cringeConfig = result.cringeConfig;
  }
  if (result.threshold !== undefined) {
    cringeThreshold = result.threshold;
  }
  if (result.inferenceMode && Object.values(INFERENCE_MODES).includes(result.inferenceMode)) {
    inferenceMode = result.inferenceMode;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.inferenceMode) {
    const mode = changes.inferenceMode.newValue;
    if (Object.values(INFERENCE_MODES).includes(mode)) {
      inferenceMode = mode;
      console.log('🚨 LINKEDIN CRINGE FILTER: Inference mode updated to', inferenceMode);
    }
  }
});

// Generate dynamic multi-label prompt based on user configuration
function generateCringePrompt(enabledKeys = LABEL_KEYS) {
  const indicatorDescriptions = {
    humbleBragging: 'Humble bragging ("I\'m humbled to announce...", excessive self-congratulation)',
    excessiveEmojis: 'Overuse of emojis relative to text length or tone',
    engagementBait: 'Engagement bait (asking for likes/comments or using cliffhangers to farm engagement)',
    fakeStories: 'Dubious inspirational stories that feel fabricated or exaggerated',
    companyCulture: 'Over-the-top corporate culture praise with little substance',
    personalAnecdotes: 'Unnecessary personal anecdotes used to make a flimsy business point',
    hiringStories: '"I hired/rejected someone because..." performative hiring stories',
    basicDecencyPraising: 'Celebrating basic human decency as exceptional behavior',
    minorAchievements: 'Long posts bragging about very small wins',
    buzzwordOveruse: 'Buzzword overload without concrete content',
    linkedinCliches: 'Classic LinkedIn clichés ("Let that sink in", "Can we normalize...", etc.)',
    virtueSignaling: 'Virtue signaling or moral grandstanding without action',
    professionalOversharing: 'Sharing overly personal or private details in a professional context',
    mundaneLifeLessons: 'Forced life/business lessons from banal daily events',
    overall_cringe: 'Overall cringe factor capturing the combined effect of the above signals'
  };

  const activeKeys = Array.isArray(enabledKeys) && enabledKeys.length > 0 ? enabledKeys : LABEL_KEYS;
  const activeDescriptions = activeKeys.map(key => {
    const prettyKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
    return `- ${prettyKey}: ${indicatorDescriptions[key] || key}`;
  }).join('\n');

  const aggressiveness = cringeThreshold;
  let toneGuidance = '';

  if (aggressiveness <= 0.2) {
    toneGuidance = 'Be maximally aggressive. Treat borderline cases as positive.';
  } else if (aggressiveness <= 0.4) {
    toneGuidance = 'Be very strict. Err on the side of calling cringe.';
  } else if (aggressiveness <= 0.6) {
    toneGuidance = 'Be balanced but still call obvious cringe patterns decisively.';
  } else if (aggressiveness <= 0.8) {
    toneGuidance = 'Be selective. Only mark patterns that are clearly present.';
  } else {
    toneGuidance = 'Be cautious. Only mark egregious examples.';
  }

  return `You are a calibrated LinkedIn content rater. Score the post for overall cringe and for each specific cringe pattern.

Return probabilities in [0,1] where 0 = not present and 1 = overwhelming evidence. You can set medium values when unsure.

Active indicators to pay attention to:
${activeDescriptions}

${toneGuidance}

Answer strictly with JSON that matches the provided schema. Provide up to 3 short reasons that justify the strongest signals.`;
}

// Helper function to fix common JSON formatting issues
function fixJsonString(jsonStr) {
  let fixed = jsonStr.trim();
  
  // Remove any leading/trailing non-JSON content
  const jsonStart = fixed.indexOf('{');
  const jsonEnd = fixed.lastIndexOf('}');
  
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    fixed = fixed.substring(jsonStart, jsonEnd + 1);
  }
  
  // Fix trailing commas (most common issue)
  fixed = fixed.replace(/,\s*}/g, '}');
  fixed = fixed.replace(/,\s*]/g, ']');
  
  // Try to fix unterminated strings by adding missing closing quotes
  // Count unescaped quotes to see if we have an odd number
  let unescapedQuotes = 0;
  let inString = false;
  
  for (let i = 0; i < fixed.length; i++) {
    if (fixed[i] === '"' && (i === 0 || fixed[i-1] !== '\\')) {
      unescapedQuotes++;
      inString = !inString;
    }
  }
  
  // If we have an odd number of quotes, we're missing a closing quote
  if (unescapedQuotes % 2 !== 0 && inString) {
    // Add closing quote before the last closing brace
    const lastBrace = fixed.lastIndexOf('}');
    if (lastBrace !== -1) {
      fixed = fixed.substring(0, lastBrace) + '"' + fixed.substring(lastBrace);
    }
  }
  
  // Fix common newline issues in strings
  fixed = fixed.replace(/\n/g, '\\n');
  fixed = fixed.replace(/\r/g, '\\r');
  fixed = fixed.replace(/\t/g, '\\t');
  
  return fixed;
}

async function hashPrompt(promptText) {
  const encoder = new TextEncoder();
  const data = encoder.encode(promptText);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function clampProbability(value) {
  if (Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  return 0;
}

function ensureLabelMap(rawLabels = {}) {
  const labels = {};
  LABEL_KEYS.forEach(key => {
    labels[key] = clampProbability(typeof rawLabels[key] === 'number' ? rawLabels[key] : 0);
  });
  return labels;
}

function sanitizeReasons(reasons) {
  if (!Array.isArray(reasons)) {
    return [];
  }
  return reasons
    .map(reason => String(reason || '').trim())
    .filter(Boolean)
    .slice(0, 3);
}

function buildLegacyResult(teacher, threshold) {
  const topReasons = teacher.top_reasons;
  const primaryReason = topReasons[0] || 'Cringe indicators detected.';
  const confidence = clampProbability(teacher.cringe_prob);
  const isCringe = confidence >= threshold;
  return {
    isCringe,
    confidence,
    reason: primaryReason
  };
}

function estimateTokenLength(text) {
  if (!text) return 0;
  const tokens = text.trim().split(/\s+/);
  return tokens.filter(Boolean).length;
}

async function persistTeacherSample(sample) {
  return new Promise(resolve => {
    chrome.storage.local.get([SAMPLE_STORAGE_KEY], (result) => {
      const existing = Array.isArray(result[SAMPLE_STORAGE_KEY]) ? result[SAMPLE_STORAGE_KEY] : [];
      const dedupeKey = `${sample.post.post_id}::${sample.context.prompt_hash}`;

      const filtered = existing.filter(item => item.context?.dedupe_key !== dedupeKey);
      filtered.push({
        ...sample,
        context: {
          ...sample.context,
          dedupe_key: dedupeKey
        }
      });

      // Trim to storage limit (keep most recent)
      const trimmed = filtered.slice(-SAMPLE_STORAGE_LIMIT);
      chrome.storage.local.set({ [SAMPLE_STORAGE_KEY]: trimmed }, () => resolve());
    });
  });
}

async function analyzePost(postData) {
  const {
    postId,
    text,
    hasImage,
    charLen,
    tokenLen,
    lang,
    scrapedAt,
    enabledIndicators = LABEL_KEYS
  } = postData;
  console.log('🚨 LINKEDIN CRINGE FILTER: Analyzing post:', postId);

  if (!apiKey) {
    console.log('🚨 LINKEDIN CRINGE FILTER: No API key set');
    return { error: 'No API key configured. Please set your OpenAI API key in the extension popup.' };
  }

  // Check cache first
  const cached = await getCachedResult(postId);
  if (cached !== null) {
    console.log('🚨 LINKEDIN CRINGE FILTER: Using cached result for:', postId);
    updateStats(cached.isCringe, true);
    return cached;
  }

  if (inferenceMode === INFERENCE_MODES.STUDENT) {
    const studentResult = await analyzeWithStudent(postData);
    if (studentResult) {
      cacheResult(postId, studentResult);
      updateStats(studentResult.isCringe, false);
      return studentResult;
    }
    console.warn('🚨 LINKEDIN CRINGE FILTER: Student model unavailable, falling back to teacher API.');
  }

  // Generate dynamic system prompt based on user's cringe configuration
  const systemPrompt = generateCringePrompt(enabledIndicators);
  const promptHash = await hashPrompt(systemPrompt);
  const metadataCharLen = typeof charLen === 'number' ? charLen : text.length;
  const metadataTokenLen = typeof tokenLen === 'number' ? tokenLen : estimateTokenLength(text);
  const language = lang || 'unknown';
  const timestamp = scrapedAt || new Date().toISOString();

  const userPrompt = `POST (trimmed to 3000 chars):

"${text}"

Context:
- Has image/media: ${hasImage ? 'yes' : 'no'}
- Approx char length: ${metadataCharLen}
- Approx token length: ${metadataTokenLen}
- Language guess: ${language}

Task:
1. Return "cringe_prob" for overall cringe.
2. Return probabilities for each label key in the schema.
3. Provide up to three concise reasons referencing the content and label names.`;

  try {
    console.log(`🚨 LINKEDIN CRINGE FILTER: Making API call for post ${postId}`);
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        seed: OPENAI_SEED,
        temperature: 0.2,
        max_output_tokens: 200,
        response_format: { type: 'json_schema', json_schema: RESPONSE_SCHEMA },
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const rawContent = data.output_text ||
      data.output?.map(block => block.content?.map(item => item.text).join('\n')).join('\n') ||
      '';
    
    console.log(`🚨 LINKEDIN CRINGE FILTER: Raw AI response for post ${postId}:`, rawContent);
    
    let teacherPayload;
    try {
      teacherPayload = JSON.parse(rawContent);
    } catch (parseError) {
      console.error(`🚨 LINKEDIN CRINGE FILTER: JSON parsing error for post ${postId}:`, parseError);
      const fixedContent = fixJsonString(rawContent);
      try {
        teacherPayload = JSON.parse(fixedContent);
      } catch (fixError) {
        console.error(`🚨 LINKEDIN CRINGE FILTER: Could not fix JSON for post ${postId}:`, fixError);
        return {
          isCringe: false,
          confidence: 0.1,
          reason: `Analysis failed due to malformed AI response: ${parseError.message}`
        };
      }
    }
    
    if (!teacherPayload || typeof teacherPayload.cringe_prob !== 'number' || typeof teacherPayload.labels !== 'object') {
      console.error(`🚨 LINKEDIN CRINGE FILTER: Invalid teacher payload for post ${postId}:`, teacherPayload);
      return {
        isCringe: false,
        confidence: 0.1,
        reason: 'Analysis failed due to invalid AI response structure'
      };
    }
    
    const labels = ensureLabelMap(teacherPayload.labels);
    const topReasons = sanitizeReasons(teacherPayload.top_reasons);
    const teacher = {
      model: OPENAI_MODEL,
      temperature: 0.2,
      seed: OPENAI_SEED,
      schema_version: SAMPLE_SCHEMA_VERSION,
      labels,
      cringe_prob: clampProbability(teacherPayload.cringe_prob),
      top_reasons: topReasons
    };

    const legacyResult = buildLegacyResult({ cringe_prob: teacher.cringe_prob, top_reasons: topReasons }, cringeThreshold);
    console.log(`🚨 LINKEDIN CRINGE FILTER: Analysis complete for post ${postId}:`, {
      ...legacyResult,
      labels
    });
    
    const finalResult = {
      ...legacyResult,
      cringeProb: teacher.cringe_prob,
      labels,
      topReasons,
      promptHash,
      schemaVersion: SAMPLE_SCHEMA_VERSION,
      origin: 'teacher'
    };

    const sample = {
      schema_version: SAMPLE_SCHEMA_VERSION,
      post: {
        post_id: postId,
        text,
        char_len: metadataCharLen,
        token_len: metadataTokenLen,
        lang: language,
        has_image: !!hasImage
      },
      teacher,
      context: {
        aggressiveness: cringeThreshold,
        indicators_enabled: enabledIndicators,
        prompt_hash: promptHash,
        ts: timestamp
      }
    };

    await persistTeacherSample(sample);

    // Cache successful results
    cacheResult(postId, finalResult);
    updateStats(finalResult.isCringe, false);
    
    return finalResult;
  } catch (error) {
    console.error(`🚨 LINKEDIN CRINGE FILTER: Analysis error for post ${postId}:`, error);
    return { error: error.message };
  }
}

async function getCachedResult(postId) {
  return new Promise((resolve) => {
    chrome.storage.local.get([`post_${postId}`], (result) => {
      const cached = result[`post_${postId}`];
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        resolve(cached.result);
      } else {
        resolve(null);
      }
    });
  });
}

function cacheResult(postId, result) {
  // Only cache successful results
  if (!result.error) {
    chrome.storage.local.set({
      [`post_${postId}`]: {
        result,
        timestamp: Date.now()
      }
    }, () => {
      // Check cache size periodically
      checkCacheSize();
    });
  }
}

let creatingOffscreenDocument = null;

async function ensureOffscreenDocument() {
  if (!chrome.offscreen || !chrome.offscreen.createDocument) {
    return;
  }

  if (chrome.offscreen.hasDocument) {
    const hasDocument = await chrome.offscreen.hasDocument();
    if (hasDocument) {
      return;
    }
  }

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen/offscreen.html'),
      reasons: ['DOM_PARSER'],
      justification: 'Run the local student model with WebGPU.'
    }).catch((error) => {
      console.warn('🚨 LINKEDIN CRINGE FILTER: Failed to create offscreen document', error);
    }).finally(() => {
      creatingOffscreenDocument = null;
    });
  }

  await creatingOffscreenDocument;
}

function sendOffscreenMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ target: 'offscreen', ...message }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function ensureStudentModel() {
  await ensureOffscreenDocument();
  try {
    const result = await sendOffscreenMessage({ action: 'STUDENT_LOAD' });
    if (result?.ready) {
      studentReady = true;
      lastStudentError = null;
      return true;
    }
    studentReady = false;
    lastStudentError = result?.error || 'Unknown load error.';
    return false;
  } catch (error) {
    studentReady = false;
    lastStudentError = error.message;
    return false;
  }
}

async function analyzeWithStudent(postData) {
  if (!(await ensureStudentModel())) {
    return null;
  }

  try {
    const response = await sendOffscreenMessage({
      action: 'STUDENT_INFER',
      payload: {
        text: postData.text,
        lang: postData.lang,
        tokenLen: postData.tokenLen,
        hasImage: postData.hasImage
      }
    });

    if (!response || !response.success) {
      lastStudentError = response?.error || 'Unknown student inference error.';
      studentReady = false;
      return null;
    }

    const labels = ensureLabelMap(response.labels || {});
    const topReasons = Array.isArray(response.topReasons) ? response.topReasons : [];
    const cringeProb = clampProbability(response.cringeProb ?? labels.overall_cringe ?? 0);
    const legacy = buildLegacyResult({ cringe_prob: cringeProb, top_reasons: topReasons }, cringeThreshold);

    return {
      ...legacy,
      cringeProb,
      labels,
      topReasons,
      origin: 'student',
      promptHash: null,
      schemaVersion: SAMPLE_SCHEMA_VERSION,
      runtimeMs: response.runtimeMs || null
    };
  } catch (error) {
    studentReady = false;
    lastStudentError = error.message;
    console.warn('🚨 LINKEDIN CRINGE FILTER: Student inference failed:', error);
    return null;
  }
}

function updateStats(isCringe, fromCache) {
  chrome.storage.local.get(['stats'], (result) => {
    const stats = result.stats || { analyzed: 0, cringeDetected: 0, fromCache: 0 };
    stats.analyzed++;
    if (isCringe) {
      stats.cringeDetected++;
    }
    if (fromCache) {
      stats.fromCache = (stats.fromCache || 0) + 1;
    }
    chrome.storage.local.set({ stats });
  });
}

// Check cache size and remove oldest entries if needed
function checkCacheSize() {
  chrome.storage.local.get(null, (items) => {
    const cacheEntries = Object.keys(items)
      .filter(key => key.startsWith('post_'))
      .map(key => ({ key, timestamp: items[key].timestamp || 0 }))
      .sort((a, b) => b.timestamp - a.timestamp);
    
    if (cacheEntries.length > MAX_CACHE_SIZE) {
      const toRemove = cacheEntries.slice(MAX_CACHE_SIZE).map(e => e.key);
      chrome.storage.local.remove(toRemove);
      console.log(`🚨 LINKEDIN CRINGE FILTER: Removed ${toRemove.length} old cache entries`);
    }
  });
}

// Cleanup old cache entries
function clearOldCache(force = false) {
  chrome.storage.local.get(null, (items) => {
    const now = Date.now();
    const keysToRemove = [];
    
    Object.keys(items).forEach(key => {
      if (key.startsWith('post_')) {
        if (force || (items[key].timestamp && now - items[key].timestamp > CACHE_DURATION)) {
          keysToRemove.push(key);
        }
      }
    });
    
    if (keysToRemove.length > 0) {
      chrome.storage.local.remove(keysToRemove);
      console.log(`🚨 LINKEDIN CRINGE FILTER: Cleaned up ${keysToRemove.length} cache entries`);
    }
  });
}

// Cleanup old cache entries periodically
setInterval(() => clearOldCache(), 60 * 60 * 1000); // Run every hour
