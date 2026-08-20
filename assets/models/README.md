# ONNX Model Files

The FaceScan app uses two ONNX models:

## Required Files

| File | Model | Size | Notes |
|------|-------|------|-------|
| `scrfd_10g_kps.onnx` | SCRFD-10G Face Detector | ~17MB | Best InsightFace detector |
| `adaface_ir101.onnx` | AdaFace IR-101 Recognizer | ~170MB | State-of-the-art for low-quality images |

## Download

```bash
# From yakhyo/adaface-onnx releases:
curl -L -o scrfd_10g_kps.onnx "https://github.com/yakhyo/adaface-onnx/releases/download/weights/det_10g.onnx"
curl -L -o adaface_ir101.onnx "https://github.com/yakhyo/adaface-onnx/releases/download/weights/adaface_ir_101.onnx"
```

## Input Specifications

### SCRFD-10G Detector
- Input: shape `[1, 3, 640, 640]`
- Normalization: `(pixel - 127.5) / 128.0`
- Outputs: 9 tensors (scores, boxes, keypoints at strides 8/16/32)

### AdaFace IR-101 Recognizer
- Input: shape `[1, 3, 112, 112]` (112×112 aligned face crop)
- Normalization: `(pixel - 127.5) / 127.5` ← different from ArcFace (128.0)!
- Output: `[1, 512]` L2-normalized embedding
- Trained on: MS1MV2 (5.8M images, 85K identities)

## Why AdaFace IR-101?

AdaFace uses **quality-adaptive margin** — it automatically handles low-quality images
(small faces, bad lighting, motion blur) which is exactly the challenge in classroom
group photos. IR-101 (IResNet-101 backbone) is the largest and most accurate variant.

## Placement

Download models locally (they are **gitignored** — GitHub rejects files > 100MB):

```bash
npm run download-models
```

```
attendance-thingy/assets/models/
├── scrfd_10g_kps.onnx     (~17MB)
└── adaface_ir101.onnx     (~249MB)
```
