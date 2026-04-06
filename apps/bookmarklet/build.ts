/**
 * build.ts
 *
 * Bundles src/index.ts into a single minified IIFE.
 * Outputs:
 *   dist/bookmarklet.js       — raw minified bundle (for inspection)
 *   dist/bookmarklet-url.txt  — javascript: URL to paste as a browser bookmark
 *
 * SERVER_URL env var overrides the default Render deployment URL.
 */
import * as esbuild from 'esbuild';
import { writeFileSync, mkdirSync } from 'fs';

const SERVER_URL =
  process.env.SERVER_URL || 'https://inspect-to-explain-agent.onrender.com';

async function build() {
  const result = await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    minify: true,
    format: 'iife',
    // Replace the declare constant at build time — no runtime dependency on process.env
    define: {
      __SERVER_URL__: JSON.stringify(SERVER_URL),
    },
    write: false,
  });

  mkdirSync('dist', { recursive: true });

  const code = result.outputFiles[0].text;
  writeFileSync('dist/bookmarklet.js', code);

  // The esbuild IIFE (`"use strict";(()=>{...})()`) returns undefined,
  // so the browser won't navigate away. No void() wrapper needed —
  // wrapping would create `void("use strict";...)` which is a syntax error.
  const bookmarkletUrl = `javascript:${encodeURIComponent(code)}`;
  writeFileSync('dist/bookmarklet-url.txt', bookmarkletUrl);

  const kb = (code.length / 1024).toFixed(1);
  console.log(`✅  dist/bookmarklet.js        (${kb} KB)`);
  console.log(`✅  dist/bookmarklet-url.txt`);
  console.log(`\nServer URL: ${SERVER_URL}`);
  console.log(`\nInstall:  Copy the content of dist/bookmarklet-url.txt.`);
  console.log(`          In your browser, create a new bookmark and paste it as the URL.`);
  console.log(`          Click the bookmark on any page to activate inspect mode.`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
