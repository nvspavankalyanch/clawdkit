import { describe, it, expect } from 'vitest';
import utils from '../chrome/utils.js';

const {
  getCurrentBranch,
  convertToMarkdown,
  extractArtifactsFromMessage,
  extractArtifactFiles,
  getFileExtension,
  isProgrammingLanguage,
  inferModel,
  formatModelName,
  getModelBadgeClass,
  DEFAULT_MODEL_TIMELINE,
  _mdToHtml,
  _inlineHtml,
} = utils;

// Regression coverage for the bug fixed in v1.9.1: bash/web_search/repl
// tool_use entries used to slip through as fake artifacts. Now gated on
// `tool_use.name === 'artifacts'`.
describe('extractArtifactsFromMessage — tool name filter', () => {
  it('rejects a bash tool_use even with code_block display content', () => {
    const message = {
      content: [
        {
          type: 'tool_use',
          name: 'bash',
          display_content: {
            type: 'code_block',
            code: 'ls -la',
            language: 'bash',
            filename: 'cmd.sh',
          },
        },
      ],
    };
    expect(extractArtifactsFromMessage(message)).toEqual([]);
  });

  it('rejects a web_search tool_use', () => {
    const message = {
      content: [
        {
          type: 'tool_use',
          name: 'web_search',
          display_content: {
            type: 'code_block',
            code: 'results...',
            language: 'json',
          },
        },
      ],
    };
    expect(extractArtifactsFromMessage(message)).toEqual([]);
  });

  it('extracts an artifacts tool_use with code_block format', () => {
    const message = {
      content: [
        {
          type: 'tool_use',
          name: 'artifacts',
          display_content: {
            type: 'code_block',
            code: 'def hello():\n    pass',
            language: 'python',
            filename: 'hello.py',
          },
        },
      ],
    };
    const artifacts = extractArtifactsFromMessage(message);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe('hello');
    expect(artifacts[0].language).toBe('python');
    expect(artifacts[0].content).toBe('def hello():\n    pass');
  });

  it('extracts an artifacts tool_use with json_block format when filename is present', () => {
    const message = {
      content: [
        {
          type: 'tool_use',
          name: 'artifacts',
          display_content: {
            type: 'json_block',
            json_block: JSON.stringify({
              filename: 'app.js',
              language: 'javascript',
              code: 'console.log("hi");',
            }),
          },
        },
      ],
    };
    const artifacts = extractArtifactsFromMessage(message);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe('app');
  });

  it('rejects a json_block artifacts entry that has no filename', () => {
    const message = {
      content: [
        {
          type: 'tool_use',
          name: 'artifacts',
          display_content: {
            type: 'json_block',
            json_block: JSON.stringify({
              code: 'echo hi',
            }),
          },
        },
      ],
    };
    expect(extractArtifactsFromMessage(message)).toEqual([]);
  });

  // Regression: when `enabled_artifacts_attachments` is false in conversation
  // settings, Claude uses the skills-runner `create_file` MCP tool instead of
  // the legacy `artifacts` tool. display_content shape is identical
  // (json_block with language / code / filename). The extractor must allowlist
  // both tool names.
  it('extracts a create_file tool_use (skills-runner replacement for artifacts)', () => {
    const message = {
      content: [
        {
          type: 'tool_use',
          name: 'create_file',
          input: {
            path: '/mnt/user-data/outputs/hello.md',
            file_text: '# Hello, world!\n',
          },
          display_content: {
            type: 'json_block',
            json_block: JSON.stringify({
              language: 'markdown',
              code: '# Hello, world!\n',
              filename: '/mnt/user-data/outputs/hello.md',
            }),
          },
        },
      ],
    };
    const artifacts = extractArtifactsFromMessage(message);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].title).toBe('hello');
    expect(artifacts[0].language).toBe('markdown');
    expect(artifacts[0].content).toBe('# Hello, world!');
  });

  it('still rejects other skills tools that share json_block display (e.g. view, list_directory)', () => {
    const message = {
      content: [
        {
          type: 'tool_use',
          name: 'view',
          display_content: {
            type: 'json_block',
            json_block: JSON.stringify({
              language: 'text',
              code: 'directory listing here',
              filename: '/mnt/skills/public',
            }),
          },
        },
      ],
    };
    expect(extractArtifactsFromMessage(message)).toEqual([]);
  });
});

describe('extractArtifactFiles — end-to-end', () => {
  function makeConversationWithMessages(messages) {
    const last = messages[messages.length - 1];
    return {
      current_leaf_message_uuid: last.uuid,
      chat_messages: messages,
    };
  }

  it('returns artifact files only from real artifact tool calls', () => {
    const data = makeConversationWithMessages([
      {
        uuid: 'm1',
        sender: 'human',
        content: [{ type: 'text', text: 'make me something' }],
        parent_message_uuid: '00000000-0000-0000-0000-000000000000',
      },
      {
        uuid: 'm2',
        sender: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'artifacts',
            display_content: {
              type: 'code_block',
              code: '<h1>hi</h1>',
              language: 'html',
              filename: 'page.html',
            },
          },
          {
            type: 'tool_use',
            name: 'bash',
            display_content: {
              type: 'code_block',
              code: 'ls',
              language: 'bash',
              filename: 'noise.sh',
            },
          },
        ],
        parent_message_uuid: 'm1',
      },
    ]);
    const files = extractArtifactFiles(data);
    expect(files).toHaveLength(1);
    expect(files[0].filename).toMatch(/\.html$/);
  });

  it('deduplicates duplicate filenames with a counter suffix', () => {
    const data = makeConversationWithMessages([
      {
        uuid: 'm1',
        sender: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'artifacts',
            display_content: {
              type: 'code_block',
              code: 'a',
              language: 'javascript',
              filename: 'app.js',
            },
          },
          {
            type: 'tool_use',
            name: 'artifacts',
            display_content: {
              type: 'code_block',
              code: 'b',
              language: 'javascript',
              filename: 'app.js',
            },
          },
        ],
        parent_message_uuid: '00000000-0000-0000-0000-000000000000',
      },
    ]);
    const files = extractArtifactFiles(data);
    expect(files).toHaveLength(2);
    const names = files.map(f => f.filename);
    expect(new Set(names).size).toBe(2); // both unique
  });
});

describe('getCurrentBranch', () => {
  it('returns empty array when there are no messages', () => {
    expect(getCurrentBranch({ chat_messages: [], current_leaf_message_uuid: 'x' })).toEqual([]);
  });

  it('returns empty array when leaf uuid is missing', () => {
    expect(getCurrentBranch({ chat_messages: [{ uuid: 'a' }] })).toEqual([]);
  });

  it('walks from leaf back to root in chronological order', () => {
    const data = {
      current_leaf_message_uuid: 'm3',
      chat_messages: [
        { uuid: 'm1', parent_message_uuid: 'root', text: 'first' },
        { uuid: 'm2', parent_message_uuid: 'm1', text: 'second' },
        { uuid: 'm3', parent_message_uuid: 'm2', text: 'third' },
      ],
    };
    const branch = getCurrentBranch(data);
    expect(branch.map(m => m.uuid)).toEqual(['m1', 'm2', 'm3']);
  });

  it('only includes messages on the current branch (ignores siblings)', () => {
    // m1 → m2a → m3 (current leaf), m1 → m2b is a sibling branch and should be excluded
    const data = {
      current_leaf_message_uuid: 'm3',
      chat_messages: [
        { uuid: 'm1', parent_message_uuid: 'root', text: 'first' },
        { uuid: 'm2a', parent_message_uuid: 'm1', text: 'kept' },
        { uuid: 'm2b', parent_message_uuid: 'm1', text: 'sibling' },
        { uuid: 'm3', parent_message_uuid: 'm2a', text: 'leaf' },
      ],
    };
    const branch = getCurrentBranch(data);
    expect(branch.map(m => m.uuid)).toEqual(['m1', 'm2a', 'm3']);
  });
});

describe('getFileExtension', () => {
  it('maps common programming languages correctly', () => {
    expect(getFileExtension('javascript')).toBe('.js');
    expect(getFileExtension('python')).toBe('.py');
    expect(getFileExtension('bash')).toBe('.sh');
  });

  it('falls back to .txt for unknown languages', () => {
    expect(getFileExtension('totally-not-a-language')).toBe('.txt');
  });
});

describe('isProgrammingLanguage', () => {
  it('recognizes common programming languages', () => {
    expect(isProgrammingLanguage('javascript')).toBe(true);
    expect(isProgrammingLanguage('python')).toBe(true);
    expect(isProgrammingLanguage('rust')).toBe(true);
  });

  it('rejects markup/document formats', () => {
    expect(isProgrammingLanguage('markdown')).toBe(false);
  });
});

// Regression: claude-opus-4-20250514 used to render as "Claude Opus 4.20250514"
// because the optional minor group `(\d+)` was eating the 8-digit date.
// Fix in v1.9.1: constrained minor to `\d{1,2}`.
describe('formatModelName — new format (claude-{type}-{major}[-{minor}][-{date}])', () => {
  it('renders major-only with date suffix correctly (regression)', () => {
    expect(formatModelName('claude-opus-4-20250514')).toBe('Claude Opus 4');
    expect(formatModelName('claude-sonnet-4-20250514')).toBe('Claude Sonnet 4');
  });

  it('renders major.minor with date suffix', () => {
    expect(formatModelName('claude-sonnet-4-5-20250929')).toBe('Claude Sonnet 4.5');
    expect(formatModelName('claude-opus-4-5-20251101')).toBe('Claude Opus 4.5');
  });

  it('renders major.minor without date suffix', () => {
    expect(formatModelName('claude-sonnet-4-6')).toBe('Claude Sonnet 4.6');
    expect(formatModelName('claude-opus-4-7')).toBe('Claude Opus 4.7');
  });

  it('renders major-only without date', () => {
    expect(formatModelName('claude-haiku-5')).toBe('Claude Haiku 5');
  });
});

describe('formatModelName — old format (claude-{major}[-{minor}]-{type}-{date})', () => {
  it('renders major-only old format', () => {
    expect(formatModelName('claude-3-sonnet-20240229')).toBe('Claude Sonnet 3');
  });

  it('renders major.minor old format', () => {
    expect(formatModelName('claude-3-5-sonnet-20240620')).toBe('Claude Sonnet 3.5');
    expect(formatModelName('claude-3-7-sonnet-20250219')).toBe('Claude Sonnet 3.7');
  });
});

describe('formatModelName — edge cases', () => {
  it('returns "Unknown" for null/undefined/empty', () => {
    expect(formatModelName(null)).toBe('Unknown');
    expect(formatModelName(undefined)).toBe('Unknown');
    expect(formatModelName('')).toBe('Unknown');
  });

  it('returns input unchanged when not a claude- model', () => {
    expect(formatModelName('gpt-4')).toBe('gpt-4');
  });

  it('returns input unchanged when claude- prefix but unparseable', () => {
    expect(formatModelName('claude-nonsense')).toBe('claude-nonsense');
  });
});

// Coverage matrix for the three documented shapes (per Anthropic's model-ids docs):
//   1. Dateless 4.6+: `claude-{name}-{major}-{minor}` (canonical snapshot)
//   2. Dated pre-4.6: `claude-{name}-{major}-{minor}-{YYYYMMDD}`
//   3. Convenience alias pre-4.6: `claude-{name}-{major}-{minor}` (looks identical to #1, semantic difference only)
// Verified across all known families. Bedrock/Vertex prefixes intentionally omitted —
// claude.ai never serves those.
describe('formatModelName — full family × shape matrix', () => {
  const families = [
    ['sonnet', 'Sonnet'],
    ['opus', 'Opus'],
    ['haiku', 'Haiku'],
  ];

  for (const [family, label] of families) {
    it(`renders ${family} dateless (4.6+ canonical)`, () => {
      expect(formatModelName(`claude-${family}-4-6`)).toBe(`Claude ${label} 4.6`);
    });

    it(`renders ${family} dated (pre-4.6)`, () => {
      expect(formatModelName(`claude-${family}-4-5-20250929`)).toBe(`Claude ${label} 4.5`);
    });

    it(`renders ${family} alias (pre-4.6 dateless — same shape as #1, different semantics)`, () => {
      expect(formatModelName(`claude-${family}-4-5`)).toBe(`Claude ${label} 4.5`);
    });
  }
});

describe('formatModelName — minor-version regex boundary (\\d{1,2})', () => {
  it('accepts two-digit minors', () => {
    expect(formatModelName('claude-sonnet-5-10')).toBe('Claude Sonnet 5.10');
    expect(formatModelName('claude-opus-4-99')).toBe('Claude Opus 4.99');
  });

  it('falls through on three-digit minors (would need regex bump)', () => {
    expect(formatModelName('claude-sonnet-5-100')).toBe('claude-sonnet-5-100');
  });
});

// Documented behavior for unknown families (e.g. a hypothetical future "Mythos").
// Current regex hardcodes `(sonnet|opus|haiku)` — anything else falls through to
// raw display. These tests pin that behavior so the day Anthropic ships a new
// family, we get a heads-up via test failure rather than ugly UI.
describe('formatModelName — unknown family fallthrough', () => {
  it('returns raw ID for new family with non-numeric version (e.g. -preview)', () => {
    expect(formatModelName('claude-mythos-preview')).toBe('claude-mythos-preview');
  });

  it('returns raw ID for new family with numeric version', () => {
    expect(formatModelName('claude-mythos-1-0')).toBe('claude-mythos-1-0');
  });

  it('returns raw ID for new family with dated version', () => {
    expect(formatModelName('claude-mythos-1-0-20260101')).toBe('claude-mythos-1-0-20260101');
  });
});

describe('inferModel', () => {
  it('returns conversation.model when set, regardless of date', () => {
    expect(inferModel({ model: 'claude-opus-4-7', created_at: '2024-01-01T00:00:00Z' }))
      .toBe('claude-opus-4-7');
  });

  it('falls back to timeline lookup when model is null', () => {
    // Mid-2024 → claude-3-5-sonnet-20240620
    expect(inferModel({ model: null, created_at: '2024-08-01T00:00:00Z' }))
      .toBe('claude-3-5-sonnet-20240620');
  });

  it('returns the most recent timeline entry for current dates', () => {
    expect(inferModel({ model: null, created_at: '2026-04-01T00:00:00Z' }))
      .toBe('claude-sonnet-4-6');
  });

  it('returns the earliest timeline entry for pre-timeline dates', () => {
    expect(inferModel({ model: null, created_at: '2023-06-01T00:00:00Z' }))
      .toBe('claude-3-sonnet-20240229');
  });

  it('uses correct model on timeline boundaries', () => {
    // 2024-06-20 is the first day of claude-3-5-sonnet-20240620
    expect(inferModel({ model: null, created_at: '2024-06-20T00:00:00Z' }))
      .toBe('claude-3-5-sonnet-20240620');
    // One second before that boundary should still be the prior model
    expect(inferModel({ model: null, created_at: '2024-06-19T23:59:59Z' }))
      .toBe('claude-3-sonnet-20240229');
  });
});

describe('DEFAULT_MODEL_TIMELINE', () => {
  it('has all valid Date objects (no NaN dates)', () => {
    for (const entry of DEFAULT_MODEL_TIMELINE) {
      expect(entry.date instanceof Date).toBe(true);
      expect(Number.isNaN(entry.date.getTime())).toBe(false);
    }
  });

  it('is sorted in chronological order', () => {
    for (let i = 1; i < DEFAULT_MODEL_TIMELINE.length; i++) {
      expect(DEFAULT_MODEL_TIMELINE[i].date.getTime())
        .toBeGreaterThan(DEFAULT_MODEL_TIMELINE[i - 1].date.getTime());
    }
  });

  // Catches typos when adding a new default — e.g. `claude-sonnett-4-7` would
  // silently fall through to raw display in the UI; this test makes it loud.
  it('every entry parses cleanly through formatModelName (no fallthrough to raw ID)', () => {
    for (const entry of DEFAULT_MODEL_TIMELINE) {
      const formatted = formatModelName(entry.model);
      expect(formatted, `entry "${entry.model}" failed to format`).toMatch(/^Claude (Sonnet|Opus|Haiku) /);
    }
  });
});

describe('getModelBadgeClass', () => {
  it('returns family name when model contains it', () => {
    expect(getModelBadgeClass('claude-sonnet-4-5-20250929')).toBe('sonnet');
    expect(getModelBadgeClass('claude-opus-4-7')).toBe('opus');
    expect(getModelBadgeClass('claude-haiku-3-5')).toBe('haiku');
  });

  it('returns empty string for unknown family', () => {
    expect(getModelBadgeClass('gpt-4')).toBe('');
  });

  it('returns empty string for new claude family without a registered badge', () => {
    expect(getModelBadgeClass('claude-mythos-preview')).toBe('');
    expect(getModelBadgeClass('claude-mythos-1-0')).toBe('');
  });

  it('handles null/empty input without throwing', () => {
    expect(getModelBadgeClass(null)).toBe('');
    expect(getModelBadgeClass('')).toBe('');
    expect(getModelBadgeClass(undefined)).toBe('');
  });
});

describe('convertToMarkdown — smoke test', () => {
  it('renders both human and assistant message text', () => {
    const data = {
      name: 'Test Chat',
      model: 'claude-sonnet-4-5-20250929',
      created_at: '2026-04-01T12:00:00Z',
      updated_at: '2026-04-01T12:00:00Z',
      current_leaf_message_uuid: 'm2',
      chat_messages: [
        {
          uuid: 'm1',
          sender: 'human',
          content: [{ type: 'text', text: 'Hello there' }],
          parent_message_uuid: '00000000-0000-0000-0000-000000000000',
        },
        {
          uuid: 'm2',
          sender: 'assistant',
          content: [{ type: 'text', text: 'General Kenobi' }],
          parent_message_uuid: 'm1',
        },
      ],
    };
    const md = convertToMarkdown(data, false);
    expect(md).toContain('Hello there');
    expect(md).toContain('General Kenobi');
  });

  it('includes metadata block when includeMetadata is true', () => {
    const data = {
      name: 'My Chat',
      model: 'claude-opus-4-5-20251101',
      created_at: '2026-04-01T12:00:00Z',
      updated_at: '2026-04-01T12:00:00Z',
      current_leaf_message_uuid: 'm1',
      chat_messages: [
        {
          uuid: 'm1',
          sender: 'human',
          content: [{ type: 'text', text: 'hi' }],
          parent_message_uuid: '00000000-0000-0000-0000-000000000000',
        },
      ],
    };
    const md = convertToMarkdown(data, true);
    expect(md).toContain('My Chat');
  });
});

describe('_inlineHtml — inline transforms', () => {
  it('wraps inline code', () => expect(_inlineHtml('use `npm i`')).toBe('use <code>npm i</code>'));
  it('renders bold', () => expect(_inlineHtml('**bold**')).toBe('<strong>bold</strong>'));
  it('renders italic', () => expect(_inlineHtml('*italic*')).toBe('<em>italic</em>'));
  it('renders bold+italic', () => expect(_inlineHtml('***hi***')).toBe('<strong><em>hi</em></strong>'));
  it('renders link', () => expect(_inlineHtml('[click](https://a.com)')).toBe('<a href="https://a.com">click</a>'));
  it('renders strikethrough', () => expect(_inlineHtml('~~old~~')).toBe('<s>old</s>'));
});

describe('_mdToHtml — block elements', () => {
  it('renders # as h2', () => expect(_mdToHtml('# Intro')).toContain('<h2>Intro</h2>'));
  it('renders ## as h3', () => expect(_mdToHtml('## Sub')).toContain('<h3>Sub</h3>'));
  it('renders ### as h4', () => expect(_mdToHtml('### Deep')).toContain('<h4>Deep</h4>'));
  it('renders #### as h4 (capped)', () => expect(_mdToHtml('#### Deeper')).toContain('<h4>Deeper</h4>'));
  it('renders unordered list', () => {
    const out = _mdToHtml('- a\n- b');
    expect(out).toContain('<ul>');
    expect(out).toContain('<li>a</li>');
    expect(out).toContain('<li>b</li>');
  });
  it('renders ordered list', () => {
    const out = _mdToHtml('1. x\n2. y');
    expect(out).toContain('<ol>');
    expect(out).toContain('<li>x</li>');
  });
  it('renders blockquote', () => {
    const out = _mdToHtml('> quoted text');
    expect(out).toContain('<blockquote>');
    expect(out).toContain('quoted text');
  });
  it('renders hr from ---', () => expect(_mdToHtml('---')).toBe('<hr>'));
  it('renders hr from ***', () => expect(_mdToHtml('***')).toBe('<hr>'));
  it('renders table with header and data rows', () => {
    const out = _mdToHtml('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(out).toContain('<table>');
    expect(out).toContain('<th>A</th>');
    expect(out).toContain('<td>1</td>');
  });
  it('does not parse markdown inside fenced code block', () => {
    const out = _mdToHtml('```\n# not heading\n**not bold**\n```');
    expect(out).not.toContain('<h2>');
    expect(out).not.toContain('<strong>');
    expect(out).toContain('<pre><code>');
  });
  it('does not double-escape HTML entities in code blocks', () => {
    const out = _mdToHtml('```\n<div>&</div>\n```');
    expect(out).toContain('&lt;div&gt;&amp;&lt;/div&gt;');
  });
  it('wraps plain text in <p>', () => expect(_mdToHtml('Hello')).toBe('<p>Hello</p>'));
  it('splits double newlines into separate paragraphs', () => {
    const out = _mdToHtml('Para one\n\nPara two');
    expect(out).toContain('<p>Para one</p>');
    expect(out).toContain('<p>Para two</p>');
  });
  it('applies inline bold inside list items', () => {
    const out = _mdToHtml('- **bold item**');
    expect(out).toContain('<strong>bold item</strong>');
  });
});

describe('convertToHTML — theme baking', () => {
  const data = {
    name: 'Theme Test',
    model: 'claude-sonnet-4-5-20250929',
    created_at: '2026-06-01T12:00:00Z',
    current_leaf_message_uuid: 'm1',
    chat_messages: [
      {
        uuid: 'm1',
        sender: 'human',
        content: [{ type: 'text', text: 'hi' }],
        parent_message_uuid: '00000000-0000-0000-0000-000000000000',
      },
    ],
  };
  it('emits data-theme="dark" when theme is dark', () => {
    expect(utils.convertToHTML(data, 'c1', { theme: 'dark' })).toContain('<html lang="en" data-theme="dark">');
  });
  it('emits data-theme="light" when theme is light', () => {
    expect(utils.convertToHTML(data, 'c1', { theme: 'light' })).toContain('<html lang="en" data-theme="light">');
  });
  it('omits data-theme when no theme given', () => {
    expect(utils.convertToHTML(data, 'c1', {})).toContain('<html lang="en">');
  });
  it('CSS contains the attribute-selector dark palette (print-safe)', () => {
    const html = utils.convertToHTML(data, 'c1', { theme: 'dark' });
    expect(html).toContain(':root[data-theme="dark"]');
  });
});

describe('inline visuals (visualize:show_widget)', () => {
  const svgWidget = {
    type: 'tool_use',
    name: 'visualize:show_widget',
    input: {
      title: 'ai_history_timeline',
      widget_code: '\n<svg width="100%" viewBox="0 0 680 920" role="img"><title>Timeline</title><rect/></svg>',
    },
    integration_name: 'visualize',
    is_mcp_app: true,
  };
  const readMe = {
    type: 'tool_use',
    name: 'visualize:read_me',
    input: { modules: ['diagram', 'chart'] },
    integration_name: 'visualize',
  };

  it('extracts show_widget as a visual artifact, skips read_me', () => {
    const arts = extractArtifactsFromMessage({ content: [readMe, svgWidget] });
    expect(arts).toHaveLength(1);
    expect(arts[0].type).toBe('visual');
    expect(arts[0].title).toBe('ai_history_timeline');
    expect(arts[0].language).toBe('svg');
    expect(arts[0].content.startsWith('<svg')).toBe(true);
  });

  it('detects html widgets when code is not svg', () => {
    const arts = extractArtifactsFromMessage({
      content: [{ type: 'tool_use', name: 'visualize:show_widget', input: { title: 'w', widget_code: '<div>hi</div>' } }],
    });
    expect(arts[0].language).toBe('html');
  });

  const data = {
    name: 'Viz Chat',
    created_at: '2026-06-12T07:00:00Z',
    current_leaf_message_uuid: 'm2',
    chat_messages: [
      { uuid: 'm1', sender: 'human', content: [{ type: 'text', text: 'chart please' }], parent_message_uuid: '00000000-0000-0000-0000-000000000000' },
      { uuid: 'm2', sender: 'assistant', content: [{ type: 'text', text: 'Here it is' }, svgWidget], parent_message_uuid: 'm1' },
    ],
  };

  it('extractArtifactFiles places visuals in a visuals/ subfolder with .svg extension', () => {
    const files = extractArtifactFiles(data, 'original');
    expect(files).toHaveLength(1);
    expect(files[0].filename).toBe('visuals/ai_history_timeline.svg');
  });

  it('convertToHTML embeds the visual as a sandboxed iframe, not a code block', () => {
    const html = utils.convertToHTML(data, 'c1', {});
    expect(html).toContain('class="visual-frame" sandbox');
    expect(html).toContain('aspect-ratio:680/920');
    expect(html).not.toContain('<pre><code>&lt;svg');
  });

  it('convertToMarkdown embeds the raw markup under a Visual heading', () => {
    const md = convertToMarkdown(data, false);
    expect(md).toContain('#### 📊 Visual: ai_history_timeline');
    expect(md).toContain('<svg width="100%"');
  });
});

describe('visual SVG styling (claude.ai host CSS baked in)', () => {
  const widget = (code) => ({
    content: [{ type: 'tool_use', name: 'visualize:show_widget', input: { title: 'w', widget_code: code } }],
  });

  it('injects the host stylesheet and xmlns into extracted SVG', () => {
    const arts = extractArtifactsFromMessage(widget('<svg viewBox="0 0 10 10"><text class="th">hi</text></svg>'));
    expect(arts[0].content).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(arts[0].content).toContain('svg .th{font-size:14px;font-weight:500;fill:#1A1915;}');
    expect(arts[0].content).toContain('g.c-purple>rect');
  });

  it('does not duplicate an existing xmlns', () => {
    const arts = extractArtifactsFromMessage(widget('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>'));
    expect(arts[0].content.match(/xmlns=/g)).toHaveLength(1);
  });

  it('leaves html widgets unmodified', () => {
    const arts = extractArtifactsFromMessage(widget('<div>plain</div>'));
    expect(arts[0].content).toBe('<div>plain</div>');
  });
});
