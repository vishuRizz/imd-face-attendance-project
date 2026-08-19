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
  embedding: number[];   // 512-dim MobileFaceNet embedding (L2-normalized)
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
