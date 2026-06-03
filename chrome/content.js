// Prevent double-injection of content script
if (window.claudeExporterContentScriptLoaded) {
  console.log('ClawdKit content script already loaded, skipping re-injection');
} else {
  window.claudeExporterContentScriptLoaded = true;

// Capture unhandled errors for diagnostics (sanitized, stored in chrome.storage.local)
if (typeof initErrorCapture === 'function') initErrorCapture('content');

// Note: Organization ID is now stored in extension settings
// Users need to configure it in the extension options page

// Record export timestamp for a conversation
function recordExportTimestamp(conversationId) {
  chrome.storage.local.get(['exportTimestamps'], (result) => {
    const timestamps = result.exportTimestamps || {};
    timestamps[conversationId] = new Date().toISOString();
    chrome.storage.local.set({ exportTimestamps: timestamps });
  });
}

// Record export timestamps for multiple conversations
function recordExportTimestamps(conversationIds) {
  chrome.storage.local.get(['exportTimestamps'], (result) => {
    const timestamps = result.exportTimestamps || {};
    const now = new Date().toISOString();
    for (const id of conversationIds) {
      timestamps[id] = now;
    }
    chrome.storage.local.set({ exportTimestamps: timestamps });
  });
}

// Snapshot each conversation's current model so it survives a model bounce
// (e.g. when a model retires and Claude silently moves old chats onto a new
// one). Only the raw API model is recorded — never an inferred guess.
function recordModelSnapshots(conversations) {
  if (!Array.isArray(conversations)) return;
  chrome.storage.local.get(['modelSnapshots'], (result) => {
    const snapshots = result.modelSnapshots || {};
    const now = new Date().toISOString();
    let changed = false;
    for (const conv of conversations) {
      const model = conv && conv.model;
      const id = conv && conv.uuid;
      if (!model || !id) continue; // skip null-model chats — don't snapshot a guess
      const existing = snapshots[id];
      if (!existing) {
        snapshots[id] = {
          firstSeen: model,
          firstSeenAt: now,
          current: model,
          currentAt: now,
          history: [{ model, at: now }]
        };
        changed = true;
      } else if (existing.current !== model) {
        existing.current = model;
        existing.currentAt = now;
        existing.history = existing.history || [];
        existing.history.push({ model, at: now });
        changed = true;
      }
    }
    if (changed) {
      chrome.storage.local.set({ modelSnapshots: snapshots });
    }
  });
}

// Helper function to format datetime in local time for filenames
function getLocalDateTimeString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

  // Fetch conversation data
  async function fetchConversation(orgId, conversationId) {
    const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=True&rendering_mode=messages&render_all_tools=true`;

    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch conversation: ${response.status}`);
    }

    return await response.json();
  }
  
  // Fetch all conversations
  async function fetchAllConversations(orgId) {
    const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations`;
    
    const response = await fetch(url, {
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch conversations: ${response.status}`);
    }

    const conversations = await response.json();
    recordModelSnapshots(conversations); // capture current models before any bounce
    return conversations;
  }

  async function downloadConversationFile(orgId, file) {
    let url;
    if (file.file_kind === 'image') {
      url = `https://claude.ai/api/${orgId}/files/${file.file_uuid}/preview`;
    } else if (file.file_kind === 'document') {
      url = `https://claude.ai/api/${orgId}/files/${file.file_uuid}/document_pdf`;
    } else {
      return null; // blob — no download endpoint
    }
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.arrayBuffer();
  }

  // Download all uploaded files in a conversation and add to folder.
  // prefix (optional) is prepended to each filename — used in flat-mode batch exports.
  async function addConversationFilesToFolder(folder, orgId, convData, prefix = '') {
    const files = collectConversationFiles(convData);
    const blobItems = [];
    const usedNames = new Set();
    for (const file of files) {
      if (file.file_kind === 'blob') {
        const size = file.size_bytes ? `${(file.size_bytes / 1024).toFixed(1)} KB` : 'unknown size';
        blobItems.push(`- **${file.file_name || file.file_uuid}** (${size})`);
        continue;
      }
      let filename = file.file_name || file.file_uuid;
      if (usedNames.has(filename)) {
        const dot = filename.lastIndexOf('.');
        const base = dot > 0 ? filename.slice(0, dot) : filename;
        const ext  = dot > 0 ? filename.slice(dot)  : '';
        let i = 2;
        while (usedNames.has(`${base}_${i}${ext}`)) i++;
        filename = `${base}_${i}${ext}`;
      }
      usedNames.add(filename);
      try {
        const buffer = await downloadConversationFile(orgId, file);
        if (buffer) folder.file(`${prefix}${filename}`, buffer);
      } catch (e) {
        console.warn(`Failed to download file ${filename}:`, e);
      }
    }
    if (blobItems.length > 0) {
      folder.file(`${prefix}_unavailable_files.md`,
        `# Unavailable Files\n\nThese file types have no download endpoint in the Claude API:\n\n${blobItems.join('\n')}\n`);
    }
    return files.length;
  }

  // Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Auto-detect organization ID from Claude.ai API
  if (request.action === 'detectOrgId') {
    console.log('Auto-detecting organization ID...');

    fetch('https://claude.ai/api/organizations', {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to fetch organizations: ${response.status}`);
        }
        return response.json();
      })
      .then(orgs => {
        if (Array.isArray(orgs) && orgs.length > 0) {
          // Find the org with "chat" capability (the Claude.ai org, not the API org)
          const chatOrg = orgs.find(org =>
            org.capabilities && org.capabilities.includes('chat')
          );
          const orgId = chatOrg ? chatOrg.uuid : orgs[0].uuid;
          console.log('Auto-detected organization ID:', orgId, chatOrg ? '(chat org)' : '(fallback to first)');
          sendResponse({ success: true, orgId });
        } else {
          throw new Error('No organizations found');
        }
      })
      .catch(error => {
        console.error('Auto-detect org ID failed:', error);
        sendResponse({ success: false, error: error.message });
      });

    return true;
  }

  if (request.action === 'exportConversation') {
    console.log('Export conversation request received:', request);

    fetchConversation(request.orgId, request.conversationId)
      .then(async data => {
        console.log('Conversation data fetched successfully:', data);

        // Validate conversation data structure
        if (!data || !data.chat_messages || !Array.isArray(data.chat_messages)) {
          throw new Error('Invalid conversation data structure. Please refresh the page and try again.');
        }

        // Infer model if null
        data.model = inferModel(data);

        // === PDF: open print-ready HTML in a new tab ===
        if (request.format === 'pdf') {
          const html = convertToHTML(data, request.conversationId, {
            includeArtifacts: request.includeArtifacts,
            includeThinking: request.includeThinking
          });
          const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const win = window.open(url, '_blank');
          if (!win) {
            URL.revokeObjectURL(url);
            sendResponse({ success: false, error: 'PDF preview was blocked by your browser. Allow popups for claude.ai and try again.' });
            return;
          }
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          recordExportTimestamp(request.conversationId);
          sendResponse({ success: true });
          return;
        }

        // Load Obsidian filename template (only used when format === 'obsidian')
        let obsidianTemplate = '';
        if (request.format === 'obsidian') {
          const storageData = await new Promise(resolve => chrome.storage.local.get(['obsidianFilenameTemplate'], resolve));
          obsidianTemplate = storageData.obsidianFilenameTemplate || '';
        }

        // Check if we need to extract artifacts to separate files
        if (request.extractArtifacts || request.flattenArtifacts) {
          // Extract artifacts
          const artifactFiles = extractArtifactFiles(data, request.artifactFormat || 'original');

          if (artifactFiles.length > 0) {
            // Create a ZIP with artifacts (and optionally conversation)
            const zip = new JSZip();

            // Add conversation file only if includeChats is true
            if (request.includeChats !== false) {
              let conversationContent, conversationFilename;
              switch (request.format) {
                case 'markdown':
                  conversationContent = convertToMarkdown(data, request.includeMetadata, request.conversationId, request.includeArtifacts, request.includeThinking);
                  conversationFilename = `${data.name || request.conversationId}.md`;
                  break;
                case 'obsidian':
                  conversationContent = convertToObsidian(data, request.conversationId, { includeArtifacts: request.includeArtifacts, includeThinking: request.includeThinking });
                  conversationFilename = obsidianFilename(data, obsidianTemplate);
                  break;
                case 'text':
                  conversationContent = convertToText(data, request.includeMetadata, request.includeArtifacts, request.includeThinking);
                  conversationFilename = `${data.name || request.conversationId}.txt`;
                  break;
                default:
                  conversationContent = JSON.stringify(data, null, 2);
                  conversationFilename = `${data.name || request.conversationId}.json`;
              }

              // Flat export: add to Chats folder
              if (request.flattenArtifacts && !request.extractArtifacts) {
                const chatsFolder = zip.folder('Chats');
                chatsFolder.file(conversationFilename, conversationContent);
              } else {
                // Nested or no artifact extraction: add to root
                zip.file(conversationFilename, conversationContent);
              }
            }

            // Add artifact files
            // Nested: create artifacts subfolder
            if (request.extractArtifacts) {
              const artifactsFolder = request.includeChats !== false ? zip.folder('artifacts') : zip;
              for (const artifact of artifactFiles) {
                artifactsFolder.file(artifact.filename, artifact.content);
              }
            }

            // Flat: add artifacts with conversation name prefix to Artifacts folder
            if (request.flattenArtifacts && !request.extractArtifacts) {
              const artifactsFolder = zip.folder('Artifacts');
              for (const artifact of artifactFiles) {
                const filename = `${data.name || request.conversationId}_${artifact.filename}`;
                artifactsFolder.file(filename, artifact.content);
              }
            }

            // Add pasted text attachments
            const { files: attFiles, manifest: attManifest } = extractAttachmentFiles(data);
            if (attFiles.length > 0 || attManifest) {
              const chatName = data.name || request.conversationId;
              if (request.flattenArtifacts && !request.extractArtifacts) {
                const attachmentsFolder = zip.folder('Attachments');
                for (const af of attFiles) attachmentsFolder.file(`${chatName}_${af.filename}`, af.content);
                if (attManifest) attachmentsFolder.file(`${chatName}_binary_uploads.md`, attManifest);
              } else {
                const attachmentsFolder = zip.folder('attachments');
                for (const af of attFiles) attachmentsFolder.file(af.filename, af.content);
                if (attManifest) attachmentsFolder.file('_binary_uploads.md', attManifest);
              }
            }

            // Add uploaded files (images, PDFs, etc. from message.files)
            await addConversationFilesToFolder(zip.folder('attachments'), request.orgId, data);

            // Generate and download ZIP
            try {
              const blob = await zip.generateAsync({ type: 'blob' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `${data.name || request.conversationId}.zip`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            } catch (err) {
              console.error('ZIP generation failed:', err);
              sendResponse({ success: false, error: 'ZIP generation failed: ' + err.message });
              return;
            }
            console.log(`Downloading ZIP with conversation and ${artifactFiles.length} artifact(s)`);
            recordExportTimestamp(request.conversationId);
            sendResponse({ success: true });
          } else {
            // No artifacts — generate conversation content then check for attachments/wiggle
            let content, filename, type;
            switch (request.format) {
              case 'markdown':
                content = convertToMarkdown(data, request.includeMetadata, request.conversationId, request.includeArtifacts, request.includeThinking);
                filename = `${data.name || request.conversationId}.md`;
                type = 'text/markdown';
                break;
              case 'obsidian':
                content = convertToObsidian(data, request.conversationId, { includeArtifacts: request.includeArtifacts, includeThinking: request.includeThinking });
                filename = obsidianFilename(data, obsidianTemplate);
                type = 'text/markdown';
                break;
              case 'text':
                content = convertToText(data, request.includeMetadata, request.includeArtifacts, request.includeThinking);
                filename = `${data.name || request.conversationId}.txt`;
                type = 'text/plain';
                break;
              default:
                content = JSON.stringify(data, null, 2);
                filename = `${data.name || request.conversationId}.json`;
                type = 'application/json';
            }
            const { files: attFiles, manifest: attManifest } = extractAttachmentFiles(data);
            const convFiles = collectConversationFiles(data);
            if (attFiles.length > 0 || attManifest || convFiles.length > 0) {
              // Has uploads — ZIP conversation + attachments
              const zip = new JSZip();
              zip.file(filename, content);
              const attachmentsFolder = zip.folder('attachments');
              for (const af of attFiles) attachmentsFolder.file(af.filename, af.content);
              if (attManifest) attachmentsFolder.file('_binary_uploads.md', attManifest);
              await addConversationFilesToFolder(attachmentsFolder, request.orgId, data);
              try {
                const blob = await zip.generateAsync({ type: 'blob' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${data.name || request.conversationId}.zip`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              } catch (err) {
                console.error('ZIP generation failed:', err);
                recordExportTimestamp(request.conversationId);
                sendResponse({ success: false, error: 'ZIP generation failed: ' + err.message });
                return;
              }
            } else {
              console.log('No artifacts or uploads found. Downloading file:', filename);
              downloadFile(content, filename, type);
            }
            recordExportTimestamp(request.conversationId);
            sendResponse({ success: true });
          }
        } else {
          // Normal export without artifact extraction
          if (request.includeChats === false) {
            // If chats are disabled and we're not extracting artifacts, there's nothing to export
            console.log('No content to export (chats disabled, artifacts not extracted)');
            sendResponse({
              success: false,
              error: 'Nothing to export. Enable "Include conversation text" or "Artifacts nested".'
            });
          } else {
            let content, filename, type;
            switch (request.format) {
              case 'markdown':
                content = convertToMarkdown(data, request.includeMetadata, request.conversationId, request.includeArtifacts, request.includeThinking);
                filename = `${data.name || request.conversationId}.md`;
                type = 'text/markdown';
                break;
              case 'obsidian':
                content = convertToObsidian(data, request.conversationId, { includeArtifacts: request.includeArtifacts, includeThinking: request.includeThinking });
                filename = obsidianFilename(data, obsidianTemplate);
                type = 'text/markdown';
                break;
              case 'text':
                content = convertToText(data, request.includeMetadata, request.includeArtifacts, request.includeThinking);
                filename = `${data.name || request.conversationId}.txt`;
                type = 'text/plain';
                break;
              default:
                content = JSON.stringify(data, null, 2);
                filename = `${data.name || request.conversationId}.json`;
                type = 'application/json';
            }

            const { files: attFiles, manifest: attManifest } = extractAttachmentFiles(data);
            const convFiles = collectConversationFiles(data);
            if (attFiles.length > 0 || attManifest || convFiles.length > 0) {
              const zip = new JSZip();
              zip.file(filename, content);
              const attachmentsFolder = zip.folder('attachments');
              for (const af of attFiles) attachmentsFolder.file(af.filename, af.content);
              if (attManifest) attachmentsFolder.file('_binary_uploads.md', attManifest);
              await addConversationFilesToFolder(attachmentsFolder, request.orgId, data);
              try {
                const blob = await zip.generateAsync({ type: 'blob' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${data.name || request.conversationId}.zip`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              } catch (err) {
                console.error('ZIP generation failed:', err);
                recordExportTimestamp(request.conversationId);
                sendResponse({ success: false, error: 'ZIP generation failed: ' + err.message });
                return;
              }
            } else {
              console.log('Downloading file:', filename);
              downloadFile(content, filename, type);
            }
            recordExportTimestamp(request.conversationId);
            sendResponse({ success: true });
          }
        }
      })
      .catch(error => {
        console.error('Export conversation error:', error);
        sendResponse({ 
          success: false, 
          error: error.message,
          details: error.stack 
        });
      });
    
    return true;
  }
    
      if (request.action === 'exportAllConversations') {
    console.log('Export all conversations request received:', request);
    
    // PDF bulk export is not supported — single conversations only
    if (request.format === 'pdf') {
      sendResponse({ success: false, error: 'PDF export works one conversation at a time. Select a conversation and use "Export current" to export as PDF.' });
      return true;
    }

    fetchAllConversations(request.orgId)
      .then(async conversations => {
        console.log(`Fetched ${conversations.length} conversations`);

        // Load Obsidian filename template (only used when format === 'obsidian')
        let obsidianTemplate = '';
        if (request.format === 'obsidian') {
          const storageData = await new Promise(resolve => chrome.storage.local.get(['obsidianFilenameTemplate'], resolve));
          obsidianTemplate = storageData.obsidianFilenameTemplate || '';
        }

        if (request.extractArtifacts || request.flattenArtifacts) {
          // When extracting artifacts (nested or flat), always create a ZIP
          const zip = new JSZip();
          let processed = 0;
          let included = 0;
          let errors = [];
          const failedUuids = new Set();

          for (const conv of conversations) {
            try {
              processed++;
              console.log(`Scanning conversation ${processed}/${conversations.length}: ${conv.name || conv.uuid}`);
              const fullConv = await fetchConversation(request.orgId, conv.uuid);

              // Infer model if null
              fullConv.model = inferModel(fullConv);

              // Extract artifacts first to check if this conversation should be included
              const artifactFiles = extractArtifactFiles(fullConv, request.artifactFormat || 'original');

              // If chats are disabled and no artifacts, skip this conversation
              if (request.includeChats === false && artifactFiles.length === 0) {
                console.log(`  Skipping - no artifacts found (${processed}/${conversations.length} scanned, ${included} included)`);
                // Add a small delay to avoid overwhelming the API
                await new Promise(resolve => setTimeout(resolve, 500));
                continue;
              }

              // Sanitize folder name
              const folderName = (conv.name || conv.uuid).replace(/[<>:"/\\|?*]/g, '_');

              // Generate conversation content
              let conversationContent, conversationFilename;
              if (request.format === 'markdown') {
                conversationContent = convertToMarkdown(fullConv, request.includeMetadata, conv.uuid, request.includeArtifacts, request.includeThinking);
                conversationFilename = `${folderName}.md`;
              } else if (request.format === 'obsidian') {
                conversationContent = convertToObsidian(fullConv, conv.uuid, { includeArtifacts: request.includeArtifacts, includeThinking: request.includeThinking });
                conversationFilename = obsidianFilename(fullConv, obsidianTemplate);
              } else if (request.format === 'text') {
                conversationContent = convertToText(fullConv, request.includeMetadata, request.includeArtifacts, request.includeThinking);
                conversationFilename = `${folderName}.txt`;
              } else {
                conversationContent = JSON.stringify(fullConv, null, 2);
                conversationFilename = `${folderName}.json`;
              }

              // Flat export: use Chats and Artifacts top-level folders
              if (request.flattenArtifacts && !request.extractArtifacts) {
                if (request.includeChats !== false) {
                  zip.folder('Chats').file(conversationFilename, conversationContent);
                }
                if (artifactFiles.length > 0) {
                  const artifactsFolder = zip.folder('Artifacts');
                  for (const artifact of artifactFiles) {
                    artifactsFolder.file(`${folderName}_${artifact.filename}`, artifact.content);
                  }
                }
                const { files: attFiles, manifest: attManifest } = extractAttachmentFiles(fullConv);
                const attachmentsFolder = zip.folder('Attachments');
                for (const af of attFiles) attachmentsFolder.file(`${folderName}_${af.filename}`, af.content);
                if (attManifest) attachmentsFolder.file(`${folderName}_binary_uploads.md`, attManifest);
                // Uploaded files: prefix with conversation name to avoid collisions in flat Attachments/ folder
                await addConversationFilesToFolder(attachmentsFolder, request.orgId, fullConv, `${folderName}_`);
              }
              // Nested export: create per-conversation folders with artifacts subfolder
              else if (request.extractArtifacts) {
                const convFolder = zip.folder(folderName);
                if (request.includeChats !== false) {
                  convFolder.file(conversationFilename, conversationContent);
                }
                if (artifactFiles.length > 0) {
                  const artifactsFolder = request.includeChats !== false ? convFolder.folder('artifacts') : convFolder;
                  for (const artifact of artifactFiles) {
                    artifactsFolder.file(artifact.filename, artifact.content);
                  }
                }
                const { files: attFiles, manifest: attManifest } = extractAttachmentFiles(fullConv);
                const attachmentsFolder = convFolder.folder('attachments');
                for (const af of attFiles) attachmentsFolder.file(af.filename, af.content);
                if (attManifest) attachmentsFolder.file('_binary_uploads.md', attManifest);
                await addConversationFilesToFolder(attachmentsFolder, request.orgId, fullConv);
              }

              included++;
              console.log(`  Added to export (${processed}/${conversations.length} scanned, ${included} included)`);

              // Add a small delay to avoid overwhelming the API
              await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
              console.error(`Failed to export conversation ${conv.uuid}:`, error);
              errors.push(`${conv.name || conv.uuid}: ${error.message}`);
              failedUuids.add(conv.uuid);
            }
          }

          // Generate and download ZIP
          const exportedIds = conversations.map(c => c.uuid).filter(id => !failedUuids.has(id));
          recordExportTimestamps(exportedIds);
          try {
            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            // Format: claude-artifacts-20251031-143045.zip or claude-exports-20251031-143045.zip
            const datetime = getLocalDateTimeString();
            // Use 'claude-artifacts' when ONLY flat artifacts are exported
            const prefix = (request.flattenArtifacts && !request.extractArtifacts && request.includeChats === false) ? 'claude-artifacts' : 'claude-exports';
            a.download = `${prefix}-${datetime}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          } catch (err) {
            console.error('ZIP generation failed:', err);
            sendResponse({ success: false, error: 'ZIP generation failed: ' + err.message });
            return;
          }

          if (errors.length > 0) {
            console.warn('Some conversations failed to export:', errors);
            sendResponse({
              success: true,
              count: included,
              warnings: `Exported ${included}/${conversations.length} conversations. Some failed: ${errors.join('; ')}`
            });
          } else {
            sendResponse({ success: true, count: included });
          }
        } else {
          // For other formats without artifact extraction, create a ZIP
          const zip = new JSZip();
          let count = 0;
          let errors = [];
          const failedUuids2 = new Set();

          for (const conv of conversations) {
            try {
              console.log(`Fetching full conversation ${count + 1}/${conversations.length}: ${conv.uuid}`);
              const fullConv = await fetchConversation(request.orgId, conv.uuid);

              // Infer model if null
              fullConv.model = inferModel(fullConv);

              let content, filename;
              const safeName = (conv.name || conv.uuid).replace(/[<>:"/\\|?*]/g, '_');

              if (request.format === 'markdown') {
                content = convertToMarkdown(fullConv, request.includeMetadata, conv.uuid, request.includeArtifacts, request.includeThinking);
                filename = `${safeName}.md`;
              } else if (request.format === 'obsidian') {
                content = convertToObsidian(fullConv, conv.uuid, { includeArtifacts: request.includeArtifacts, includeThinking: request.includeThinking });
                filename = obsidianFilename(fullConv, obsidianTemplate);
              } else if (request.format === 'text') {
                content = convertToText(fullConv, request.includeMetadata, request.includeArtifacts, request.includeThinking);
                filename = `${safeName}.txt`;
              } else {
                content = JSON.stringify(fullConv, null, 2);
                filename = `${safeName}.json`;
              }

              const chatFolder = zip.folder(safeName);
              chatFolder.file(filename, content);

              // Add pasted text attachments and uploaded files (images, PDFs, etc.)
              const { files: attFiles, manifest: attManifest } = extractAttachmentFiles(fullConv);
              const attachmentsFolder = chatFolder.folder('attachments');
              for (const af of attFiles) attachmentsFolder.file(af.filename, af.content);
              if (attManifest) attachmentsFolder.file('_binary_uploads.md', attManifest);
              await addConversationFilesToFolder(attachmentsFolder, request.orgId, fullConv);

              count++;

              // Add a small delay to avoid overwhelming the API
              await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
              console.error(`Failed to export conversation ${conv.uuid}:`, error);
              errors.push(`${conv.name || conv.uuid}: ${error.message}`);
              failedUuids2.add(conv.uuid);
            }
          }

          // Generate and download ZIP
          const exportedIds2 = conversations.map(c => c.uuid).filter(id => !failedUuids2.has(id));
          recordExportTimestamps(exportedIds2);
          try {
            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const datetime = getLocalDateTimeString();
            a.download = `claude-exports-${datetime}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          } catch (err) {
            console.error('ZIP generation failed:', err);
            sendResponse({ success: false, error: 'ZIP generation failed: ' + err.message });
            return;
          }

          if (errors.length > 0) {
            console.warn('Some conversations failed to export:', errors);
            sendResponse({
              success: true,
              count,
              warnings: `Exported ${count}/${conversations.length} conversations. Some failed: ${errors.join('; ')}`
            });
          } else {
            sendResponse({ success: true, count });
          }
        }
      })
      .catch(error => {
        console.error('Export all conversations error:', error);
        sendResponse({
          success: false,
          error: error.message,
          details: error.stack
        });
      });

    return true;
  }

  // Handle loadConversations request from browse page
  if (request.action === 'loadConversations') {
    console.log('Load conversations request received from browse page');

    fetchAllConversations(request.orgId)
      .then(conversations => {
        sendResponse({ success: true, conversations: conversations });
      })
      .catch(error => {
        console.error('Load conversations error:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      });

    return true;
  }

  // Handle loadProjects request from browse page
  if (request.action === 'loadProjects') {
    console.log('Load projects request received from browse page');

    fetch(`https://claude.ai/api/organizations/${request.orgId}/projects`, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then(projects => {
        sendResponse({ success: true, projects: projects });
      })
      .catch(error => {
        console.error('Load projects error:', error);
        sendResponse({
          success: false,
          error: error.message
        });
      });

    return true;
  }
  });

// === Keyboard Shortcuts ===

// Brief on-page toast used for keyboard shortcut feedback.
function showCtToast(message, duration = 2500) {
  let toast = document.getElementById('ct-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ct-toast';
    Object.assign(toast.style, {
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(30,24,18,.92)', color: '#f2ece2',
      fontSize: '13px', fontWeight: '500', fontFamily: 'system-ui,sans-serif',
      padding: '9px 18px', borderRadius: '10px', zIndex: '9999',
      boxShadow: '0 4px 20px rgba(0,0,0,.3)',
      pointerEvents: 'none', opacity: '0', transition: 'opacity .15s',
    });
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.style.opacity = '0'; }, duration);
}

// Alt+E: exports the current conversation as Markdown with default settings.
async function quickExportCurrent() {
  const conversationId = location.pathname.match(/\/chat\/([^/?]+)/)?.[1];
  if (!conversationId) { showCtToast('No conversation open'); return; }

  showCtToast('Exporting…');
  try {
    const orgResp = await fetch('https://claude.ai/api/organizations', {
      credentials: 'include', headers: { Accept: 'application/json' }
    });
    if (!orgResp.ok) throw new Error('Auth error — make sure you are logged in to claude.ai');
    const orgs = await orgResp.json();
    const org = orgs.find(o => Array.isArray(o.capabilities) && o.capabilities.includes('chat')) || orgs[0];
    if (!org?.uuid) throw new Error('Could not detect org ID');

    const data = await fetchConversation(org.uuid, conversationId);
    data.model = inferModel(data);
    downloadFile(
      convertToMarkdown(data, false, conversationId, true, false),
      `${data.name || conversationId}.md`,
      'text/markdown'
    );
    recordExportTimestamp(conversationId);
    showCtToast('Exported ✓');
  } catch (err) {
    showCtToast('Export failed: ' + err.message);
  }
}

// Install/re-install the keydown listener. Called on init and whenever settings change.
// Stored on window so it can be cleanly removed before re-registering.
function initKeyboardShortcuts(shortcuts) {
  if (window._ctKbListener) {
    document.removeEventListener('keydown', window._ctKbListener, true);
  }

  window._ctKbListener = function(e) {
    // Alt+E — quick export (always active)
    if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
      quickExportCurrent();
      return;
    }

    // Alt+B — open browse page (always active)
    if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey && (e.key === 'b' || e.key === 'B')) {
      e.preventDefault();
      window.open(chrome.runtime.getURL('browse.html'), '_blank');
      return;
    }

    // Enter/Ctrl+Enter swap — only when enterBehavior === 'ctrlEnter'
    if (!shortcuts || shortcuts.enterBehavior !== 'ctrlEnter') return;

    const editor = document.querySelector('[contenteditable="true"][data-placeholder]') ||
                   document.querySelector('[contenteditable="true"][role="textbox"]');
    if (!editor || (!editor.contains(e.target) && e.target !== editor)) return;

    if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      // Enter → insert newline (don't send)
      e.preventDefault();
      e.stopPropagation();
      document.execCommand('insertText', false, '\n');
      return;
    }

    if (e.key === 'Enter' && e.ctrlKey && !e.shiftKey) {
      // Ctrl+Enter → send
      e.preventDefault();
      e.stopPropagation();
      const sendBtn = document.querySelector('[data-testid="send-button"]') ||
                     document.querySelector('button[aria-label="Send Message"]') ||
                     document.querySelector('button[aria-label="Send message"]');
      if (sendBtn) sendBtn.click();
    }
  };

  document.addEventListener('keydown', window._ctKbListener, true);
}

chrome.storage.sync.get(['keyboardShortcuts'], (result) => {
  initKeyboardShortcuts(result.keyboardShortcuts || {});
});

// Re-init when settings change (e.g. user toggles Ctrl+Enter in options)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && 'keyboardShortcuts' in changes) {
    initKeyboardShortcuts(changes.keyboardShortcuts.newValue || {});
  }
});

// === Bookmarks ===

function _bmId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
async function _bmLoad() {
  return new Promise(r => chrome.storage.local.get(['bookmarks'], d => r(d.bookmarks || {})));
}
async function _bmSave(obj) {
  return new Promise(r => chrome.storage.local.set({ bookmarks: obj }, r));
}

async function handleBookmarkClick(btn, el, sender) {
  const conversationId = location.pathname.match(/\/chat\/([^/?]+)/)?.[1];
  if (!conversationId) return;

  if (btn.dataset.ctBmId) {
    const bms = await _bmLoad();
    delete bms[btn.dataset.ctBmId];
    await _bmSave(bms);
    delete btn.dataset.ctBmId;
    btn.textContent = '☆';
    btn.classList.remove('ct-bm-on');
    btn.title = 'Bookmark';
  } else {
    const id = _bmId();
    const preview = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 300);
    const convName = document.title.replace(/\s*[-–|]\s*(Claude|Anthropic).*$/i, '').trim() || conversationId;
    const bms = await _bmLoad();
    bms[id] = { id, conversationId, conversationName: convName, messageText: preview, sender, createdAt: new Date().toISOString() };
    await _bmSave(bms);
    btn.dataset.ctBmId = id;
    btn.textContent = '★';
    btn.classList.add('ct-bm-on');
    btn.title = 'Remove bookmark';
    showCtToast('Bookmarked ★');
  }
}

// Cached selectors for message containers; one per sender type.
const _bmSels = { human: null, claude: null };
let _bmDebounce2 = null;

function injectBookmarkButtons() {
  const convId = location.pathname.match(/\/chat\/([^/?]+)/)?.[1];
  const SELS = {
    human: ['[data-testid="human-turn"]', '[data-testid="human-turn-inner"]'],
    claude: ['[data-testid="ai-turn"]', '[data-testid="ai-turn-inner"]']
  };

  for (const [sender, candidates] of Object.entries(SELS)) {
    if (_bmSels[sender] && !document.querySelector(_bmSels[sender])) _bmSels[sender] = null;
    if (!_bmSels[sender]) {
      for (const sel of candidates) {
        if (document.querySelector(sel)) { _bmSels[sender] = sel; break; }
      }
    }
    if (!_bmSels[sender]) continue;

    document.querySelectorAll(_bmSels[sender] + ':not([data-ct-bm])').forEach(el => {
      el.setAttribute('data-ct-bm', sender);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ct-bm-btn';
      btn.textContent = '☆';
      btn.title = 'Bookmark';
      btn.setAttribute('aria-label', 'Bookmark this message');
      btn.addEventListener('click', e => { e.stopPropagation(); handleBookmarkClick(btn, el, sender); });

      const wrap = document.createElement('div');
      wrap.className = 'ct-bm-wrap';
      wrap.appendChild(btn);
      el.appendChild(wrap);

      // Restore starred state if this message was previously bookmarked
      if (convId) {
        _bmLoad().then(bms => {
          const preview = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 100);
          const match = Object.values(bms).find(b =>
            b.conversationId === convId && b.sender === sender &&
            b.messageText.slice(0, 100) === preview
          );
          if (match) {
            btn.dataset.ctBmId = match.id;
            btn.textContent = '★';
            btn.classList.add('ct-bm-on');
            btn.title = 'Remove bookmark';
          }
        });
      }
    });
  }
}

(function initBookmarks() {
  injectBookmarkButtons();
  const obs = new MutationObserver(() => {
    clearTimeout(_bmDebounce2);
    _bmDebounce2 = setTimeout(injectBookmarkButtons, 300);
  });
  obs.observe(document.body, { childList: true, subtree: true });
})();

// === Continue from Here ===

// Clipboard helper — falls back to execCommand if Clipboard API is unavailable.
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    Object.assign(el.style, { position: 'fixed', left: '-9999px', top: '-9999px' });
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  }
}

// Fetch conversation + slice to the N-th Claude response, copy to clipboard.
async function handleContinueFromHere(claudeMsgIdx) {
  const conversationId = location.pathname.match(/\/chat\/([^/?]+)/)?.[1];
  if (!conversationId) { showCtToast('No conversation open'); return; }

  showCtToast('Fetching conversation…');
  try {
    const orgResp = await fetch('https://claude.ai/api/organizations', {
      credentials: 'include', headers: { Accept: 'application/json' }
    });
    if (!orgResp.ok) throw new Error('Not authenticated — make sure you are logged in to claude.ai');
    const orgs = await orgResp.json();
    const org = orgs.find(o => Array.isArray(o.capabilities) && o.capabilities.includes('chat')) || orgs[0];
    if (!org?.uuid) throw new Error('Could not detect org ID');

    const data = await fetchConversation(org.uuid, conversationId);
    data.model = inferModel(data);

    // Walk the current branch and find the N-th Claude response (0-based)
    const branch = getCurrentBranch(data);
    let claudeCount = -1;
    let cutIdx = -1;
    for (let i = 0; i < branch.length; i++) {
      if (branch[i].sender === 'claude') {
        claudeCount++;
        if (claudeCount === claudeMsgIdx) { cutIdx = i; break; }
      }
    }

    if (cutIdx === -1) {
      showCtToast('Message not found — the page may be out of sync, try scrolling up first');
      return;
    }

    // Build conversation truncated at the cut point by changing the leaf UUID.
    // convertToMarkdown calls getCurrentBranch internally, which traces back from this UUID.
    const truncData = { ...data, current_leaf_message_uuid: branch[cutIdx].uuid };
    const content = convertToMarkdown(truncData, false, conversationId, false, false);
    const ok = await copyToClipboard(content);

    if (ok) {
      const msgCount = cutIdx + 1;
      showCtToast(`Context copied (${msgCount} message${msgCount !== 1 ? 's' : ''}) — paste into a new conversation`);
    } else {
      showCtToast('Could not copy — check browser clipboard permissions');
    }
  } catch (err) {
    showCtToast('Failed: ' + err.message);
  }
}

// Injects "Continue from here" buttons into unprocessed Claude response containers.
// Tries selectors in priority order; once one works, caches it.
// The cache resets automatically when the matched selector disappears from the DOM.
let _cfhSel = null;
let _cfhDebounce = null;

function injectCfhButtons() {
  // Reset cached selector if it no longer matches anything (e.g. after navigation)
  if (_cfhSel && !document.querySelector(_cfhSel)) _cfhSel = null;

  if (!_cfhSel) {
    for (const sel of ['[data-testid="ai-turn"]', '[data-testid="ai-turn-inner"]']) {
      if (document.querySelector(sel)) { _cfhSel = sel; break; }
    }
  }
  if (!_cfhSel) return;

  document.querySelectorAll(_cfhSel + ':not([data-ct-cfh])').forEach((el) => {
    el.setAttribute('data-ct-cfh', '1');

    const wrap = document.createElement('div');
    wrap.className = 'ct-cfh-wrap';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ct-cfh-btn';
    btn.textContent = 'Continue from here ↗';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Determine index by position among all injected buttons at click time
      const allBtns = [...document.querySelectorAll('.ct-cfh-btn')];
      handleContinueFromHere(allBtns.indexOf(btn));
    });
    wrap.appendChild(btn);
    el.appendChild(wrap);
  });
}

// Start injection and observe the DOM for new messages.
(function initContinueFromHere() {
  injectCfhButtons();

  const observer = new MutationObserver(() => {
    clearTimeout(_cfhDebounce);
    _cfhDebounce = setTimeout(injectCfhButtons, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();

// === Full-Width Mode ===
// Reads wideMode from storage and toggles data-ct-wide on document.body.
// CSS in content.css removes claude.ai's max-width constraints when this attribute is present.
function applyWideMode(enabled) {
  if (enabled) {
    document.body.setAttribute('data-ct-wide', '');
  } else {
    document.body.removeAttribute('data-ct-wide');
  }
}

chrome.storage.local.get(['wideMode'], (result) => {
  applyWideMode(!!result.wideMode);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'wideMode' in changes) {
    applyWideMode(!!changes.wideMode.newValue);
  }
});

} // End of double-injection guard