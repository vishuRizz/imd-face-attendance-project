#!/usr/bin/env python3
"""
Prepare the downloaded ONNX models for the app (run once after `npm run download-models`):

    pip install onnx
    python3 scripts/prepare-models.py

1. AdaFace IR-101: expose the pre-normalisation feature norm as a second
   output named "norm". In AdaFace the feature norm is a learned image-quality
   signal (low for blurry / tiny / side-on faces); the app uses it to gate and
   weight matches and to fuse flip-augmented embeddings exactly like the
   AdaFace evaluation code does.
2. SCRFD: mark the outputs' anchor dimension as dynamic. The exported model
   hard-codes 640x640 shapes, which makes ONNX Runtime log a warning on every
   frame when we run it at other (faster / aspect-correct) resolutions.

The script is idempotent: running it twice leaves the models unchanged.
"""
import os
import sys

import onnx
from onnx import TensorProto, helper

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "models")
REC = os.path.join(ROOT, "adaface_ir101.onnx")
DET = os.path.join(ROOT, "scrfd_10g_kps.onnx")


def patch_recognizer(path: str) -> None:
    model = onnx.load(path)
    graph = model.graph
    if any(o.name == "norm" for o in graph.output):
        print(f"[ok] {os.path.basename(path)} already exposes 'norm'")
        return
    reduce_nodes = [n for n in graph.node if n.op_type == "ReduceL2"]
    div_nodes = [n for n in graph.node if n.op_type == "Div" and "output" in n.output]
    if not reduce_nodes or not div_nodes:
        sys.exit("Recognizer graph does not end in ReduceL2 -> Div; refusing to patch.")
    norm_tensor = reduce_nodes[-1].output[0]
    graph.node.append(helper.make_node("Identity", [norm_tensor], ["norm"], name="expose_norm"))
    graph.output.append(helper.make_tensor_value_info("norm", TensorProto.FLOAT, ["batch_size", 1]))
    onnx.checker.check_model(model)
    tmp = path + ".tmp"
    onnx.save(model, tmp)
    os.replace(tmp, path)
    print(f"[patched] {os.path.basename(path)}: added 'norm' output")


def patch_detector(path: str) -> None:
    model = onnx.load(path)
    changed = False
    for out in model.graph.output:
        dims = out.type.tensor_type.shape.dim
        if dims and dims[0].dim_value:
            dims[0].ClearField("dim_value")
            dims[0].dim_param = "anchors"
            changed = True
    if not changed:
        print(f"[ok] {os.path.basename(path)} outputs already dynamic")
        return
    onnx.checker.check_model(model)
    tmp = path + ".tmp"
    onnx.save(model, tmp)
    os.replace(tmp, path)
    print(f"[patched] {os.path.basename(path)}: dynamic output shapes")


if __name__ == "__main__":
    for p in (REC, DET):
        if not os.path.exists(p):
            sys.exit(f"Missing {p}. Run `npm run download-models` first.")
    patch_recognizer(REC)
    patch_detector(DET)
