package expo.modules.faceml

import android.content.Context
import android.graphics.RectF
import android.os.SystemClock
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import kotlin.concurrent.withLock
import kotlin.math.abs
import kotlin.math.min

class AnalyzeOptions : Record {
    /** Long side to decode the image to (0 = full resolution). */
    @Field val maxDim: Int = 1600
    /** Long side of the detector input (rounded up to a multiple of 32). */
    @Field val detSize: Int = 640
    /** Extra overlapping-tile detection for small / distant faces. */
    @Field val tiled: Boolean = false
    @Field val detThreshold: Double = 0.5
    /** Max faces to embed (largest first). */
    @Field val maxFaces: Int = 80
    /** Faces whose shorter side is below this (px at decoded scale) are not embedded. */
    @Field val minFaceSize: Int = 24
    /** Normalised [x, y, w, h] boxes of already-identified faces to skip. */
    @Field val skipBoxes: List<List<Double>> = emptyList()
    @Field val skipIou: Double = 0.45
    /** Laplacian-variance floor on the aligned face; 0 disables. */
    @Field val blurThreshold: Double = 0.0
    /** Skip faces turned further than this (eye-distance units); 0 disables. */
    @Field val maxYaw: Double = 0.0
    /** Flip test-time augmentation (norm-weighted fusion). */
    @Field val flip: Boolean = false
    @Field val thumbs: Boolean = true
    @Field val deleteInput: Boolean = false
}

class EnrollOptions : Record {
    @Field val maxDim: Int = 1280
    @Field val minFaceSize: Int = 80
    @Field val blurThreshold: Double = 40.0
    @Field val flip: Boolean = true
    @Field val deleteInput: Boolean = false
}

class FaceMLModule : Module() {
    private var engine: FaceEngine? = null

    private val context: Context
        get() = appContext.reactContext ?: throw IllegalStateException("React context unavailable")

    private fun requireEngine(): FaceEngine =
        engine?.takeIf { it.isReady } ?: throw IllegalStateException("Models not initialized. Call initModels first.")

    override fun definition() = ModuleDefinition {
        Name("FaceMLModule")

        AsyncFunction("initModels") { detectorPath: String, recognizerPath: String, promise: Promise ->
            try {
                val e = engine ?: FaceEngine(context).also { engine = it }
                if (!e.isReady) {
                    val (det, rec) = resolveModels(detectorPath, recognizerPath)
                    e.init(det, rec)
                }
                promise.resolve(null)
            } catch (t: Throwable) {
                promise.reject("INIT_ERROR", "Failed to initialize models: ${t.message}", t)
            }
        }

        AsyncFunction("isReady") { promise: Promise -> promise.resolve(engine?.isReady == true) }

        AsyncFunction("getEngineInfo") { promise: Promise ->
            val e = engine
            promise.resolve(if (e == null || !e.isReady) mapOf("backend" to "none") else e.info())
        }

        AsyncFunction("tuneBackend") { force: Boolean, promise: Promise ->
            try {
                promise.resolve(requireEngine().tune(force))
            } catch (t: Throwable) {
                promise.reject("TUNE_ERROR", t.message ?: "Tuning failed", t)
            }
        }

        AsyncFunction("analyzeImage") { imageUri: String, options: AnalyzeOptions, promise: Promise ->
            try {
                promise.resolve(analyze(requireEngine(), imageUri, options))
            } catch (t: Throwable) {
                promise.reject("ANALYZE_ERROR", t.message ?: "Unknown error", t)
            }
        }

        AsyncFunction("analyzeEnrollment") { imageUri: String, options: EnrollOptions, promise: Promise ->
            try {
                promise.resolve(enroll(requireEngine(), imageUri, options))
            } catch (t: Throwable) {
                promise.reject("ENROLL_ERROR", t.message ?: "Unknown error", t)
            }
        }

        // ── Legacy entry points (kept for compatibility) ──────────────────────
        AsyncFunction("detectAndEmbedFaces") { imageUri: String, promise: Promise ->
            try {
                val r = analyze(requireEngine(), imageUri, AnalyzeOptions())
                @Suppress("UNCHECKED_CAST")
                val faces = (r["faces"] as List<Map<String, Any>>).filter { it.containsKey("embedding") }.map {
                    it + mapOf("isBlurry" to false, "blurScore" to (it["sharpness"] ?: 0.0))
                }
                promise.resolve(mapOf("faces" to faces, "imageWidth" to r.getValue("imageWidth"), "imageHeight" to r.getValue("imageHeight")))
            } catch (t: Throwable) {
                promise.reject("DETECTION_ERROR", t.message ?: "Unknown error", t)
            }
        }

        AsyncFunction("validateEnrollmentPhoto") { imageUri: String, promise: Promise ->
            try {
                val r = enroll(requireEngine(), imageUri, EnrollOptions())
                val reason = r["reason"] as String
                val messages = mapOf(
                    "no_face" to "No face detected. Please look at the camera.",
                    "multiple" to "Multiple faces detected. Only one person should be in frame.",
                    "too_small" to "Face is too small. Please move closer to the camera.",
                    "blurry" to "Image is blurry. Please hold still and capture again."
                )
                val validation = mutableMapOf<String, Any>(
                    "isValid" to (reason == "ok"),
                    "faceCount" to (r["faceCount"] ?: 0),
                    "isBlurry" to (reason == "blurry"),
                    "blurScore" to (r["sharpness"] ?: 0.0),
                    "isFaceTooSmall" to (reason == "too_small")
                )
                messages[reason]?.let { validation["errorMessage"] = it }
                val out = mutableMapOf<String, Any>("validation" to validation)
                r["embedding"]?.let { out["embedding"] = it }
                promise.resolve(out)
            } catch (t: Throwable) {
                promise.reject("VALIDATION_ERROR", t.message ?: "Unknown error", t)
            }
        }

        OnDestroy {
            engine?.close()
            engine = null
        }
    }

    // ─── Pipelines ───────────────────────────────────────────────────────────

    private fun analyze(e: FaceEngine, uri: String, o: AnalyzeOptions): Map<String, Any> = e.lock.withLock {
        val t0 = SystemClock.elapsedRealtime()
        val bmp = e.loadBitmap(uri, o.maxDim) ?: throw IllegalArgumentException("Failed to load image: $uri")
        if (o.deleteInput) e.deleteLocal(uri)
        val t1 = SystemClock.elapsedRealtime()

        val thr = o.detThreshold.toFloat()
        val dets = (if (o.tiled) e.detectTiled(bmp, o.detSize, thr) else e.detect(bmp, o.detSize, thr))
            .sortedByDescending { it.box.width() * it.box.height() }
        val t2 = SystemClock.elapsedRealtime()

        val w = bmp.width.toFloat(); val h = bmp.height.toFloat()
        val skip = o.skipBoxes.filter { it.size >= 4 }.map {
            RectF((it[0] * w).toFloat(), (it[1] * h).toFloat(), ((it[0] + it[2]) * w).toFloat(), ((it[1] + it[3]) * h).toFloat())
        }

        var embedded = 0
        val faces = ArrayList<Map<String, Any>>(dets.size)
        for (d in dets) {
            val yaw = e.yaw(d)
            val entry = mutableMapOf<String, Any>(
                "box" to boxMap(d),
                "landmarks" to d.landmarks.map { mapOf("x" to it.x.toDouble(), "y" to it.y.toDouble()) },
                "yaw" to yaw.toDouble()
            )
            when {
                skip.any { e.iou(it, d.box) >= o.skipIou } -> entry["status"] = "skipped"
                min(d.box.width(), d.box.height()) < o.minFaceSize -> entry["status"] = "small"
                o.maxYaw > 0 && abs(yaw) > o.maxYaw -> entry["status"] = "pose"
                embedded >= o.maxFaces -> entry["status"] = "deferred"
                else -> {
                    val aligned = e.align(bmp, d)
                    val sharp = e.sharpness(aligned)
                    entry["sharpness"] = sharp
                    if (o.blurThreshold > 0 && sharp < o.blurThreshold) {
                        entry["status"] = "blurry"
                    } else {
                        val emb = e.embed(listOf(aligned), o.flip).first()
                        entry["embedding"] = emb.vector.map { it.toDouble() }
                        entry["quality"] = emb.norm.toDouble()
                        entry["status"] = "embedded"
                        embedded++
                        if (o.thumbs) e.saveThumb(bmp, d.box)?.let { entry["thumbUri"] = it }
                    }
                    aligned.recycle()
                }
            }
            faces.add(entry)
        }
        val t3 = SystemClock.elapsedRealtime()
        val result = mapOf(
            "faces" to faces,
            "imageWidth" to bmp.width,
            "imageHeight" to bmp.height,
            "timings" to mapOf(
                "decodeMs" to (t1 - t0).toDouble(),
                "detectMs" to (t2 - t1).toDouble(),
                "embedMs" to (t3 - t2).toDouble(),
                "totalMs" to (t3 - t0).toDouble()
            )
        )
        bmp.recycle()
        result
    }

    private fun enroll(e: FaceEngine, uri: String, o: EnrollOptions): Map<String, Any> = e.lock.withLock {
        val bmp = e.loadBitmap(uri, o.maxDim) ?: throw IllegalArgumentException("Failed to load image: $uri")
        if (o.deleteInput) e.deleteLocal(uri)
        val dets = e.detect(bmp, 480, 0.5f).sortedByDescending { it.box.width() * it.box.height() }
        val out = mutableMapOf<String, Any>(
            "imageWidth" to bmp.width, "imageHeight" to bmp.height, "faceCount" to dets.size
        )
        val p = dets.firstOrNull()
        val second = dets.getOrNull(1)
        fun area(d: FaceEngine.Detection) = d.box.width() * d.box.height()
        when {
            p == null -> out["reason"] = "no_face"
            second != null && area(second) * 2.2f > area(p) -> out["reason"] = "multiple"
            min(p.box.width(), p.box.height()) < o.minFaceSize -> out["reason"] = "too_small"
            else -> {
                val aligned = e.align(bmp, p)
                val sharp = e.sharpness(aligned)
                out["sharpness"] = sharp
                if (sharp < o.blurThreshold) {
                    out["reason"] = "blurry"
                } else {
                    val emb = e.embed(listOf(aligned), o.flip).first()
                    out["embedding"] = emb.vector.map { it.toDouble() }
                    out["quality"] = emb.norm.toDouble()
                    out["reason"] = "ok"
                    e.saveThumb(bmp, p.box, 320)?.let { out["thumbUri"] = it }
                }
                aligned.recycle()
            }
        }
        if (p != null) {
            out["box"] = boxMap(p)
            out["landmarks"] = p.landmarks.map { mapOf("x" to it.x.toDouble(), "y" to it.y.toDouble()) }
            out["yaw"] = e.yaw(p).toDouble()
        }
        bmp.recycle()
        out
    }

    private fun boxMap(d: FaceEngine.Detection) = mapOf(
        "x" to d.box.left.toDouble(), "y" to d.box.top.toDouble(),
        "width" to d.box.width().toDouble(), "height" to d.box.height().toDouble(),
        "score" to d.score.toDouble()
    )

    // ─── Model files ─────────────────────────────────────────────────────────

    private fun resolveModels(detectorPath: String, recognizerPath: String): Pair<String, String> {
        fun existing(path: String, min: Long): String? {
            if (path.isBlank()) return null
            val f = File(path.removePrefix("file://"))
            return if (f.exists() && f.length() >= min) f.absolutePath else null
        }
        val det = existing(detectorPath, MIN_DET_BYTES)
        val rec = existing(recognizerPath, MIN_REC_BYTES)
        if (det != null && rec != null) return det to rec

        val dir = File(context.filesDir, "models").apply { mkdirs() }
        return extract(DET_ASSET, File(dir, DET_ASSET)) to extract(REC_ASSET, File(dir, REC_ASSET))
    }

    /** Copy an APK asset to internal storage; re-copy whenever the bundled model changes. */
    private fun extract(asset: String, dest: File): String {
        val assetLen = try { context.assets.openFd(asset).use { it.length } } catch (_: Exception) { -1L }
        if (dest.exists() && dest.length() > 0 && (assetLen < 0 || dest.length() == assetLen)) return dest.absolutePath
        val tmp = File(dest.parentFile, "${dest.name}.part")
        context.assets.open(asset).use { input -> tmp.outputStream().use { input.copyTo(it, 1 shl 20) } }
        dest.delete()
        if (!tmp.renameTo(dest)) throw IllegalStateException("Could not install model $asset")
        return dest.absolutePath
    }

    companion object {
        private const val DET_ASSET = "scrfd_10g_kps.onnx"
        private const val REC_ASSET = "adaface_ir101.onnx"
        private const val MIN_DET_BYTES = 15_000_000L
        private const val MIN_REC_BYTES = 160_000_000L
    }
}
