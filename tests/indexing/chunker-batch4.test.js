/**
 * Batch 4: Chunker + entity tests
 * Languages: HTML, CSS, SCSS, Less, GraphQL
 */

import { describe, it, expect } from 'vitest';
import { ASTChunker } from '../../core/indexing/ast-chunker.js';
import { GraphExtractor } from '../../core/graph/index.js';

const chunker = new ASTChunker({ projectRoot: '/test', useTreeSitter: false });
const extractor = new GraphExtractor({ projectRoot: '/test' });

function chunkSummary(chunks) {
  return chunks.map(c => ({
    type: c.metadata.chunk_type,
    name: c.metadata.symbol,
    lang: c.metadata.language,
  }));
}

// =============================================================================
// HTML (brace-based — NOTE: tracks {} not <>, so chunk boundaries are imprecise)
// =============================================================================

describe('HTML chunker', () => {
  it('chunks HTML semantic sections', async () => {
    const chunks = await chunker.parseFile('/test/page.html', [
      '<header id="top-header">',
      '  <h1>Title of the page goes here</h1>',
      '  <p>Subtitle for the header section</p>',
      '</header>',
      '<main>',
      '  <section class="content-area">',
      '    <p>Content paragraph one goes right here</p>',
      '    <p>Content paragraph two is right after</p>',
      '  </section>',
      '</main>',
    ].join('\n'));
    expect(chunks.length).toBe(4);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'section' && s.name === 'header')).toBe(true);
    expect(chunks[0].metadata.language).toBe('html');
  });

  it('chunks HTML components (uppercase tags)', async () => {
    const chunks = await chunker.parseFile('/test/app.html', [
      '<div class="app-container-wrapper">',
      '  <MyComponent prop="value" data-id="1">',
      '    <p>Some child content inside the component</p>',
      '  </MyComponent>',
      '  <AnotherWidget type="card" size="large">',
      '    <span>Widget content goes right here</span>',
      '  </AnotherWidget>',
      '</div>',
    ].join('\n'));
    expect(chunks.length).toBe(3);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'component' && s.name === 'MyComponent')).toBe(true);
    expect(summary.some(s => s.type === 'component' && s.name === 'AnotherWidget')).toBe(true);
  });
});

describe('HTML entity extraction', () => {
  it('extracts sections and external resources', async () => {
    const result = await extractor.extractFromFile('/test/index.html', [
      '<link rel="stylesheet" href="styles.css">',
      '<script src="app.js"></script>',
      '<nav id="main-nav">',
      '  <a href="/about">About</a>',
      '</nav>',
      '<form action="/api/submit">',
      '  <input type="text">',
      '</form>',
    ].join('\n'));
    expect(result.entities.length).toBe(2);
    expect(result.relationships.length).toBe(3);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'styles.css')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'app.js')).toBe(true);
  });
});

// =============================================================================
// CSS (brace-based — only named patterns like @keyframes/@layer work)
// =============================================================================

describe('CSS chunker', () => {
  it('chunks CSS @keyframes', async () => {
    const chunks = await chunker.parseFile('/test/styles.css', [
      '@keyframes fadeIn {',
      '  from { opacity: 0; transform: translateY(-10px); }',
      '  to { opacity: 1; transform: translateY(0); }',
      '}',
      '',
      '@keyframes slideUp {',
      '  0% { transform: translateY(100%); opacity: 0; }',
      '  100% { transform: translateY(0); opacity: 1; }',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'keyframes' && s.name === 'fadeIn')).toBe(true);
    expect(summary.some(s => s.type === 'keyframes' && s.name === 'slideUp')).toBe(true);
    expect(chunks[0].metadata.language).toBe('css');
  });
});

describe('CSS entity extraction', () => {
  it('extracts keyframes, selectors, variables, and imports', async () => {
    const result = await extractor.extractFromFile('/test/theme.css', [
      '@import "reset.css";',
      '',
      '--primary-color: #3498db;',
      '',
      '.button-primary { color: red; }',
      '',
      '@keyframes spin {',
      '  from { transform: rotate(0deg); }',
      '  to { transform: rotate(360deg); }',
      '}',
    ].join('\n'));
    expect(result.entities.length).toBe(3);
    expect(result.relationships.length).toBe(1);
    expect(result.entities.some(e => e.type === 'keyframes' && e.name === 'spin')).toBe(true);
    expect(result.entities.some(e => e.type === 'selector' && e.name === '.button-primary')).toBe(true);
    expect(result.entities.some(e => e.type === 'variable' && e.name === 'primary-color')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'reset.css')).toBe(true);
  });
});

// =============================================================================
// SCSS (brace-based)
// =============================================================================

describe('SCSS chunker', () => {
  it('chunks SCSS mixins and functions', async () => {
    const chunks = await chunker.parseFile('/test/utils.scss', [
      '@mixin responsive-grid($cols) {',
      '  display: grid;',
      '  grid-template-columns: repeat($cols, 1fr);',
      '  gap: 1rem;',
      '}',
      '',
      '@function darken-color($color, $amount) {',
      '  @return darken($color, $amount);',
      '  @return adjust-hue($color, 10deg);',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'mixin' && s.name === 'responsive-grid')).toBe(true);
    expect(summary.some(s => s.type === 'function' && s.name === 'darken-color')).toBe(true);
    expect(chunks[0].metadata.language).toBe('scss');
  });
});

describe('SCSS entity extraction', () => {
  it('extracts entities and relationships', async () => {
    const result = await extractor.extractFromFile('/test/main.scss', [
      '@use "variables";',
      '@forward "mixins";',
      '@import "legacy";',
      '',
      '$spacing: 1rem;',
      '',
      '@mixin card-style {',
      '  @include border-radius;',
      '  padding: $spacing;',
      '}',
    ].join('\n'));
    expect(result.entities.length).toBe(2);
    expect(result.relationships.length).toBe(4);
    expect(result.entities.some(e => e.type === 'mixin' && e.name === 'card-style')).toBe(true);
    expect(result.entities.some(e => e.type === 'variable' && e.name === 'spacing')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'variables')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'mixins')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'legacy')).toBe(true);
  });
});

// =============================================================================
// LESS (brace-based)
// =============================================================================

describe('Less chunker', () => {
  it('chunks Less mixins', async () => {
    const chunks = await chunker.parseFile('/test/lib.less', [
      '.border-radius(@radius) {',
      '  -webkit-border-radius: @radius;',
      '  -moz-border-radius: @radius;',
      '  border-radius: @radius;',
      '}',
      '',
      '.box-shadow(@x, @y, @blur) {',
      '  -webkit-box-shadow: @x @y @blur;',
      '  -moz-box-shadow: @x @y @blur;',
      '  box-shadow: @x @y @blur;',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'mixin' && s.name === 'border-radius')).toBe(true);
    expect(summary.some(s => s.type === 'mixin' && s.name === 'box-shadow')).toBe(true);
    expect(chunks[0].metadata.language).toBe('less');
  });
});

describe('Less entity extraction', () => {
  it('extracts mixins, variables, and imports', async () => {
    const result = await extractor.extractFromFile('/test/theme.less', [
      '@import "colors.less";',
      '',
      '@primary: #3498db;',
      '@font-size: 16px;',
      '',
      '.gradient(@start, @end) {',
      '  background: linear-gradient(@start, @end);',
      '}',
    ].join('\n'));
    expect(result.entities.length).toBe(3);
    expect(result.relationships.length).toBe(1);
    expect(result.entities.some(e => e.type === 'mixin' && e.name === 'gradient')).toBe(true);
    expect(result.entities.some(e => e.type === 'variable' && e.name === 'primary')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'colors.less')).toBe(true);
  });
});

// =============================================================================
// GRAPHQL (brace-based)
// =============================================================================

describe('GraphQL chunker', () => {
  it('chunks GraphQL types, inputs, and enums', async () => {
    const chunks = await chunker.parseFile('/test/schema.graphql', [
      'type User {',
      '  id: ID!',
      '  name: String!',
      '  email: String',
      '}',
      '',
      'input CreateUserInput {',
      '  name: String!',
      '  email: String!',
      '  password: String!',
      '}',
      '',
      'enum Role {',
      '  ADMIN',
      '  USER',
      '  MODERATOR',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(3);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'type' && s.name === 'User')).toBe(true);
    expect(summary.some(s => s.type === 'input' && s.name === 'CreateUserInput')).toBe(true);
    expect(summary.some(s => s.type === 'enum' && s.name === 'Role')).toBe(true);
    expect(chunks[0].metadata.language).toBe('graphql');
  });

  it('chunks GraphQL query and interface', async () => {
    const chunks = await chunker.parseFile('/test/ops.graphql', [
      'interface Node {',
      '  id: ID!',
      '  createdAt: DateTime!',
      '  updatedAt: DateTime!',
      '}',
      '',
      'query GetUsers {',
      '  users {',
      '    id',
      '    name',
      '  }',
      '}',
    ].join('\n'));
    expect(chunks.length).toBe(2);
    const summary = chunkSummary(chunks);
    expect(summary.some(s => s.type === 'interface' && s.name === 'Node')).toBe(true);
    expect(summary.some(s => s.type === 'query' && s.name === 'GetUsers')).toBe(true);
  });
});

describe('GraphQL entity extraction', () => {
  it('extracts types and implements relationship', async () => {
    const result = await extractor.extractFromFile('/test/types.graphql', [
      'type Post implements Node {',
      '  id: ID!',
      '  title: String!',
      '  content: String',
      '}',
      '',
      'scalar DateTime',
    ].join('\n'));
    expect(result.entities.length).toBe(2);
    expect(result.relationships.length).toBe(1);
    expect(result.entities.some(e => e.type === 'type' && e.name === 'Post')).toBe(true);
    expect(result.entities.some(e => e.type === 'scalar' && e.name === 'DateTime')).toBe(true);
    expect(result.relationships.some(r => r.type === 'implements' && r.target_name.includes('Node'))).toBe(true);
  });
});
