console.log('🚨 LINKEDIN CRINGE FILTER: Service worker loaded!');
// Service worker for handling API requests with priority queue and efficient caching
let apiKey = '';
let cringeConfig = null;
const API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
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
});

// Initialize API key, cringe config, and threshold from storage
let cringeThreshold = 0.7; // Default threshold
chrome.storage.local.get(['apiKey', 'cringeConfig', 'threshold'], (result) => {
  if (result.apiKey) {
    apiKey = result.apiKey;
  }
  if (result.cringeConfig) {
    cringeConfig = result.cringeConfig;
  }
  if (result.threshold !== undefined) {
    cringeThreshold = result.threshold;
  }
});

// Generate dynamic cringe detection prompt based on user configuration
function generateCringePrompt() {
  const cringeIndicators = [];
  
  // Map checkbox IDs to cringe indicators
  const indicatorMap = {
    humbleBragging: 'Humble bragging ("I\'m humbled to announce...")',
    excessiveEmojis: 'Excessive emojis (>3-4 in short posts)',
    engagementBait: 'Engagement bait ("Agree? Thoughts?")',
    fakeStories: 'Fake inspirational stories',
    companyCulture: 'Over-the-top company culture posts',
    personalAnecdotes: 'Unnecessary personal anecdotes for business points',
    hiringStories: '"I hired/rejected someone because..." stories',
    basicDecencyPraising: 'Celebrating basic human decency as exceptional',
    minorAchievements: 'Multi-paragraph posts about minor achievements',
    buzzwordOveruse: 'Buzzword overuse without substance',
    linkedinCliches: '"Can we normalize...", "Let that sink in", and other LinkedIn clichés',
    virtueSignaling: 'Virtue signaling without substance',
    professionalOversharing: 'Professional oversharing',
    mundaneLifeLessons: '"Here\'s what I learned" from mundane experiences and turning every life event into a business lesson'
  };
  
  // If no config is loaded yet, use all indicators
  if (!cringeConfig) {
    cringeIndicators.push(...Object.values(indicatorMap));
  } else {
    // Only include enabled indicators
    Object.keys(indicatorMap).forEach(key => {
      if (cringeConfig[key] === true) {
        cringeIndicators.push(indicatorMap[key]);
      }
    });
  }
  
  // Determine aggressiveness based on threshold
  // Lower threshold = more aggressive (0 = maximum, 1 = minimum)
  const aggressiveness = cringeThreshold;
  let aggressivenessText = '';
  let confidenceGuidance = '';
  
  if (aggressiveness <= 0.2) {
    aggressivenessText = 'OBLITERATE EVERYTHING. Show absolutely NO MERCY. Even the slightest whiff of performative nonsense gets DESTROYED.';
    confidenceGuidance = 'Use maximum confidence (0.8-1.0) and be RUTHLESSLY aggressive.';
  } else if (aggressiveness <= 0.4) {
    aggressivenessText = 'TEAR APART any obvious corporate theater. Be VICIOUSLY strict about these patterns.';
    confidenceGuidance = 'Use high confidence scores (0.7-0.9) and show NO SYMPATHY for fake content.';
  } else if (aggressiveness <= 0.6) {
    aggressivenessText = 'MERCILESSLY JUDGE these patterns with balanced brutality.';
    confidenceGuidance = 'Use solid confidence scores (0.6-0.8) but still be HARSH on obvious cases.';
  } else if (aggressiveness <= 0.8) {
    aggressivenessText = 'Be SELECTIVELY BRUTAL - only annihilate clear examples of these patterns.';
    confidenceGuidance = 'Use moderate confidence scores (0.5-0.7) but still call out obvious BS.';
  } else {
    aggressivenessText = 'Be RELUCTANTLY TOLERANT - only destroy the most EGREGIOUS examples.';
    confidenceGuidance = 'Use lower confidence scores (0.4-0.6) but still maintain your CRITICAL EDGE.';
  }
  
  // If no indicators are enabled, return a minimal prompt
  if (cringeIndicators.length === 0) {
    return `You are a BRUTAL CRITIC who absolutely despises LinkedIn's toxic culture of fake positivity and fake nonsense. You have ZERO tolerance for corporate acting. Since no specific cringe indicators are enabled, ${aggressivenessText.toLowerCase()} 

CRITICAL: Respond with VALID JSON only. No other text. Ensure all strings are properly quoted and escaped.

# Response Format (JSON only):
{
  "isCringe": boolean,
  "confidence": number (0-1),
  "reason": "brief explanation without quotes or newlines"
}

Example: {"isCringe": false, "confidence": 0.2, "reason": "Shockingly contains actual substance instead of corporate garbage"}

${aggressivenessText} ${confidenceGuidance} Show ABSOLUTELY NO MERCY for empty content pretending to be deep. DESTROY the fake inspirational nonsense.`;
  }
  
  // Generate the full prompt with selected indicators
  const indicatorList = cringeIndicators.map(indicator => `- ${indicator}`).join('\n');
  
  return `You are a SAVAGE LINKEDIN CRITIC who has endured YEARS of insufferable corporate virtue signaling, fake inspirational stories, and shameless self-promotion. You are SICK AND TIRED of the platform's toxic positivity culture. You call out BS with the fury of a thousand suns and have absolutely ZERO patience for fake nonsense.

CRITICAL: Respond with VALID JSON only. No other text. Ensure all strings are properly quoted and escaped.

# Your Mission - Call Out These Cringe Patterns:
${indicatorList}

# Your Brutal Analysis Style:
${aggressivenessText} ${confidenceGuidance} You are a TOUGH JUDGE of what's real. Call out fake vulnerability, fake inspiration, and corporate acting exactly.

# Response Format (JSON only):
{
  "isCringe": boolean,
  "confidence": number (0-1),
  "reason": "brief explanation without quotes or newlines"
}

Example: {"isCringe": true, "confidence": 0.95, "reason": "Disgusting fake vulnerability acting designed to get likes"}

Only spare posts that provide REAL value without fake acting. Everything else gets CALLED OUT without mercy.`;
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

async function analyzePost(postData) {
  const { postId, text, hasImage } = postData;
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

  // Generate dynamic system prompt based on user's cringe configuration
  const systemPrompt = generateCringePrompt();

  const userPrompt = `Analyze this LinkedIn post:

"${text}"

${hasImage ? 'Note: This post includes an image.' : ''}`;

  try {
    console.log(`🚨 LINKEDIN CRINGE FILTER: Making API call for post ${postId}`);
    const response = await fetch(API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4.1',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.2,
        max_tokens: 100,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const rawContent = data.choices[0].message.content;
    
    console.log(`🚨 LINKEDIN CRINGE FILTER: Raw AI response for post ${postId}:`, rawContent);
    
    let result;
    try {
      result = JSON.parse(rawContent);
    } catch (jsonError) {
      console.error(`🚨 LINKEDIN CRINGE FILTER: JSON parsing error for post ${postId}:`, jsonError);
      console.error(`🚨 LINKEDIN CRINGE FILTER: Problematic content:`, rawContent);
      
      // Try to fix common JSON issues
      const fixedContent = fixJsonString(rawContent);
      try {
        result = JSON.parse(fixedContent);
        console.log(`🚨 LINKEDIN CRINGE FILTER: Successfully parsed fixed JSON for post ${postId}:`, result);
      } catch (fixError) {
        console.error(`🚨 LINKEDIN CRINGE FILTER: Could not fix JSON for post ${postId}:`, fixError);
        // Return a fallback result
        return {
          isCringe: false,
          confidence: 0.1,
          reason: `Analysis failed due to malformed AI response: ${jsonError.message}`
        };
      }
    }
    
    // Validate the result structure
    if (!result || typeof result.isCringe !== 'boolean' || typeof result.confidence !== 'number') {
      console.error(`🚨 LINKEDIN CRINGE FILTER: Invalid result structure for post ${postId}:`, result);
      return {
        isCringe: false,
        confidence: 0.1,
        reason: 'Analysis failed due to invalid AI response structure'
      };
    }
    
    console.log(`🚨 LINKEDIN CRINGE FILTER: Analysis complete for post ${postId}:`, result);
    
    const finalResult = {
      isCringe: result.isCringe,
      confidence: Math.max(0, Math.min(1, result.confidence)), // Clamp between 0-1
      reason: result.reason || 'No reason provided'
    };

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
