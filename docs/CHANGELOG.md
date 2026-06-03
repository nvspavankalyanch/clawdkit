# Changelog

## [1.2.3] - 2026-06-03

### Features
- **Continue from Here** — a "Continue from here ↗" button appears at the bottom of each Claude response. Clicking it fetches the conversation from the API, truncates to that message, converts to Markdown, and copies to clipboard. A toast shows the message count and prompts pasting into a new conversation. Works via `getCurrentBranch()` + leaf UUID swap so the existing `convertToMarkdown()` function handles the truncation. DOM injection uses `MutationObserver` with debouncing; selector auto-detected and cached per page load.

## [1.2.2] - 2026-06-03

### Features
- **Keyboard shortcuts** — always-active on claude.ai tabs:
  - `Alt+E` — export current conversation as Markdown (shows an on-page toast with result)
  - `Alt+B` — open Browse page in a new tab
- **Ctrl+Enter to send** — toggle in Options → Keyboard. When on, Enter inserts a newline and Ctrl+Enter sends; Shift+Enter always inserts a newline. Live-updating via `storage.onChanged`.

## [1.2.1] - 2026-06-03

### Features
- **Wide Mode** — toggle in Options → Appearance. Removes claude.ai's side margins so the conversation and input area span the full browser width. Applied via `body[data-ct-wide]` attribute; updates live when toggled (no page reload needed for already-open tabs if content script is active, otherwise reload applies it).

## [1.2.0] - 2026-06-03

### Features
- **Obsidian export format** — new "Obsidian" option in the format selector (popup, browse, bulk export). Exports standard Markdown with YAML frontmatter (`title`, `date`, `model`, `source`, `tags`) compatible with Obsidian's metadata panel. Available across all export paths: Export Current, Export All, and Browse page single and bulk exports.
- **Obsidian filename template** — configurable in Options → Export. Supports `{{date}}` (YYYY-MM-DD) and `{{title}}` tokens. Default: `{{date}}-{{title}}`.

## [1.1.0] - 2026-05-31

### Design
- Complete UI redesign across popup, browse, and settings — "Atelier" design system
- Warm-toned color palette (paper/surface/ink/accent CSS variables) with full dark mode via `data-theme="dark"`
- Fonts: Bricolage Grotesque (display), Hanken Grotesk (UI), JetBrains Mono (mono)
- Popup: 392px width, segmented format controls, toggle switches, artifact placement chips, accent top bar
- Browse: sidebar navigation rail, collapsible export options panel, segmented filter control, styled settings dropdown
- Settings: sidebar nav, sectioned panels, radio cards for model display, org ID helper callout
- Updated `popup-theme.js` to consistent `data-theme="dark"` convention (matches browse.js)

## [1.0.1] - 2026-05-30

### Design
- Redesigned app icon (Concept A) — clay gradient tile with cream speech bubble and teal export-arrow-into-tray glyph; replaces the original speech-bubble-plus-bar-chart mark. Reads clearly at 16px toolbar size.

## [1.1.0] - 2026-05-29

### Features
- **Counter integration** — Token counting, cache timer, and usage bars now built into the extension
  - Approximate token count for the current conversation with a mini progress bar against the 200k context limit
  - Cache timer countdown showing how long the conversation remains cached (cheaper to continue)
  - Session (5-hour) and weekly (7-day) usage bars with progress bars and reset countdowns
  - Live SSE `message_limit` updates for more accurate usage than Claude's rounded /usage page
  - Click usage bars to manually refresh
- Previously a separate extension ([Counter](https://github.com/pavan-kalyan-ai/claude-ai-chat-exporter/tree/main/claude-counter)), now fully integrated into ClawdKit

### Technical
- Added `counter/` directory with 7 files (constants, bridge-client, bridge, tokens, ui, main, styles)
- Added `vendor/o200k_base.js` tokenizer library (~2MB)
- Updated manifests, background scripts, and web_accessible_resources for both Chrome and Firefox
- Counter uses isolated `globalThis.ClaudeCounter` namespace and `.cc-*` CSS — no conflicts with exporter code

## [1.0.0] - 2026-05-26

Initial release of ClawdKit by Pavan Kalyan.

### Features
- Export individual conversations directly from Claude.ai in JSON, Markdown, or Plain Text formats
- Bulk export all or filtered conversations as a ZIP file
- Browse and search all conversations in a sortable, filterable table
- Branch-aware export — correctly handles multi-branch conversations
- Artifact export — extract code, documents, and other artifacts as separate files
- Flexible export options — include conversations, inline artifacts, or artifacts as separate files
- Organized ZIP archives for bulk exports with per-conversation subfolders
- User-uploaded file attachments included in exports (`attachments/` subfolder per chat)
- Metadata options — include or exclude timestamps, models, and other info
- Complete model information preserved and displayed for all conversations
- Smart model inference — automatically infers the correct model for conversations using the default model at the time
- Export project — export entire Claude.ai projects as structured workspace ZIPs
- Backup & Restore — export/import all extension data (snapshots, history, preferences)
- Track export timestamps per conversation with new/updated indicators
- Auto-detect organization ID from Claude.ai session
- Settings dropdown on browse page (theme, org ID, filters, test connection)
- Light/Dark mode toggle
- Chrome (Manifest V3) and Firefox (Manifest V2) support
