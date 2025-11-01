// Viewport-based pre-emptive post analysis manager
class ViewportManager {
  constructor() {
    this.observer = null;
    this.processQueue = new Map(); // postId -> element
    this.processing = new Set(); // Currently processing post IDs
    this.pendingRequests = new Map(); // postId -> Promise (for deduplication)
    this.VIEWPORT_MARGIN = '500px'; // Analyze posts 500px before they're visible
    this.MAX_CONCURRENT = 10; // Max concurrent API calls
    this.preFilterStats = { total: 0, filtered: 0 };
  }

  initialize() {
    // Create intersection observer with large margin
    this.observer = new IntersectionObserver(
      (entries) => this.handleIntersection(entries),
      {
        root: null,
        rootMargin: `${this.VIEWPORT_MARGIN} 0px ${this.VIEWPORT_MARGIN} 0px`,
        threshold: 0
      }
    );

    // Start processing queue
    this.startQueueProcessor();
  }

  handleIntersection(entries) {
    entries.forEach(entry => {
      const element = entry.target;
      const postId = window.getPostId?.(element);
      
      if (!postId || window.processedPosts?.has(postId)) {
        return;
      }

      if (entry.isIntersecting) {
        // Post is approaching viewport - add to queue with priority
        const rect = element.getBoundingClientRect();
        const distanceToViewport = Math.max(0, rect.top - window.innerHeight);
        
        this.processQueue.set(postId, {
          element,
          priority: distanceToViewport,
          timestamp: Date.now()
        });
      } else {
        // Post left the extended viewport - remove from queue
        this.processQueue.delete(postId);
      }
    });
  }

  async startQueueProcessor() {
    while (true) {
      await this.processNextBatch();
      await new Promise(resolve => setTimeout(resolve, 50)); // Check every 50ms
    }
  }

  async processNextBatch() {
    if (!window.isEnabled || this.processQueue.size === 0) {
      return;
    }

    // Sort queue by priority (closest to viewport first)
    const sortedQueue = Array.from(this.processQueue.entries())
      .sort((a, b) => a[1].priority - b[1].priority)
      .slice(0, this.MAX_CONCURRENT - this.processing.size);

    // Process posts concurrently
    const promises = sortedQueue.map(([postId, data]) => {
      if (this.processing.has(postId)) return null;
      
      this.processing.add(postId);
      this.processQueue.delete(postId);
      
      return this.analyzePost(data.element, postId)
        .finally(() => this.processing.delete(postId));
    });

    await Promise.all(promises.filter(Boolean));
  }

  async analyzePost(element, postId) {
    // Mark as processed immediately to prevent duplicate processing
    window.processedPosts?.add(postId);

    const text = window.getPostText?.(element);
    if (!text || text.length < 50) {
      return;
    }

    // Check if we're already processing this exact post (deduplication)
    if (this.pendingRequests.has(postId)) {
      const result = await this.pendingRequests.get(postId);
      this.applyResult(element, result);
      return;
    }

    try {
      // Try pre-filter first for instant results
      this.preFilterStats.total++;
      const preFilterResult = window.cringePreFilter?.analyze(text);
      
      if (preFilterResult) {
        this.preFilterStats.filtered++;
        console.log(`🚨 LINKEDIN CRINGE FILTER: Pre-filter result for ${postId}:`, preFilterResult);
        
        // Cache pre-filter result
        if (window.resultsCache) {
          window.resultsCache.set(postId, preFilterResult);
        }
        
        this.applyResult(element, preFilterResult);
        
        // Log pre-filter efficiency periodically
        if (this.preFilterStats.total % 50 === 0) {
          const efficiency = Math.round((this.preFilterStats.filtered / this.preFilterStats.total) * 100);
          console.log(`🚨 LINKEDIN CRINGE FILTER: Pre-filter efficiency: ${efficiency}% (${this.preFilterStats.filtered}/${this.preFilterStats.total})`);
        }
        
        return;
      }

      // Need API analysis - create deduplication promise
      const analysisPromise = chrome.runtime.sendMessage({
        type: 'ANALYZE_POST',
        data: {
          postId,
          text: text.substring(0, 1000),
          hasImage: window.hasPostImage?.(element),
          priority: true
        }
      });

      this.pendingRequests.set(postId, analysisPromise);

      const result = await analysisPromise;
      
      this.pendingRequests.delete(postId);

      if (result.error) {
        console.error(`Analysis error for post ${postId}:`, result.error);
        return;
      }

      // Cache API result
      if (window.resultsCache) {
        window.resultsCache.set(postId, result);
      }

      this.applyResult(element, result);
    } catch (error) {
      console.error(`Failed to analyze post ${postId}:`, error);
      this.pendingRequests.delete(postId);
    }
  }

  applyResult(element, result) {
    if (result.isCringe && result.confidence >= window.cringeThreshold) {
      window.blurPost?.(element, result.reason);
    }
  }

  observePost(element) {
    if (this.observer) {
      this.observer.observe(element);
    }
  }

  disconnect() {
    if (this.observer) {
      this.observer.disconnect();
    }
  }

  getStats() {
    return {
      queueSize: this.processQueue.size,
      processing: this.processing.size,
      pendingRequests: this.pendingRequests.size,
      preFilterEfficiency: this.preFilterStats.total > 0 
        ? Math.round((this.preFilterStats.filtered / this.preFilterStats.total) * 100) 
        : 0
    };
  }
}

// Export for use in content script
window.viewportManager = new ViewportManager(); 