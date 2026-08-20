const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

/** Write android/local.properties after prebuild so Gradle finds the SDK. */
module.exports = function withAndroidSdk(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const localPropsPath = path.join(projectRoot, 'android', 'local.properties');

      const sdkDir =
        process.env.ANDROID_HOME ||
        process.env.ANDROID_SDK_ROOT ||
        path.join(process.env.HOME || '', 'Library', 'Android', 'sdk');

      if (!fs.existsSync(sdkDir)) {
        console.warn(
          `[withAndroidSdk] Android SDK not found at ${sdkDir}. ` +
            'Set ANDROID_HOME or create android/local.properties manually.'
        );
        return cfg;
      }

      fs.writeFileSync(localPropsPath, `sdk.dir=${sdkDir}\n`);
      return cfg;
    },
  ]);
};
