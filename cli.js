#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { buildReviewPage } = require('./generator.js');

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  console.log(`
  Copy Review Generator CLI

  Usage:
    node cli.js <input> [options]

  Input:
    URL (https://...)   Fetches the page and generates a review file
    file.html           Reads a local HTML file

  Options:
    -o, --output <file>   Output file path (default: review-output.html)
    -h, --help            Show this help

  Examples:
    node cli.js https://example.com/sales -o review.html
    node cli.js ./my-page.html -o review.html
    node cli.js ./my-page.html > review.html
  `);
  process.exit(0);
}

const input = args[0];
let outputFile = 'review-output.html';

const outIdx = args.indexOf('-o') !== -1 ? args.indexOf('-o') : args.indexOf('--output');
if (outIdx !== -1 && args[outIdx + 1]) {
  outputFile = args[outIdx + 1];
}

async function run() {
  let html = '';

  if (input.startsWith('http://') || input.startsWith('https://')) {
    console.error('Fetching ' + input + '...');
    const resp = await fetch(input, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
      redirect: 'follow',
    });
    if (!resp.ok) {
      console.error('Failed to fetch: ' + resp.status);
      process.exit(1);
    }
    html = await resp.text();
  } else {
    const filePath = path.resolve(input);
    if (!fs.existsSync(filePath)) {
      console.error('File not found: ' + filePath);
      process.exit(1);
    }
    html = fs.readFileSync(filePath, 'utf-8');
  }

  console.error('Processing...');
  const result = buildReviewPage(html);
  console.error('Tagged ' + result.count + ' elements');

  // If stdout is piped, write to stdout; otherwise write to file
  if (outIdx !== -1) {
    fs.writeFileSync(outputFile, result.html, 'utf-8');
    console.error('Saved to ' + outputFile);
  } else {
    process.stdout.write(result.html);
  }
}

run().catch(function(err) {
  console.error('Error: ' + err.message);
  process.exit(1);
});
