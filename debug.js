// Debug script for LinkedIn Cringe Filter
// Run this in the browser console on LinkedIn to debug the extension

console.log('🚨 LINKEDIN CRINGE FILTER DEBUG: Starting debug session');

// Check if content script is loaded
console.log('Extension variables available:', {
  isEnabled: window.isEnabled,
  processedPosts: window.processedPosts,
  getPostId: typeof window.getPostId,
  analyzePost: typeof window.analyzePost,
  scanAllPosts: typeof window.scanAllPosts
});

// Check for posts using different selectors
const selectors = [
  '[data-urn*="urn:li:activity"]',
  '.feed-shared-update-v2[data-urn]',
  'div[role="article"]',
  'article[data-test-id="main-feed-activity-card"]',
  'div[data-test-id="main-feed-activity-card"]',
  '.feed-shared-update-v2',
  'article',
  '.feed-shared-update-v2__description-wrapper',
  '.feed-shared-text',
  '.update-components-text'
];

console.log('🚨 LINKEDIN CRINGE FILTER DEBUG: Checking selectors...');
selectors.forEach(selector => {
  const elements = document.querySelectorAll(selector);
  console.log(`Selector "${selector}": ${elements.length} elements found`);
  if (elements.length > 0 && elements.length <= 3) {
    console.log('First element:', elements[0]);
  }
});

// Test text-content-based approach
console.log('🚨 LINKEDIN CRINGE FILTER DEBUG: Testing text-content-based approach...');
const textContainers = document.querySelectorAll('.update-components-text');
console.log(`Found ${textContainers.length} text containers`);

const foundPosts = [];
textContainers.forEach((container, index) => {
  if (index < 5) { // Check first 5
    console.log(`\nText container ${index}:`);
    console.log('  Text preview:', container.textContent.trim().substring(0, 100) + '...');
    
    const possiblePost = container.closest('.feed-shared-update-v2') || 
                        container.closest('[data-urn]') ||
                        container.closest('article') ||
                        container.closest('[role="article"]');
    
    if (possiblePost) {
      console.log('  Found parent post:', possiblePost.tagName, possiblePost.className.split(' ')[0] + '...');
      console.log('  data-urn:', possiblePost.getAttribute('data-urn'));
      
      if (!foundPosts.includes(possiblePost)) {
        foundPosts.push(possiblePost);
        
        // Test our functions on this post
        if (window.getPostId) {
          const postId = window.getPostId(possiblePost);
          console.log('  Post ID:', postId);
        }
        
        if (window.getPostText) {
          const text = window.getPostText(possiblePost);
          console.log('  Text length:', text.length);
          console.log('  Text preview:', text.substring(0, 100) + '...');
        }
        
        if (window.hasPostImage) {
          const hasImage = window.hasPostImage(possiblePost);
          console.log('  Has image:', hasImage);
        }
      }
    } else {
      console.log('  No parent post found');
    }
  }
});

console.log(`\n🚨 LINKEDIN CRINGE FILTER DEBUG: Found ${foundPosts.length} unique posts via text containers`);

// Test manual scan
if (window.scanAllPosts) {
  console.log('🚨 LINKEDIN CRINGE FILTER DEBUG: Running manual scan...');
  window.scanAllPosts();
} else {
  console.log('🚨 LINKEDIN CRINGE FILTER DEBUG: scanAllPosts function not available');
}

console.log('🚨 LINKEDIN CRINGE FILTER DEBUG: Debug session complete');

// Enhanced Debug Script for LinkedIn Cringe Filter - Test Slider Reset Fix
console.log('🔧 LinkedIn Cringe Filter Debug Script - Testing Slider Reset Fix');

// Test functions for verifying the slider reset fix
window.testSliderResetFix = {
  
  // Test 1: Check current threshold storage and slider consistency
  async checkCurrentState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['threshold'], (result) => {
        const storedThreshold = result.threshold;
        const expectedSliderValue = storedThreshold !== undefined ? Math.round((1 - storedThreshold) * 100) : 30;
        
        console.log('=== Current State Check ===');
        console.log('Stored threshold:', storedThreshold);
        console.log('Expected slider value:', expectedSliderValue);
        console.log('Current cringe threshold in content:', window.cringeThreshold);
        
        resolve({
          storedThreshold,
          expectedSliderValue,
          contentThreshold: window.cringeThreshold
        });
      });
    });
  },

  // Test 2: Set a specific threshold and verify it persists
  async setAndVerifyThreshold(testThreshold = 0.5) {
    console.log(`=== Setting Test Threshold: ${testThreshold} ===`);
    
    // Set the threshold
    chrome.storage.local.set({ threshold: testThreshold }, () => {
      console.log('✅ Test threshold saved');
    });
    
    // Wait a moment then verify
    setTimeout(async () => {
      const state = await this.checkCurrentState();
      const expectedSlider = Math.round((1 - testThreshold) * 100);
      
      console.log('Verification Results:');
      console.log('- Expected threshold:', testThreshold);
      console.log('- Stored threshold:', state.storedThreshold);
      console.log('- Expected slider:', expectedSlider);
      console.log('- Content threshold:', state.contentThreshold);
      console.log('- Match:', Math.abs(state.storedThreshold - testThreshold) < 0.01 ? '✅' : '❌');
    }, 100);
  },

  // Test 3: Simulate cache clear and check if threshold persists
  async testCacheClear() {
    console.log('=== Testing Cache Clear (Simulated) ===');
    
    const beforeState = await this.checkCurrentState();
    console.log('Before cache clear:', beforeState);
    
    // Simulate the new cache clear logic
    const currentThreshold = beforeState.storedThreshold || 0.7;
    
    // This simulates what the fixed popup does
    chrome.storage.local.set({ threshold: currentThreshold }, () => {
      console.log('✅ Threshold preserved during cache clear simulation');
      
      // Simulate cache clearing
      if (window.resultsCache) {
        window.resultsCache.clear();
        console.log('✅ Memory cache cleared (simulated)');
      }
      
      // Check state after
      setTimeout(async () => {
        const afterState = await this.checkCurrentState();
        console.log('After cache clear:', afterState);
        console.log('Threshold preserved:', Math.abs(afterState.storedThreshold - currentThreshold) < 0.01 ? '✅' : '❌');
      }, 100);
    });
  },

  // Test 4: Test threshold consistency across page refresh
  async testPageRefreshConsistency() {
    console.log('=== Testing Page Refresh Consistency ===');
    
    const testThreshold = 0.3;
    console.log(`Setting threshold to ${testThreshold} and simulating refresh...`);
    
    // Set a specific threshold
    chrome.storage.local.set({ threshold: testThreshold }, () => {
      console.log('✅ Test threshold set');
      
      // Simulate content script reinitialization (what happens on page refresh)
      if (window.initializeSettings) {
        window.initializeSettings().then(() => {
          console.log('✅ Settings reinitialized');
          
          setTimeout(async () => {
            const state = await this.checkCurrentState();
            console.log('After refresh simulation:', state);
            console.log('Consistency check:', Math.abs(state.contentThreshold - testThreshold) < 0.01 ? '✅' : '❌');
          }, 100);
        });
      } else {
        console.log('⚠️ initializeSettings not available (might be in popup context)');
      }
    });
  },

  // Test 5: Run all tests
  async runAllTests() {
    console.log('🧪 Running All Slider Reset Fix Tests...\n');
    
    await this.checkCurrentState();
    console.log('\n');
    
    await this.setAndVerifyThreshold(0.4);
    console.log('\n');
    
    setTimeout(async () => {
      await this.testCacheClear();
      console.log('\n');
      
      setTimeout(async () => {
        await this.testPageRefreshConsistency();
        console.log('\n🏁 All tests completed!');
      }, 1000);
    }, 1000);
  },

  // Helper: Reset to default for testing
  resetToDefault() {
    console.log('🔄 Resetting to default threshold (0.7)...');
    chrome.storage.local.set({ threshold: 0.7 }, () => {
      console.log('✅ Reset complete');
    });
  }
};

// Quick access functions
window.checkSliderState = window.testSliderResetFix.checkCurrentState;
window.testSliderFix = window.testSliderResetFix.runAllTests;
window.resetSlider = window.testSliderResetFix.resetToDefault;

// Auto-run basic state check
setTimeout(() => {
  console.log('\n📊 Auto-running basic state check...');
  window.testSliderResetFix.checkCurrentState();
}, 1000);

console.log(`
🔧 DEBUG COMMANDS AVAILABLE:
- window.testSliderResetFix.runAllTests() - Run all tests
- window.checkSliderState() - Check current state
- window.testSliderFix() - Quick test alias
- window.resetSlider() - Reset to default
- window.debugLinkedInFilter() - Original debug info
`); 