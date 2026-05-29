# ClawdKit

A browser extension for Chrome and Firefox that allows you to export your Claude.ai conversations and artifacts in various formats with support for bulk exports, artifact extraction, and conversation browsing.

## Features

- **Export Individual Conversations** - Export any conversation directly from Claude.ai
- **Bulk Export** - Export all or filtered conversations as a ZIP file
- **Browse & Search** - View all your conversations in a searchable table
- **Sort Conversations** - Sort by name, date, project, model, and more
- **Branch-Aware Export** - Correctly handles conversation branches
- **Multiple Formats** - JSON (full data), Markdown, or Plain Text
- **Artifact Export** - Extract artifacts (code, documents, etc.) as separate files
- **Flexible Export Options** - Choose to include conversations, artifacts inline, or artifacts as separate files
- **ZIP Archives** - Bulk exports create organized ZIP files with conversations and artifacts
- **Metadata Options** - Include or exclude timestamps, models, and other metadata
- **Complete Model Information** - Preserves and displays model information for all conversations
- **Smart Model Inference** - Automatically infers the correct model for conversations that used the default model at the time
- **Token Counter** - Approximate token count for the current conversation with a mini progress bar (200k context limit)
- ⏱ **Cache Timer** - Countdown showing how long the conversation remains cached (cheaper to continue)
- **Usage Bars** - Session (5-hour) and weekly (7-day) usage with progress bars and reset countdowns
- **Secure** - All data processing happens in your browser and is never sent anywhere
- **Light/Dark Mode** - Toggle between color schemes

---
### Installation

See [docs/INSTALL.md](docs/INSTALL.md) for installation instructions (browser stores, manual, and from source).

---
### Usage

#### Token Counter & Usage Bars (automatic)
Once installed, the extension automatically displays on claude.ai:
- **Token count** — Approximate token count and mini progress bar appear next to the conversation header
- **Cache timer** — Countdown showing how long the conversation remains cached
- **Usage bars** — Session (5h) and weekly (7d) usage bars appear near the model selector, with reset countdowns
- Click the usage bars to manually refresh. All data is read from Claude's native API.

#### Export Current Conversation
1. Navigate to any conversation on claude.ai
2. Click the extension icon
3. Choose your export format and metadata preferences
4. Click "Export Current Conversation"

#### Browse All Conversations
1. Click the extension icon
2. Click "Browse All Conversations" (green button)
3. In the browse page, you can:
 - Search conversations by name
 - Filter by model
 - Sort by date or name
 - Export individual conversations
 - Export all filtered conversations as ZIP
 
#### Bulk Export
1. In the browse page, select your format and filters
2. Click "Export All"
3. A progress dialog will show the export status
4. Once complete, a ZIP file will download containing all conversations

---
### Export Formats

#### JSON
- Complete data including all branches and metadata
- Best for data preservation and programmatic use
- Includes all message versions and conversation branches

#### Markdown
- Human-readable format with formatting
- Shows only the current conversation branch
- Includes optional metadata (timestamps, model info)
- Great for documentation or sharing

#### Plain Text
- Simple format following Claude's prompt style
- Uses "User:" and "Claude:" prefixes
- Shows only the current conversation branch
- Ideal for copying into other LLMs or text editors

---
### Troubleshooting

#### "Failed to obtain organization ID"
- The extension auto-detects your Organization ID — make sure you're logged into Claude.ai and on a claude.ai tab
- If auto-detection fails, manually set it via the Options page: [docs/INSTALL.md](docs/INSTALL.md#configuration)
- The format should be: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

#### "Not authenticated" error
- Make sure you're logged into Claude.ai
- Try refreshing the Claude.ai page

#### Export fails for some conversations
- Some very old conversations might have different data structures
- Check the browser console for specific error messages
- The ZIP export includes a summary file listing any failed exports

#### Content Security Policy errors
- Make sure you're using the latest version of the extension
- Try reloading the extension from chrome://extensions/

**For browser-specific troubleshooting issues**, see [docs/INSTALL.md](docs/INSTALL.md#Troubleshooting)

---
### Known Limitations

- Rate limiting: The extension processes conversations in small batches to avoid overwhelming the API
- Using a VPN may return a 403 error when trying to connect to the Claude API
- Plaintext and markdown formats only export the currently selected branch in conversations with multiple branches
- Large bulk exports may take several minutes
- Some special content types (like artifacts) may not export perfectly
- API does not preserve per-message model data
 - `conversation.model` from the API is the *current* model only — when chats get bounced (deprecation, guardrails kicking to Sonnet 4, etc.) the original model is lost

---
### Privacy & Security

- **Local Processing**: All data processing happens in your browser
- **No External Servers**: The extension doesn't send data anywhere
- **Your Authentication**: Uses your existing Claude.ai session
- **Open Source**: You can review all code before installation

---
### Contributing

Feel free to submit issues or pull requests if you find bugs or have suggestions for improvements!

---

<div align="center">
<sub>
Independent project. Not affiliated with, endorsed by, or sponsored by Anthropic PBC. Anthropic, Claude,
</sub>
<br />
<sub>
and related marks belong to their respective owners.
</sub>
</div>
