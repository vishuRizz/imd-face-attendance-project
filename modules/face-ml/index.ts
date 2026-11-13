import FaceMLModule from './src/FaceMLModule';

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  score: number;
}

export interface Landmark {
  x: number;
  y: number;
}

export interface DetectedFace {
  box: FaceBox;
  landmarks: Landmark[]; // 5 points: left_eye, right_eye, nose, left_mouth, right_mouth
  embedding: number[];   // 512-dim AdaFace IR-101 embedding (L2-normalized)
  isBlurry: boolean;
  blurScore: number;     // Laplacian variance — higher = sharper
}

export interface DetectionResult {
  faces: DetectedFace[];
  imageWidth: number;
  imageHeight: number;
}

export interface EnrollmentValidation {
  isValid: boolean;
  faceCount: number;
  isBlurry: boolean;
  blurScore: number;
  isFaceTooSmall: boolean;
  errorMessage?: string;
}

/**
 * Initialize the ML models. Must be called once before detection.
 * Models must be placed at the paths specified.
 *
 * @param detectorModelPath - Path to SCRFD ONNX model (e.g., in assets/)
 * @param recognizerModelPath - Path to MobileFaceNet ONNX model
 */
export async function initModels(
  detectorModelPath: string,
  recognizerModelPath: string
): Promise<void> {
  return FaceMLModule.initModels(detectorModelPath, recognizerModelPath);
}

/**
 * Detect all faces in an image and generate embeddings for each.
 * Suitable for group photos during attendance scanning.
 *
 * @param imageUri - file:// URI of the image
 * @returns DetectionResult with all detected faces and their embeddings
 */
export async function detectAndEmbedFaces(imageUri: string): Promise<DetectionResult> {
  return FaceMLModule.detectAndEmbedFaces(imageUri);
}

/**
 * Validate an image for enrollment (single-face, not blurry, face large enough).
 * Also returns the embedding if valid.
 *
 * @param imageUri - file:// URI of the captured photo
 */
export async function validateEnrollmentPhoto(imageUri: string): Promise<{
  validation: EnrollmentValidation;
  embedding?: number[];
}> {
  return FaceMLModule.validateEnrollmentPhoto(imageUri);
}

/**
 * Check if models are loaded and ready.
 */
export async function isReady(): Promise<boolean> {
  return FaceMLModule.isReady();
}

// ─── Fast analysis APIs (live scan, group photos, auto-enrollment) ───────────

export type AnalyzedFaceStatus = 'embedded' | 'skipped' | 'small' | 'deferred' | 'blurry' | 'pose';

export interface AnalyzedFace {
  box: FaceBox;
  landmarks: Landmark[];
  status: AnalyzedFaceStatus;
  /** Head yaw in eye-distance units (0 = frontal). */
  yaw: number;
  embedding?: number[];
  /** AdaFace feature norm — higher means a cleaner, more identifiable face (-1 if unavailable). */
  quality?: number;
  sharpness?: number;
  thumbUri?: string;
}

export interface AnalyzeResult {
  faces: AnalyzedFace[];
  imageWidth: number;
  imageHeight: number;
  timings: { decodeMs: number; detectMs: number; embedMs: number; totalMs: number };
}

export interface AnalyzeOptions {
  maxDim?: number;
  detSize?: number;
  tiled?: boolean;
  detThreshold?: number;
  maxFaces?: number;
  minFaceSize?: number;
  /** Normalised [x, y, w, h] boxes to skip embedding for. */
  skipBoxes?: number[][];
  skipIou?: number;
  blurThreshold?: number;
  maxYaw?: number;
  flip?: boolean;
  thumbs?: boolean;
  deleteInput?: boolean;
}

export async function analyzeImage(imageUri: string, options: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  return FaceMLModule.analyzeImage(imageUri, options);
}

export type EnrollReason = 'ok' | 'no_face' | 'multiple' | 'too_small' | 'blurry';

export interface EnrollAnalysis {
  reason: EnrollReason;
  faceCount: number;
  imageWidth: number;
  imageHeight: number;
  box?: FaceBox;
  landmarks?: Landmark[];
  yaw?: number;
  embedding?: number[];
  quality?: number;
  sharpness?: number;
  thumbUri?: string;
}

export interface EnrollOptions {
  maxDim?: number;
  minFaceSize?: number;
  blurThreshold?: number;
  flip?: boolean;
  deleteInput?: boolean;
}

export async function analyzeEnrollment(imageUri: string, options: EnrollOptions = {}): Promise<EnrollAnalysis> {
  return FaceMLModule.analyzeEnrollment(imageUri, options);
}

export interface EngineInfo {
  backend: 'cpu' | 'xnnpack' | 'nnapi' | 'none';
  threads?: number;
  qualityAvailable?: boolean;
  recognizerMs?: number;
  benchmarks?: Record<string, number>;
}

export async function getEngineInfo(): Promise<EngineInfo> {
  return FaceMLModule.getEngineInfo();
}

/** Pick the fastest verified inference backend for this phone (persisted; runs once). */
export async function tuneBackend(force = false): Promise<EngineInfo> {
  return FaceMLModule.tuneBackend(force);
}
