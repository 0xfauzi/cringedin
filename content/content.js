console.log('🚨 LINKEDIN CRINGE FILTER: Content script loaded!', window.location.href);
// Main content script for LinkedIn Cringe Filter - Optimized for speed
let isEnabled = true;
let cringeThreshold = 0.7;
let testMode = false;
let currentCringeConfig = null;
const processedPosts = new Set();
const resultsCache = new Map(); // In-memory cache for instant lookups
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

// Make variables global for observer.js and viewport-manager.js
window.isEnabled = isEnabled;
window.processedPosts = processedPosts;
window.cringeThreshold = cringeThreshold;

// Add test and debugging functions immediately
window.enableTestMode = () => {
  testMode = true;
  console.log('🚨 LINKEDIN CRINGE FILTER: Test mode enabled - will blur high confidence posts');
  return 'Test mode enabled';
};

window.disableTestMode = () => {
  testMode = false;
  console.log('🚨 LINKEDIN CRINGE FILTER: Test mode disabled');
  return 'Test mode disabled';
};

window.setThreshold = (threshold) => {
  cringeThreshold = threshold;
  window.cringeThreshold = threshold;
  console.log(`🚨 LINKEDIN CRINGE FILTER: Threshold set to ${threshold}`);
  return `Threshold set to ${threshold}`;
};

// Debug function
window.debugLinkedInFilter = () => {
  const vmStats = window.viewportManager?.getStats() || {};
  
  console.log('🚨 LINKEDIN CRINGE FILTER DEBUG:');
  console.log('=== Core Settings ===');
  console.log('- isEnabled:', isEnabled);
  console.log('- testMode:', testMode);
  console.log('- cringeThreshold:', cringeThreshold);
  console.log('');
  console.log('=== Performance Stats ===');
  console.log('- processedPosts:', processedPosts.size);
  console.log('- resultsCache:', resultsCache.size);
  console.log('- totalPosts found:', document.querySelectorAll('[data-urn*="urn:li:activity"]').length);
  console.log('- blurredPosts:', document.querySelectorAll('.lcf-blurred').length);
  console.log('');
  console.log('=== Viewport Manager ===');
  console.log('- Queue size:', vmStats.queueSize || 0);
  console.log('- Currently processing:', vmStats.processing || 0);
  console.log('- Pending requests:', vmStats.pendingRequests || 0);
  console.log('- Pre-filter efficiency:', vmStats.preFilterEfficiency || 0, '%');
  console.log('');
  console.log('=== Optimization Metrics ===');
  console.log('- Viewport margin:', window.viewportManager?.VIEWPORT_MARGIN || 'N/A');
  console.log('- Max concurrent:', window.viewportManager?.MAX_CONCURRENT || 'N/A');
  console.log('- Pre-filter active:', !!window.cringePreFilter);
  console.log('- Request deduplication active:', vmStats.pendingRequests > 0);
  
  return 'Debug info logged to console';
};

// Improved settings initialization - prevent race conditions
function initializeSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['enabled', 'threshold', 'cringeConfig'], (result) => {
      // Use consistent defaults
      isEnabled = result.enabled !== false;
      cringeThreshold = result.threshold !== undefined ? result.threshold : 0.7;
      currentCringeConfig = result.cringeConfig || null;
      
      // Update global references
      window.isEnabled = isEnabled;
      window.cringeThreshold = cringeThreshold;
      
      console.log('🚨 LINKEDIN CRINGE FILTER: Settings initialized -', {
        enabled: isEnabled,
        threshold: cringeThreshold
      });
      
      resolve();
    });
  });
}

// Initialize settings on load
initializeSettings();

// Message listeners
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'TOGGLE_ENABLED') {
    isEnabled = request.enabled;
    window.isEnabled = isEnabled;
    if (!isEnabled) {
      unblurAllPosts();
    } else {
      // Re-scan all visible posts
      scanVisiblePosts();
    }
    sendResponse({ success: true });
  } else if (request.type === 'RESCAN_FEED') {
    console.log('🚨 LINKEDIN CRINGE FILTER: Rescanning feed...');
    processedPosts.clear();
    resultsCache.clear();
    unblurAllPosts();
    
    // Reinitialize settings to ensure consistency
    initializeSettings().then(() => {
      scanVisiblePosts();
      sendResponse({ success: true });
    });
    return true; // Keep message channel open for async response
  } else if (request.type === 'CLEAR_MEMORY_CACHE') {
    resultsCache.clear();
    console.log('🚨 LINKEDIN CRINGE FILTER: Memory cache cleared');
    sendResponse({ success: true });
  } else if (request.type === 'THRESHOLD_CHANGED') {
    cringeThreshold = request.threshold;
    window.cringeThreshold = cringeThreshold;
    console.log('🚨 LINKEDIN CRINGE FILTER: Threshold updated immediately to:', cringeThreshold);
    // Re-evaluate cached results with new threshold
    reEvaluateCachedResults();
    sendResponse({ success: true });
  } else if (request.type === 'CRINGE_CONFIG_CHANGED') {
    // Update pre-filter configuration
    if (window.cringePreFilter) {
      window.cringePreFilter.updateConfig(request.config);
    }
    currentCringeConfig = request.config;
    // Clear cache and rescan since detection criteria changed
    processedPosts.clear();
    resultsCache.clear();
    unblurAllPosts();
    scanVisiblePosts();
    sendResponse({ success: true });
  }
});

// Settings change listeners - improved to prevent race conditions
chrome.storage.onChanged.addListener((changes) => {
  let shouldRescan = false;
  
  if (changes.enabled) {
    isEnabled = changes.enabled.newValue;
    window.isEnabled = isEnabled;
    if (isEnabled) {
      shouldRescan = true;
    } else {
      unblurAllPosts();
    }
  }
  
  if (changes.threshold) {
    cringeThreshold = changes.threshold.newValue;
    window.cringeThreshold = cringeThreshold;
    console.log('🚨 LINKEDIN CRINGE FILTER: Threshold changed via storage to:', cringeThreshold);
    // Re-evaluate cached results with new threshold
    reEvaluateCachedResults();
  }

  if (changes.cringeConfig) {
    currentCringeConfig = changes.cringeConfig.newValue;
  }
  
  // Only rescan once if multiple settings changed
  if (shouldRescan) {
    scanVisiblePosts();
  }
});

function getPostId(element) {
  // Try multiple methods to get a unique post ID
  const urn = element.getAttribute('data-urn');
  if (urn) return urn;
  
  const elementWithUrn = element.closest('[data-urn]');
  if (elementWithUrn) {
    const urnValue = elementWithUrn.getAttribute('data-urn');
    if (urnValue) return urnValue;
  }

  const article = element.closest('article');
  if (article) {
    const articleUrn = article.getAttribute('data-urn');
    if (articleUrn) return articleUrn;
  }

  const activityLink = element.querySelector('a[href*="/feed/update/"]') || 
                      element.closest('[role="article"]')?.querySelector('a[href*="/feed/update/"]');
  if (activityLink) {
    const match = activityLink.href.match(/urn:li:activity:(\d+)/);
    if (match) return match[1];
  }

  // Generate ID from content hash as fallback
  const textContent = getPostText(element);
  if (textContent && textContent.length > 20) {
    return hashCode(textContent).toString();
  }

  return null;
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function getPostText(element) {
  // Check if we've already extracted text for this element (memoization)
  const cached = element._lcfTextCache;
  if (cached !== undefined) {
    return cached;
  }

  // Fast path: check most common selectors first
  const fastSelectors = [
    '.feed-shared-text',
    '.update-components-text',
    '[data-test-id="main-feed-activity-card__commentary"]'
  ];

  for (const selector of fastSelectors) {
    const content = element.querySelector(selector);
    if (content && content.textContent.trim()) {
      const text = content.textContent.replace(/\s+/g, ' ').trim();
      if (text.length > 10) {
        element._lcfTextCache = text;
        return text;
      }
    }
  }

  // Slower fallback for other cases
  const containers = [
    element,
    element.closest('[data-urn]'),
    element.closest('article'),
    element.closest('[role="article"]')
  ].filter(Boolean);

  const contentSelectors = [
    '.feed-shared-update-v2__description',
    '.feed-shared-update-v2__commentary',
    '.feed-shared-inline-show-more-text',
    'span[dir="ltr"]',
    '.break-words'
  ];

  for (const container of containers) {
    for (const selector of contentSelectors) {
      const content = container.querySelector(selector);
      if (content && content.textContent.trim()) {
        let text = content.textContent.trim();
        text = text.replace(/\s+/g, ' ').trim();
        if (text.length > 10) {
          element._lcfTextCache = text;
          return text;
        }
      }
    }
  }

  element._lcfTextCache = '';
  return '';
}

function hasPostImage(element) {
  // Fast check for common image indicators
  if (element._lcfHasImage !== undefined) {
    return element._lcfHasImage;
  }

  // Quick check for most common image selectors
  const quickCheck = element.querySelector(
    'img[data-test-id="main-feed-activity-card__image"], ' +
    '.feed-shared-image__image, ' +
    'video, ' +
    'iframe[title*="Document"]'
  );

  if (quickCheck) {
    element._lcfHasImage = true;
    return true;
  }

  // Full check only if quick check fails
  const containers = [
    element,
    element.closest('[data-urn]'),
    element.closest('article')
  ].filter(Boolean);

  const imageSelectors = [
    '.feed-shared-external-video__video',
    '.update-components-document__container',
    'img[alt]:not([alt=""]):not([alt*="profile"]):not([alt*="Photo of"])'
  ];

  for (const container of containers) {
    const hasImage = imageSelectors.some(selector => {
      const elements = container.querySelectorAll(selector);
      return elements.length > 0;
    });
    if (hasImage) {
      element._lcfHasImage = true;
      return true;
    }
  }

  element._lcfHasImage = false;
  return false;
}

function expandPost(element) {
  if (!element) return;
  const candidates = element.querySelectorAll('button, a, [role="button"]');
  candidates.forEach(node => {
    if (node.dataset?.lcfExpanded === '1') {
      return;
    }
    const text = (node.innerText || node.textContent || node.getAttribute('aria-label') || '').toLowerCase();
    if (text.includes('see more') || text.includes('show more')) {
      node.dataset.lcfExpanded = '1';
      try {
        node.click();
      } catch (error) {
        console.debug('🚨 LINKEDIN CRINGE FILTER: Failed to expand post button', error);
      }
    }
  });
}

function normalizePostText(text) {
  if (!text) return '';
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function estimateTokenLength(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function detectLanguage(text) {
  if (!text) return 'unknown';
  const asciiChars = (text.match(/[A-Za-z0-9\s]/g) || []).length;
  const ratio = asciiChars / text.length;
  if (ratio > 0.85) {
    return 'en';
  }
  const docLang = document.documentElement.lang || '';
  const navLang = navigator.language || '';
  const candidate = docLang || navLang;
  return candidate ? candidate.split('-')[0] : 'unknown';
}

function getEnabledIndicatorKeys() {
  if (!currentCringeConfig) {
    return LABEL_KEYS;
  }
  const enabled = Object.keys(currentCringeConfig).filter(key => currentCringeConfig[key]);
  if (!enabled.includes('overall_cringe')) {
    enabled.push('overall_cringe');
  }
  return enabled.length > 0 ? enabled : LABEL_KEYS;
}

// Optimized analysis with caching
async function analyzePost(element, postId, priority = false) {
  // Check in-memory cache first
  if (resultsCache.has(postId)) {
    const cached = resultsCache.get(postId);
    if (cached.isCringe && cached.confidence >= cringeThreshold) {
      blurPost(element, cached.reason);
    }
    return cached;
  }

  expandPost(element);
  delete element._lcfTextCache;

  const text = getPostText(element);
  const normalizedText = normalizePostText(text);
  if (!normalizedText || normalizedText.length < 50) {
    return null;
  }

  const trimmedText = normalizedText.slice(0, 3000);
  const charLen = trimmedText.length;
  const tokenLen = estimateTokenLength(trimmedText);
  const languageGuess = detectLanguage(trimmedText);
  const enabledIndicators = getEnabledIndicatorKeys();
  const scrapedAt = new Date().toISOString();
  const hasImage = hasPostImage(element);

  try {
    const result = await chrome.runtime.sendMessage({
      type: 'ANALYZE_POST',
      data: {
        postId,
        text: trimmedText,
        hasImage,
        priority,
        charLen,
        tokenLen,
        lang: languageGuess,
        scrapedAt,
        enabledIndicators
      }
    });

    if (result.error) {
      console.error('Analysis error:', result.error);
      return null;
    }

    // Cache result in memory
    resultsCache.set(postId, result);

    if (result.isCringe && result.confidence >= cringeThreshold) {
      blurPost(element, result.reason);
    } else if (testMode && result.confidence >= 0.8) {
      blurPost(element, `TEST MODE: ${result.reason} (Confidence: ${result.confidence})`);
    }

    return result;
  } catch (error) {
    console.error('Failed to analyze post:', error);
    return null;
  }
}

// Re-evaluate cached results when threshold changes
function reEvaluateCachedResults() {
  const posts = findAllPosts();
  posts.forEach(element => {
    const postId = getPostId(element);
    if (postId && resultsCache.has(postId)) {
      const result = resultsCache.get(postId);
      const isBlurred = element.classList.contains('lcf-blurred');
      
      if (result.isCringe && result.confidence >= cringeThreshold && !isBlurred) {
        blurPost(element, result.reason);
      } else if ((!result.isCringe || result.confidence < cringeThreshold) && isBlurred) {
        // Unblur if no longer meets threshold
        element.classList.remove('lcf-blurred');
        const overlay = element.querySelector('.lcf-overlay');
        if (overlay) overlay.remove();
      }
    }
  });
}

// Scan visible posts and observe new ones
function scanVisiblePosts() {
  if (!isEnabled) return;
  
  console.log('🚨 LINKEDIN CRINGE FILTER: Scanning visible posts');
  
  const posts = findAllPosts();
  posts.forEach(element => {
    const postId = getPostId(element);
    if (postId && !processedPosts.has(postId)) {
      processedPosts.add(postId);
      // Add to viewport observer
      window.viewportManager?.observePost(element);
    }
  });
}

function findAllPosts() {
  // Try multiple selectors to find all posts
  const postSelectors = [
    '[data-urn*="urn:li:activity"]',
    '.feed-shared-update-v2[data-urn]',
    'div[role="article"]',
    'article[data-test-id="main-feed-activity-card"]',
    'div[data-test-id="main-feed-activity-card"]',
    '.feed-shared-update-v2',
    'article'
  ];

  for (const selector of postSelectors) {
    const posts = document.querySelectorAll(selector);
    if (posts.length > 0) {
      console.log(`🚨 LINKEDIN CRINGE FILTER: Found ${posts.length} posts using selector: ${selector}`);
      return Array.from(posts);
    }
  }

  // Fallback: find by text content
  return findPostsByTextContent();
}

function findPostsByTextContent() {
  const posts = [];
  const textContainers = document.querySelectorAll('.update-components-text');
  
  textContainers.forEach(container => {
    const possiblePost = container.closest('.feed-shared-update-v2') || 
                        container.closest('[data-urn]') ||
                        container.closest('article') ||
                        container.closest('[role="article"]');
    
    if (possiblePost && !posts.includes(possiblePost)) {
      posts.push(possiblePost);
    }
  });
  
  return posts;
}

function blurPost(element, reason) {
  // Find the main post container
  const strategies = [
    () => element.closest('[data-urn]'),
    () => element.closest('article'),
    () => element.closest('[role="article"]'),
    () => element.closest('.feed-shared-update-v2'),
    () => element.closest('div[data-test-id*="main-feed-activity-card"]'),
    () => element
  ];
  
  let postContainer = null;
  for (const strategy of strategies) {
    postContainer = strategy();
    if (postContainer) break;
  }
                       
  if (!postContainer || postContainer.classList.contains('lcf-blurred')) {
    return;
  }

  postContainer.classList.add('lcf-blurred');
  
  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'lcf-overlay';
  overlay.innerHTML = `
    <div class="lcf-message">
      <p class="lcf-title">🚨 Cringe Alert!</p>
      <p class="lcf-reason">${reason}</p>
      <button class="lcf-show-btn">Show anyway</button>
    </div>
  `;

  overlay.querySelector('.lcf-show-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    postContainer.classList.remove('lcf-blurred');
    overlay.remove();
  });

  const computedStyle = window.getComputedStyle(postContainer);
  if (computedStyle.position === 'static') {
    postContainer.style.position = 'relative';
  }

  postContainer.appendChild(overlay);
}

function unblurAllPosts() {
  document.querySelectorAll('.lcf-blurred').forEach(article => {
    article.classList.remove('lcf-blurred');
    const overlay = article.querySelector('.lcf-overlay');
    if (overlay) overlay.remove();
  });
}

// Export functions for viewport manager
window.getPostId = getPostId;
window.getPostText = getPostText;
window.hasPostImage = hasPostImage;
window.blurPost = blurPost;
window.analyzePost = analyzePost;

// Test functions
window.forceBlurPost = (postIndex = 0) => {
  const posts = findAllPosts();
  if (posts[postIndex]) {
    blurPost(posts[postIndex], 'MANUAL TEST: Force blurred for testing');
    return `Blurred post ${postIndex}`;
  }
  return `Post ${postIndex} not found. Total posts: ${posts.length}`;
};

window.testBlurAll = () => {
  const posts = findAllPosts();
  console.log(`🚨 LINKEDIN CRINGE FILTER: Testing blur on ${Math.min(3, posts.length)} posts`);
  
  for (let i = 0; i < Math.min(3, posts.length); i++) {
    setTimeout(() => {
      blurPost(posts[i], `TEST BLUR ${i + 1}: This is a test blur for debugging`);
    }, i * 1000);
  }
  
  return `Testing blur on ${Math.min(3, posts.length)} posts`;
};

window.getStats = () => {
  const vmStats = window.viewportManager?.getStats() || {};
  const stats = {
    processedPosts: processedPosts.size,
    resultsCache: resultsCache.size,
    totalPosts: findAllPosts().length,
    blurredPosts: document.querySelectorAll('.lcf-blurred').length,
    viewportQueue: vmStats.queueSize || 0,
    processing: vmStats.processing || 0,
    pendingRequests: vmStats.pendingRequests || 0,
    preFilterEfficiency: vmStats.preFilterEfficiency || 0
  };
  
  console.log('🚨 LINKEDIN CRINGE FILTER: Stats:', stats);
  return stats;
};

// Initialize viewport manager when ready
if (window.viewportManager) {
  window.viewportManager.initialize();
  console.log('🚨 LINKEDIN CRINGE FILTER: Viewport manager initialized');
}

// Initial scan after a short delay
setTimeout(() => {
  scanVisiblePosts();
}, 1000);

// Make scanVisiblePosts available globally
window.scanVisiblePosts = scanVisiblePosts;

