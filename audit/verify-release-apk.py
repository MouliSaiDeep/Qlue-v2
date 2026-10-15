"""Inspect the universal production APK; no device/install/network access."""
import sys, zipfile, json, hashlib
from pathlib import Path
apk = Path(sys.argv[1])
with zipfile.ZipFile(apk) as z:
    names = set(z.namelist())
    assert 'AndroidManifest.xml' in names
    assert not any('/assets/speech/' in n for n in names), 'Offline models bundled'
    assert not any(n.endswith(('/libonnxruntime.so', '/libsherpa-onnx-c-api.so', '/libsherpa-onnx-cxx-api.so')) for n in names), 'Offline native libraries bundled'
    abis = sorted({n.split('/')[1] for n in names if n.startswith('lib/')})
    assert abis == ['arm64-v8a', 'armeabi-v7a', 'x86_64'], abis
    for abi in abis:
        for lib in ['libapp.so', 'libflutter.so', 'libdartjni.so', 'libdatastore_shared_counter.so']:
            assert f'lib/{abi}/{lib}' in names, (abi, lib)
    fonts = sorted(n for n in names if '/assets/fonts/' in n and n.endswith('.ttf'))
    assert {Path(n).name for n in fonts} == {'Montserrat-Regular.ttf', 'Montserrat-Bold.ttf'}, fonts
    for font in fonts:
        assert z.read(font) == (Path(__file__).resolve().parents[1] / 'frontend/assets/fonts' / Path(font).name).read_bytes(), font
    assert z.testzip() is None
print(json.dumps({'apkBytes':apk.stat().st_size, 'sha256':hashlib.sha256(apk.read_bytes()).hexdigest(), 'abis':abis, 'bundledFonts':len(fonts), 'offlineResourcesAbsent':True}))
