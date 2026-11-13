// Model setup uses the URI-based APIs. In Expo SDK 54 those APIs live in the
// legacy entry point; the default module exposes the newer File/Directory API.
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import {
  initModels,
  detectAndEmbedFaces,
  validateEnrollmentPhoto,
  analyzeImage,
  analyzeEnrollment,
  getEngineInfo,
  tuneBackend,
  isReady,
  type DetectionResult,
  type AnalyzeResult,
  type EnrollAnalysis,
  type EngineInfo,
} from '../../modules/face-ml/index';
import {
  buildEnrolledTemplates,
  matchGroupFaces,
  type MatchResult,
  type EnrolledStudentTemplates,
} from './matcher';

import detectorAssetModule   from '../../assets/models/scrfd_10g_kps.onnx';
import recognizerAssetModule from '../../assets/models/adaface_ir101.onnx';

const MODELS_DIR        = `${FileSystem.documentDirectory}models/`;
const DETECTOR_MODEL    = `${MODELS_DIR}scrfd_10g_kps.onnx`;
const RECOGNIZER_MODEL  = `${MODELS_DIR}adaface_ir101.onnx`;

const MIN_DETECTOR_BYTES   =  15_000_000;  // det_10g ~17MB
const MIN_RECOGNIZER_BYTES = 160_000_000;  // adaface_ir101 ~170MB

/** ONNX Runtime on Android expects a plain path, not a file:// URI. */
function toNativePath(uri: string): string {
  return uri.replace(/^file:\/\//, '');
}

let _initialized = false;
let _initializing: Promise<void> | null = null;

/** Copy bundled models from Metro assets to document directory if needed. */
async function ensureModelsExist(): Promise<{ detector: string; recognizer: string } | null> {
  await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });

  async function copyBundledAsset(
    moduleId: number,
    destPath: string,
    minBytes: number
  ): Promise<void> {
    const info = await FileSystem.getInfoAsync(destPath);
    if (info.exists && 'size' in info && info.size >= minBytes) return;

    if (info.exists) {
      await FileSystem.deleteAsync(destPath, { idempotent: true });
    }

    const asset = Asset.fromModule(moduleId);
    await asset.downloadAsync();
    if (!asset.localUri) {
      throw new Error('Failed to resolve bundled model asset. Run: npm run download-models');
    }

    await FileSystem.copyAsync({ from: asset.localUri, to: destPath });

    const copied = await FileSystem.getInfoAsync(destPath);
    if (!copied.exists || !('size' in copied) || copied.size < minBytes) {
      throw new Error(`Failed to copy model to ${destPath}`);
    }
  }

  try {
    await copyBundledAsset(detectorAssetModule, DETECTOR_MODEL, MIN_DETECTOR_BYTES);
    await copyBundledAsset(recognizerAssetModule, RECOGNIZER_MODEL, MIN_RECOGNIZER_BYTES);
    return {
      detector: toNativePath(DETECTOR_MODEL),
      recognizer: toNativePath(RECOGNIZER_MODEL),
    };
  } catch {
    return null;
  }
}

/** Initialize ONNX models. Safe to call multiple times — idempotent. */
export async function initMLModels(): Promise<void> {
  if (_initialized) return;
  if (_initializing) {
    await _initializing;
    return;
  }

  _initializing = (async () => {
    // Prefer native APK asset extraction (reliable for ~190MB models).
    // JS Metro copy is dev-client fallback only.
    try {
      await initModels('', '');
      _initialized = true;
      return;
    } catch {
      // Fall through to JS documentDirectory copy.
    }

    const paths = await ensureModelsExist();
    if (!paths) {
      throw new Error(
        'Failed to load ML models. Rebuild the app after placing .onnx files in assets/models/'
      );
    }
    await initModels(paths.detector, paths.recognizer);
    _initialized = true;
  })();

  try {
    await _initializing;
  } catch (error) {
    _initialized = false;
    throw error;
  } finally {
    _initializing = null;
  }
}

export async function checkModelsReady(): Promise<boolean> {
  if (!_initialized) {
    try {
      await initMLModels();
    } catch {
      return false;
    }
  }
  return isReady();
}

/**
 * Validate a single captured photo for enrollment.
 * Returns embedding if valid, or error message if not.
 */
export async function validateCapture(imageUri: string): Promise<{
  isValid: boolean;
  embedding?: number[];
  errorMessage?: string;
  blurScore?: number;
}> {
  await initMLModels();
  const result = await validateEnrollmentPhoto(imageUri);
  return {
    isValid: result.validation.isValid,
    embedding: result.embedding,
    errorMessage: result.validation.errorMessage,
    blurScore: result.validation.blurScore,
  };
}

export interface FaceMatchResult {
  faceIndex: number;
  box: { x: number; y: number; width: number; height: number; score: number };
  landmarks: Array<{ x: number; y: number }>;
  match: MatchResult;
  embedding: number[];
}

/**
 * Process a group photo: detect all faces, embed them, match against enrolled students.
 * Returns per-face match results.
 */
export async function processGroupPhoto(
  imageUri: string,
  rawEnrolledEmbeddings: Array<{ studentId: number; embedding: number[] }>
): Promise<{
  results: FaceMatchResult[];
  imageWidth: number;
  imageHeight: number;
}> {
  await initMLModels();
  const detection: DetectionResult = await detectAndEmbedFaces(imageUri);

  // Ignore stale embeddings from older models (e.g. MobileFaceNet 128-d).
  const validEmbeddings = rawEnrolledEmbeddings.filter(
    (row) => Array.isArray(row.embedding) && row.embedding.length === 512
  );
  if (validEmbeddings.length === 0 && rawEnrolledEmbeddings.length > 0) {
    throw new Error(
      'Stored face embeddings are from an old model. Delete and re-enroll every student, then scan again.'
    );
  }

  const enrolled = buildEnrolledTemplates(validEmbeddings);
  const matches = matchGroupFaces(
    detection.faces.map((face) => face.embedding),
    enrolled
  );

  if (__DEV__) {
    console.log(
      '[FaceML] faces=',
      detection.faces.length,
      'enrolled=',
      enrolled.length,
      'matches=',
      matches.map((m) =>
        m.type === 'unknown' ? 'unknown' : `${m.type}:${m.studentId}@${m.score.toFixed(3)}`
      )
    );
  }

  const results: FaceMatchResult[] = detection.faces.map((face, idx) => ({
    faceIndex: idx,
    box: face.box,
    landmarks: face.landmarks,
    match: matches[idx],
    embedding: face.embedding,
  }));

  return {
    results,
    imageWidth: detection.imageWidth,
    imageHeight: detection.imageHeight,
  };
}

// ─── Fast pipeline (live scan / group photo / auto-enroll) ───────────────────

export interface Gallery {
  templates: EnrolledStudentTemplates[];
  /** Median AdaFace quality of enrollment captures (-1 if unknown). */
  qualityRef: number;
}

export function buildGallery(
  rows: Array<{ studentId: number; embedding: number[]; quality?: number; source?: string }>
): Gallery {
  const valid = rows.filter(r => Array.isArray(r.embedding) && r.embedding.length === 512);
  const q = valid
    .filter(r => r.source !== 'field' && typeof r.quality === 'number' && r.quality > 0)
    .map(r => r.quality as number)
    .sort((a, b) => a - b);
  return {
    templates: buildEnrolledTemplates(valid),
    qualityRef: q.length ? q[Math.floor(q.length / 2)] : -1,
  };
}

/**
 * Live frame preset — tuned for throughput while the teacher sweeps the room:
 * aspect-correct 512px detector input, no flip, side-on and blurry faces are
 * skipped before the expensive recognizer runs (they'll be caught in a later frame).
 */
export async function analyzeLiveFrame(uri: string, skipBoxes: number[][]): Promise<AnalyzeResult> {
  return analyzeImage(uri, {
    maxDim: 1440,
    detSize: 512,
    detThreshold: 0.5,
    maxFaces: 8,
    minFaceSize: 36,
    skipBoxes,
    skipIou: 0.4,
    maxYaw: 0.55,
    blurThreshold: 18,
    flip: false,
    thumbs: true,
    deleteInput: true,
  });
}

/**
 * Group photo preset — maximum accuracy: near-full-resolution decode, tiled
 * detection (2×2 or 3×3) for back rows, a slightly lower detection threshold,
 * and flip-fused embeddings.
 */
export async function analyzeGroupPhotoRaw(uri: string): Promise<AnalyzeResult> {
  await initMLModels();
  return analyzeImage(uri, {
    maxDim: 4000,
    detSize: 640,
    tiled: true,
    detThreshold: 0.45,
    maxFaces: 150,
    minFaceSize: 20,
    flip: true,
    thumbs: true,
  });
}

export async function analyzeEnrollmentCapture(uri: string): Promise<EnrollAnalysis> {
  return analyzeEnrollment(uri, { maxDim: 1280, minFaceSize: 80, blurThreshold: 40, flip: true, deleteInput: true });
}

/** Initialise models, then pick the fastest verified backend once per device. */
export async function warmUpEngine(): Promise<EngineInfo | null> {
  try {
    await initMLModels();
    return await tuneBackend(false);
  } catch {
    return null;
  }
}

export { getEngineInfo };
export type { EngineInfo };
