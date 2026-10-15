# Temporary answer delivery analysis runtime

This isolated layer belongs only to `AnswerAudioFunction`. Standard `sam build --use-container` invokes the Makefile. It installs the locked ONNX Runtime package without install scripts, retains the CPU Linux ARM64 binary only, and includes the licensed Silero v5 model. No GPU, speech transcription model, or Android asset is added.

- Model source: https://raw.githubusercontent.com/snakers4/silero-vad/v5.0/files/silero_vad.onnx
- Model SHA-256: `6b99cbfd39246b6706f98ec13c7c50c6b299181f2474fa05cbc8046acc274396`
- Model license: MIT, retained in `models/SILERO-LICENSE.txt`.
- Runtime: pinned `onnxruntime-node` 1.30.0, its bundled licenses remain in the artifact.
- Protocol: mono PCM16 at 16 kHz; 512-sample frames plus 64 samples of context; recurrent state `[2,1,128]` reset between contiguous capture segments.
- Native support: https://onnxruntime.ai/docs/get-started/with-javascript/node.html

For local package inspection: `node build.cjs <dedicated-artifact-directory>`. The resulting layer was tested in the Node 24 Lambda Linux ARM64 image with networking disabled. That test used CPU emulation on Windows; it does not establish production Lambda latency. Benchmark actual supported phones and native AWS execution before release.

Speech probability is a detector output, not vocal confidence. Timing, clipping, and speech/non-speech contrast are uncalibrated observations. Contrast is not a measured SNR. Pause smoothing/quality thresholds do not grade a candidate. Numeric confidence remains unavailable pending human-rated calibration.
