# ONNX Model Files Required

The FaceScan app requires two ONNX model files to be placed in this directory:

## Required Files

| File | Model | Size | Source |
|------|-------|------|--------|
| `scrfd_500m_kps.onnx` | SCRFD Face Detector | ~1MB | [InsightFace Model Zoo](https://github.com/deepinsight/insightface/tree/master/detection/scrfd) |
| `mobilefacenet.onnx` | MobileFaceNet Recognizer | ~3.8MB | [ArcFace Models](https://github.com/deepinsight/insightface/tree/master/recognition/arcface_torch) |

## How to Get the Models

### SCRFD Detector
```bash
# Download scrfd_500m_kps from InsightFace
# Export to ONNX using:
python -m mxnet_to_onnx scrfd_500m_kps
# Or use the pre-exported ONNX from:
# https://github.com/deepinsight/insightface/releases
```

### MobileFaceNet Recognizer
```bash
# Use the ArcFace MobileFaceNet ONNX export:
# Model: mobilefacenet from insightface model zoo
# Input: [1, 3, 112, 112], normalized to [-1, 1]
# Output: [1, 512] L2-normalized embedding
```

## Input Specifications

### SCRFD Input
- Input: `input.1` — shape `[1, 3, 640, 640]`
- Normalization: `(pixel - 127.5) / 128.0`
- Outputs: `score_8, score_16, score_32, bbox_8, bbox_16, bbox_32, kps_8, kps_16, kps_32`

### MobileFaceNet Input  
- Input: shape `[1, 3, 112, 112]`
- Normalization: `(pixel - 127.5) / 128.0`
- Output: `[1, 512]` L2-normalized embedding

## Alternative: ms1mv3 MobileFaceNet
A commonly used ONNX-compatible model is available via `buffalo_s` from the InsightFace model zoo:
```
https://github.com/deepinsight/insightface/releases/tag/v0.7
```

## Placement
After downloading, copy both `.onnx` files into:
```
attendance-thingy/assets/models/
├── scrfd_500m_kps.onnx
└── mobilefacenet.onnx
```

The app copies them from assets to the document directory on first launch.
