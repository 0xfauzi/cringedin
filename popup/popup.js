// Popup JavaScript

// Global error handlers to prevent uncaught errors from showing in Chrome extensions page
window.addEventListener('error', (event) => {
  console.error('Popup error:', event.error);
  event.preventDefault();
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection in popup:', event.reason);
  event.preventDefault();
});

// Toast Notification System
class ToastManager {
  constructor() {
    this.container = null;
    this.toasts = new Map();
    this.toastCounter = 0;
    this.init();
  }

  init() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.createContainer());
    } else {
      this.createContainer();
    }
  }

  createContainer() {
    this.container = document.getElementById('toast-container');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toast-container';
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  }

  show(options) {
    const {
      type = 'info',
      title = '',
      message = '',
      duration = 4000,
      closable = true
    } = options;

    const toastId = `toast-${++this.toastCounter}`;
    const toast = this.createToast(toastId, type, title, message, closable);
    
    this.container.appendChild(toast);
    this.toasts.set(toastId, toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    // Auto-dismiss
    if (duration > 0) {
      const progressBar = toast.querySelector('.toast-progress-bar');
      if (progressBar) {
        progressBar.style.width = '100%';
        progressBar.style.transitionDuration = `${duration}ms`;
        
        // Start progress animation
        requestAnimationFrame(() => {
          progressBar.style.width = '0%';
        });
      }

      setTimeout(() => {
        this.hide(toastId);
      }, duration);
    }

    return toastId;
  }

  createToast(id, type, title, message, closable) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('data-toast-id', id);

    const icons = {
      success: '✅',
      error: '⚠️',
      warning: '⚠️',
      info: 'ℹ️',
      confirm: '❓'
    };

    const icon = icons[type] || icons.info;

    toast.innerHTML = `
      <div class="toast-header">
        <div class="toast-icon">${icon}</div>
        ${title ? `<div class="toast-title">${title}</div>` : ''}
        ${closable ? '<button class="toast-close" aria-label="Close">✕</button>' : ''}
      </div>
      <div class="toast-content">
        ${message ? `<div class="toast-message">${message}</div>` : ''}
      </div>
      <div class="toast-progress">
        <div class="toast-progress-bar"></div>
      </div>
    `;

    // Add close button functionality
    const closeBtn = toast.querySelector('.toast-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.hide(id);
      });
    }

    return toast;
  }

  hide(toastId) {
    const toast = this.toasts.get(toastId);
    if (!toast) return;

    toast.classList.remove('show');
    toast.classList.add('hide');

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
      this.toasts.delete(toastId);
    }, 300);
  }

  success(title, message, duration = 3000) {
    return this.show({
      type: 'success',
      title,
      message,
      duration
    });
  }

  error(title, message, duration = 5000) {
    return this.show({
      type: 'error',
      title,
      message,
      duration
    });
  }

  warning(title, message, duration = 4000) {
    return this.show({
      type: 'warning',
      title,
      message,
      duration
    });
  }

  info(title, message, duration = 4000) {
    return this.show({
      type: 'info',
      title,
      message,
      duration
    });
  }

  confirm(title, message, options = {}) {
    return new Promise((resolve) => {
      const {
        confirmText = 'Yes',
        cancelText = 'No',
        confirmClass = 'primary',
        cancelClass = 'secondary'
      } = options;

      const toastId = `toast-${++this.toastCounter}`;
      const toast = this.createConfirmToast(toastId, title, message, {
        confirmText,
        cancelText,
        confirmClass,
        cancelClass,
        onConfirm: () => {
          this.hide(toastId);
          resolve(true);
        },
        onCancel: () => {
          this.hide(toastId);
          resolve(false);
        }
      });

      this.container.appendChild(toast);
      this.toasts.set(toastId, toast);

      // Trigger animation
      requestAnimationFrame(() => {
        toast.classList.add('show');
      });
    });
  }

  createConfirmToast(id, title, message, options) {
    const toast = document.createElement('div');
    toast.className = 'toast confirm';
    toast.setAttribute('data-toast-id', id);

    toast.innerHTML = `
      <div class="toast-header">
        <div class="toast-icon">❓</div>
        ${title ? `<div class="toast-title">${title}</div>` : ''}
        <button class="toast-close" aria-label="Close">✕</button>
      </div>
      <div class="toast-content">
        ${message ? `<div class="toast-message">${message}</div>` : ''}
        <div class="toast-actions">
          <button class="toast-btn ${options.confirmClass}" data-action="confirm">
            ${options.confirmText}
          </button>
          <button class="toast-btn ${options.cancelClass}" data-action="cancel">
            ${options.cancelText}
          </button>
        </div>
      </div>
    `;

    // Add button functionality
    const confirmBtn = toast.querySelector('[data-action="confirm"]');
    const cancelBtn = toast.querySelector('[data-action="cancel"]');
    const closeBtn = toast.querySelector('.toast-close');

    confirmBtn.addEventListener('click', options.onConfirm);
    cancelBtn.addEventListener('click', options.onCancel);
    closeBtn.addEventListener('click', options.onCancel);

    return toast;
  }

  clear() {
    this.toasts.forEach((toast, id) => {
      this.hide(id);
    });
  }
}

// Initialize toast manager
const toast = new ToastManager();

// Development/debugging function to test all toast types
// Can be called from browser console: testToasts()
window.testToasts = function() {
  console.log('Testing all toast types...');
  
  // Test success toast
  setTimeout(() => {
    toast.success('Success Test', 'This is a success notification with auto-dismiss');
  }, 500);
  
  // Test error toast
  setTimeout(() => {
    toast.error('Error Test', 'This is an error notification that stays longer');
  }, 1000);
  
  // Test warning toast
  setTimeout(() => {
    toast.warning('Warning Test', 'This is a warning notification');
  }, 1500);
  
  // Test info toast
  setTimeout(() => {
    toast.info('Info Test', 'This is an informational notification');
  }, 2000);
  
  // Test confirmation toast
  setTimeout(async () => {
    const result = await toast.confirm(
      'Confirmation Test', 
      'This is a confirmation dialog. Do you want to proceed?',
      { confirmText: 'Yes, Proceed', cancelText: 'Cancel' }
    );
    
    if (result) {
      toast.success('Confirmed', 'You clicked Yes!');
    } else {
      toast.info('Cancelled', 'You clicked No or closed the dialog');
    }
  }, 2500);
  
  return 'Toast tests initiated! Check the UI for toast notifications.';
};

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const enableToggle = document.getElementById('enableToggle');
  const apiSection = document.getElementById('apiSection');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const saveApiKeyBtn = document.getElementById('saveApiKey');
  const thresholdSlider = document.getElementById('thresholdSlider');
  const thresholdValue = document.querySelector('.threshold-value');
  const analyzedCount = document.getElementById('analyzedCount');
  const cringeCount = document.getElementById('cringeCount');
  const cringeRate = document.getElementById('cringeRate');
  const clearCacheBtn = document.getElementById('clearCache');
  const resetStatsBtn = document.getElementById('resetStats');
  const rescanBtn = document.getElementById('rescan');
  
  // View navigation elements
  const mainView = document.getElementById('mainView');
  const configView = document.getElementById('configView');
  const openConfigBtn = document.getElementById('openConfigBtn');
  const backBtn = document.getElementById('backBtn');

  
  // Cringe configuration elements
  const selectAllCringeBtn = document.getElementById('selectAllCringe');
  const deselectAllCringeBtn = document.getElementById('deselectAllCringe');
  const resetDefaultCringeBtn = document.getElementById('resetDefaultCringe');
  
  // All cringe checkboxes
  const cringeCheckboxes = [
    'humbleBragging', 'engagementBait', 'excessiveEmojis',
    'fakeStories', 'hiringStories', 'companyCulture', 'personalAnecdotes',
    'buzzwordOveruse', 'linkedinCliches', 'virtueSignaling', 'professionalOversharing',
    'basicDecencyPraising', 'minorAchievements', 'mundaneLifeLessons'
  ];

  // Helper function to safely send messages to content script
  function sendToContentScript(message, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url?.includes('linkedin.com')) {
        chrome.tabs.sendMessage(tabs[0].id, message, (response) => {
          if (chrome.runtime.lastError) {
            console.log(`Content script not available for ${message.type}:`, chrome.runtime.lastError.message);
          }
          if (callback) callback(response, chrome.runtime.lastError);
        });
      } else {
        console.log(`Skipped sending ${message.type} - not on LinkedIn`);
        if (callback) callback(null, { message: 'Not on LinkedIn' });
      }
    });
  }

  // Simplified settings loading - fix race conditions
  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['enabled', 'apiKey', 'threshold', 'stats', 'cringeConfig'], (result) => {
        console.log('Loading settings from storage:', result);
        
        // Enable toggle
        enableToggle.checked = result.enabled !== false;
        
        // API key
        if (result.apiKey) {
          apiKeyInput.value = result.apiKey;
          apiSection.classList.add('hidden');
        }
        
        // Cringe configuration
        const cringeConfig = result.cringeConfig || getDefaultCringeConfig();
        loadCringeConfig(cringeConfig);
        
        // Threshold handling - simplified and consistent
        const threshold = result.threshold !== undefined ? result.threshold : 0.7;
        const sliderValue = Math.round((1 - threshold) * 100);
        
        console.log(`Loading - Threshold: ${threshold}, Slider value: ${sliderValue}`);
        
        // Set slider value and update display
        thresholdSlider.value = sliderValue;
        updateThresholdDisplay(sliderValue);
        
        // Update stats
        updateStats(result.stats || { analyzed: 0, cringeDetected: 0 });
        
        resolve();
      });
    });
  }

  // Initialize settings on load
  loadSettings().then(() => {
    console.log('Settings loaded successfully');
  });

  // Helper function to update threshold display
  function updateThresholdDisplay(sliderValue) {
    if (sliderValue <= 20) {
      thresholdValue.textContent = 'Minimal';
    } else if (sliderValue <= 40) {
      thresholdValue.textContent = 'Less';
    } else if (sliderValue <= 60) {
      thresholdValue.textContent = 'Balanced';
    } else if (sliderValue <= 80) {
      thresholdValue.textContent = 'More';
    } else {
      thresholdValue.textContent = 'Maximum';
    }
  }

  // Enable/disable toggle
  enableToggle.addEventListener('change', (e) => {
    const enabled = e.target.checked;
    chrome.storage.local.set({ enabled });
    
    // Notify content script
    sendToContentScript({ type: 'TOGGLE_ENABLED', enabled });
  });

  // API key save
  saveApiKeyBtn.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      toast.warning('API Key Required', 'Please enter an API key');
      return;
    }

    chrome.runtime.sendMessage({ type: 'SET_API_KEY', apiKey }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Failed to save API key:', chrome.runtime.lastError.message);
        toast.error('Save Failed', 'Failed to save API key. Please try again.');
        return;
      }
      
      if (response?.success) {
        apiSection.classList.add('hidden');
        toast.success('API Key Saved', 'Your API key has been saved successfully!');
      } else {
        toast.error('Save Failed', 'Failed to save API key. Please try again.');
      }
    });
  });

  // Threshold slider - Simplified with proper state preservation
  let saveThresholdTimeout;
  
  function saveThreshold(sliderValue) {
    // Invert the slider value to get the actual threshold
    const threshold = 1 - (sliderValue / 100);
    
    console.log(`Saving threshold - Slider: ${sliderValue}, Threshold: ${threshold}`);
    
    chrome.storage.local.set({ threshold }, () => {
      console.log('✅ Threshold saved to storage:', threshold);
    });
    
    // Notify content script immediately
    sendToContentScript({ 
      type: 'THRESHOLD_CHANGED', 
      threshold: threshold 
    });
    
    // Notify service worker immediately
    chrome.runtime.sendMessage({ 
      type: 'THRESHOLD_CHANGED', 
      threshold: threshold 
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('Service worker notification failed:', chrome.runtime.lastError.message);
      } else {
        console.log('✅ Service worker notified of threshold change');
      }
    });
  }

  thresholdSlider.addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    updateThresholdDisplay(value);
    
    // Save with debouncing
    clearTimeout(saveThresholdTimeout);
    saveThresholdTimeout = setTimeout(() => {
      saveThreshold(value);
    }, 300);
  });

  thresholdSlider.addEventListener('change', (e) => {
    const sliderValue = parseInt(e.target.value);
    
    // Clear debounced save and save immediately
    clearTimeout(saveThresholdTimeout);
    saveThreshold(sliderValue);
  });

  // Clear cache - FIXED: Preserve slider state
  clearCacheBtn.addEventListener('click', async () => {
    const confirmed = await toast.confirm(
      'Clear Cache?', 
      'This will clear all cached analysis results. Continue?',
      { confirmText: 'Clear', cancelText: 'Cancel' }
    );
    
    if (confirmed) {
      // Save current slider state before clearing cache
      const currentSliderValue = parseInt(thresholdSlider.value);
      const currentThreshold = 1 - (currentSliderValue / 100);
      
      console.log('Preserving threshold before cache clear:', currentThreshold);
      
      // Ensure threshold is saved before clearing cache
      chrome.storage.local.set({ threshold: currentThreshold }, () => {
        // Now clear the cache
        chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('Failed to clear cache:', chrome.runtime.lastError.message);
            toast.error('Clear Failed', 'Failed to clear cache. Please try again.');
            return;
          }
          
          // Also clear from content script memory
          sendToContentScript({ type: 'CLEAR_MEMORY_CACHE' });
          
          // Reload settings to ensure consistency
          setTimeout(() => {
            loadSettings();
          }, 100);
          
          toast.success('Cache Cleared', 'All cached results have been cleared successfully!');
        });
      });
    }
  });

  // Reset statistics
  resetStatsBtn.addEventListener('click', async () => {
    const confirmed = await toast.confirm(
      'Reset Statistics?', 
      'This will clear your analyzed posts count and cringe detection stats. This action cannot be undone.',
      { confirmText: 'Reset', cancelText: 'Cancel' }
    );
    
    if (confirmed) {
      chrome.runtime.sendMessage({ type: 'RESET_STATS' }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Failed to reset statistics:', chrome.runtime.lastError.message);
          toast.error('Reset Failed', 'Failed to reset statistics. Please try again.');
          return;
        }
        
        // Immediately update the displayed stats to show reset
        updateStats({ analyzed: 0, cringeDetected: 0, fromCache: 0 });
        
        toast.success('Statistics Reset', 'All statistics have been reset successfully!');
      });
    }
  });

  // Rescan feed - FIXED: Preserve slider state
  rescanBtn.addEventListener('click', () => {
    // Save current slider state before rescanning
    const currentSliderValue = parseInt(thresholdSlider.value);
    const currentThreshold = 1 - (currentSliderValue / 100);
    
    console.log('Preserving threshold before rescan:', currentThreshold);
    
    // Ensure threshold is saved before rescanning
    chrome.storage.local.set({ threshold: currentThreshold }, () => {
      sendToContentScript({ type: 'RESCAN_FEED' }, (response, error) => {
        if (error) {
          if (error.message === 'Not on LinkedIn') {
            toast.info('LinkedIn Required', 'Please navigate to LinkedIn first');
          } else {
            toast.warning('Content Script Not Ready', 'Please refresh the LinkedIn page and try again.');
          }
        } else {
          // Reload settings to ensure consistency
          setTimeout(() => {
            loadSettings();
          }, 100);
          
          toast.success('Feed Rescanned', 'LinkedIn feed has been rescanned successfully!', 2000);
          // Close popup after brief delay to show the success message
          setTimeout(() => {
            window.close();
          }, 1500);
        }
      });
    });
  });

  // Update stats periodically
  function updateStats(stats) {
    analyzedCount.textContent = stats.analyzed || 0;
    cringeCount.textContent = stats.cringeDetected || 0;
    
    const rate = stats.analyzed > 0 
      ? Math.round((stats.cringeDetected / stats.analyzed) * 100)
      : 0;
    cringeRate.textContent = `${rate}%`;
    
    // Show cache hit rate if available
    if (stats.fromCache) {
      const cacheRate = stats.analyzed > 0 
        ? Math.round((stats.fromCache / stats.analyzed) * 100)
        : 0;
      // You could add this to the UI if desired
      console.log(`Cache hit rate: ${cacheRate}%`);
    }
  }

  // Refresh stats
  setInterval(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATS' }, (stats) => {
      if (chrome.runtime.lastError) {
        console.log('Failed to get stats:', chrome.runtime.lastError.message);
        return;
      }
      if (stats) updateStats(stats);
    });
  }, 2000);

  // Safety mechanism: save any pending threshold changes before closing
  window.addEventListener('beforeunload', () => {
    if (saveThresholdTimeout) {
      clearTimeout(saveThresholdTimeout);
      const currentValue = parseInt(thresholdSlider.value);
      saveThreshold(currentValue);
    }
  });

  // Also save on popup blur/focus loss
  window.addEventListener('blur', () => {
    if (saveThresholdTimeout) {
      clearTimeout(saveThresholdTimeout);
      const currentValue = parseInt(thresholdSlider.value);
      saveThreshold(currentValue);
    }
  });

  // Cringe configuration functions
  function getDefaultCringeConfig() {
    const config = {};
    cringeCheckboxes.forEach(id => {
      config[id] = true; // All enabled by default
    });
    return config;
  }

  function loadCringeConfig(config) {
    cringeCheckboxes.forEach(id => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.checked = config[id] !== false;
      }
    });
  }

  function saveCringeConfig() {
    const config = {};
    cringeCheckboxes.forEach(id => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        config[id] = checkbox.checked;
      }
    });
    
    chrome.storage.local.set({ cringeConfig: config }, () => {
      console.log('Cringe configuration saved:', config);
      
      // Notify content script and service worker of config change
      sendToContentScript({ 
        type: 'CRINGE_CONFIG_CHANGED', 
        config: config 
      });
      
      chrome.runtime.sendMessage({ 
        type: 'CRINGE_CONFIG_CHANGED', 
        config: config 
      });
    });
  }

  // View navigation functions
  function showMainView() {
    mainView.classList.remove('hidden');
    configView.classList.add('hidden');
    
    // Switch header content
    document.getElementById('mainHeader').classList.remove('hidden');
    document.getElementById('configHeader').classList.add('hidden');
  }

  function showConfigView() {
    mainView.classList.add('hidden');
    configView.classList.remove('hidden');
    
    // Switch header content
    document.getElementById('mainHeader').classList.add('hidden');
    document.getElementById('configHeader').classList.remove('hidden');
  }

  // Add event listeners to all cringe checkboxes
  cringeCheckboxes.forEach(id => {
    const checkbox = document.getElementById(id);
    if (checkbox) {
      checkbox.addEventListener('change', saveCringeConfig);
    }
  });

  // Select all cringe types
  selectAllCringeBtn.addEventListener('click', () => {
    cringeCheckboxes.forEach(id => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.checked = true;
      }
    });
    saveCringeConfig();
  });

  // Deselect all cringe types
  deselectAllCringeBtn.addEventListener('click', () => {
    cringeCheckboxes.forEach(id => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.checked = false;
      }
    });
    saveCringeConfig();
  });

  // Reset to default configuration
  resetDefaultCringeBtn.addEventListener('click', () => {
    const defaultConfig = getDefaultCringeConfig();
    loadCringeConfig(defaultConfig);
    saveCringeConfig();
  });

  // View navigation event listeners
  openConfigBtn.addEventListener('click', () => {
    showConfigView();
  });

  backBtn.addEventListener('click', () => {
    showMainView();
  });
});
