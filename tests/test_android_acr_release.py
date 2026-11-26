import importlib.util
import json
import os
import hashlib
import gzip
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


path = Path(__file__).resolve().parents[1] / "scripts" / "sync-android-acr.py"
spec = importlib.util.spec_from_file_location("sync_android_acr", path)
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


def release(code=17, tag="android-v0.1.15"):
    name = f"pipi-phone-android-0.1.15-{code}.apk"
    asset = {"name": name, "digest": "sha256:" + "a" * 64, "size": 123, "state": "uploaded",
             "browser_download_url": f"https://github.com/{sync.REPO}/releases/download/{tag}/{name}"}
    return {"tag_name": tag, "draft": False, "prerelease": False, "assets": [asset]}


class AndroidPublication(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        data = b"PK\x03\x04signed apk bytes" * 40
        self.record = sync.release_record(release())
        self.record.update(size=len(data), sha256=hashlib.sha256(data).hexdigest())
        self.apk = self.base / self.record["name"]
        self.apk.write_bytes(data)

    def layout(self, name):
        layout = self.base / name
        sync.image_layout(layout, self.apk, self.record)
        desc = json.loads((layout / "index.json").read_bytes())["manifests"][0]
        blobs = layout / "blobs" / "sha256"
        raw = (blobs / desc["digest"][7:]).read_bytes()
        self.assertEqual(sync.acr["sha256"](raw), desc["digest"])
        return layout, json.loads(raw)

    def test_real_deterministic_single_file_image(self):
        layout, manifest = self.layout("one")
        self.assertEqual(self.layout("two")[1], manifest)
        self.assertEqual(sync.manifest_record(manifest), self.record)
        layer = manifest["layers"][0]
        self.assertNotEqual(layer["digest"], "sha256:" + self.record["sha256"])
        blobs = layout / "blobs" / "sha256"
        config = json.loads((blobs / manifest["config"]["digest"][7:]).read_bytes())
        raw_tar = gzip.decompress((blobs / layer["digest"][7:]).read_bytes())
        self.assertEqual(config["rootfs"]["diff_ids"], [sync.acr["sha256"](raw_tar)])
        sync.verify_download(layout, manifest, self.record)
        with self.assertRaisesRegex(ValueError, "Downloaded APK"):
            sync.verify_download(layout, manifest, dict(self.record, sha256="b" * 64))
        with self.assertRaisesRegex(ValueError, "single APK"):
            sync.verify_download(layout, manifest, dict(self.record, name="renamed.apk"))

    def test_reject_raw_and_missing_release_assets(self):
        layout, manifest = self.layout("bad")
        manifest["annotations"][sync.ANNOTATION] = json.dumps(dict(self.record, encoding="raw"))
        with self.assertRaisesRegex(ValueError, "differs"):
            sync.manifest_record(manifest)
        self.assertIsNone(sync.release_record(dict(release(tag="v0.13.25"), assets=[])))
        with self.assertRaisesRegex(ValueError, "exactly one"):
            sync.release_record(dict(release(), assets=[]))

    def test_retry_existing_version_verifies_anonymously_without_downgrade(self):
        layout, manifest = self.layout("retry")
        newer_record = dict(self.record, versionCode=self.record["versionCode"]+1)
        latest = dict(manifest, annotations={sync.ANNOTATION: json.dumps(newer_record)})
        def inspect(ref, _auth):
            return sync.acr["json_bytes"](latest if ref.endswith(sync.LATEST) else manifest)
        def copy(source, destination, auth):
            self.assertTrue(source.startswith("docker://" + sync.MIRROR + "@sha256:"))
            self.assertEqual(auth.name, "public.json")
            shutil.copytree(layout, destination.removeprefix("oci:").removesuffix(":apk"))
        with (patch.dict(os.environ, {"RELEASE_TAG": "android-v0.1.15", "ACR_USERNAME": "user", "ACR_PASSWORD": "pass"}),
              patch.object(sync, "github", return_value=("android-v0.1.15", self.record)),
              patch.dict(sync.acr, {"inspect": inspect, "copy": copy,
                                    "registry": lambda *a, **kw: b'{"Tags":["android-image-latest","android-image-17"]}'})):
            sync.main()


if __name__ == "__main__":
    unittest.main()
