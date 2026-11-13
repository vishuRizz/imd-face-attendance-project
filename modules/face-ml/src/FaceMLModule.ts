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
  getEngineInfo: async () => ({ backend: 'none' }),
  tuneBackend: async (_force: boolean) => ({ backend: 'none' }),
  analyzeImage: async (_uri: string, _options: unknown) => ({
    faces: [],
    imageWidth: 0,
    imageHeight: 0,
    timings: { decodeMs: 0, detectMs: 0, embedMs: 0, totalMs: 0 },
  }),
  analyzeEnrollment: async (_uri: string, _options: unknown) => ({
    reason: 'no_face',
    faceCount: 0,
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

