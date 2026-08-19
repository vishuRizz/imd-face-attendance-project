// Model setup uses the URI-based APIs. In Expo SDK 54 those APIs live in the
// legacy entry point; the default module exposes the newer File/Directory API.
import * as FileSystem from 'expo-file-system/legacy';
import {
  initModels,
  detectAndEmbedFaces,
  validateEnrollmentPhoto,
  isReady,
  type DetectionResult,
} from '../../modules/face-ml';
import { buildEnrolledStudents, matchFace, type MatchResult } from './matcher';

const MODELS_DIR = `${FileSystem.documentDirectory}models/`;
const DETECTOR_MODEL = `${MODELS_DIR}scrfd_500m_kps.onnx`;
const RECOGNIZER_MODEL = `${MODELS_DIR}mobilefacenet.onnx`;

// Source paths — models should be bundled in assets/models/
const ASSET_DETECTOR = 'asset:/models/scrfd_500m_kps.onnx';
const ASSET_RECOGNIZER = 'asset:/models/mobilefacenet.onnx';

let _initialized = false;
let _initializing = false;

/** Copy bundled models from assets to document directory if needed */
async function ensureModelsExist(): Promise<void> {
  await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });

  const detectorInfo = await FileSystem.getInfoAsync(DETECTOR_MODEL);
  if (!detectorInfo.exists) {
    await FileSystem.copyAsync({ from: ASSET_DETECTOR, to: DETECTOR_MODEL });
  }

  const recognizerInfo = await FileSystem.getInfoAsync(RECOGNIZER_MODEL);
  if (!recognizerInfo.exists) {
    await FileSystem.copyAsync({ from: ASSET_RECOGNIZER, to: RECOGNIZER_MODEL });
  }
}

/** Initialize ONNX models. Safe to call multiple times — idempotent. */
export async function initMLModels(): Promise<void> {
  if (_initialized) return;
  if (_initializing) {
    // Wait for in-progress init
    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        if (_initialized) { clearInterval(interval); resolve(); }
      }, 100);
    });
    return;
  }

  _initializing = true;
  try {
    await ensureModelsExist();
    await initModels(DETECTOR_MODEL, RECOGNIZER_MODEL);
    _initialized = true;
  } finally {
    _initializing = false;
  }
}

export async function checkModelsReady(): Promise<boolean> {
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
  const detection: DetectionResult = await detectAndEmbedFaces(imageUri);
  const enrolled = buildEnrolledStudents(rawEnrolledEmbeddings);

  const results: FaceMatchResult[] = detection.faces.map((face, idx) => ({
    faceIndex: idx,
    box: face.box,
    landmarks: face.landmarks,
    match: matchFace(face.embedding, enrolled),
    embedding: face.embedding,
  }));

  return {
    results,
    imageWidth: detection.imageWidth,
    imageHeight: detection.imageHeight,
  };
}
