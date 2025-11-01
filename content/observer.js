console.log('🚨 LINKEDIN CRINGE FILTER: Observer script loaded!');
// Optimized mutation observer to detect new posts immediately
let observer = null;

function initializeObserver() {
  if (observer) {
    observer.disconnect();
  }

  const targetNode = document.querySelector('main') || document.body;
  
  const config = {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false
  };

  const callback = function(mutationsList) {
    // Process mutations immediately
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if the added node is a post or contains posts
            const posts = [];
            
            // Check if node itself is a post
            if (isPostElement(node)) {
              posts.push(node);
            }
            
            // Find posts within the node
            const foundPosts = findPostsInNode(node);
            posts.push(...foundPosts);
            
            // Add posts to viewport observer immediately
            posts.forEach(post => {
              if (window.isEnabled && window.getPostId && window.processedPosts) {
                const postId = window.getPostId(post);
                if (postId && !window.processedPosts.has(postId)) {
                  window.processedPosts.add(postId);
                  // Add to viewport observer immediately
                  window.viewportManager?.observePost(post);
                  
                  // If post is already in viewport, analyze with high priority
                  const rect = post.getBoundingClientRect();
                  const isNearViewport = rect.top < window.innerHeight + 500 && rect.bottom > -100;
                  
                  if (isNearViewport && window.analyzePost) {
                    // Analyze immediately if near viewport
                    window.analyzePost(post, postId, true);
                  }
                }
              }
            });
          }
        });
      }
    }
  };

  observer = new MutationObserver(callback);
  observer.observe(targetNode, config);
  
  console.log('🚨 LINKEDIN CRINGE FILTER: DOM observer initialized');
}

function isPostElement(element) {
  // Check if element is likely a post
  const postIndicators = [
    '[data-urn*="urn:li:activity"]',
    '.feed-shared-update-v2[data-urn]',
    'div[role="article"]',
    'article[data-test-id="main-feed-activity-card"]',
    'div[data-test-id="main-feed-activity-card"]'
  ];
  
  return postIndicators.some(selector => element.matches && element.matches(selector));
}

function findPostsInNode(node) {
  if (!node.querySelectorAll) return [];
  
  const postSelectors = [
    '[data-urn*="urn:li:activity"]',
    '.feed-shared-update-v2[data-urn]',
    'div[role="article"]',
    'article[data-test-id="main-feed-activity-card"]',
    'div[data-test-id="main-feed-activity-card"]',
    '.feed-shared-update-v2',
    'article'
  ];
  
  const posts = [];
  for (const selector of postSelectors) {
    const found = node.querySelectorAll(selector);
    if (found.length > 0) {
      posts.push(...Array.from(found));
      break; // Use first successful selector to avoid duplicates
    }
  }
  
  return posts;
}

// Handle page navigation (LinkedIn is a SPA)
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    
    // Clear processed posts on navigation
    if (window.processedPosts) {
      window.processedPosts.clear();
    }
    
    // Clear cache
    if (window.resultsCache) {
      window.resultsCache.clear();
    }
    
    // Reset viewport manager
    if (window.viewportManager) {
      window.viewportManager.disconnect();
      window.viewportManager.processQueue.clear();
      window.viewportManager.processing.clear();
    }
    
    // Reinitialize after navigation
    setTimeout(() => {
      initializeObserver();
      if (window.viewportManager) {
        window.viewportManager.initialize();
      }
      if (window.scanVisiblePosts) {
        window.scanVisiblePosts();
      }
    }, 500);
  }
}).observe(document, { subtree: true, childList: true });

// Initialize observer when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeObserver);
} else {
  initializeObserver();
}

// Reinitialize on visibility change
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && window.isEnabled) {
    // Re-scan when tab becomes visible
    if (window.scanVisiblePosts) {
      window.scanVisiblePosts();
    }
  }
});

// Detect scroll direction for predictive loading
let lastScrollY = window.scrollY;
let scrollDirection = 'down';

window.addEventListener('scroll', () => {
  const currentScrollY = window.scrollY;
  scrollDirection = currentScrollY > lastScrollY ? 'down' : 'up';
  lastScrollY = currentScrollY;
  
  // Adjust viewport margin based on scroll direction
  if (window.viewportManager && window.viewportManager.observer) {
    const margin = scrollDirection === 'down' ? '800px' : '300px';
    if (window.viewportManager.VIEWPORT_MARGIN !== margin) {
      window.viewportManager.VIEWPORT_MARGIN = margin;
      // Reinitialize observer with new margin
      window.viewportManager.disconnect();
      window.viewportManager.initialize();
      window.scanVisiblePosts();
    }
  }
}, { passive: true });
