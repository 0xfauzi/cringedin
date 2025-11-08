# Third-party runtime assets

This folder is intentionally empty. Drop the following files here to enable
local student inference inside the offscreen document:

- `transformers.min.js` – UMD build of [@xenova/transformers](https://github.com/xenova/transformers.js).
  Download from a trusted source (e.g. jsDelivr) and place the file alongside
  this README.
- Optional: any ONNX Runtime WASM/WebGPU assets required by your model.

The extension will automatically load `transformers.min.js` from this directory.
If the file is missing, local inference will be disabled and the service worker
will fall back to the teacher API.

