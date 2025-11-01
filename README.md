# CringeIn

A Chrome extension that automatically detects and blurs cringe LinkedIn posts using GPT-4.1 analysis.

## Features

- 🤖 **AI-Powered Detection**: Uses GPT-4.1 to analyze post content
- 🙈 **Auto-blur**: Automatically blurs detected cringe posts
- 🎯 **Adjustable Sensitivity**: Control how strict the filter is
- 📊 **Statistics**: Track how many posts have been analyzed
- 💾 **Smart Caching**: Reduces API calls by caching results
- 🔄 **Real-time**: Works as you scroll through your feed

## What Makes a Post "Cringe"?

The extension looks for common LinkedIn cringe patterns:
- Humble bragging
- Excessive emoji use
- "Agree? Thoughts?" endings
- Fake inspirational stories
- Over-the-top company culture posts
- Unnecessary personal anecdotes for basic points
- Celebrating basic human decency as exceptional

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/linkedin-cringe-filter.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" in the top right

4. Click "Load unpacked" and select the extension directory

5. The extension icon should appear in your toolbar

## Setup

1. Click the extension icon
2. Enter your OpenAI API key (get one at [platform.openai.com](https://platform.openai.com))
3. Make sure you have access to GPT-4.1
4. Navigate to LinkedIn and watch the magic happen!

## Configuration

- **Enable/Disable**: Toggle the extension on/off
- **Sensitivity**: Adjust the cringe detection threshold (0-100%)
- **Clear Cache**: Remove all cached analysis results
- **Rescan Feed**: Force re-analysis of current posts

## How It Works

1. **Content Detection**: The extension monitors your LinkedIn feed for new posts
2. **Text Extraction**: Extracts post content while you scroll
3. **AI Analysis**: Sends text to GPT-4.1 for cringe detection
4. **Visual Feedback**: Blurs posts that exceed the cringe threshold
5. **User Control**: Click "Show anyway" to reveal any blurred post

## Privacy & Security

- No data is collected or stored externally
- API keys are stored locally in Chrome
- Post analysis is cached locally for 7 days
- All processing happens between your browser and OpenAI

## Development

### Project Structure
```
linkedin-cringe-filter/
├── manifest.json          # Extension configuration
├── background/
│   └── service-worker.js  # Handles API calls
├── content/
│   ├── content.js         # Main content script
│   ├── observer.js        # DOM mutation observer
│   └── styles.css         # Injected styles
└── popup/
    ├── popup.html         # Extension popup
    ├── popup.js           # Popup logic
    └── popup.css          # Popup styles
```

### API Usage

The extension uses GPT-4.1 with specific prompting for reliable cringe detection:
- Structured JSON responses
- Clear cringe indicators
- Confidence scoring
- Brief explanations

### Performance Optimizations

- Batched API requests (up to 5 posts at once)
- Intelligent caching system
- Debounced scroll detection
- Minimal DOM manipulation

## Troubleshooting

**Posts not being analyzed?**
- Check your API key is valid
- Ensure you have GPT-4.1 access
- Try refreshing the page

**Too many/few posts being blurred?**
- Adjust the sensitivity slider
- Posts need 70%+ confidence by default

**Extension not working?**
- Make sure you're on linkedin.com
- Check the extension is enabled
- Look for errors in the console

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Future Enhancements

- [ ] Image analysis support
- [ ] Custom cringe patterns
- [ ] Whitelist specific users
- [ ] Export statistics
- [ ] Batch processing optimization
- [ ] Multi-language support

## License

MIT License - feel free to use and modify!

## Disclaimer

This extension is for entertainment purposes. "Cringe" is subjective, and the AI might not always align with your personal preferences. Use responsibly and be kind to your LinkedIn connections! 😊
