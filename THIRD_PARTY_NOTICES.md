# Third-party notices

ReadMate AI's optional offline Asante Twi fallback uses these upstream components. They are not relicensed by ReadMate's project license.

## Nano-Twi

- Project and integration examples: <https://github.com/michsethowusu/nano-twi>
- Model repository: <https://huggingface.co/ghananlpcommunity/nano-twi>
- Release bundle: `v1.0/nano-twi-sherpa-onnx.zip`
- ReadMate-pinned bundle SHA-256: `ba2372d44c2eebd3dc6bb8f9654f1c7693e2223eee4457a859824b70983d9982`
- Upstream model card license: MIT. The upstream card states that Matcha-TTS, Vocos, sherpa-onnx, and eSpeak NG retain their respective licenses.

## sherpa-onnx Node runtime

- Package: `sherpa-onnx-node` version `1.13.6`
- Project: <https://github.com/k2-fsa/sherpa-onnx>
- License: Apache-2.0

The container downloads the pinned Nano-Twi release at build time, verifies the checksum, and ships only the quality acoustic model, vocoder, tokens, and required eSpeak NG data. Consult the upstream projects for their complete license texts and source.
