import importlib.util
import json
import os
import subprocess
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


def manifest(record):
    return {"mediaType": sync.MANIFEST, "config": {"mediaType": sync.CONFIG}, "annotations": {sync.ANNOTATION: json.dumps(record)},
            "layers": [{"size": record["size"], "digest": "sha256:" + record["sha256"], "mediaType": sync.LAYER}]}


class AndroidPublication(unittest.TestCase):
    def test_official_release_and_raw_blob(self):
        record = sync.release_record(release())
        data = manifest(record)
        self.assertEqual(sync.manifest_record(data), record)
        data["layers"][0]["size"] += 1
        with self.assertRaisesRegex(ValueError, "differs"):
            sync.manifest_record(data)
        web_only = dict(release(tag="v0.13.25"), assets=[])
        self.assertIsNone(sync.release_record(web_only))
        with self.assertRaisesRegex(ValueError, "exactly one"):
            sync.release_record(dict(release(), assets=[]))

    def test_reconciliation_selects_highest_code_and_rejects_conflicting_duplicates(self):
        new, old = release(17), release(16, "v0.13.23")
        with patch("subprocess.check_output", return_value=json.dumps([[new, old]]).encode()):
            self.assertEqual(sync.github("")[1]["versionCode"], 17)
        old = release(17, "v0.13.23")
        old["assets"][0]["digest"] = "sha256:" + "b"*64
        with patch("subprocess.check_output", return_value=json.dumps([[new, old]]).encode()):
            with self.assertRaisesRegex(ValueError, "conflict"):
                sync.github("")

    def test_retry_existing_version_verifies_blob_without_downgrading_latest(self):
        old, new = sync.release_record(release(16)), sync.release_record(release(17))
        calls = []
        def invoke(args, **kwargs):
            calls.append(args)
            if args[1:3] == ["repo", "tags"]:
                data = b"android-channel-latest\nandroid-apk-16\n"
            elif args[1:3] == ["manifest", "fetch"]:
                item = new if args[3].endswith(sync.LATEST) else old
                data = json.dumps(manifest(item)).encode()
            else:
                data = b""
            return subprocess.CompletedProcess(args, 0, stdout=data)
        with (patch.dict(os.environ, {"RELEASE_TAG": "v0.13.23", "ACR_USERNAME": "test", "ACR_PASSWORD": "test"}),
              patch.object(sync, "github", return_value=("v0.13.23", old)),
              patch("subprocess.run", side_effect=invoke), patch.object(sync, "check_file") as verify):
            sync.main()
        verify.assert_called_once()
        self.assertTrue(any(a[1:3] == ["blob","fetch"] for a in calls))
        self.assertFalse(any(a[1] in ("push","tag") for a in calls))


if __name__ == "__main__":
    unittest.main()
