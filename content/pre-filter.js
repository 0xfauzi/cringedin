// Pre-filter for instant cringe detection without API calls
class CringePreFilter {
  constructor() {
    this.cringeConfig = null;
    this.loadConfig();
    
    // Obvious cringe patterns that don't need API validation
    this.instantCringePatterns = [
      // Humble brags
      /i['']m humbled to announce/i,
      /excited and humbled/i,
      /blessed and grateful/i,
      /thrilled and honored/i,
      
      // Excessive emoji patterns
      /([🎉🎊🚀💪🔥✨⭐️🌟💯]{3,})/,
      /(.)\1{4,}/, // Same emoji repeated 5+ times
      
      // Engagement bait
      /^agree\?$/i,
      /^thoughts\?$/i,
      /agree\?\s*thoughts\?/i,
      /drop a[n]? (?:emoji|comment|❤️|👍)/i,
      /type (?:yes|amen|1)/i,
      /repost if you agree/i,
      
      // LinkedIn lunatic phrases
      /can we normalize/i,
      /let that sink in/i,
      /read that again/i,
      /a thread 🧵/i,
      /unpopular opinion:/i,
      /hot take:/i,
      
      // Fake inspiration
      /today i learned that .{0,20} is a metaphor for/i,
      /this random encounter taught me/i,
      /my (?:3|4|5|6|7|8|9|10)[\s-]?year[\s-]?old (?:daughter|son|child) (?:taught|showed) me/i,
      
      // Over-the-top reactions
      /i['']m crying/i,
      /literally shaking/i,
      /goosebumps/i,
      /mind\s*=\s*blown/i,
      
      // Cringe storytelling
      /so i (?:hired|rejected|fired) (?:him|her|them)/i,
      /the candidate who/i,
      /plot twist:/i,
      /spoiler alert:/i
    ];

    // Obvious non-cringe patterns (skip API for these)
    this.definitelyNotCringePatterns = [
      // Technical content
      /```[\s\S]+```/, // Code blocks
      /github\.com/i,
      /stackoverflow\.com/i,
      /\b(?:api|sql|javascript|python|java|react|vue|angular)\b/i,
      
      // Professional updates without fluff
      /^(?:we are|we're) hiring/i,
      /^new position/i,
      /^job opening/i,
      
      // Direct business content
      /quarterly results/i,
      /earnings report/i,
      /product launch/i,
      /^announcing/i
    ];

    // Word frequency indicators
    this.cringeBuzzwords = new Set([
      'humbled', 'blessed', 'grateful', 'honored', 'thrilled',
      'journey', 'pivot', 'synergy', 'disrupt', 'mindset',
      'hustle', 'grind', 'manifest', 'authentic', 'vulnerable',
      'intentional', 'empower', 'elevate', 'unlock', 'unleash'
    ]);
  }

  loadConfig() {
    // Load cringe configuration from storage
    chrome.storage.local.get(['cringeConfig'], (result) => {
      this.cringeConfig = result.cringeConfig;
    });
  }

  updateConfig(config) {
    this.cringeConfig = config;
  }

  isPatternEnabled(patternType) {
    if (!this.cringeConfig) return true; // Default to enabled if no config
    
    // Map pattern types to config keys
    const patternMap = {
      humbleBrag: 'humbleBragging',
      emoji: 'excessiveEmojis',
      engagement: 'engagementBait',
      cliche: 'linkedinCliches',
      story: 'fakeStories',
      hiring: 'hiringStories',
      buzzword: 'buzzwordOveruse'
    };
    
    const configKey = patternMap[patternType];
    return configKey ? this.cringeConfig[configKey] !== false : true;
  }

  getPatternType(pattern) {
    const patternStr = pattern.toString();
    
    if (patternStr.includes('humbled')) return 'humbleBrag';
    if (patternStr.includes('emoji') || patternStr.includes('{3,}')) return 'emoji';
    if (patternStr.includes('agree') || patternStr.includes('thoughts')) return 'engagement';
    if (patternStr.includes('normalize') || patternStr.includes('sink in')) return 'cliche';
    if (patternStr.includes('taught me') || patternStr.includes('learned')) return 'story';
    if (patternStr.includes('hired') || patternStr.includes('rejected')) return 'hiring';
    
    return 'general'; // Default type
  }

  analyze(text) {
    if (!text || text.length < 30) {
      return null; // Too short to analyze
    }

    const lowerText = text.toLowerCase();
    
    // Check definite non-cringe first
    for (const pattern of this.definitelyNotCringePatterns) {
      if (pattern.test(text)) {
        return {
          isCringe: false,
          confidence: 0.9,
          reason: 'Professional/technical content',
          source: 'pre-filter'
        };
      }
    }

    // Check instant cringe patterns (only if enabled)
    for (const pattern of this.instantCringePatterns) {
      if (pattern.test(text)) {
        const patternType = this.getPatternType(pattern);
        if (this.isPatternEnabled(patternType)) {
          return {
            isCringe: true,
            confidence: 0.95,
            reason: this.getReasonForPattern(pattern, text),
            source: 'pre-filter'
          };
        }
      }
    }

    // Check buzzword density (only if enabled)
    if (this.isPatternEnabled('buzzword')) {
      const words = lowerText.split(/\s+/);
      const buzzwordCount = words.filter(word => this.cringeBuzzwords.has(word)).length;
      const buzzwordDensity = buzzwordCount / words.length;

      if (buzzwordDensity > 0.1) { // More than 10% buzzwords
        return {
          isCringe: true,
          confidence: 0.85,
          reason: 'Too many business buzzwords',
          source: 'pre-filter'
        };
      }
    }

    // Check emoji density (only if enabled)
    if (this.isPatternEnabled('emoji')) {
      const emojiCount = (text.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length;
      const emojiDensity = emojiCount / text.length;

      if (emojiDensity > 0.05 && text.length < 200) { // More than 5% emojis in short post
        return {
          isCringe: true,
          confidence: 0.8,
          reason: 'Too many emojis',
          source: 'pre-filter'
        };
      }
    }

    // No definitive match - needs API analysis
    return null;
  }

  getReasonForPattern(pattern, text) {
    const patternStr = pattern.toString();
    
    if (patternStr.includes('humbled')) return 'Humble bragging detected';
    if (patternStr.includes('emoji')) return 'Too many emojis';
    if (patternStr.includes('agree')) return 'Begging for likes';
    if (patternStr.includes('normalize')) return 'LinkedIn trendy phrases';
    if (patternStr.includes('taught me')) return 'Fake inspirational story';
    if (patternStr.includes('hired')) return 'Boring hiring story';
    
    return 'Typical LinkedIn nonsense';
  }
}

// Export for use
window.cringePreFilter = new CringePreFilter(); 