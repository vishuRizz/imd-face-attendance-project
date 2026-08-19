/**
 * JS stub for the FaceML native module.
 * On Android it resolves to the Kotlin FaceMLModule via expo-modules-core.
 * On other platforms it provides no-op stubs to avoid crashes.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

const nativeModule = requireOptionalNativeModule('FaceMLModule');

const FaceMLModule = nativeModule ?? {
  initModels: async () => {
    console.warn('FaceMLModule: native module not available on this platform');
  },
  isReady: async () => false,
  detectAndEmbedFaces: async (_uri: string) => ({
    faces: [],
    imageWidth: 0,
    imageHeight: 0,
  }),
  validateEnrollmentPhoto: async (_uri: string) => ({
    validation: {
      isValid: false,
      faceCount: 0,
      isBlurry: false,
      blurScore: 0,
      isFaceTooSmall: false,
      errorMessage: 'Native ML module not available on this platform.',
    },
  }),
};

export default FaceMLModule;

