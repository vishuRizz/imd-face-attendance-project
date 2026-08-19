package expo.modules.faceml

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.PointF
import android.graphics.RectF
import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.io.File
import java.io.FileInputStream
import java.nio.FloatBuffer
import kotlin.math.sqrt
import kotlin.math.max
import kotlin.math.min

class FaceMLModule : Module() {

    private var ortEnvironment: OrtEnvironment? = null
    private var detectorSession: OrtSession? = null
    private var recognizerSession: OrtSession? = null
    private var isInitialized = false

    // SCRFD input size
    private val DETECTOR_INPUT_SIZE = 640
    private val DETECTOR_MEAN = floatArrayOf(127.5f, 127.5f, 127.5f)
    private val DETECTOR_STD = floatArrayOf(128.0f, 128.0f, 128.0f)

    // MobileFaceNet input size
    private val RECOGNIZER_INPUT_SIZE = 112
    private val RECOGNIZER_MEAN = floatArrayOf(127.5f, 127.5f, 127.5f)
    private val RECOGNIZER_STD = floatArrayOf(128.0f, 128.0f, 128.0f)

    // Detection thresholds
    private val CONFIDENCE_THRESHOLD = 0.5f
    private val NMS_THRESHOLD = 0.4f
    private val MIN_FACE_SIZE = 40 // pixels

    // Blur detection threshold (Laplacian variance)
    private val BLUR_THRESHOLD = 100.0

    override fun definition() = ModuleDefinition {
        Name("FaceMLModule")

        AsyncFunction("initModels") { detectorPath: String, recognizerPath: String, promise: Promise ->
            try {
                ortEnvironment = OrtEnvironment.getEnvironment()
                val sessionOptions = OrtSession.SessionOptions().apply {
                    addConfigEntry("session.inter_op_num_threads", "2")
                    addConfigEntry("session.intra_op_num_threads", "2")
                }

                detectorSession = ortEnvironment!!.createSession(detectorPath, sessionOptions)
                recognizerSession = ortEnvironment!!.createSession(recognizerPath, sessionOptions)
                isInitialized = true
                promise.resolve(null)
            } catch (e: Exception) {
                promise.reject("INIT_ERROR", "Failed to initialize models: ${e.message}", e)
            }
        }

        AsyncFunction("isReady") { promise: Promise ->
            promise.resolve(isInitialized)
        }

        AsyncFunction("detectAndEmbedFaces") { imageUri: String, promise: Promise ->
            if (!isInitialized) {
                promise.reject("NOT_INITIALIZED", "Models not initialized. Call initModels first.", null)
                return@AsyncFunction
            }
            try {
                val bitmap = loadBitmap(imageUri)
                    ?: throw Exception("Failed to load image: $imageUri")

                val faces = detectFaces(bitmap)
                val result = mutableListOf<Map<String, Any>>()

                for (face in faces) {
                    val aligned = alignFace(bitmap, face.landmarks)
                    val embedding = generateEmbedding(aligned)
                    val blurScore = computeBlurScore(aligned)

                    result.add(mapOf(
                        "box" to mapOf(
                            "x" to face.box.left.toDouble(),
                            "y" to face.box.top.toDouble(),
                            "width" to face.box.width().toDouble(),
                            "height" to face.box.height().toDouble(),
                            "score" to face.score.toDouble()
                        ),
                        "landmarks" to face.landmarks.map { pt ->
                            mapOf("x" to pt.x.toDouble(), "y" to pt.y.toDouble())
                        },
                        "embedding" to embedding.toList(),
                        "isBlurry" to (blurScore < BLUR_THRESHOLD),
                        "blurScore" to blurScore
                    ))
                }

                promise.resolve(mapOf(
                    "faces" to result,
                    "imageWidth" to bitmap.width,
                    "imageHeight" to bitmap.height
                ))
            } catch (e: Exception) {
                promise.reject("DETECTION_ERROR", e.message ?: "Unknown error", e)
            }
        }

        AsyncFunction("validateEnrollmentPhoto") { imageUri: String, promise: Promise ->
            if (!isInitialized) {
                promise.reject("NOT_INITIALIZED", "Models not initialized. Call initModels first.", null)
                return@AsyncFunction
            }
            try {
                val bitmap = loadBitmap(imageUri)
                    ?: throw Exception("Failed to load image: $imageUri")

                val faces = detectFaces(bitmap)
                val faceCount = faces.size

                val validation = mutableMapOf<String, Any>()
                var embedding: List<Double>? = null

                when {
                    faceCount == 0 -> {
                        validation["isValid"] = false
                        validation["faceCount"] = 0
                        validation["isBlurry"] = false
                        validation["blurScore"] = 0.0
                        validation["isFaceTooSmall"] = false
                        validation["errorMessage"] = "No face detected. Please look at the camera."
                    }
                    faceCount > 1 -> {
                        validation["isValid"] = false
                        validation["faceCount"] = faceCount
                        validation["isBlurry"] = false
                        validation["blurScore"] = 0.0
                        validation["isFaceTooSmall"] = false
                        validation["errorMessage"] = "Multiple faces detected. Only one person should be in frame."
                    }
                    else -> {
                        val face = faces[0]
                        val faceWidth = face.box.width()
                        val isFaceTooSmall = faceWidth < MIN_FACE_SIZE

                        val aligned = alignFace(bitmap, face.landmarks)
                        val blurScore = computeBlurScore(aligned)
                        val isBlurry = blurScore < BLUR_THRESHOLD

                        when {
                            isFaceTooSmall -> {
                                validation["isValid"] = false
                                validation["faceCount"] = 1
                                validation["isBlurry"] = isBlurry
                                validation["blurScore"] = blurScore
                                validation["isFaceTooSmall"] = true
                                validation["errorMessage"] = "Face is too small. Please move closer to the camera."
                            }
                            isBlurry -> {
                                validation["isValid"] = false
                                validation["faceCount"] = 1
                                validation["isBlurry"] = true
                                validation["blurScore"] = blurScore
                                validation["isFaceTooSmall"] = false
                                validation["errorMessage"] = "Image is blurry. Please hold still and capture again."
                            }
                            else -> {
                                val emb = generateEmbedding(aligned)
                                embedding = emb.toList()
                                validation["isValid"] = true
                                validation["faceCount"] = 1
                                validation["isBlurry"] = false
                                validation["blurScore"] = blurScore
                                validation["isFaceTooSmall"] = false
                            }
                        }
                    }
                }

                val result = mutableMapOf<String, Any>("validation" to validation)
                if (embedding != null) result["embedding"] = embedding
                promise.resolve(result)

            } catch (e: Exception) {
                promise.reject("VALIDATION_ERROR", e.message ?: "Unknown error", e)
            }
        }
    }

    // ─── Private: Image Loading ───────────────────────────────────────────────

    private fun loadBitmap(uriStr: String): Bitmap? {
        return try {
            val uri = Uri.parse(uriStr)
            val inputStream = appContext.reactContext?.contentResolver?.openInputStream(uri)
                ?: FileInputStream(File(uri.path ?: return null))
            BitmapFactory.decodeStream(inputStream)
        } catch (e: Exception) {
            null
        }
    }

    // ─── Private: SCRFD Face Detection ───────────────────────────────────────

    data class FaceDetection(
        val box: RectF,
        val landmarks: List<PointF>,
        val score: Float
    )

    private fun detectFaces(bitmap: Bitmap): List<FaceDetection> {
        val session = detectorSession ?: return emptyList()
        val env = ortEnvironment ?: return emptyList()

        // Resize and pad image to detector input size
        val (resized, scale, padX, padY) = letterboxResize(bitmap, DETECTOR_INPUT_SIZE)

        // Convert bitmap to NCHW float tensor [1, 3, 640, 640]
        val inputArray = bitmapToNCHW(resized, DETECTOR_MEAN, DETECTOR_STD)
        val inputShape = longArrayOf(1, 3, DETECTOR_INPUT_SIZE.toLong(), DETECTOR_INPUT_SIZE.toLong())
        val inputTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(inputArray), inputShape)

        val inputName = session.inputNames.iterator().next()
        val outputs = session.run(mapOf(inputName to inputTensor))

        // Parse SCRFD outputs: boxes, scores, landmarks
        // SCRFD with KPS outputs: [num_boxes, 4] boxes, [num_boxes, 1] scores, [num_boxes, 10] landmarks
        val faces = parseSCRFDOutput(outputs, scale, padX, padY, bitmap.width, bitmap.height)

        inputTensor.close()
        outputs.close()

        return nonMaxSuppression(faces, NMS_THRESHOLD)
    }

    private data class LetterboxResult(
        val bitmap: Bitmap,
        val scale: Float,
        val padX: Int,
        val padY: Int
    )

    private fun letterboxResize(bitmap: Bitmap, targetSize: Int): LetterboxResult {
        val scale = min(
            targetSize.toFloat() / bitmap.width,
            targetSize.toFloat() / bitmap.height
        )
        val scaledW = (bitmap.width * scale).toInt()
        val scaledH = (bitmap.height * scale).toInt()
        val padX = (targetSize - scaledW) / 2
        val padY = (targetSize - scaledH) / 2

        val result = Bitmap.createBitmap(targetSize, targetSize, Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(result)
        canvas.drawColor(android.graphics.Color.rgb(127, 127, 127)) // gray padding
        val scaled = Bitmap.createScaledBitmap(bitmap, scaledW, scaledH, true)
        canvas.drawBitmap(scaled, padX.toFloat(), padY.toFloat(), null)
        scaled.recycle()

        return LetterboxResult(result, scale, padX, padY)
    }

    private fun bitmapToNCHW(bitmap: Bitmap, mean: FloatArray, std: FloatArray): FloatArray {
        val w = bitmap.width
        val h = bitmap.height
        val pixels = IntArray(w * h)
        bitmap.getPixels(pixels, 0, w, 0, 0, w, h)

        val result = FloatArray(3 * h * w)
        val area = h * w

        for (i in 0 until area) {
            val pixel = pixels[i]
            val r = ((pixel shr 16) and 0xFF).toFloat()
            val g = ((pixel shr 8) and 0xFF).toFloat()
            val b = (pixel and 0xFF).toFloat()
            result[i] = (r - mean[0]) / std[0]           // R channel
            result[area + i] = (g - mean[1]) / std[1]    // G channel
            result[2 * area + i] = (b - mean[2]) / std[2] // B channel
        }
        return result
    }

    private fun parseSCRFDOutput(
        outputs: OrtSession.Result,
        scale: Float,
        padX: Int,
        padY: Int,
        origWidth: Int,
        origHeight: Int
    ): List<FaceDetection> {
        val faces = mutableListOf<FaceDetection>()

        // SCRFD with KPS produces 3 output heads for each of 3 feature map strides (8, 16, 32)
        // For simplicity: iterate over all output tensors and parse them
        val outputNames = outputs.map { it.key }

        // Group outputs: score maps, bbox maps, landmark maps
        // Order depends on SCRFD model export. Standard ONNX export typically:
        // score_8, score_16, score_32, bbox_8, bbox_16, bbox_32, kps_8, kps_16, kps_32
        val strides = intArrayOf(8, 16, 32)
        val inputSize = DETECTOR_INPUT_SIZE

        for ((idx, stride) in strides.withIndex()) {
            try {
                val scoreKey = outputNames.find { it.contains("score") && outputNames.indexOf(it) == idx }
                    ?: outputNames.getOrNull(idx) ?: continue
                val bboxKey = outputNames.find { it.contains("bbox") && outputNames.indexOf(it) == idx + 3 }
                    ?: outputNames.getOrNull(idx + 3) ?: continue
                val kpsKey = outputNames.find { it.contains("kps") || it.contains("landmark") }
                    ?.let { outputNames.getOrNull(idx + 6) } ?: outputNames.getOrNull(idx + 6)

                val scoresTensor = outputs[scoreKey].get() as? OnnxTensor ?: continue
                val bboxTensor = outputs[bboxKey].get() as? OnnxTensor ?: continue

                val scoresData = scoresTensor.floatBuffer.array()
                val bboxData = bboxTensor.floatBuffer.array()
                val kpsData = if (kpsKey != null) {
                    (outputs[kpsKey].get() as? OnnxTensor)?.floatBuffer?.array()
                } else null

                val fmH = inputSize / stride
                val fmW = inputSize / stride
                val numAnchors = 2 // SCRFD uses 2 anchors per location

                for (i in 0 until fmH * fmW * numAnchors) {
                    val score = scoresData.getOrElse(i) { 0f }
                    if (score < CONFIDENCE_THRESHOLD) continue

                    val anchorIdx = i
                    val row = (anchorIdx / numAnchors) / fmW
                    val col = (anchorIdx / numAnchors) % fmW
                    val anchor = anchorIdx % numAnchors

                    // Anchor center in feature map coordinates
                    val cx = (col + 0.5f) * stride
                    val cy = (row + 0.5f) * stride

                    // Decode bbox (SCRFD regresses to distances from anchor center)
                    val bboxOffset = anchorIdx * 4
                    val x1 = cx - bboxData.getOrElse(bboxOffset) { 0f } * stride
                    val y1 = cy - bboxData.getOrElse(bboxOffset + 1) { 0f } * stride
                    val x2 = cx + bboxData.getOrElse(bboxOffset + 2) { 0f } * stride
                    val y2 = cy + bboxData.getOrElse(bboxOffset + 3) { 0f } * stride

                    // Map back to original image coordinates
                    val origX1 = ((x1 - padX) / scale).coerceIn(0f, origWidth.toFloat())
                    val origY1 = ((y1 - padY) / scale).coerceIn(0f, origHeight.toFloat())
                    val origX2 = ((x2 - padX) / scale).coerceIn(0f, origWidth.toFloat())
                    val origY2 = ((y2 - padY) / scale).coerceIn(0f, origHeight.toFloat())

                    val box = RectF(origX1, origY1, origX2, origY2)

                    // Decode landmarks
                    val landmarks = mutableListOf<PointF>()
                    if (kpsData != null) {
                        val kpsOffset = anchorIdx * 10
                        for (k in 0 until 5) {
                            val lx = ((kpsData.getOrElse(kpsOffset + k * 2) { 0f } * stride - padX) / scale)
                                .coerceIn(0f, origWidth.toFloat())
                            val ly = ((kpsData.getOrElse(kpsOffset + k * 2 + 1) { 0f } * stride - padY) / scale)
                                .coerceIn(0f, origHeight.toFloat())
                            landmarks.add(PointF(lx, ly))
                        }
                    } else {
                        // Fallback: use box corners as landmarks
                        val cx2 = (origX1 + origX2) / 2
                        val cy2 = (origY1 + origY2) / 2
                        landmarks.addAll(listOf(
                            PointF(origX1 + (origX2 - origX1) * 0.3f, origY1 + (origY2 - origY1) * 0.35f),
                            PointF(origX1 + (origX2 - origX1) * 0.7f, origY1 + (origY2 - origY1) * 0.35f),
                            PointF(cx2, cy2),
                            PointF(origX1 + (origX2 - origX1) * 0.35f, origY1 + (origY2 - origY1) * 0.65f),
                            PointF(origX1 + (origX2 - origX1) * 0.65f, origY1 + (origY2 - origY1) * 0.65f)
                        ))
                    }

                    if (box.width() >= MIN_FACE_SIZE && box.height() >= MIN_FACE_SIZE) {
                        faces.add(FaceDetection(box, landmarks, score))
                    }
                }
            } catch (e: Exception) {
                // Skip problematic output
            }
        }
        return faces
    }

    private fun nonMaxSuppression(faces: List<FaceDetection>, threshold: Float): List<FaceDetection> {
        val sorted = faces.sortedByDescending { it.score }.toMutableList()
        val result = mutableListOf<FaceDetection>()

        while (sorted.isNotEmpty()) {
            val best = sorted.removeAt(0)
            result.add(best)
            sorted.removeAll { other ->
                iou(best.box, other.box) > threshold
            }
        }
        return result
    }

    private fun iou(a: RectF, b: RectF): Float {
        val interX1 = max(a.left, b.left)
        val interY1 = max(a.top, b.top)
        val interX2 = min(a.right, b.right)
        val interY2 = min(a.bottom, b.bottom)

        if (interX2 <= interX1 || interY2 <= interY1) return 0f

        val interArea = (interX2 - interX1) * (interY2 - interY1)
        val aArea = a.width() * a.height()
        val bArea = b.width() * b.height()
        return interArea / (aArea + bArea - interArea)
    }

    // ─── Private: Face Alignment (Affine warp) ────────────────────────────────

    // Standard 112×112 ArcFace template landmarks
    private val ARCFACE_TEMPLATE = arrayOf(
        floatArrayOf(38.2946f, 51.6963f),
        floatArrayOf(73.5318f, 51.5014f),
        floatArrayOf(56.0252f, 71.7366f),
        floatArrayOf(41.5493f, 92.3655f),
        floatArrayOf(70.7299f, 92.2041f)
    )

    private fun alignFace(bitmap: Bitmap, landmarks: List<PointF>): Bitmap {
        if (landmarks.size < 5) {
            // Fallback: simple crop and resize
            return Bitmap.createScaledBitmap(bitmap, RECOGNIZER_INPUT_SIZE, RECOGNIZER_INPUT_SIZE, true)
        }

        val src = Array(5) { i -> floatArrayOf(landmarks[i].x, landmarks[i].y) }
        val dst = ARCFACE_TEMPLATE

        // Compute similarity transform (scale, rotation, translation)
        val matrix = computeSimilarityTransform(src, dst)

        val result = Bitmap.createBitmap(RECOGNIZER_INPUT_SIZE, RECOGNIZER_INPUT_SIZE, Bitmap.Config.ARGB_8888)
        val canvas = android.graphics.Canvas(result)
        val paint = android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG)
        canvas.drawBitmap(bitmap, matrix, paint)
        return result
    }

    private fun computeSimilarityTransform(src: Array<FloatArray>, dst: Array<FloatArray>): Matrix {
        // Compute mean of src and dst
        var srcMeanX = 0f; var srcMeanY = 0f
        var dstMeanX = 0f; var dstMeanY = 0f
        val n = src.size.toFloat()

        for (i in src.indices) {
            srcMeanX += src[i][0]; srcMeanY += src[i][1]
            dstMeanX += dst[i][0]; dstMeanY += dst[i][1]
        }
        srcMeanX /= n; srcMeanY /= n
        dstMeanX /= n; dstMeanY /= n

        // Center points
        var sigma_src = 0f
        var a = 0f; var b = 0f

        for (i in src.indices) {
            val sx = src[i][0] - srcMeanX; val sy = src[i][1] - srcMeanY
            val dx = dst[i][0] - dstMeanX; val dy = dst[i][1] - dstMeanY
            sigma_src += sx * sx + sy * sy
            a += sx * dx + sy * dy
            b += sx * dy - sy * dx
        }

        val s = if (sigma_src > 0) sqrt((a * a + b * b).toDouble()).toFloat() / sigma_src else 1f
        val cos_t = if (sigma_src > 0) a / (sigma_src * s) else 1f
        val sin_t = if (sigma_src > 0) b / (sigma_src * s) else 0f

        val tx = dstMeanX - s * (cos_t * srcMeanX - sin_t * srcMeanY)
        val ty = dstMeanY - s * (sin_t * srcMeanX + cos_t * srcMeanY)

        val matrix = Matrix()
        matrix.setValues(floatArrayOf(
            s * cos_t,  -s * sin_t, tx,
            s * sin_t,  s * cos_t,  ty,
            0f,          0f,         1f
        ))
        return matrix
    }

    // ─── Private: MobileFaceNet Embedding ────────────────────────────────────

    private fun generateEmbedding(alignedFace: Bitmap): FloatArray {
        val session = recognizerSession ?: return FloatArray(512)
        val env = ortEnvironment ?: return FloatArray(512)

        val inputArray = bitmapToNCHW(alignedFace, RECOGNIZER_MEAN, RECOGNIZER_STD)
        val inputShape = longArrayOf(1, 3, RECOGNIZER_INPUT_SIZE.toLong(), RECOGNIZER_INPUT_SIZE.toLong())
        val inputTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(inputArray), inputShape)

        val inputName = session.inputNames.iterator().next()
        val outputs = session.run(mapOf(inputName to inputTensor))
        val outputName = session.outputNames.iterator().next()
        val embedding = (outputs[outputName].get() as OnnxTensor).floatBuffer.array().clone()

        inputTensor.close()
        outputs.close()

        return l2NormalizeKotlin(embedding)
    }

    private fun l2NormalizeKotlin(vec: FloatArray): FloatArray {
        var norm = 0f
        for (v in vec) norm += v * v
        norm = sqrt(norm.toDouble()).toFloat()
        if (norm == 0f) return vec
        return FloatArray(vec.size) { vec[it] / norm }
    }

    // ─── Private: Blur Detection (Laplacian Variance) ────────────────────────

    private fun computeBlurScore(bitmap: Bitmap): Double {
        val width = bitmap.width
        val height = bitmap.height
        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)

        // Convert to grayscale and apply Laplacian kernel [0,1,0 / 1,-4,1 / 0,1,0]
        val gray = DoubleArray(width * height) { i ->
            val p = pixels[i]
            0.299 * ((p shr 16) and 0xFF) + 0.587 * ((p shr 8) and 0xFF) + 0.114 * (p and 0xFF)
        }

        var sum = 0.0
        var count = 0
        for (y in 1 until height - 1) {
            for (x in 1 until width - 1) {
                val lap = gray[(y - 1) * width + x] +
                        gray[(y + 1) * width + x] +
                        gray[y * width + (x - 1)] +
                        gray[y * width + (x + 1)] -
                        4 * gray[y * width + x]
                sum += lap * lap
                count++
            }
        }
        return if (count > 0) sum / count else 0.0
    }

    override fun onDestroy() {
        detectorSession?.close()
        recognizerSession?.close()
        ortEnvironment?.close()
        super.onDestroy()
    }
}
