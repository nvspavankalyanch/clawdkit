// Shared utility functions for ClawdKit

// Helper function to reconstruct the current branch from the message tree
function getCurrentBranch(data) {
  if (!data.chat_messages || !data.current_leaf_message_uuid) {
    return [];
  }
  
  // Create a map of UUID to message for quick lookup
  const messageMap = new Map();
  data.chat_messages.forEach(msg => {
    messageMap.set(msg.uuid, msg);
  });
  
  // Trace back from the current leaf to the root
  const branch = [];
  let currentUuid = data.current_leaf_message_uuid;
  const visited = new Set();

  while (currentUuid && messageMap.has(currentUuid)) {
    if (visited.has(currentUuid)) break; // cycle guard
    visited.add(currentUuid);
    const message = messageMap.get(currentUuid);
    branch.unshift(message); // Add to beginning to maintain order
    currentUuid = message.parent_message_uuid;

    // Stop if we hit the root (parent UUID that doesn't exist in our messages)
    if (!messageMap.has(currentUuid)) {
      break;
    }
  }
  
  return branch;
}

// Convert to markdown format
function convertToMarkdown(data, includeMetadata, conversationId = null, includeArtifacts = true, includeThinking = true) {
  console.log('🔧 convertToMarkdown - conversationId:', conversationId, 'includeArtifacts:', includeArtifacts, 'includeThinking:', includeThinking);
  let markdown = `# ${data.name || 'Untitled Conversation'}\n\n`;

  if (includeMetadata) {
    markdown += `**Created:** ${new Date(data.created_at).toLocaleString()}\n`;
    markdown += `**Updated:** ${new Date(data.updated_at).toLocaleString()}\n`;
    markdown += `**Exported:** ${new Date().toLocaleString()}\n`;
    markdown += `**Model:** ${data.model}\n`;
    if (conversationId) {
      markdown += `**Link:** [https://claude.ai/chat/${conversationId}](https://claude.ai/chat/${conversationId})\n`;
    }
    if (data.truncated !== undefined) {
      markdown += `**Truncated:** ${data.truncated}\n`;
    }
    markdown += `\n---\n\n`;
  }

  // Get only the current branch messages
  const branchMessages = getCurrentBranch(data);

  for (const message of branchMessages) {
    const sender = message.sender === 'human' ? '## User' : '## Claude';
    markdown += `${sender}\n`;

    if (includeMetadata && message.created_at) {
      markdown += `**${new Date(message.created_at).toISOString()}**\n`;
    }
    markdown += `\n`;

    // Extract artifacts from the entire message (handles both old and new formats)
    const messageArtifacts = includeArtifacts ? extractArtifactsFromMessage(message) : [];
    if (messageArtifacts.length > 0) {
      console.log('📦 Found', messageArtifacts.length, 'artifact(s) in message:', messageArtifacts.map(a => a.title));
    }

    // Render message text (excluding tool_use and artifact tags)
    if (message.content) {
      for (const content of message.content) {
        // Handle thinking blocks (extended thinking)
        if (content.type === 'thinking' && content.thinking && includeThinking) {
          markdown += `### Thinking\n\`\`\`\`\n${content.thinking}\n\`\`\`\`\n\n`;
        }
        // Handle regular text content (skip tool_use, we handle artifacts separately)
        else if (content.type === 'text' && content.text) {
          // Remove old-format artifact tags from text
          let textWithoutArtifacts = content.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
          if (textWithoutArtifacts) {
            markdown += `${textWithoutArtifacts}\n\n`;
          }
        }
      }
    } else if (message.text) {
      // Handle old format - remove artifact tags from text
      let textWithoutArtifacts = message.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
      if (textWithoutArtifacts) {
        markdown += `${textWithoutArtifacts}\n\n`;
      }
    }

    // Handle attachments (file uploads and pasted content)
    if (message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        if (attachment.file_name) {
          // File attachment — show file metadata + extracted content if present
          let header = `### Attachment: ${attachment.file_name}`;
          const meta = [];
          if (attachment.file_size) {
            meta.push(`${(attachment.file_size / 1024).toFixed(1)} KB`);
          }
          if (attachment.file_type) {
            meta.push(attachment.file_type);
          }
          if (meta.length > 0) {
            header += ` _(${meta.join(', ')})_`;
          }
          markdown += `${header}\n`;
          if (attachment.extracted_content) {
            markdown += `\`\`\`\`\n${attachment.extracted_content}\n\`\`\`\`\n\n`;
          } else {
            markdown += `\n`;
          }
        } else if (attachment.extracted_content) {
          // Pasted content (no file_name) — legacy label
          markdown += `### Pasted\n\`\`\`\`\n${attachment.extracted_content}\n\`\`\`\`\n\n`;
        }
      }
    }

    // Render all artifacts found in the message
    for (const artifact of messageArtifacts) {
      // Inline visuals: embed the raw SVG/HTML so Obsidian/Typora render it.
      if (artifact.type === 'visual') {
        markdown += `#### 📊 Visual: ${artifact.title}\n\n`;
        markdown += `${artifact.content}\n\n`;
        continue;
      }

      markdown += `#### 📦 Artifact: ${artifact.title}\n`;
      markdown += `**Type:** ${artifact.type} | **Language:** ${artifact.language}\n\n`;

      if (artifact.type === 'code' || isProgrammingLanguage(artifact.language)) {
        markdown += `\`\`\`${artifact.language}\n${artifact.content}\n\`\`\`\n\n`;
      } else {
        markdown += `${artifact.content}\n\n`;
      }
    }
  }

  return markdown;
}

// Convert to plain text
function convertToText(data, includeMetadata, includeArtifacts = true, includeThinking = true) {
  let text = '';

  // Add metadata header if requested
  if (includeMetadata) {
    text += `${data.name || 'Untitled Conversation'}\n`;
    text += `Created: ${new Date(data.created_at).toLocaleString()}\n`;
    text += `Updated: ${new Date(data.updated_at).toLocaleString()}\n`;
    text += `Model: ${data.model}\n\n`;
    text += '---\n\n';
  }

  // Get only the current branch messages
  const branchMessages = getCurrentBranch(data);

  branchMessages.forEach((message) => {
    // Extract artifacts from the entire message (handles both old and new formats)
    const artifacts = includeArtifacts ? extractArtifactsFromMessage(message) : [];

    // Get the message text (excluding artifacts)
    let messageText = '';
    let thinkingText = '';
    if (message.content) {
      for (const content of message.content) {
        // Handle thinking blocks
        if (content.type === 'thinking' && content.thinking && includeThinking) {
          const summary = (content.summaries && content.summaries.length > 0
            ? content.summaries[content.summaries.length - 1].summary
            : null) ?? 'Thought process';
          thinkingText += `[Thinking: ${summary}]\n${content.thinking}\n[End Thinking]\n\n`;
        }
        // Only include text content, skip tool_use
        else if (content.type === 'text' && content.text) {
          // Remove old-format artifact tags
          messageText += content.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim() + ' ';
        }
      }
    } else if (message.text) {
      // Handle old format - remove artifact tags
      messageText = message.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
    }

    messageText = messageText.trim();

    // Use full label for all messages
    let senderLabel;
    if (message.sender === 'human') {
      senderLabel = 'User';
    } else {
      senderLabel = 'Claude';
    }

    // Add thinking text if present
    if (thinkingText) {
      text += thinkingText;
    }

    text += `${senderLabel}: ${messageText}\n`;

    // Add artifacts if present
    if (artifacts.length > 0) {
      for (const artifact of artifacts) {
        const label = artifact.type === 'visual' ? 'Visual' : 'Artifact';
        text += `\n[${label}: ${artifact.title} (${artifact.language})]\n`;
        text += `${artifact.content}\n`;
        text += `[End ${label}]\n`;
      }
    }

    // Add pasted content if present
    if (message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        if (attachment.extracted_content) {
          const size = attachment.file_size ? ` (${attachment.file_size} bytes)` : '';
          text += `\n[Pasted content${size}]\n`;
          text += `${attachment.extracted_content}\n`;
          text += `[End Pasted content]\n`;
        }
      }
    }

    text += `\n`;
  });

  return text.trim();
}

// ============================================================================
// PDF / HTML Export
// ============================================================================

// Internal: escape HTML entities.
function _htmlEsc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Internal: apply inline Markdown → HTML to an already-HTML-escaped string.
// Handles inline code, bold+italic, bold, italic, links, and strikethrough.
function _inlineHtml(s) {
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  return s;
}

// Internal: convert Markdown to HTML for use in the PDF output.
// Line-by-line block parser: headings, lists, blockquotes, tables, HR, code
// fences, and paragraphs. Inline transforms (bold, italic, links, etc.) are
// applied per block via _inlineHtml. Covers the patterns Claude actually uses.
function _mdToHtml(text) {
  if (!text) return '';
  const codes = [];
  // Extract fenced code blocks first so their content is never re-processed.
  let s = text
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, c) => { codes.push(_htmlEsc(c)); return `\x01${codes.length - 1}`; })
    .replace(/```([\s\S]*?)```/g,         (_, c)       => { codes.push(_htmlEsc(c)); return `\x01${codes.length - 1}`; });

  const lines = s.split('\n');
  const blocks = [];
  const paraBuf = [];
  let i = 0;

  const flush = () => { if (paraBuf.length) { blocks.push({ type: 'para', lines: paraBuf.splice(0) }); } };

  while (i < lines.length) {
    const raw = lines[i];
    // Standalone code-block placeholder
    if (/^\x01\d+$/.test(raw.trim())) {
      flush(); blocks.push({ type: 'code', idx: +raw.trim().slice(1) }); i++; continue;
    }
    // Blank line → paragraph break
    if (!raw.trim()) { flush(); i++; continue; }
    // Heading: # → h2, ## → h3, ###/#### → h4 (h1 is reserved for the doc title)
    const hm = raw.match(/^(#{1,4})\s+(.*)/);
    if (hm) { flush(); blocks.push({ type: 'h', level: Math.min(hm[1].length + 1, 4), text: hm[2] }); i++; continue; }
    // HR
    if (/^[-*_]{3,}\s*$/.test(raw.trim())) { flush(); blocks.push({ type: 'hr' }); i++; continue; }
    // Blockquote
    if (/^> ?/.test(raw)) {
      flush();
      const bq = [];
      while (i < lines.length && /^> ?/.test(lines[i])) { bq.push(lines[i].replace(/^> ?/, '')); i++; }
      blocks.push({ type: 'bq', lines: bq }); continue;
    }
    // Unordered list
    if (/^[ \t]*[-*] /.test(raw)) {
      flush();
      const items = [];
      while (i < lines.length && /^[ \t]*[-*] /.test(lines[i])) { items.push(lines[i].replace(/^[ \t]*[-*] /, '')); i++; }
      blocks.push({ type: 'ul', items }); continue;
    }
    // Ordered list
    if (/^[ \t]*\d+\. /.test(raw)) {
      flush();
      const items = [];
      while (i < lines.length && /^[ \t]*\d+\. /.test(lines[i])) { items.push(lines[i].replace(/^[ \t]*\d+\. /, '')); i++; }
      blocks.push({ type: 'ol', items }); continue;
    }
    // Table (header row followed immediately by a separator row)
    if (/^\s*\|/.test(raw) && i + 1 < lines.length && /^\s*\|[\s\-:|]+\|/.test(lines[i + 1])) {
      flush();
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      blocks.push({ type: 'table', rows }); continue;
    }
    paraBuf.push(raw); i++;
  }
  flush();

  // HTML-escape a text fragment and apply inline transforms.
  const esc = t => _inlineHtml(_htmlEsc(t));
  // For a line that may contain \x01N placeholders mid-text, escape each non-placeholder part.
  const escLine = line => line.split(/(\x01\d+)/).map(p => /^\x01\d+$/.test(p) ? p : _inlineHtml(_htmlEsc(p))).join('');

  const out = blocks.map(b => {
    if (b.type === 'code')  return `<pre><code>${codes[b.idx]}</code></pre>`;
    if (b.type === 'hr')    return '<hr>';
    if (b.type === 'h')     return `<h${b.level}>${esc(b.text)}</h${b.level}>`;
    if (b.type === 'bq')    return `<blockquote>${b.lines.map(escLine).join('<br>')}</blockquote>`;
    if (b.type === 'ul')    return `<ul>${b.items.map(it => `<li>${esc(it)}</li>`).join('')}</ul>`;
    if (b.type === 'ol')    return `<ol>${b.items.map(it => `<li>${esc(it)}</li>`).join('')}</ol>`;
    if (b.type === 'table') {
      const rows = b.rows.map(r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
      return '<table>' + rows.map((cells, ri) => {
        if (ri === 1) return ''; // separator row
        const tag = ri === 0 ? 'th' : 'td';
        return '<tr>' + cells.map(c => `<${tag}>${esc(c)}</${tag}>`).join('') + '</tr>';
      }).join('') + '</table>';
    }
    return `<p>${b.lines.map(escLine).join('<br>')}</p>`;
  }).join('');

  // Restore any code placeholders that survived into non-code blocks (edge case).
  return out.replace(/\x01(\d+)/g, (_, idx) => `<pre><code>${codes[+idx]}</code></pre>`);
}

// CSS for the generated print HTML — embedded so the file is self-contained.
const _PDF_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#fefefe;--text:#1c1a17;--muted:#72685e;--border:#e4ded5;
  --code-bg:#f4f1eb;--accent:#c2603d;--accent2:#9d4c2e;
}
/* Theme is baked in via <html data-theme="..."> because Chrome's print engine
   forces prefers-color-scheme to light — a dark media query never matches in the
   print preview, so attribute selectors are the only way a dark PDF can render. */
:root[data-theme="dark"]{
  color-scheme:dark;
  --bg:#1a1713;--text:#e8e2d8;--muted:#9a9080;--border:#302822;
  --code-bg:#252018;--accent:#d77a52;--accent2:#e89068;
}
@media(prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --bg:#1a1713;--text:#e8e2d8;--muted:#9a9080;--border:#302822;
    --code-bg:#252018;--accent:#d77a52;--accent2:#e89068;
  }
}
html{background:var(--bg);}
body{
  background:var(--bg);color:var(--text);
  font-family:Georgia,'Times New Roman',serif;
  font-size:14px;line-height:1.78;
  max-width:820px;margin:0 auto;padding:0;
}
.print-bar{
  position:sticky;top:0;background:var(--bg);
  border-bottom:1px solid var(--border);
  padding:11px 32px;display:flex;align-items:center;gap:14px;
  font-family:system-ui,sans-serif;font-size:13px;z-index:100;
}
.print-bar button{
  padding:7px 16px;background:var(--accent);color:#fff;
  border:none;border-radius:8px;cursor:pointer;
  font-weight:600;font-size:13px;font-family:inherit;
  transition:background .15s;
}
.print-bar button:hover{background:var(--accent2);}
.print-bar .hint{color:var(--muted);font-size:12px;}
.conversation{padding:36px 32px 60px;}
h1{font-size:26px;font-weight:700;letter-spacing:-.02em;margin-bottom:6px;}
.meta{
  font-family:system-ui,sans-serif;font-size:12px;color:var(--muted);
  display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:38px;
}
.meta a{color:var(--muted);text-decoration:underline;}
.sep{opacity:.35;}
.message{padding:22px 0;border-top:1px solid var(--border);}
.label{
  font-family:system-ui,sans-serif;font-size:10.5px;font-weight:700;
  letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:10px;
}
.label-claude{color:var(--accent);}
.text-content p{margin-top:.72em;}
.text-content p:first-child{margin-top:0;}
pre{
  background:var(--code-bg);border-radius:7px;padding:14px 16px;
  margin:12px 0;font-size:12.5px;line-height:1.55;
  white-space:pre-wrap;word-break:break-word;overflow-x:auto;
}
code{
  font-family:'Courier New',Courier,monospace;font-size:12.5px;
  background:var(--code-bg);padding:1px 5px;border-radius:3px;
}
pre code{background:none;padding:0;font-size:inherit;}
.thinking{
  margin:12px 0;padding:12px 16px;
  border-left:3px solid var(--border);color:var(--muted);
}
.thinking-label{
  font-family:system-ui,sans-serif;font-size:10px;font-weight:700;
  text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;
}
.attachment{
  margin:12px 0;padding:10px 14px;background:var(--code-bg);
  border-radius:7px;font-family:system-ui,sans-serif;font-size:12.5px;
}
.att-name{font-weight:600;}
.att-meta{color:var(--muted);margin-left:8px;font-size:11px;}
.att-content{margin-top:8px;}
.artifact{
  margin:16px 0;border:1px solid var(--border);
  border-radius:9px;overflow:hidden;
}
.artifact-hd{
  padding:9px 14px;background:var(--code-bg);
  font-family:system-ui,sans-serif;font-size:11.5px;font-weight:600;
  border-bottom:1px solid var(--border);
}
.artifact-lang{font-weight:400;opacity:.65;}
.artifact pre{border-radius:0;margin:0;}
.visual{margin:16px 0;border:1px solid var(--border);border-radius:9px;overflow:hidden;break-inside:avoid;}
.visual-frame{display:block;width:100%;border:0;background:#FAF9F5;}
.text-content h2{font-size:20px;font-weight:700;letter-spacing:-.01em;margin:1.1em 0 .35em;}
.text-content h3{font-size:17px;font-weight:600;margin:1em 0 .3em;}
.text-content h4{font-size:15px;font-weight:600;margin:.9em 0 .25em;}
.text-content ul,.text-content ol{margin:.6em 0 .6em 1.5em;padding:0;}
.text-content li{margin:.2em 0;line-height:1.7;}
.text-content blockquote{margin:.7em 0;padding:.5em .9em;border-left:3px solid var(--accent);color:var(--muted);font-style:italic;}
.text-content hr{border:none;border-top:1px solid var(--border);margin:1.2em 0;}
.text-content table{border-collapse:collapse;width:100%;margin:.8em 0;font-size:13px;}
.text-content th,.text-content td{border:1px solid var(--border);padding:6px 10px;text-align:left;}
.text-content th{background:var(--code-bg);font-weight:600;}
.text-content a{color:var(--accent);text-decoration:underline;}
.text-content s{opacity:.6;}
/* Zero the browser page margins so the themed background bleeds to the sheet
   edge (otherwise dark pages get a mismatched frame from the default white/dark
   margin band). Text spacing is handled by .conversation padding instead. */
@page{margin:0;}
@media print{
  /* Render backgrounds/borders exactly so code blocks and shaded UI survive
     into the PDF. Colors follow the user's active theme (dark or light) rather
     than being overridden — so dark-mode users get a dark PDF, light-mode users
     get a light PDF. Messages are allowed to break across pages so a very long
     response doesn't push everything to page 2, leaving page 1 blank. */
  *,*::before,*::after{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
  html,body{background:var(--bg)!important;}
  .print-bar{display:none!important;}
  body{max-width:100%;font-size:11pt;}
  .conversation{padding:16mm 18mm;}
  pre{font-size:9pt;white-space:pre-wrap;word-break:break-word;}
  a{color:inherit!important;text-decoration:none;}
}
`.trim();

// Stylesheet for Claude's inline visuals (visualize:show_widget). The widget
// markup references claude.ai's host CSS — pre-built SVG classes (t/ts/th,
// box/arr/leader, c-{ramp} color classes) and --color-* variables — none of
// which exist outside claude.ai. Reconstructed here from the visualize tool's
// own design-system spec, pinned to the light-mode palette so visuals always
// look like they do in Claude chat regardless of the export theme.
// Ramp stops: [50 fill, 600 stroke/subtitle, 800 title]
const _VISUAL_RAMPS = {
  purple: ['#EEEDFE', '#534AB7', '#3C3489'],
  teal:   ['#E1F5EE', '#0F6E56', '#085041'],
  coral:  ['#FAECE7', '#993C1D', '#712B13'],
  pink:   ['#FBEAF0', '#993556', '#72243E'],
  gray:   ['#F1EFE8', '#5F5E5A', '#444441'],
  blue:   ['#E6F1FB', '#185FA5', '#0C447C'],
  green:  ['#EAF3DE', '#3B6D11', '#27500A'],
  amber:  ['#FAEEDA', '#854F0B', '#633806'],
  red:    ['#FCEBEB', '#A32D2D', '#791F1F'],
};

const _VISUAL_CSS = `
svg,:root{
  --color-background-primary:#FFFFFF;--color-background-secondary:#F5F4EF;--color-background-tertiary:#F0EEE5;
  --color-background-info:#E6F1FB;--color-background-danger:#FCEBEB;--color-background-success:#EAF3DE;--color-background-warning:#FAEEDA;
  --color-text-primary:#1A1915;--color-text-secondary:#5F5E5A;--color-text-tertiary:#888780;
  --color-text-info:#0C447C;--color-text-danger:#791F1F;--color-text-success:#27500A;--color-text-warning:#633806;
  --color-border-primary:rgba(26,25,21,.4);--color-border-secondary:rgba(26,25,21,.3);--color-border-tertiary:rgba(26,25,21,.15);
  --color-border-info:#378ADD;--color-border-danger:#E24B4A;--color-border-success:#97C459;--color-border-warning:#EF9F27;
  --font-sans:system-ui,-apple-system,'Segoe UI',sans-serif;--font-serif:Georgia,serif;--font-mono:ui-monospace,monospace;
  --border-radius-md:8px;--border-radius-lg:12px;--border-radius-xl:16px;
  --p:#1A1915;--s:#5F5E5A;--t:rgba(26,25,21,.15);--bg2:#F5F4EF;--b:rgba(26,25,21,.3);
}
svg text{font-family:var(--font-sans);}
svg .t{font-size:14px;font-weight:400;fill:#1A1915;}
svg .ts{font-size:12px;font-weight:400;fill:#5F5E5A;}
svg .th{font-size:14px;font-weight:500;fill:#1A1915;}
svg .box{fill:#F5F4EF;stroke:rgba(26,25,21,.3);}
svg .arr{stroke:rgba(26,25,21,.3);stroke-width:1.5;fill:none;}
svg .leader{stroke:rgba(26,25,21,.15);stroke-width:.5;stroke-dasharray:4 3;fill:none;}
` + Object.entries(_VISUAL_RAMPS).map(([name, [fill, stroke, title]]) => `
g.c-${name}>rect,g.c-${name}>circle,g.c-${name}>ellipse,rect.c-${name},circle.c-${name},ellipse.c-${name}{fill:${fill};stroke:${stroke};}
g.c-${name}>text.th,g.c-${name}>text.t,g.c-${name}>.th,g.c-${name}>.t{fill:${title};}
g.c-${name}>text.ts,g.c-${name}>.ts{fill:${stroke};}`).join('') + `
`;

// Bake the host stylesheet into a standalone SVG so it renders correctly
// outside claude.ai (PDF iframe, exported .svg files, Obsidian embeds).
function _styleSvgVisual(code) {
  if (code.includes(_VISUAL_CSS)) return code;
  // Widgets are authored as HTML fragments where the SVG namespace is implied;
  // a standalone .svg file needs it explicitly or browsers render raw XML.
  return code.replace(/(<svg\b[^>]*?)(\s*\/?>)/i, (m, open, close) =>
    `${/\bxmlns\s*=/.test(open) ? open : open + ' xmlns="http://www.w3.org/2000/svg"'}${close}<style>${_VISUAL_CSS}</style>`);
}

// Render an inline visual (visualize:show_widget SVG/HTML) for the PDF page.
// The markup comes from conversation data, so it is untrusted — it is embedded
// in a fully sandboxed iframe (no scripts, opaque origin) rather than inlined,
// because the browse-page print tab shares the extension's origin.
function _visualHtml(art) {
  const code = art.content;
  let sizing = 'height:480px;';
  const vb = code.match(/viewBox\s*=\s*["']\s*[\d.+-]+[\s,]+[\d.+-]+[\s,]+([\d.+-]+)[\s,]+([\d.+-]+)/i);
  if (vb && +vb[1] > 0 && +vb[2] > 0) sizing = `aspect-ratio:${+vb[1]}/${+vb[2]};height:auto;`;
  // Fixed light claude.ai-style canvas regardless of export theme — visuals
  // are designed against Claude chat's palette, not the PDF's.
  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:8px;background:#FAF9F5;color:#1A1915;font-family:system-ui,sans-serif}svg{display:block;width:100%;height:auto}${_VISUAL_CSS}</style></head><body>${code}</body></html>`;
  return `<div class="visual"><div class="artifact-hd">📊 ${_htmlEsc(art.title)}<span class="artifact-lang"> · visual</span></div><iframe class="visual-frame" sandbox style="${sizing}" srcdoc="${_htmlEsc(doc)}"></iframe></div>`;
}

// Generate a self-contained, print-ready HTML document for a single conversation.
// Opening the returned HTML in a browser tab and clicking "Print" produces a clean PDF.
function convertToHTML(data, conversationId, options) {
  const includeArtifacts = !options || options.includeArtifacts !== false;
  const includeThinking  = !options || options.includeThinking  !== false;
  const theme = options && (options.theme === 'dark' || options.theme === 'light') ? options.theme : '';

  const title   = data.name || 'Untitled Conversation';
  const model   = typeof formatModelName === 'function' ? formatModelName(data.model || inferModel(data)) : (data.model || '');
  const created = data.created_at
    ? new Date(data.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : '';
  const link = conversationId ? `https://claude.ai/chat/${conversationId}` : '';

  const branch = getCurrentBranch(data);
  let messagesHtml = '';

  for (const message of branch) {
    const isHuman  = message.sender === 'human';
    const label    = isHuman ? 'User' : 'Claude';
    let contentHtml = '';

    // Text blocks
    if (message.content) {
      for (const c of message.content) {
        if (c.type === 'thinking' && c.thinking && includeThinking) {
          contentHtml += `<div class="thinking"><div class="thinking-label">Thinking</div>${_htmlEsc(c.thinking)}</div>`;
        } else if (c.type === 'text' && c.text) {
          const cleaned = c.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
          if (cleaned) contentHtml += `<div class="text-content">${_mdToHtml(cleaned)}</div>`;
        }
      }
    } else if (message.text) {
      const cleaned = message.text.replace(/<antArtifact[^>]*>[\s\S]*?<\/antArtifact>/g, '').trim();
      if (cleaned) contentHtml += `<div class="text-content">${_mdToHtml(cleaned)}</div>`;
    }

    // Attachments
    if (message.attachments) {
      for (const att of message.attachments) {
        if (att.file_name) {
          const meta = [att.file_type, att.file_size ? `${(att.file_size / 1024).toFixed(1)} KB` : ''].filter(Boolean).join(' · ');
          contentHtml += `<div class="attachment"><span class="att-name">${_htmlEsc(att.file_name)}</span>${meta ? `<span class="att-meta">${_htmlEsc(meta)}</span>` : ''}${att.extracted_content ? `<pre class="att-content">${_htmlEsc(att.extracted_content)}</pre>` : ''}</div>`;
        } else if (att.extracted_content) {
          contentHtml += `<div class="attachment"><span class="att-name">Pasted content</span><pre class="att-content">${_htmlEsc(att.extracted_content)}</pre></div>`;
        }
      }
    }

    // Artifacts (and inline visuals)
    if (includeArtifacts) {
      const artifacts = typeof extractArtifactsFromMessage === 'function' ? extractArtifactsFromMessage(message) : [];
      for (const art of artifacts) {
        if (art.type === 'visual') {
          contentHtml += _visualHtml(art);
          continue;
        }
        contentHtml += `<div class="artifact"><div class="artifact-hd">📦 ${_htmlEsc(art.title)}<span class="artifact-lang"> · ${_htmlEsc(art.language || art.type || '')}</span></div><pre><code>${_htmlEsc(art.content)}</code></pre></div>`;
      }
    }

    messagesHtml += `<div class="message message-${isHuman ? 'user' : 'claude'}"><div class="label label-${isHuman ? 'user' : 'claude'}">${label}</div><div class="content">${contentHtml}</div></div>`;
  }

  const metaParts = [
    created && `<span>${_htmlEsc(created)}</span>`,
    model   && `<span>${_htmlEsc(model)}</span>`,
    link    && `<a href="${_htmlEsc(link)}" target="_blank">Open in Claude</a>`,
  ].filter(Boolean).join('<span class="sep"> · </span>');

  return `<!DOCTYPE html>
<html lang="en"${theme ? ` data-theme="${theme}"` : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${_htmlEsc(title)}</title>
<style>${_PDF_CSS}</style>
</head>
<body>
<div class="print-bar">
  <button id="cc-print-btn">Print / Save as PDF</button>
  <span class="hint">In the print dialog, choose <strong>Save as PDF</strong> as the destination.</span>
</div>
<div class="conversation">
  <h1>${_htmlEsc(title)}</h1>
  <div class="meta">${metaParts}</div>
  <div class="messages">${messagesHtml}</div>
</div>
</body>
</html>`;
}

// Open a print-ready HTML document in a new tab for a single conversation.
// Used by browse.js (and any other non-content-script context). Throws if
// window.open is blocked. Returns { filename } on success.
function exportConversationToPdf(data, conversationId, options) {
  const html = convertToHTML(data, conversationId, options);
  const win = window.open('about:blank', '_blank');
  if (!win) throw new Error('PDF preview was blocked. Allow popups for this page and try again.');
  win.document.open();
  win.document.write(html);
  win.document.close();
  // Wire the print button from the opener context — about:blank may inherit CSP from the opener.
  const printBtn = win.document.getElementById('cc-print-btn');
  if (printBtn) printBtn.addEventListener('click', () => win.print());
  win.focus();
  const safeTitle = (options && options.filename) || data.name || conversationId || 'conversation';
  return { filename: `${safeTitle}.pdf` };
}

// Convert to Obsidian-compatible Markdown: standard Markdown body with YAML frontmatter.
// Reuses convertToMarkdown() for the body — metadata header is omitted since frontmatter covers it.
function convertToObsidian(data, conversationId, options = {}) {
  const model = data.model || inferModel(data);
  const date = new Date(data.created_at).toISOString().split('T')[0];
  const title = (data.name || 'Untitled Conversation').replace(/"/g, '\\"');
  const frontmatter = [
    '---',
    `title: "${title}"`,
    `date: ${date}`,
    `model: ${model}`,
    `source: https://claude.ai/chat/${conversationId || ''}`,
    `tags: []`,
    '---',
    ''
  ].join('\n');
  const includeArtifacts = options.includeArtifacts !== false;
  const includeThinking = options.includeThinking !== false;
  return frontmatter + convertToMarkdown(data, false, conversationId, includeArtifacts, includeThinking);
}

// Build a filename for an Obsidian export using a template string.
// Supported tokens: {{date}} (YYYY-MM-DD from created_at), {{title}} (sanitized name).
// Default template: '{{date}}-{{title}}'
function obsidianFilename(data, template) {
  const t = (template && template.trim()) ? template.trim() : '{{date}}-{{title}}';
  const date = new Date(data.created_at).toISOString().split('T')[0];
  const raw = data.name || 'Untitled Conversation';
  const title = raw.replace(/[<>:"/\\|?*\n\r]/g, '_').replace(/\s+/g, ' ').trim();
  return t
    .replace(/\{\{date\}\}/g, date)
    .replace(/\{\{title\}\}/g, title)
    .replace(/\.md$/i, '') + '.md';
}

// Download file utility
function downloadFile(content, filename, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================================
// Artifact Extraction Functions
// ============================================================================

// Extract artifacts from message content (supports both old and new formats)
function extractArtifactsFromMessage(message) {
  const artifacts = [];

  // Check if message has content array (new format)
  if (message.content && Array.isArray(message.content)) {
    for (const content of message.content) {
      // NEW FORMAT: tool_use with display_content.
      // Allowlist real file/artifact producers:
      //   - `artifacts` — legacy artifacts tool (still used when
      //     `enabled_artifacts_attachments` is true)
      //   - `create_file` — skills-runner MCP tool that replaced artifacts
      //     when `enabled_artifacts_attachments` is false. Same json_block
      //     display_content shape (language / code / filename).
      // bash, web_search, repl, view, list_directory, etc. are filtered out.
      if (content.type === 'tool_use' &&
          (content.name === 'artifacts' || content.name === 'create_file') &&
          content.display_content) {
        const displayContent = content.display_content;

        // Check for code_block format (newer artifact format)
        if (displayContent.type === 'code_block' && displayContent.code) {
          const language = displayContent.language || 'txt';
          const code = displayContent.code || '';
          const filename = displayContent.filename || 'artifact';

          // Extract title from filename (remove path and extension)
          const title = filename.split('/').pop().replace(/\.[^.]+$/, '');

          artifacts.push({
            title: title || 'Untitled',
            language: language,
            type: isProgrammingLanguage(language) ? 'code' : 'document',
            identifier: null,
            content: code.trim(),
          });
        }
        // Check for json_block format (older artifact format)
        else if (displayContent.type === 'json_block' && displayContent.json_block) {
          try {
            const artifactData = JSON.parse(displayContent.json_block);

            // Only treat as artifact if it has a filename (real artifacts, not tool uses like bash)
            if (artifactData.filename) {
              // Extract artifact details
              const language = artifactData.language || 'txt';
              const code = artifactData.code || '';
              const filename = artifactData.filename;

              // Extract title from filename (remove path and extension)
              const title = filename.split('/').pop().replace(/\.[^.]+$/, '');

              artifacts.push({
                title: title || 'Untitled',
                language: language,
                type: isProgrammingLanguage(language) ? 'code' : 'document',
                identifier: null,
                content: code.trim(),
              });
            }
          } catch (e) {
            // JSON parse failed, skip this artifact
            console.warn('Failed to parse artifact json_block:', e);
          }
        }
      }

      // Analysis Tool / Computer Use create_file: output via input.path + input.file_text
      // (distinct from the skills-runner create_file that uses display_content, handled
      // above — skip when display_content exists or the artifact would be duplicated)
      if (content.type === 'tool_use' && content.name === 'create_file' && content.input && !content.display_content) {
        const path = content.input.path || '';
        const fileText = content.input.file_text || '';
        if (path && fileText) {
          const filename = path.split('/').pop() || 'artifact';
          const extMatch = filename.match(/\.([^.]+)$/);
          const ext = extMatch ? extMatch[1].toLowerCase() : 'txt';
          const title = filename.replace(/\.[^.]+$/, '') || 'artifact';
          const extToLang = {
            md: 'markdown', txt: 'text', js: 'javascript', ts: 'typescript',
            py: 'python', rb: 'ruby', sh: 'bash', kt: 'kotlin',
            cs: 'csharp', rs: 'rust', tex: 'latex', mmd: 'mermaid',
          };
          const language = extToLang[ext] || ext;
          artifacts.push({
            title,
            language,
            type: isProgrammingLanguage(language) ? 'code' : 'document',
            identifier: null,
            content: fileText.trim(),
          });
        }
      }

      // Claude's inline visuals ("custom visuals in chat"): visualize:show_widget
      // carries the rendered SVG/HTML markup in input.widget_code.
      // visualize:read_me is just the tool loading its instructions — the
      // widget_code guard skips it.
      if (content.type === 'tool_use' && content.name === 'visualize:show_widget' &&
          content.input && content.input.widget_code) {
        const code = String(content.input.widget_code).trim();
        const isSvg = /^<svg[\s>]/i.test(code);
        artifacts.push({
          title: content.input.title || 'visual',
          language: isSvg ? 'svg' : 'html',
          type: 'visual',
          identifier: null,
          content: isSvg ? _styleSvgVisual(code) : code,
        });
      }

      // OLD FORMAT: Check text content for <antArtifact> tags
      if (content.text) {
        const textArtifacts = extractArtifactsFromText(content.text);
        artifacts.push(...textArtifacts);
      }
    }
  }

  // Fallback: Check message.text directly (older format)
  if (message.text) {
    const textArtifacts = extractArtifactsFromText(message.text);
    artifacts.push(...textArtifacts);
  }

  return artifacts;
}

// Extract artifacts from text using regex (OLD FORMAT: <antArtifact> tags)
function extractArtifactsFromText(text) {
  const artifactRegex = /<antArtifact[^>]*>([\s\S]*?)<\/antArtifact>/g;
  const artifacts = [];
  let match;

  while ((match = artifactRegex.exec(text)) !== null) {
    const fullTag = match[0];
    const content = match[1];

    // Extract attributes - handle both old and new formats
    const titleMatch = fullTag.match(/title="([^"]*)"/);
    const typeMatch = fullTag.match(/type="([^"]*)"/);
    const languageMatch = fullTag.match(/language="([^"]*)"/);
    const identifierMatch = fullTag.match(/identifier="([^"]*)"/);

    // Determine the artifact type and language
    let artifactType = 'text';
    let language = 'txt';

    if (typeMatch) {
      const type = typeMatch[1];
      // Map type to language/format
      if (type === 'text/html') {
        language = 'html';
        artifactType = 'code';
      } else if (type === 'text/markdown') {
        language = 'markdown';
        artifactType = 'document';
      } else if (type === 'application/vnd.ant.code') {
        language = languageMatch ? languageMatch[1] : 'txt';
        artifactType = 'code';
      } else if (type === 'text/css') {
        language = 'css';
        artifactType = 'code';
      } else if (type === 'application/vnd.ant.mermaid') {
        language = 'mermaid';
        artifactType = 'document';
      } else if (type === 'application/vnd.ant.react') {
        language = 'jsx';
        artifactType = 'code';
      } else if (type === 'image/svg+xml') {
        language = 'svg';
        artifactType = 'code';
      }
    } else if (languageMatch) {
      // Old format - just language attribute
      language = languageMatch[1];
      artifactType = 'code';
    }

    artifacts.push({
      title: titleMatch ? titleMatch[1] : 'Untitled',
      language: language,
      type: artifactType,
      identifier: identifierMatch ? identifierMatch[1] : null,
      content: content.trim(),
    });
  }

  return artifacts;
}

// Legacy function name for backward compatibility
function extractArtifacts(text) {
  return extractArtifactsFromText(text);
}

// Get file extension from language
function getFileExtension(language) {
  const languageToExt = {
    javascript: '.js',
    html: '.html',
    css: '.css',
    python: '.py',
    java: '.java',
    c: '.c',
    cpp: '.cpp',
    'c++': '.cpp',
    ruby: '.rb',
    php: '.php',
    swift: '.swift',
    go: '.go',
    rust: '.rs',
    typescript: '.ts',
    tsx: '.tsx',
    jsx: '.jsx',
    shell: '.sh',
    bash: '.sh',
    sql: '.sql',
    kotlin: '.kt',
    scala: '.scala',
    r: '.r',
    matlab: '.m',
    json: '.json',
    xml: '.xml',
    yaml: '.yaml',
    yml: '.yml',
    markdown: '.md',
    md: '.md',
    text: '.txt',
    txt: '.txt',
    latex: '.tex',
    tex: '.tex',
    bibtex: '.bib',
    bib: '.bib',
    mermaid: '.mmd',
    svg: '.svg',
    csv: '.csv',
    toml: '.toml',
    ini: '.ini',
    perl: '.pl',
    lua: '.lua',
    dart: '.dart',
    elixir: '.ex',
    erlang: '.erl',
    haskell: '.hs',
    clojure: '.clj',
    fsharp: '.fs',
    'f#': '.fs',
    'c#': '.cs',
    csharp: '.cs',
    'objective-c': '.m',
    ocaml: '.ml',
    scheme: '.scm',
    lisp: '.lisp',
    fortran: '.f90',
    assembly: '.asm',
    asm: '.asm',
    scss: '.scss',
    sass: '.sass',
    less: '.less',
    stylus: '.styl',
    dockerfile: '.dockerfile',
    makefile: '.mk',
    gradle: '.gradle',
    groovy: '.groovy',
  };
  return languageToExt[language.toLowerCase()] || '.txt';
}

// Check if a language is a programming language (should be saved in original format only)
function isProgrammingLanguage(language) {
  const programmingLanguages = [
    'javascript', 'typescript', 'python', 'java', 'c', 'cpp', 'c++', 'ruby', 'php',
    'swift', 'go', 'rust', 'jsx', 'tsx', 'shell', 'bash', 'sql', 'kotlin', 'scala',
    'r', 'perl', 'lua', 'dart', 'elixir', 'erlang', 'haskell', 'clojure', 'fsharp',
    'f#', 'c#', 'csharp', 'objective-c', 'ocaml', 'scheme', 'lisp', 'fortran',
    'assembly', 'asm', 'groovy', 'html', 'css', 'scss', 'sass', 'less', 'stylus'
  ];
  return programmingLanguages.includes(language.toLowerCase());
}

// Convert artifact content and filename based on selected format
function convertArtifactFormat(content, language, baseFilename, format) {
  // Get original extension
  const originalExtension = getFileExtension(language);

  // Keep code files and non-markdown files in original format
  if (isProgrammingLanguage(language) || originalExtension !== '.md') {
    return {
      filename: `${baseFilename}${originalExtension}`,
      content: content
    };
  }

  // For markdown documents, convert based on selected format
  switch (format) {
    case 'markdown':
    case 'original':
      // Keep as markdown
      return {
        filename: `${baseFilename}.md`,
        content: content
      };

    case 'text':
      // Convert to plain text (remove markdown formatting)
      let plainText = content;

      // Remove code blocks
      plainText = plainText.replace(/```[\s\S]*?```/g, (match) => {
        // Extract just the code content without backticks and language
        return match.replace(/```\w*\n?/, '').replace(/\n?```$/, '');
      });

      // Remove inline code
      plainText = plainText.replace(/`([^`]+)`/g, '$1');

      // Remove bold/italic
      plainText = plainText.replace(/\*\*([^*]+)\*\*/g, '$1');
      plainText = plainText.replace(/\*([^*]+)\*/g, '$1');
      plainText = plainText.replace(/__([^_]+)__/g, '$1');
      plainText = plainText.replace(/_([^_]+)_/g, '$1');

      // Remove headers (replace with just the text)
      plainText = plainText.replace(/^#{1,6}\s+(.+)$/gm, '$1');

      // Remove links but keep text
      plainText = plainText.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

      // Remove images
      plainText = plainText.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '');

      // Remove horizontal rules
      plainText = plainText.replace(/^[-*_]{3,}$/gm, '');

      // Clean up excessive newlines
      plainText = plainText.replace(/\n{3,}/g, '\n\n');

      return {
        filename: `${baseFilename}.txt`,
        content: plainText.trim()
      };

    case 'json':
      // Convert to JSON format
      const jsonData = {
        title: baseFilename,
        language: language,
        content: content,
        format: 'markdown'
      };

      return {
        filename: `${baseFilename}.json`,
        content: JSON.stringify(jsonData, null, 2)
      };

    default:
      // Default to original format
      return {
        filename: `${baseFilename}${originalExtension}`,
        content: content
      };
  }
}

// Extract all artifacts from a conversation into separate files
function extractArtifactFiles(data, artifactFormat = 'original') {
  const artifactFiles = [];
  const usedFilenames = new Set();

  // Get only the current branch messages
  const branchMessages = getCurrentBranch(data);

  for (const message of branchMessages) {
    const artifacts = extractArtifactsFromMessage(message);

    for (const artifact of artifacts) {
      // Generate filename from title and language
      let baseFilename = artifact.title || 'artifact';
      // Sanitize filename (remove invalid characters)
      baseFilename = baseFilename.replace(/[<>:"/\\|?*]/g, '_');

      // Convert artifact based on selected format
      const converted = convertArtifactFormat(
        artifact.content,
        artifact.language,
        baseFilename,
        artifactFormat
      );

      let filename = converted.filename;

      // Inline visuals get their own subfolder; JSZip treats the path
      // separator as a nested folder at every assembly site.
      if (artifact.type === 'visual') filename = `visuals/${filename}`;

      // Handle duplicate filenames
      let counter = 1;
      const extensionMatch = filename.match(/(\.[^.]+)$/);
      const extension = extensionMatch ? extensionMatch[1] : '';
      const nameWithoutExt = extension ? filename.slice(0, -extension.length) : filename;

      while (usedFilenames.has(filename)) {
        filename = `${nameWithoutExt}_${counter}${extension}`;
        counter++;
      }

      usedFilenames.add(filename);

      artifactFiles.push({
        filename: filename,
        content: converted.content
      });
    }
  }

  return artifactFiles;
}
// ----- Model utilities -----

// Default model timeline for null models — each entry is when that model became the default
const DEFAULT_MODEL_TIMELINE = [
  { date: new Date('2024-01-01'), model: 'claude-3-sonnet-20240229' },
  { date: new Date('2024-06-20'), model: 'claude-3-5-sonnet-20240620' },
  { date: new Date('2024-10-22'), model: 'claude-3-5-sonnet-20241022' },
  { date: new Date('2025-02-24'), model: 'claude-3-7-sonnet-20250219' },
  { date: new Date('2025-05-22'), model: 'claude-sonnet-4-20250514' },
  { date: new Date('2025-09-29'), model: 'claude-sonnet-4-5-20250929' },
  { date: new Date('2026-02-17'), model: 'claude-sonnet-4-6' }
];

// Returns conversation.model if set; otherwise infers from created_at via the timeline
function inferModel(conversation) {
  if (conversation.model) {
    return conversation.model;
  }
  const conversationDate = new Date(conversation.created_at);
  for (let i = DEFAULT_MODEL_TIMELINE.length - 1; i >= 0; i--) {
    if (conversationDate >= DEFAULT_MODEL_TIMELINE[i].date) {
      return DEFAULT_MODEL_TIMELINE[i].model;
    }
  }
  return DEFAULT_MODEL_TIMELINE[0].model;
}

// Format a model ID like `claude-sonnet-4-5-20250929` into "Claude Sonnet 4.5".
// Schema reference: https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions
// Handles three documented shapes for the sonnet/opus/haiku/fable families:
//   - Dateless 4.6+:        claude-{name}-{major}-{minor}            (canonical snapshot)
//   - Dated pre-4.6:        claude-{name}-{major}-{minor}-{YYYYMMDD}
//   - Convenience alias:    claude-{name}-{major}-{minor}            (resolves to most recent dated snapshot)
// Unknown families (anything not in `(sonnet|opus|haiku|fable)`) fall through to raw display.
function formatModelName(model) {
  if (!model || !model.startsWith('claude-')) {
    return model || 'Unknown';
  }

  // New format: claude-{type}-{major}[-{minor}][-{date}]
  const newFormatMatch = model.match(/^claude-(sonnet|opus|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i);
  if (newFormatMatch) {
    const [, modelType, major, minor] = newFormatMatch;
    const modelName = modelType.charAt(0).toUpperCase() + modelType.slice(1);
    const version = minor ? `${major}.${minor}` : major;
    return `Claude ${modelName} ${version}`;
  }

  // Old format: claude-{major}[-{minor}]-{type}-{date}
  const oldFormatMatch = model.match(/^claude-(\d+)(?:-(\d+))?-(sonnet|opus|haiku|fable)-\d{8}$/i);
  if (oldFormatMatch) {
    const [, major, minor, modelType] = oldFormatMatch;
    const modelName = modelType.charAt(0).toUpperCase() + modelType.slice(1);
    const version = minor ? `${major}.${minor}` : major;
    return `Claude ${modelName} ${version}`;
  }

  return model;
}

// Returns CSS badge class name based on the model family
function getModelBadgeClass(model) {
  if (!model) return '';
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  if (model.includes('fable')) return 'fable';
  return '';
}

// ----- Extension data backup / restore -----

// Download all extension storage (local + sync) as a structured JSON file.
// onComplete(success, message) reports the result so each caller can show it
// its own way (options page status line vs. browse-page toast).
function backupExtensionData(onComplete) {
  chrome.storage.local.get(null, (local) => {
    chrome.storage.sync.get(null, (sync) => {
      const backup = {
        _meta: {
          app: 'claude-exporter',
          backupVersion: 1,
          extensionVersion: chrome.runtime.getManifest().version,
          createdAt: new Date().toISOString()
        },
        local: local || {},
        sync: sync || {}
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const now = new Date();
      const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const hms = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
      a.download = `claude-exporter-backup-${ymd}-${hms}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      const snapCount = Object.keys(backup.local.modelSnapshots || {}).length;
      const exportCount = Object.keys(backup.local.exportTimestamps || {}).length;
      if (onComplete) onComplete(true, `Backup exported — ${snapCount} model snapshot(s), ${exportCount} export record(s).`);
    });
  });
}

// Conservative merge: for each top-level key in `backup`, if the key is absent
// locally, copy it over; if both sides are plain objects (UUID-keyed records
// like exportTimestamps / modelSnapshots), merge their sub-keys with local
// winning on overlap. Scalar conflicts (org ID, date format, etc.) keep the
// local value untouched.
function mergeStorageData(current, backup) {
  const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const result = { ...current };
  for (const [key, backupVal] of Object.entries(backup || {})) {
    if (!(key in current)) {
      result[key] = backupVal;
    } else if (isPlainObject(current[key]) && isPlainObject(backupVal)) {
      result[key] = { ...backupVal, ...current[key] };
    }
    // else: scalar conflict — current value is already in result, keep it
  }
  return result;
}

// Show a modal letting the user choose merge vs replace BEFORE the OS file
// picker opens. onConfirm(mode) fires with 'merge' / 'replace' when the user
// commits, or null on Cancel / Esc / overlay click. The caller is responsible
// for opening the file picker after a non-null mode.
function showImportModeModal(onConfirm) {
  if (!document.getElementById('claude-exporter-modal-styles')) {
    const style = document.createElement('style');
    style.id = 'claude-exporter-modal-styles';
    style.textContent = `
      .ce-modal-overlay {
        position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55);
        display: flex; align-items: center; justify-content: center;
        z-index: 100000; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .ce-modal {
        background: var(--bg-body, #ffffff);
        color: var(--text-primary, #2c313a);
        padding: 22px 24px;
        border-radius: 8px;
        max-width: 480px; width: 90%;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
        border: 1px solid var(--border-color, #e2e4e9);
      }
      .ce-modal h2 { margin: 0 0 14px; font-size: 17px; font-weight: 600; }
      .ce-modal-info {
        background: var(--section-bg, var(--bg-card, #f8f9fa));
        padding: 10px 12px;
        border-radius: 5px;
        margin-bottom: 14px;
        font-size: 13px;
        line-height: 1.5;
        border: 1px solid var(--border-color, #e2e4e9);
      }
      .ce-modal-option {
        display: block; padding: 10px 12px; border-radius: 5px;
        margin-bottom: 8px; cursor: pointer;
        border: 1px solid var(--border-color, #e2e4e9);
        background: var(--bg-body, #ffffff);
        font-size: 13px;
      }
      .ce-modal-option:hover { border-color: var(--primary-color, #5d44e8); }
      .ce-modal-option input { margin-right: 6px; vertical-align: middle; }
      .ce-modal-option strong { font-weight: 600; }
      .ce-modal-option-desc {
        display: block; margin: 4px 0 0 22px;
        font-size: 12px;
        color: var(--text-secondary, #666666);
      }
      .ce-modal-actions {
        display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;
      }
      .ce-modal-actions button {
        padding: 8px 16px; border-radius: 5px; border: none;
        cursor: pointer; font-size: 14px;
        display: inline-flex; align-items: center; justify-content: center;
        line-height: 1;
      }
      .ce-modal-cancel {
        background: var(--section-bg, var(--bg-card, #e9ecef));
        color: var(--text-primary, #2c313a);
        border: 1px solid var(--border-color, #e2e4e9) !important;
      }
      .ce-modal-import {
        background: var(--primary-color, #5d44e8);
        color: #ffffff;
      }
      .ce-modal-import:hover { background: var(--primary-hover, #4a35ba); }
    `;
    document.head.appendChild(style);
  }

  // Remove any stale modal before showing a new one
  const stale = document.querySelector('.ce-modal-overlay');
  if (stale) stale.remove();

  const overlay = document.createElement('div');
  overlay.className = 'ce-modal-overlay';
  overlay.innerHTML = `
    <div class="ce-modal" role="dialog" aria-modal="true" aria-labelledby="ce-modal-title">
      <h2 id="ce-modal-title">Import Backup</h2>
      <div class="ce-modal-info">
        Choose how the imported data should be combined with your current data, then pick a backup file.
      </div>
      <label class="ce-modal-option">
        <input type="radio" name="ce-import-mode" value="merge" checked>
        <strong>Merge with current data</strong>
        <span class="ce-modal-option-desc">Adds entries not present locally; keeps your current values when they overlap.</span>
      </label>
      <label class="ce-modal-option">
        <input type="radio" name="ce-import-mode" value="replace">
        <strong>Replace all current data</strong>
        <span class="ce-modal-option-desc">Overwrites everything with this backup's contents.</span>
      </label>
      <div class="ce-modal-actions">
        <button type="button" class="ce-modal-cancel">Cancel</button>
        <button type="button" class="ce-modal-import">Choose File&hellip;</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const cleanup = (mode) => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onConfirm(mode);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') cleanup(null);
    else if (e.key === 'Enter') cleanup(overlay.querySelector('input[name="ce-import-mode"]:checked').value);
  };
  document.addEventListener('keydown', onKey);

  overlay.querySelector('.ce-modal-cancel').addEventListener('click', () => cleanup(null));
  overlay.querySelector('.ce-modal-import').addEventListener('click', () => {
    cleanup(overlay.querySelector('input[name="ce-import-mode"]:checked').value);
  });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });

  // Focus the default radio so keyboard users can act immediately
  const firstRadio = overlay.querySelector('input[name="ce-import-mode"]');
  if (firstRadio) firstRadio.focus();
}

// Import extension storage from a file produced by backupExtensionData.
// Validates the file, then writes to local + sync using the supplied mode
// ('merge' or 'replace'). The mode choice is made BEFORE the file picker
// opens (see showImportModeModal), so this function just executes.
function importBackup(file, mode, onComplete) {
  const reader = new FileReader();
  reader.onload = (e) => {
    let backup;
    try {
      backup = JSON.parse(e.target.result);
    } catch (err) {
      if (onComplete) onComplete(false, 'Import failed: the file is not valid JSON.');
      return;
    }

    if (!backup || typeof backup !== 'object' || !backup._meta ||
        backup._meta.app !== 'claude-exporter' || typeof backup.local !== 'object') {
      if (onComplete) onComplete(false, 'Import failed: this does not look like a ClawdKit backup file.');
      return;
    }

    const snapCount = Object.keys(backup.local.modelSnapshots || {}).length;
    const exportCount = Object.keys(backup.local.exportTimestamps || {}).length;
    const syncData = (backup.sync && typeof backup.sync === 'object') ? backup.sync : {};

    if (mode === 'replace') {
      chrome.storage.local.set(backup.local, () => {
        chrome.storage.sync.set(syncData, () => {
          if (onComplete) onComplete(true, `Import complete (replace) — ${snapCount} model snapshot(s), ${exportCount} export record(s) restored. Reload any open Claude pages and the browse page to see the changes.`);
        });
      });
    } else {
      // Merge: missing keys added, conflicts keep local
      chrome.storage.local.get(null, (currentLocal) => {
        chrome.storage.sync.get(null, (currentSync) => {
          const mergedLocal = mergeStorageData(currentLocal || {}, backup.local);
          const mergedSync = mergeStorageData(currentSync || {}, syncData);
          chrome.storage.local.set(mergedLocal, () => {
            chrome.storage.sync.set(mergedSync, () => {
              if (onComplete) onComplete(true, `Import complete (merge) — added missing entries from backup, kept your current values on overlap. Reload any open Claude pages and the browse page to see the changes.`);
            });
          });
        });
      });
    }
  };
  reader.readAsText(file);
}

// ----- Error capture & diagnostics -----
// Captures unhandled errors and rejected promises into a ring buffer in
// chrome.storage.local. The user can later download a sanitized diagnostics
// bundle (Options page → Contact & Diagnostics) to attach to a bug report.
// Sanitization runs at capture time: any UUID-looking substring (chat / org /
// project IDs that may appear in fetch URLs or stack traces) is replaced with
// "<id>" so we never persist identifiers.

const CE_UUID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const CE_ERROR_LOG_MAX = 50;

function sanitizeForDiagnostics(value) {
  if (typeof value !== 'string') return value;
  return value.replace(CE_UUID_REGEX, '<id>');
}

function initErrorCapture(context) {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

  // Re-entry guard: if our own push() throws, don't loop into the listener.
  let suppressed = false;

  const push = (entry) => {
    if (suppressed) return;
    suppressed = true;
    try {
      chrome.storage.local.get(['errorLog'], (result) => {
        try {
          const log = Array.isArray(result.errorLog) ? result.errorLog : [];
          log.push(entry);
          if (log.length > CE_ERROR_LOG_MAX) {
            log.splice(0, log.length - CE_ERROR_LOG_MAX);
          }
          chrome.storage.local.set({ errorLog: log }, () => { suppressed = false; });
        } catch (e) { suppressed = false; }
      });
    } catch (e) { suppressed = false; }
  };

  const target = (typeof globalThis !== 'undefined') ? globalThis : self;

  target.addEventListener('error', (event) => {
    push({
      ts: new Date().toISOString(),
      level: 'error',
      context,
      msg: sanitizeForDiagnostics(String(event.message || '')),
      source: event.filename ? sanitizeForDiagnostics(String(event.filename)) : null,
      line: event.lineno || null,
      col: event.colno || null,
      stack: event.error && event.error.stack ? sanitizeForDiagnostics(String(event.error.stack)) : null
    });
  });

  target.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = reason && reason.message ? String(reason.message)
              : (reason !== undefined ? String(reason) : '(no reason)');
    push({
      ts: new Date().toISOString(),
      level: 'unhandledrejection',
      context,
      msg: sanitizeForDiagnostics(msg),
      stack: reason && reason.stack ? sanitizeForDiagnostics(String(reason.stack)) : null
    });
  });
}

// Build a sanitized diagnostics bundle and trigger a download. Callers may
// pass an onComplete(success, message) callback for status reporting.
function generateDiagnostics(onComplete) {
  const manifest = chrome.runtime.getManifest();

  chrome.storage.local.get(
    ['errorLog', 'modelSnapshots', 'exportTimestamps', 'dateFormat', 'timeFormat', 'modelDisplay'],
    (local) => {
      chrome.storage.sync.get(['organizationId'], (sync) => {
        const errorLog = Array.isArray(local.errorLog) ? local.errorLog : [];
        const diagnostics = {
          _meta: {
            app: 'claude-exporter',
            diagnosticsVersion: 1,
            generatedAt: new Date().toISOString()
          },
          extension: {
            name: manifest.name,
            version: manifest.version
          },
          environment: {
            userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) || null,
            platform: (typeof navigator !== 'undefined' && navigator.platform) || null,
            language: (typeof navigator !== 'undefined' && navigator.language) || null
          },
          preferences: {
            dateFormat: local.dateFormat || 'mdy',
            timeFormat: local.timeFormat || '12h',
            modelDisplay: local.modelDisplay === 'current' ? 'current' : 'original',
            orgIdConfigured: !!(sync && sync.organizationId)
          },
          counts: {
            modelSnapshots: Object.keys(local.modelSnapshots || {}).length,
            exportTimestamps: Object.keys(local.exportTimestamps || {}).length,
            errors: errorLog.length
          },
          errors: errorLog
        };

        const now = new Date();
        const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const hms = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

        const blob = new Blob([JSON.stringify(diagnostics, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `claude-exporter-diagnostics-${ymd}-${hms}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (onComplete) {
          onComplete(true, `Diagnostics downloaded — ${errorLog.length} error(s) captured, all IDs redacted.`);
        }
      });
    }
  );
}

function extractAttachmentFiles(data) {
  const branch = getCurrentBranch(data);
  const files = [];
  const binaryItems = [];
  const usedNames = new Set();
  for (const message of branch) {
    if (!message.attachments || !message.attachments.length) continue;
    for (const att of message.attachments) {
      if (!att.file_name) continue;
      if (att.extracted_content) {
        let name = att.file_name;
        if (usedNames.has(name)) {
          const dot = name.lastIndexOf('.');
          const base = dot > 0 ? name.slice(0, dot) : name;
          const ext  = dot > 0 ? name.slice(dot)  : '';
          let i = 2;
          while (usedNames.has(`${base}_${i}${ext}`)) i++;
          name = `${base}_${i}${ext}`;
        }
        usedNames.add(name);
        files.push({ filename: name, content: att.extracted_content });
      } else {
        const size = att.file_size
          ? `${(att.file_size / 1024).toFixed(1)} KB`
          : 'unknown size';
        binaryItems.push(
          `- **${att.file_name}** (${size}${att.file_type ? `, ${att.file_type}` : ''})`
        );
      }
    }
  }
  const manifest = binaryItems.length > 0
    ? `# Binary Uploads\n\nThese files cannot be exported (binary/image files are not returned by the Claude API).\n\n${binaryItems.join('\n')}\n`
    : null;
  return { files, manifest };
}

// Collect unique uploaded files from the current branch of a conversation.
// Returns an array of file objects from message.files (deduplicated by file_uuid).
// file_kind: 'image' → downloadable via /preview; 'document' → via /document_pdf; 'blob' → no endpoint.
function collectConversationFiles(data) {
  const branch = getCurrentBranch(data);
  const files = [];
  const seenUuids = new Set();
  for (const message of branch) {
    if (!message.files || !message.files.length) continue;
    for (const file of message.files) {
      if (!file.file_uuid || seenUuids.has(file.file_uuid)) continue;
      seenUuids.add(file.file_uuid);
      files.push(file);
    }
  }
  return files;
}

// Functions are available globally in the browser context
// In Node (vitest), expose them via module.exports for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getCurrentBranch,
    convertToMarkdown,
    convertToText,
    convertToObsidian,
    obsidianFilename,
    _mdToHtml,
    _inlineHtml,
    convertToHTML,
    exportConversationToPdf,
    downloadFile,
    extractArtifactsFromMessage,
    extractArtifactsFromText,
    extractArtifacts,
    getFileExtension,
    isProgrammingLanguage,
    convertArtifactFormat,
    extractArtifactFiles,
    extractAttachmentFiles,
    collectConversationFiles,
    DEFAULT_MODEL_TIMELINE,
    inferModel,
    formatModelName,
    getModelBadgeClass,
    backupExtensionData,
    importBackup,
    mergeStorageData,
    sanitizeForDiagnostics,
  };
}
