#!/usr/bin/env node
/** Recreate android/local.properties (wiped by `expo prebuild --clean`). */
const fs = require('fs');
const path = require('path');

const sdkDir =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  path.join(process.env.HOME || '', 'Library', 'Android', 'sdk');

const out = path.join(__dirname, '..', 'android', 'local.properties');

if (!fs.existsSync(sdkDir)) {
  console.error(`Android SDK not found at: ${sdkDir}`);
  console.error('Install Android Studio or set ANDROID_HOME, then rerun.');
  process.exit(1);
}

if (!fs.existsSync(path.dirname(out))) {
  console.error('android/ folder missing. Run: npx expo prebuild --platform android');
  process.exit(1);
}

fs.writeFileSync(out, `sdk.dir=${sdkDir}\n`);
console.log(`Wrote ${out} → sdk.dir=${sdkDir}`);
