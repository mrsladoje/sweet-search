/**
 * Entity Extraction Batch 4 Tests
 *
 * Tests for graph-extractor.js extractGeneric() method for web and config languages:
 * - HTML: sections, components, ids, links, scripts
 * - CSS: keyframes, selectors, variables, imports
 * - SCSS: mixins, functions, variables, use/forward/import
 * - LESS: mixins, variables, imports
 * - YAML: top keys, anchors, aliases, refs
 * - TOML: sections, arrays, key-value pairs
 * - XML: elements, namespaces, imports, refs
 * - Dockerfile: stages, args, env, expose, from, copy-from
 * - Makefile: targets, variables, includes
 */

import { describe, it, expect } from 'vitest';
import GraphExtractor from '../core/graph-extractor.js';

const extractor = new GraphExtractor({ projectRoot: '/test' });

// =============================================================================
// HTML
// =============================================================================

describe('HTML', () => {
  it('extracts sections and components', async () => {
    const result = await extractor.extractFromFile('/test/page.html', `
<html>
<head>
  <link rel="stylesheet" href="styles.css">
  <script src="app.js"></script>
</head>
<body>
  <header id="main-header">
    <nav>Navigation</nav>
  </header>
  <main>
    <section id="content">
      <MyComponent />
      <form action="/submit">
        <input type="text">
      </form>
    </section>
  </main>
</body>
</html>
`);
    expect(result.entities.some(e => e.type === 'section' && e.name === 'header')).toBe(true);
    expect(result.entities.some(e => e.type === 'section' && e.name === 'nav')).toBe(true);
    expect(result.entities.some(e => e.type === 'section' && e.name === 'main')).toBe(true);
    expect(result.entities.some(e => e.type === 'section' && e.name === 'section')).toBe(true);
    expect(result.entities.some(e => e.type === 'section' && e.name === 'form')).toBe(true);
    expect(result.entities.some(e => e.type === 'component' && e.name === 'MyComponent')).toBe(true);
  });

  it('extracts HTML relationships', async () => {
    const result = await extractor.extractFromFile('/test/page.html', `
<html>
<head>
  <link rel="stylesheet" href="styles.css">
  <script src="app.js"></script>
</head>
<body>
  <header id="main-header">
    <nav>Navigation</nav>
  </header>
  <main>
    <section id="content">
      <MyComponent />
      <form action="/submit">
        <input type="text">
      </form>
    </section>
  </main>
</body>
</html>
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'styles.css')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'app.js')).toBe(true);
    expect(result.relationships.some(r => r.type === 'uses' && r.target_name === '/submit')).toBe(true);
  });
});

// =============================================================================
// CSS
// =============================================================================

describe('CSS', () => {
  it('extracts keyframes, selectors, and variables', async () => {
    const result = await extractor.extractFromFile('/test/styles.css', `
@import "reset.css";
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
:root {
  --primary-color: #333;
  --font-size: 16px;
}
.container {
  color: var(--primary-color);
}
#header {
  font-size: var(--font-size);
}
`);
    expect(result.entities.some(e => e.type === 'keyframes' && e.name === 'fadeIn')).toBe(true);
    expect(result.entities.some(e => e.type === 'variable' && e.name === 'primary-color')).toBe(true);
    expect(result.entities.some(e => e.type === 'variable' && e.name === 'font-size')).toBe(true);
    expect(result.entities.some(e => e.type === 'selector' && e.name === '.container')).toBe(true);
    expect(result.entities.some(e => e.type === 'selector' && e.name === '#header')).toBe(true);
  });

  it('extracts CSS imports', async () => {
    const result = await extractor.extractFromFile('/test/styles.css', `
@import "reset.css";
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
:root {
  --primary-color: #333;
  --font-size: 16px;
}
.container {
  color: var(--primary-color);
}
#header {
  font-size: var(--font-size);
}
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'reset.css')).toBe(true);
  });
});

// =============================================================================
// SCSS
// =============================================================================

describe('SCSS', () => {
  it('extracts mixins, functions, and variables', async () => {
    const result = await extractor.extractFromFile('/test/styles.scss', `
@use "variables";
@forward "mixins";
@import "legacy";
$primary: #333;
@mixin flex-center {
  display: flex;
  align-items: center;
}
@function double($n) {
  @return $n * 2;
}
.card {
  @include flex-center;
  @extend .base-card;
}
`);
    expect(result.entities.some(e => e.type === 'variable' && e.name === 'primary')).toBe(true);
    expect(result.entities.some(e => e.type === 'mixin' && e.name === 'flex-center')).toBe(true);
    expect(result.entities.some(e => e.type === 'function' && e.name === 'double')).toBe(true);
  });

  it('extracts SCSS relationships', async () => {
    const result = await extractor.extractFromFile('/test/styles.scss', `
@use "variables";
@forward "mixins";
@import "legacy";
$primary: #333;
@mixin flex-center {
  display: flex;
  align-items: center;
}
@function double($n) {
  @return $n * 2;
}
.card {
  @include flex-center;
  @extend .base-card;
}
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'variables')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'mixins')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'legacy')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'flex-center')).toBe(true);
    expect(result.relationships.some(r => r.type === 'uses' && r.target_name === '.base-card')).toBe(true);
  });
});

// =============================================================================
// LESS
// =============================================================================

describe('LESS', () => {
  it('extracts mixins and variables', async () => {
    const result = await extractor.extractFromFile('/test/styles.less', `
@import "variables.less";
@primary: #333;
@font-size: 16px;
.rounded(@radius) {
  border-radius: @radius;
}
`);
    expect(result.entities.some(e => e.type === 'variable' && e.name === 'primary')).toBe(true);
    expect(result.entities.some(e => e.type === 'variable' && e.name === 'font-size')).toBe(true);
    expect(result.entities.some(e => e.type === 'mixin' && e.name === 'rounded')).toBe(true);
  });

  it('extracts LESS imports', async () => {
    const result = await extractor.extractFromFile('/test/styles.less', `
@import "variables.less";
@primary: #333;
@font-size: 16px;
.rounded(@radius) {
  border-radius: @radius;
}
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'variables.less')).toBe(true);
  });
});

// =============================================================================
// YAML
// =============================================================================

describe('YAML', () => {
  it('extracts top-level keys', async () => {
    const result = await extractor.extractFromFile('/test/config.yml', `
name: my-service
version: 1.0.0
defaults: &defaults
  timeout: 30
  retries: 3
production:
  <<: *defaults
  host: prod.example.com
api:
  schema:
    $ref: './schema.yaml#/definitions/User'
`);
    expect(result.entities.some(e => e.type === 'topKey' && e.name === 'name')).toBe(true);
    expect(result.entities.some(e => e.type === 'topKey' && e.name === 'version')).toBe(true);
    expect(result.entities.some(e => e.type === 'topKey' && e.name === 'defaults')).toBe(true);
    expect(result.entities.some(e => e.type === 'topKey' && e.name === 'production')).toBe(true);
    expect(result.entities.some(e => e.type === 'topKey' && e.name === 'api')).toBe(true);
  });

  it('extracts YAML relationships', async () => {
    const result = await extractor.extractFromFile('/test/config.yml', `
name: my-service
version: 1.0.0
defaults: &defaults
  timeout: 30
  retries: 3
production:
  <<: *defaults
  host: prod.example.com
api:
  schema:
    $ref: './schema.yaml#/definitions/User'
`);
    expect(result.relationships.some(r => r.type === 'uses' && r.target_name === 'defaults')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'defaults')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === './schema.yaml')).toBe(true);
  });
});

// =============================================================================
// TOML
// =============================================================================

describe('TOML', () => {
  it('extracts sections, arrays, and key-value pairs', async () => {
    const result = await extractor.extractFromFile('/test/config.toml', `
[package]
name = "my-app"
version = "1.0.0"

[[dependencies]]
name = "serde"
version = "1.0"

[build]
target = "release"
`);
    expect(result.entities.some(e => e.type === 'section' && e.name === 'package')).toBe(true);
    expect(result.entities.some(e => e.type === 'keyVal' && e.name === 'name')).toBe(true);
    expect(result.entities.some(e => e.type === 'keyVal' && e.name === 'version')).toBe(true);
    expect(result.entities.some(e => e.type === 'array' && e.name === 'dependencies')).toBe(true);
    expect(result.entities.some(e => e.type === 'section' && e.name === 'build')).toBe(true);
    expect(result.entities.some(e => e.type === 'keyVal' && e.name === 'target')).toBe(true);
  });
});

// =============================================================================
// XML
// =============================================================================

describe('XML', () => {
  it('extracts elements', async () => {
    const result = await extractor.extractFromFile('/test/schema.xml', `
<schema xmlns="http://www.w3.org/2001/XMLSchema"
        xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:import schemaLocation="types.xsd"/>
  <xs:element name="user" ref="userType">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="name" type="string"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</schema>
`);
    expect(result.entities.some(e => e.type === 'element' && e.name === 'schema')).toBe(true);
    expect(result.entities.some(e => e.type === 'element' && e.name === 'xs:import')).toBe(true);
    expect(result.entities.some(e => e.type === 'element' && e.name === 'xs:element')).toBe(true);
    expect(result.entities.some(e => e.type === 'element' && e.name === 'xs:complexType')).toBe(true);
    expect(result.entities.some(e => e.type === 'element' && e.name === 'xs:sequence')).toBe(true);
  });

  it('extracts XML relationships', async () => {
    const result = await extractor.extractFromFile('/test/schema.xml', `
<schema xmlns="http://www.w3.org/2001/XMLSchema"
        xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:import schemaLocation="types.xsd"/>
  <xs:element name="user" ref="userType">
    <xs:complexType>
      <xs:sequence>
        <xs:element name="name" type="string"/>
      </xs:sequence>
    </xs:complexType>
  </xs:element>
</schema>
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'http://www.w3.org/2001/XMLSchema')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'types.xsd')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'userType')).toBe(true);
  });
});

// =============================================================================
// Dockerfile
// =============================================================================

describe('Dockerfile', () => {
  it('extracts stages, args, env, and expose', async () => {
    const result = await extractor.extractFromFile('/test/Dockerfile', `
FROM node:18-alpine AS builder
ARG NODE_ENV=production
ENV APP_PORT=3000
COPY --from=builder /app/dist /app
EXPOSE 3000
CMD ["node", "server.js"]
`);
    expect(result.entities.some(e => e.type === 'stage' && e.name === 'builder')).toBe(true);
    expect(result.entities.some(e => e.type === 'arg' && e.name === 'NODE_ENV')).toBe(true);
    expect(result.entities.some(e => e.type === 'env' && e.name === 'APP_PORT')).toBe(true);
    expect(result.entities.some(e => e.type === 'expose' && e.name === '3000')).toBe(true);
  });

  it('extracts Dockerfile relationships', async () => {
    const result = await extractor.extractFromFile('/test/Dockerfile', `
FROM node:18-alpine AS builder
ARG NODE_ENV=production
ENV APP_PORT=3000
COPY --from=builder /app/dist /app
EXPOSE 3000
CMD ["node", "server.js"]
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'node:18-alpine')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'builder')).toBe(true);
  });

  it('extracts platform-prefixed Dockerfile FROM and stage', async () => {
    const result = await extractor.extractFromFile('/test/Dockerfile', `
FROM --platform=\$BUILDPLATFORM node:20-alpine AS builder
COPY --from=builder /app /app
`);
    expect(result.entities.some(e => e.type === 'stage' && e.name === 'builder')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'node:20-alpine')).toBe(true);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'builder')).toBe(true);
  });
});

// =============================================================================
// Makefile
// =============================================================================

describe('Makefile', () => {
  it('extracts targets and variables', async () => {
    const result = await extractor.extractFromFile('/test/Makefile', `
CC = gcc
CFLAGS = -Wall

-include config.mk

all: build test

build:
	$(CC) $(CFLAGS) -o app main.c

clean:
	rm -f app
`);
    expect(result.entities.some(e => e.type === 'variable' && e.name === 'CC')).toBe(true);
    expect(result.entities.some(e => e.type === 'variable' && e.name === 'CFLAGS')).toBe(true);
    expect(result.entities.some(e => e.type === 'target' && e.name === 'all')).toBe(true);
    expect(result.entities.some(e => e.type === 'target' && e.name === 'build')).toBe(true);
    expect(result.entities.some(e => e.type === 'target' && e.name === 'clean')).toBe(true);
  });

  it('extracts Makefile includes', async () => {
    const result = await extractor.extractFromFile('/test/Makefile', `
CC = gcc
CFLAGS = -Wall

-include config.mk

all: build test

build:
	$(CC) $(CFLAGS) -o app main.c

clean:
	rm -f app
`);
    expect(result.relationships.some(r => r.type === 'imports' && r.target_name === 'config.mk')).toBe(true);
  });
});
