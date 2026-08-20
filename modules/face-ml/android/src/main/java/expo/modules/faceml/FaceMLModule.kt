package expo.modules.faceml

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.graphics.PointF
import android.graphics.RectF
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
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

    // AdaFace IR-101 input: 112×112, normalized to [-1, 1] using mean=127.5, std=127.5
    private val RECOGNIZER_INPUT_SIZE = 112
    private val RECOGNIZER_MEAN = floatArrayOf(127.5f, 127.5f, 127.5f)
    private val RECOGNIZER_STD  = floatArrayOf(127.5f, 127.5f, 127.5f) // AdaFace uses 127.5 not 128.0

    // Detection thresholds — 10G detector is much more accurate; keep confidence high
    private val CONFIDENCE_THRESHOLD = 0.5f
    private val NMS_THRESHOLD = 0.4f
    private val MIN_FACE_SIZE = 30 // pixels — 10G handles smaller faces well

    // Blur detection threshold (Laplacian variance)
    private val BLUR_THRESHOLD = 100.0

    private val DETECTOR_ASSET   = "scrfd_10g_kps.onnx"    // SCRFD-10G: best InsightFace detector
    private val RECOGNIZER_ASSET = "adaface_ir101.onnx"    // AdaFace IR-101: best on-device recognizer
    private val MIN_DETECTOR_BYTES   =  15_000_000L        // det_10g ~17MB
    private val MIN_RECOGNIZER_BYTES = 160_000_000L        // adaface_ir101 ~170MB

    override fun definition() = ModuleDefinition {
        Name("FaceMLModule")

        AsyncFunction("initModels") { detectorPath: String, recognizerPath: String, promise: Promise ->
            try {
                val (detectorFile, recognizerFile) = resolveModelFiles(detectorPath, recognizerPath)

                ortEnvironment = OrtEnvironment.getEnvironment()
                val sessionOptions = OrtSession.SessionOptions().apply {
                    addConfigEntry("session.inter_op_num_threads", "2")
                    addConfigEntry("session.intra_op_num_threads", "2")
                }

                detectorSession = ortEnvironment!!.createSession(detectorFile, sessionOptions)
                recognizerSession = ortEnvironment!!.createSession(recognizerFile, sessionOptions)
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
                    val aligned = alignFace(bitmap, face.landmarks, face.box)
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

                        val aligned = alignFace(bitmap, face.landmarks, face.box)
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
                                // Expo serializes numeric arrays as doubles; convert the ONNX
                                // FloatArray explicitly before returning it to JavaScript.
                                embedding = emb.map { it.toDouble() }
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

        OnDestroy {
            detectorSession?.close()
            recognizerSession?.close()
            ortEnvironment?.close()
            detectorSession = null
            recognizerSession = null
            ortEnvironment = null
            isInitialized = false
        }
    }

    // ─── Private: Model Paths ─────────────────────────────────────────────────

    private fun resolveModelFiles(detectorPath: String, recognizerPath: String): Pair<String, String> {
        val detector = tryResolveExistingPath(detectorPath, MIN_DETECTOR_BYTES)
        val recognizer = tryResolveExistingPath(recognizerPath, MIN_RECOGNIZER_BYTES)
        if (detector != null && recognizer != null) {
            return detector to recognizer
        }
        return ensureBundledModels()
    }

    private fun tryResolveExistingPath(path: String, minBytes: Long): String? {
        if (path.isBlank()) return null
        val normalized = if (path.startsWith("file://")) path.removePrefix("file://") else path
        val file = File(normalized)
        return if (file.exists() && file.length() >= minBytes) normalized else null
    }

    private fun ensureBundledModels(): Pair<String, String> {
        val context = appContext.reactContext
            ?: throw Exception("React context unavailable for model extraction")

        val modelsDir = File(context.filesDir, "models")
        if (!modelsDir.exists()) modelsDir.mkdirs()

        val detector = File(modelsDir, DETECTOR_ASSET)
        val recognizer = File(modelsDir, RECOGNIZER_ASSET)

        copyAssetIfNeeded(context, DETECTOR_ASSET, detector, MIN_DETECTOR_BYTES)
        copyAssetIfNeeded(context, RECOGNIZER_ASSET, recognizer, MIN_RECOGNIZER_BYTES)

        return detector.absolutePath to recognizer.absolutePath
    }

    private fun copyAssetIfNeeded(
        context: Context,
        assetName: String,
        dest: File,
        minBytes: Long
    ) {
        if (dest.exists() && dest.length() >= minBytes) return
        if (dest.exists()) dest.delete()

        context.assets.open(assetName).use { input ->
            dest.outputStream().use { output ->
                input.copyTo(output)
            }
        }

        if (!dest.exists() || dest.length() < minBytes) {
            throw Exception("Failed to extract bundled model: $assetName")
        }
    }

    // ─── Private: Image Loading ───────────────────────────────────────────────

    private fun loadBitmap(uriStr: String): Bitmap? {
        val context = appContext.reactContext ?: return null
        return try {
            val uri = Uri.parse(uriStr)
            val inputStream = context.contentResolver.openInputStream(uri)
                ?: FileInputStream(File(uri.path ?: return null))

            inputStream.use { stream ->
                var bitmap = BitmapFactory.decodeStream(stream) ?: return null
                applyExifRotation(context, uri, bitmap)
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun applyExifRotation(context: Context, uri: Uri, bitmap: Bitmap): Bitmap {
        return try {
            context.contentResolver.openInputStream(uri)?.use { exifStream ->
                val exif = ExifInterface(exifStream)
                val orientation = exif.getAttributeInt(
                    ExifInterface.TAG_ORIENTATION,
                    ExifInterface.ORIENTATION_NORMAL
                )
                val rotation = when (orientation) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                    else -> return bitmap
                }
                val matrix = Matrix()
                matrix.postRotate(rotation)
                Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
            } ?: bitmap
        } catch (_: Exception) {
            bitmap
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

    private fun tensorToFloatArray(tensor: OnnxTensor): FloatArray {
        val count = tensorElementCount(tensor)
        val buffer = tensor.floatBuffer.duplicate()
        buffer.rewind()
        val data = FloatArray(count)
        val n = min(count, buffer.remaining())
        buffer.get(data, 0, n)
        return data
    }

    private fun lastDim(tensor: OnnxTensor): Int {
        val shape = tensor.info.shape
        if (shape.isEmpty()) return 0
        val last = shape.last()
        return if (last > 0) last.toInt() else 0
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
        val tensors = outputs.mapNotNull { it.value as? OnnxTensor }

        // Group by last dimension — do NOT trust HashMap iteration order.
        // scores: [..., 1], bbox: [..., 4], kps: [..., 10]
        fun tensorsForLastDim(dim: Int) = tensors.filter { lastDim(it) == dim }

        val scoreTensors = tensorsForLastDim(1)
        val bboxTensors = tensorsForLastDim(4)
        val kpsTensors = tensorsForLastDim(10)

        val strides = intArrayOf(8, 16, 32)

        for (stride in strides) {
            try {
                val fmH = DETECTOR_INPUT_SIZE / stride
                val fmW = DETECTOR_INPUT_SIZE / stride
                val numAnchors = 2
                val expectedAnchors = fmH * fmW * numAnchors

                val scoresTensor = scoreTensors.find { tensorElementCount(it) == expectedAnchors }
                    ?: continue
                val bboxTensor = bboxTensors.find { tensorElementCount(it) == expectedAnchors * 4 }
                    ?: continue
                val kpsTensor = kpsTensors.find { tensorElementCount(it) == expectedAnchors * 10 }

                val scoresData = tensorToFloatArray(scoresTensor)
                val bboxData = tensorToFloatArray(bboxTensor)
                val kpsData = kpsTensor?.let { tensorToFloatArray(it) }

                for (i in 0 until expectedAnchors) {
                    val score = scoresData.getOrElse(i) { 0f }
                    if (score < CONFIDENCE_THRESHOLD) continue

                    val row = (i / numAnchors) / fmW
                    val col = (i / numAnchors) % fmW
                    val cx = (col + 0.5f) * stride
                    val cy = (row + 0.5f) * stride

                    val bboxOffset = i * 4
                    val x1 = cx - bboxData.getOrElse(bboxOffset) { 0f } * stride
                    val y1 = cy - bboxData.getOrElse(bboxOffset + 1) { 0f } * stride
                    val x2 = cx + bboxData.getOrElse(bboxOffset + 2) { 0f } * stride
                    val y2 = cy + bboxData.getOrElse(bboxOffset + 3) { 0f } * stride

                    val origX1 = ((x1 - padX) / scale).coerceIn(0f, origWidth.toFloat())
                    val origY1 = ((y1 - padY) / scale).coerceIn(0f, origHeight.toFloat())
                    val origX2 = ((x2 - padX) / scale).coerceIn(0f, origWidth.toFloat())
                    val origY2 = ((y2 - padY) / scale).coerceIn(0f, origHeight.toFloat())
                    val box = RectF(origX1, origY1, origX2, origY2)

                    val landmarks = mutableListOf<PointF>()
                    if (kpsData != null) {
                        // InsightFace: landmark = anchor_center + kps_offset * stride
                        val kpsOffset = i * 10
                        for (k in 0 until 5) {
                            val lx = ((cx + kpsData.getOrElse(kpsOffset + k * 2) { 0f } * stride - padX) / scale)
                                .coerceIn(0f, origWidth.toFloat())
                            val ly = ((cy + kpsData.getOrElse(kpsOffset + k * 2 + 1) { 0f } * stride - padY) / scale)
                                .coerceIn(0f, origHeight.toFloat())
                            landmarks.add(PointF(lx, ly))
                        }
                    } else {
                        val w = origX2 - origX1
                        val h = origY2 - origY1
                        landmarks.addAll(listOf(
                            PointF(origX1 + w * 0.30f, origY1 + h * 0.35f),
                            PointF(origX1 + w * 0.70f, origY1 + h * 0.35f),
                            PointF((origX1 + origX2) / 2, origY1 + h * 0.55f),
                            PointF(origX1 + w * 0.35f, origY1 + h * 0.70f),
                            PointF(origX1 + w * 0.65f, origY1 + h * 0.70f)
                        ))
                    }

                    if (box.width() >= MIN_FACE_SIZE && box.height() >= MIN_FACE_SIZE) {
                        faces.add(FaceDetection(box, landmarks, score))
                    }
                }
            } catch (_: Exception) {
                // Skip this stride
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

    private fun cropFaceFallback(bitmap: Bitmap, box: RectF): Bitmap {
        val pad = 0.25f
        val left = (box.left - box.width() * pad).toInt().coerceIn(0, bitmap.width - 1)
        val top = (box.top - box.height() * pad).toInt().coerceIn(0, bitmap.height - 1)
        val right = (box.right + box.width() * pad).toInt().coerceIn(left + 1, bitmap.width)
        val bottom = (box.bottom + box.height() * pad).toInt().coerceIn(top + 1, bitmap.height)
        val cropped = Bitmap.createBitmap(bitmap, left, top, right - left, bottom - top)
        return Bitmap.createScaledBitmap(cropped, RECOGNIZER_INPUT_SIZE, RECOGNIZER_INPUT_SIZE, true)
    }

    private fun alignFace(bitmap: Bitmap, landmarks: List<PointF>, box: RectF): Bitmap {
        if (landmarks.size < 5) {
            return cropFaceFallback(bitmap, box)
        }

        val src = Array(5) { i -> floatArrayOf(landmarks[i].x, landmarks[i].y) }
        val dst = ARCFACE_TEMPLATE
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

    // ─── Private: Face Embedding (AdaFace IR-101) ────────────────────────────

    private val EMBEDDING_DIM = 512

    private fun generateEmbedding(alignedFace: Bitmap): FloatArray {
        val session = recognizerSession
            ?: throw Exception("Recognizer model not loaded — call initModels first")
        val env = ortEnvironment
            ?: throw Exception("OrtEnvironment not initialized")

        val inputArray = bitmapToNCHW(alignedFace, RECOGNIZER_MEAN, RECOGNIZER_STD)
        val inputShape = longArrayOf(1, 3, RECOGNIZER_INPUT_SIZE.toLong(), RECOGNIZER_INPUT_SIZE.toLong())
        val inputTensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(inputArray), inputShape)

        val inputName = session.inputNames.iterator().next()
        val outputs = session.run(mapOf(inputName to inputTensor))

        // AdaFace outputs multiple tensors (512-dim embedding + 1-dim norm, etc.).
        // Pick by tensor element count from shape — never use floatBuffer.array().size
        // (that is heap capacity, not tensor size, and can mis-read the norm output).
        val embedding = extractEmbeddingFromOutputs(outputs, session.outputNames)

        inputTensor.close()
        outputs.close()

        return l2NormalizeKotlin(embedding)
    }

    private fun extractEmbeddingFromOutputs(
        outputs: OrtSession.Result,
        outputNames: Set<String>
    ): FloatArray {
        for (entry in outputs) {
            val tensor = entry.value as? OnnxTensor ?: continue
            val elementCount = tensorElementCount(tensor)
            if (elementCount != EMBEDDING_DIM) continue

            val buffer = tensor.floatBuffer.duplicate()
            buffer.rewind()
            val embedding = FloatArray(elementCount)
            if (buffer.remaining() < elementCount) continue
            buffer.get(embedding, 0, elementCount)
            return embedding
        }

        val shapeSummary = outputNames.mapNotNull { name ->
            for (entry in outputs) {
                if (entry.key != name) continue
                val tensor = entry.value as? OnnxTensor ?: return@mapNotNull null
                return@mapNotNull "$name=${tensor.info.shape.contentToString()}"
            }
            null
        }.joinToString(", ")

        throw Exception(
            "No ${EMBEDDING_DIM}-dim embedding output in recognizer model. Outputs: [$shapeSummary]"
        )
    }

    private fun tensorElementCount(tensor: OnnxTensor): Int {
        val shape = tensor.info.shape
        if (shape.isEmpty()) return 0
        var count = 1L
        for (dim in shape) {
            if (dim <= 0) return 0
            count *= dim
        }
        return count.toInt()
    }

    private fun l2NormalizeKotlin(vec: FloatArray): FloatArray {
        var norm = 0f
        for (v in vec) norm += v * v
        norm = sqrt(norm.toDouble()).toFloat()
        // Guard: if embedding is all zeros (model produced garbage), throw so caller
        // gets a meaningful error instead of silently matching against random students.
        if (norm < 1e-6f) throw Exception("Embedding is a zero vector — model output is invalid")
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

}
