package expo.modules.faceml

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtLoggingLevel
import ai.onnxruntime.OrtSession
import ai.onnxruntime.providers.NNAPIFlags
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PointF
import android.graphics.RectF
import android.net.Uri
import android.os.SystemClock
import androidx.exifinterface.media.ExifInterface
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.nio.FloatBuffer
import java.util.EnumSet
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * On-device face pipeline: SCRFD-10G detection → 5-point similarity alignment →
 * AdaFace IR-101 embedding (+ AdaFace feature-norm quality).
 *
 * Everything model-related runs under [lock]; sessions can be swapped by the
 * backend tuner without racing an in-flight inference.
 */
class FaceEngine(private val context: Context) {

    data class Detection(val box: RectF, val landmarks: List<PointF>, val score: Float)
    data class Embedding(val vector: FloatArray, val norm: Float)

    val lock = ReentrantLock()

    private var env: OrtEnvironment? = null
    private var detector: OrtSession? = null
    private var recognizer: OrtSession? = null
    private var recHasNorm = false
    var backend: String = "cpu"
        private set
    val threads: Int by lazy { performanceCoreCount() }
    val isReady: Boolean get() = detector != null && recognizer != null

    private lateinit var detectorPath: String
    private lateinit var recognizerPath: String
    private val prefs by lazy { context.getSharedPreferences("faceml_engine", Context.MODE_PRIVATE) }

    // ─── Lifecycle ───────────────────────────────────────────────────────────

    fun init(detPath: String, recPath: String) = lock.withLock {
        if (isReady) return
        detectorPath = detPath
        recognizerPath = recPath
        val e = OrtEnvironment.getEnvironment()
        env = e
        detector = e.createSession(detPath, options("cpu"))
        // A tuning attempt that never finished means that backend crashed the
        // process — never try it again on this device.
        prefs.getString(KEY_TUNING, null)?.let { crashed ->
            prefs.edit().putBoolean("bad_$crashed", true).remove(KEY_TUNING).apply()
        }
        val preferred = prefs.getString(KEY_BACKEND, "cpu") ?: "cpu"
        recognizer = try {
            createRecognizer(preferred).also { backend = preferred }
        } catch (_: Throwable) {
            backend = "cpu"
            createRecognizer("cpu")
        }
    }

    fun close() = lock.withLock {
        detector?.close(); recognizer?.close()
        detector = null; recognizer = null
    }

    private fun options(kind: String): OrtSession.SessionOptions = OrtSession.SessionOptions().apply {
        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
        setSessionLogLevel(OrtLoggingLevel.ORT_LOGGING_LEVEL_ERROR)
        setInterOpNumThreads(1)
        when (kind) {
            "xnnpack" -> {
                // XNNPACK brings its own thread pool; keep ORT's at 1 to avoid oversubscription.
                setIntraOpNumThreads(1)
                addConfigEntry("session.intra_op.allow_spinning", "0")
                addXnnpack(mapOf("intra_op_num_threads" to threads.toString()))
            }
            "nnapi" -> {
                setIntraOpNumThreads(threads)
                addNnapi(EnumSet.of(NNAPIFlags.USE_FP16))
            }
            else -> setIntraOpNumThreads(threads)
        }
    }

    private fun createRecognizer(kind: String): OrtSession {
        val s = env!!.createSession(recognizerPath, options(kind))
        recHasNorm = s.outputNames.contains("norm")
        return s
    }

    /**
     * Benchmarks the recognizer on CPU / XNNPACK / NNAPI and keeps the fastest
     * backend whose embeddings match the CPU reference (cosine ≥ 0.995).
     * Runs once per device unless forced; result is persisted.
     */
    fun tune(force: Boolean): Map<String, Any> = lock.withLock {
        if (!force && prefs.contains(KEY_BACKEND)) return info()
        val input = syntheticFace()
        val results = mutableMapOf<String, Double>()

        recognizer?.close()
        recognizer = createRecognizer("cpu")
        val reference = runRecognizer(recognizer!!, input, 1).first().vector
        results["cpu"] = bench(recognizer!!, input)
        var best = "cpu"
        var bestMs = results["cpu"]!!

        for (kind in listOf("xnnpack", "nnapi")) {
            if (prefs.getBoolean("bad_$kind", false)) continue
            prefs.edit().putString(KEY_TUNING, kind).commit()
            try {
                recognizer?.close()
                recognizer = createRecognizer(kind)
                val out = runRecognizer(recognizer!!, input, 1).first().vector
                val agree = dot(out, reference)
                if (agree >= 0.995f) {
                    val ms = bench(recognizer!!, input)
                    results[kind] = ms
                    if (ms < bestMs * 0.9) { best = kind; bestMs = ms }
                } else {
                    prefs.edit().putBoolean("bad_$kind", true).apply()
                }
            } catch (_: Throwable) {
                prefs.edit().putBoolean("bad_$kind", true).apply()
            } finally {
                prefs.edit().remove(KEY_TUNING).commit()
            }
        }

        recognizer?.close()
        recognizer = createRecognizer(best)
        backend = best
        prefs.edit().putString(KEY_BACKEND, best).putFloat("rec_ms", bestMs.toFloat()).apply()
        return info() + mapOf("benchmarks" to results)
    }

    fun info(): Map<String, Any> = mapOf(
        "backend" to backend,
        "threads" to threads,
        "qualityAvailable" to recHasNorm,
        "recognizerMs" to prefs.getFloat("rec_ms", -1f).toDouble()
    )

    private fun bench(session: OrtSession, input: FloatArray): Double {
        runRecognizer(session, input, 1)
        val times = DoubleArray(3) {
            val t = SystemClock.elapsedRealtimeNanos()
            runRecognizer(session, input, 1)
            (SystemClock.elapsedRealtimeNanos() - t) / 1e6
        }
        times.sort()
        return times[1]
    }

    private fun syntheticFace(): FloatArray {
        // Smooth deterministic pattern (not noise) so every backend sees realistic activations.
        val n = REC_SIZE * REC_SIZE
        return FloatArray(3 * n) { i ->
            val p = i % n; val c = i / n
            val x = (p % REC_SIZE) / REC_SIZE.toFloat(); val y = (p / REC_SIZE) / REC_SIZE.toFloat()
            (kotlin.math.sin(6f * x + c) * kotlin.math.cos(5f * y - c) * 0.8f)
        }
    }

    // ─── Image IO ────────────────────────────────────────────────────────────

    private fun openStream(uri: Uri): InputStream? {
        val viaResolver = try { context.contentResolver.openInputStream(uri) } catch (_: Exception) { null }
        if (viaResolver != null) return viaResolver
        val f = File(uri.path ?: return null)
        return if (f.exists()) FileInputStream(f) else null
    }

    /** Decode with subsampling so the long side is ≈ maxDim (0 = full), EXIF-upright. */
    fun loadBitmap(uriStr: String, maxDim: Int): Bitmap? = try {
        val uri = Uri.parse(uriStr)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        openStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) null else {
            val longSide = max(bounds.outWidth, bounds.outHeight)
            var sample = 1
            if (maxDim > 0) while (longSide / (sample * 2) >= maxDim) sample *= 2
            val opts = BitmapFactory.Options().apply {
                inSampleSize = sample
                inPreferredConfig = Bitmap.Config.ARGB_8888
            }
            var bmp = openStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
            if (bmp != null) {
                val cur = max(bmp.width, bmp.height)
                if (maxDim > 0 && cur > maxDim * 1.15f) {
                    val s = maxDim.toFloat() / cur
                    bmp = replace(bmp, Bitmap.createScaledBitmap(bmp, (bmp.width * s).roundToInt(), (bmp.height * s).roundToInt(), true))
                }
                val (rot, flip) = try {
                    openStream(uri)?.use { ExifInterface(it).let { e -> e.rotationDegrees to e.isFlipped } } ?: (0 to false)
                } catch (_: Exception) { 0 to false }
                if (rot != 0 || flip) {
                    val m = Matrix()
                    if (flip) m.postScale(-1f, 1f)
                    if (rot != 0) m.postRotate(rot.toFloat())
                    bmp = replace(bmp, Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true))
                }
            }
            bmp
        }
    } catch (_: Throwable) { null }

    private fun replace(old: Bitmap, new: Bitmap): Bitmap {
        if (new !== old) old.recycle()
        return new
    }

    fun deleteLocal(uriStr: String) {
        try {
            val uri = Uri.parse(uriStr)
            if (uri.scheme == null || uri.scheme == "file") uri.path?.let { File(it).delete() }
        } catch (_: Exception) {}
    }

    fun saveThumb(bitmap: Bitmap, box: RectF, size: Int = 192): String? = try {
        val side = max(box.width(), box.height()) * 1.45f
        val cx = box.centerX(); val cy = box.centerY() - box.height() * 0.04f
        val l = (cx - side / 2).toInt().coerceIn(0, bitmap.width - 1)
        val t = (cy - side / 2).toInt().coerceIn(0, bitmap.height - 1)
        val r = (cx + side / 2).toInt().coerceIn(l + 1, bitmap.width)
        val b = (cy + side / 2).toInt().coerceIn(t + 1, bitmap.height)
        val crop = Bitmap.createBitmap(bitmap, l, t, r - l, b - t)
        val thumb = Bitmap.createScaledBitmap(crop, size, size, true)
        if (crop !== thumb && crop !== bitmap) crop.recycle()
        val dir = File(context.cacheDir, "faces").apply { mkdirs() }
        val f = File(dir, "f_${System.nanoTime()}.jpg")
        FileOutputStream(f).use { thumb.compress(Bitmap.CompressFormat.JPEG, 86, it) }
        thumb.recycle()
        Uri.fromFile(f).toString()
    } catch (_: Throwable) { null }

    // ─── Detection ───────────────────────────────────────────────────────────

    /**
     * Run SCRFD with an aspect-preserving input whose long side is [longSide]
     * (rounded up to stride 32) — no square letterbox, so no wasted compute.
     */
    fun detect(bitmap: Bitmap, longSide: Int, threshold: Float): List<Detection> {
        val session = detector ?: return emptyList()
        val e = env ?: return emptyList()
        val w = bitmap.width; val h = bitmap.height
        val scale = min(1.5f, longSide.toFloat() / max(w, h))
        val sw = max(1, (w * scale).roundToInt()); val sh = max(1, (h * scale).roundToInt())
        val inW = (ceil(sw / 32f) * 32).toInt(); val inH = (ceil(sh / 32f) * 32).toInt()

        val canvasBmp = Bitmap.createBitmap(inW, inH, Bitmap.Config.ARGB_8888)
        Canvas(canvasBmp).apply {
            drawColor(Color.BLACK) // SCRFD was trained with zero padding
            val scaled = Bitmap.createScaledBitmap(bitmap, sw, sh, true)
            drawBitmap(scaled, 0f, 0f, null)
            if (scaled !== bitmap) scaled.recycle()
        }
        val data = toNCHW(canvasBmp, 127.5f, 1f / 128f, bgr = false)
        canvasBmp.recycle()

        val tensor = OnnxTensor.createTensor(e, FloatBuffer.wrap(data), longArrayOf(1, 3, inH.toLong(), inW.toLong()))
        val faces = mutableListOf<Detection>()
        session.run(mapOf(session.inputNames.first() to tensor)).use { out ->
            val tensors = out.mapNotNull { it.value as? OnnxTensor }
            for (stride in intArrayOf(8, 16, 32)) {
                val fw = inW / stride; val fh = inH / stride; val anchors = fw * fh * 2
                val sc = tensors.find { lastDim(it) == 1 && count(it) == anchors } ?: continue
                val bb = tensors.find { lastDim(it) == 4 && count(it) == anchors * 4 } ?: continue
                val kp = tensors.find { lastDim(it) == 10 && count(it) == anchors * 10 }
                val s = floats(sc); val b = floats(bb); val k = kp?.let { floats(it) }
                for (i in 0 until anchors) {
                    val score = s[i]
                    if (score < threshold) continue
                    val cell = i / 2
                    val cx = (cell % fw) * stride.toFloat(); val cy = (cell / fw) * stride.toFloat()
                    val x1 = (cx - b[i * 4] * stride) / scale
                    val y1 = (cy - b[i * 4 + 1] * stride) / scale
                    val x2 = (cx + b[i * 4 + 2] * stride) / scale
                    val y2 = (cy + b[i * 4 + 3] * stride) / scale
                    val box = RectF(x1.coerceIn(0f, w.toFloat()), y1.coerceIn(0f, h.toFloat()), x2.coerceIn(0f, w.toFloat()), y2.coerceIn(0f, h.toFloat()))
                    if (box.width() < MIN_DET_SIZE || box.height() < MIN_DET_SIZE) continue
                    val lms = if (k != null) List(5) { j ->
                        PointF((cx + k[i * 10 + j * 2] * stride) / scale, (cy + k[i * 10 + j * 2 + 1] * stride) / scale)
                    } else emptyList()
                    faces.add(Detection(box, lms, score))
                }
            }
        }
        tensor.close()
        return nms(faces, NMS_IOU)
    }

    /**
     * Group photos: full-frame pass plus an overlapping tile grid so back-row
     * faces are seen 2–3× larger by the detector. Faces cut by an interior tile
     * edge are dropped (a neighbour or the full pass sees them whole).
     */
    fun detectTiled(bitmap: Bitmap, longSide: Int, threshold: Float): List<Detection> {
        val all = detect(bitmap, longSide, threshold).toMutableList()
        val w = bitmap.width; val h = bitmap.height
        val longDim = max(w, h)
        val grid = when {
            longDim >= longSide * 4.5f -> 3
            longDim >= longSide * 1.8f -> 2
            else -> 1
        }
        if (grid == 1) return all
        val frac = if (grid == 2) 0.6f else 0.42f
        val tw = (w * frac).toInt(); val th = (h * frac).toInt()
        val edge = 3f
        for (gy in 0 until grid) for (gx in 0 until grid) {
            val tx = if (grid == 1) 0 else ((w - tw) * gx / (grid - 1))
            val ty = if (grid == 1) 0 else ((h - th) * gy / (grid - 1))
            val tile = Bitmap.createBitmap(bitmap, tx, ty, tw, th)
            val found = detect(tile, longSide, threshold)
            tile.recycle()
            for (f in found) {
                if ((tx > 0 && f.box.left <= edge) || (ty > 0 && f.box.top <= edge) ||
                    (tx + tw < w && f.box.right >= tw - edge) || (ty + th < h && f.box.bottom >= th - edge)) continue
                all.add(Detection(
                    RectF(f.box.left + tx, f.box.top + ty, f.box.right + tx, f.box.bottom + ty),
                    f.landmarks.map { PointF(it.x + tx, it.y + ty) },
                    f.score
                ))
            }
        }
        return nms(all, NMS_IOU)
    }

    private fun nms(faces: List<Detection>, thr: Float): List<Detection> {
        val sorted = faces.sortedByDescending { it.score }.toMutableList()
        val keep = mutableListOf<Detection>()
        while (sorted.isNotEmpty()) {
            val best = sorted.removeAt(0)
            keep.add(best)
            sorted.removeAll { iou(best.box, it.box) > thr || containment(best.box, it.box) > 0.8f }
        }
        return keep
    }

    fun iou(a: RectF, b: RectF): Float {
        val ix = min(a.right, b.right) - max(a.left, b.left)
        val iy = min(a.bottom, b.bottom) - max(a.top, b.top)
        if (ix <= 0 || iy <= 0) return 0f
        val inter = ix * iy
        return inter / (a.width() * a.height() + b.width() * b.height() - inter)
    }

    /** Fraction of the smaller box covered by the larger (kills nested duplicates from tiles). */
    private fun containment(a: RectF, b: RectF): Float {
        val ix = min(a.right, b.right) - max(a.left, b.left)
        val iy = min(a.bottom, b.bottom) - max(a.top, b.top)
        if (ix <= 0 || iy <= 0) return 0f
        return ix * iy / min(a.width() * a.height(), b.width() * b.height())
    }

    // ─── Alignment / pose / quality ──────────────────────────────────────────

    fun align(bitmap: Bitmap, d: Detection): Bitmap {
        val out = Bitmap.createBitmap(REC_SIZE, REC_SIZE, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        canvas.drawColor(Color.BLACK)
        val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
        if (d.landmarks.size < 5) {
            val pad = 0.2f
            val src = RectF(d.box.left - d.box.width() * pad, d.box.top - d.box.height() * pad, d.box.right + d.box.width() * pad, d.box.bottom + d.box.height() * pad)
            val m = Matrix(); m.setRectToRect(src, RectF(0f, 0f, REC_SIZE.toFloat(), REC_SIZE.toFloat()), Matrix.ScaleToFit.FILL)
            canvas.drawBitmap(bitmap, m, paint)
            return out
        }
        canvas.drawBitmap(bitmap, similarity(d.landmarks), paint)
        return out
    }

    /** Least-squares similarity transform (Umeyama) from landmarks to the ArcFace template. */
    private fun similarity(lm: List<PointF>): Matrix {
        var smx = 0f; var smy = 0f; var dmx = 0f; var dmy = 0f
        for (i in 0 until 5) { smx += lm[i].x; smy += lm[i].y; dmx += TEMPLATE[i * 2]; dmy += TEMPLATE[i * 2 + 1] }
        smx /= 5; smy /= 5; dmx /= 5; dmy /= 5
        var ss = 0f; var a = 0f; var b = 0f
        for (i in 0 until 5) {
            val sx = lm[i].x - smx; val sy = lm[i].y - smy
            val dx = TEMPLATE[i * 2] - dmx; val dy = TEMPLATE[i * 2 + 1] - dmy
            ss += sx * sx + sy * sy
            a += sx * dx + sy * dy
            b += sx * dy - sy * dx
        }
        val s = if (ss > 0) sqrt(a * a + b * b) / ss else 1f
        val norm = sqrt(a * a + b * b).takeIf { it > 0 } ?: 1f
        val cos = a / norm; val sin = b / norm
        val tx = dmx - s * (cos * smx - sin * smy)
        val ty = dmy - s * (sin * smx + cos * smy)
        return Matrix().apply { setValues(floatArrayOf(s * cos, -s * sin, tx, s * sin, s * cos, ty, 0f, 0f, 1f)) }
    }

    /** Yaw ≈ nose offset from eye midpoint, in eye-distance units (0 = frontal). */
    fun yaw(d: Detection): Float {
        if (d.landmarks.size < 3) return 0f
        val l = d.landmarks[0]; val r = d.landmarks[1]; val n = d.landmarks[2]
        val dist = sqrt((r.x - l.x) * (r.x - l.x) + (r.y - l.y) * (r.y - l.y))
        if (dist < 1f) return 0f
        return (n.x - (l.x + r.x) / 2) / dist
    }

    /** Laplacian variance on the aligned face (higher = sharper). */
    fun sharpness(face: Bitmap): Double {
        val w = face.width; val h = face.height
        val px = IntArray(w * h); face.getPixels(px, 0, w, 0, 0, w, h)
        val g = FloatArray(w * h) { i -> val p = px[i]; 0.299f * ((p shr 16) and 255) + 0.587f * ((p shr 8) and 255) + 0.114f * (p and 255) }
        var sum = 0.0; var sumSq = 0.0; var n = 0
        // Central region only — avoids black alignment borders inflating the score.
        for (y in h / 8 until h - h / 8) for (x in w / 8 until w - w / 8) {
            val v = (g[(y - 1) * w + x] + g[(y + 1) * w + x] + g[y * w + x - 1] + g[y * w + x + 1] - 4 * g[y * w + x]).toDouble()
            sum += v; sumSq += v * v; n++
        }
        if (n == 0) return 0.0
        val mean = sum / n
        return sumSq / n - mean * mean
    }

    // ─── Recognition ─────────────────────────────────────────────────────────

    /**
     * Embed aligned faces. With [flip], each face is also embedded mirrored and
     * the two are fused weighted by AdaFace feature norm (as in AdaFace eval).
     */
    fun embed(faces: List<Bitmap>, flip: Boolean): List<Embedding> {
        val session = recognizer ?: throw IllegalStateException("Recognizer not loaded")
        if (faces.isEmpty()) return emptyList()
        val per = 3 * REC_SIZE * REC_SIZE
        val views = if (flip) 2 else 1
        val batch = faces.size * views
        val data = FloatArray(batch * per)
        var off = 0
        val mirror = Matrix().apply { setScale(-1f, 1f, REC_SIZE / 2f, REC_SIZE / 2f) }
        for (f in faces) {
            System.arraycopy(toNCHW(f, 127.5f, 1f / 127.5f, bgr = true), 0, data, off, per); off += per
            if (flip) {
                val m = Bitmap.createBitmap(f, 0, 0, REC_SIZE, REC_SIZE, mirror, false)
                System.arraycopy(toNCHW(m, 127.5f, 1f / 127.5f, bgr = true), 0, data, off, per); off += per
                m.recycle()
            }
        }
        val raw = runRecognizer(session, data, batch)
        if (!flip) return raw
        return faces.indices.map { i ->
            val a = raw[i * 2]; val b = raw[i * 2 + 1]
            val wa = if (a.norm > 0) a.norm else 1f
            val wb = if (b.norm > 0) b.norm else 1f
            val fused = FloatArray(EMB_DIM) { k -> a.vector[k] * wa + b.vector[k] * wb }
            val n = l2(fused)
            for (k in fused.indices) fused[k] /= n
            Embedding(fused, if (a.norm > 0) n / 2f else -1f)
        }
    }

    private fun runRecognizer(session: OrtSession, data: FloatArray, batch: Int): List<Embedding> {
        val e = env!!
        val tensor = OnnxTensor.createTensor(e, FloatBuffer.wrap(data), longArrayOf(batch.toLong(), 3, REC_SIZE.toLong(), REC_SIZE.toLong()))
        try {
            session.run(mapOf(session.inputNames.first() to tensor)).use { out ->
                var emb: FloatArray? = null
                var norms: FloatArray? = null
                for (entry in out) {
                    val t = entry.value as? OnnxTensor ?: continue
                    when {
                        entry.key == "norm" -> norms = floats(t)
                        count(t) == batch * EMB_DIM -> emb = floats(t)
                    }
                }
                val v = emb ?: throw IllegalStateException("Recognizer produced no ${EMB_DIM}-d output")
                return List(batch) { i ->
                    val vec = v.copyOfRange(i * EMB_DIM, (i + 1) * EMB_DIM)
                    val n = l2(vec)
                    if (n < 1e-6f) throw IllegalStateException("Zero embedding")
                    for (k in vec.indices) vec[k] /= n
                    Embedding(vec, norms?.getOrNull(i) ?: -1f)
                }
            }
        } finally {
            tensor.close()
        }
    }

    // ─── Tensor helpers ──────────────────────────────────────────────────────

    private fun toNCHW(bmp: Bitmap, mean: Float, invStd: Float, bgr: Boolean): FloatArray {
        val w = bmp.width; val h = bmp.height; val area = w * h
        val px = IntArray(area); bmp.getPixels(px, 0, w, 0, 0, w, h)
        val out = FloatArray(3 * area)
        val c0 = if (bgr) 2 * area else 0
        val c2 = if (bgr) 0 else 2 * area
        for (i in 0 until area) {
            val p = px[i]
            out[c0 + i] = (((p shr 16) and 255) - mean) * invStd // R
            out[area + i] = (((p shr 8) and 255) - mean) * invStd // G
            out[c2 + i] = ((p and 255) - mean) * invStd // B
        }
        return out
    }

    private fun floats(t: OnnxTensor): FloatArray {
        val buf = t.floatBuffer.duplicate(); buf.rewind()
        val n = min(count(t), buf.remaining())
        return FloatArray(n).also { buf.get(it, 0, n) }
    }

    private fun count(t: OnnxTensor): Int {
        var c = 1L
        for (d in t.info.shape) { if (d <= 0) return 0; c *= d }
        return c.toInt()
    }

    private fun lastDim(t: OnnxTensor): Int = t.info.shape.lastOrNull()?.toInt() ?: 0

    private fun l2(v: FloatArray): Float { var s = 0f; for (x in v) s += x * x; return sqrt(s) }
    private fun dot(a: FloatArray, b: FloatArray): Float { var s = 0f; for (i in a.indices) s += a[i] * b[i]; return s }

    /** Count "big" cores (max freq ≥ 70% of the fastest) — little cores slow ORT down. */
    private fun performanceCoreCount(): Int {
        val total = Runtime.getRuntime().availableProcessors()
        val freqs = (0 until total).mapNotNull { i ->
            try { File("/sys/devices/system/cpu/cpu$i/cpufreq/cpuinfo_max_freq").readText().trim().toLong() } catch (_: Exception) { null }
        }
        val big = if (freqs.size == total && freqs.isNotEmpty()) {
            val top = freqs.max()
            freqs.count { it >= top * 0.7 }
        } else total / 2
        return big.coerceIn(2, 4)
    }

    companion object {
        const val REC_SIZE = 112
        const val EMB_DIM = 512
        const val MIN_DET_SIZE = 12f
        const val NMS_IOU = 0.4f
        private const val KEY_BACKEND = "rec_backend"
        private const val KEY_TUNING = "tuning_in_progress"
        private val TEMPLATE = floatArrayOf(
            38.2946f, 51.6963f, 73.5318f, 51.5014f, 56.0252f, 71.7366f, 41.5493f, 92.3655f, 70.7299f, 92.2041f
        )
    }
}
