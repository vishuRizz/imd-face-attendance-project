#!/usr/bin/env node
/**
 * Downloads ONNX models into assets/models/ (not committed — too large for GitHub).
 * Run: npm run download-models
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODELS_DIR = path.join(ROOT, 'assets', 'models');

const MODELS = [
  {
    destName: 'scrfd_10g_kps.onnx',
    url: 'https://github.com/yakhyo/adaface-onnx/releases/download/weights/det_10g.onnx',
  },
  {
    destName: 'adaface_ir101.onnx',
    url: 'https://github.com/yakhyo/adaface-onnx/releases/download/weights/adaface_ir_101.onnx',
  },
];

fs.mkdirSync(MODELS_DIR, { recursive: true });

for (const { destName, url } of MODELS) {
  const dest = path.join(MODELS_DIR, destName);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) {
    console.log(`Already present: ${destName}`);
    continue;
  }
  console.log(`Downloading ${destName}...`);
  execSync(`curl -L --fail --retry 3 -o "${dest}" "${url}"`, { stdio: 'inherit' });
}

console.log('Done. Models saved to assets/models/ (gitignored).');
