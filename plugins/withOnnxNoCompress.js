const { withAppBuildGradle } = require('@expo/config-plugins');

/** Ensure ONNX models in the app APK are stored uncompressed (required for large models). */
module.exports = function withOnnxNoCompress(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    let contents = gradleConfig.modResults.contents;

    if (contents.includes("noCompress += ['onnx']") || contents.includes('noCompress "onnx"')) {
      return gradleConfig;
    }

    if (contents.includes('androidResources {')) {
      contents = contents.replace(
        /androidResources\s*\{/,
        "androidResources {\n        noCompress += ['onnx']"
      );
    } else {
      contents = contents.replace(
        /android\s*\{/,
        `android {
    androidResources {
        noCompress += ['onnx']
    }`
      );
    }

    gradleConfig.modResults.contents = contents;
    return gradleConfig;
  });
};
