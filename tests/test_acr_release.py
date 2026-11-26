import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


path = Path(__file__).resolve().parents[1] / "scripts" / "sync-acr.py"
spec = importlib.util.spec_from_file_location("sync_acr", path)
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


def record(version="0.13.24"):
    return {"version": version, "image": sync.SOURCE + "@sha256:" + "a" * 64,
            "notes": "发布说明", "publishedAt": "2026-11-25T12:00:00Z"}


class DomesticPublication(unittest.TestCase):
    def test_retry_preserves_fixed_record_and_newer_latest(self):
        old = record()
        tags = {"channel-v0.13.24": old, "channel-latest": record("0.14.0")}
        sync.publish_channel(old, tags, tags.__getitem__, self.fail)
        tags["channel-v0.13.24"] = dict(old, image=sync.SOURCE + "@sha256:" + "b" * 64)
        with self.assertRaisesRegex(ValueError, "existing version"):
            sync.publish_channel(old, tags, tags.__getitem__, self.fail)

    def test_channel_written_after_verified_fixed_tag_then_idempotent(self):
        current, tags, order = record(), {}, []

        def write(tag):
            order.append(tag)
            tags[tag] = current

        sync.publish_channel(current, tags, tags.__getitem__, write)
        self.assertEqual(order, ["channel-v0.13.24", "channel-latest"])
        sync.publish_channel(current, tags, tags.__getitem__, self.fail)

    def test_verify_failure_at_fixed_tag_does_not_publish_latest(self):
        writes = []

        def fail_at_fixed(tag):
            writes.append(tag)
            raise RuntimeError("readback failed")

        with self.assertRaisesRegex(RuntimeError, "readback"):
            sync.publish_channel(record(), [], self.fail, fail_at_fixed)
        self.assertEqual(writes, ["channel-v0.13.24"])

    def test_real_oci_layout_and_annotation(self):
        with tempfile.TemporaryDirectory() as folder:
            layout = Path(folder)
            sync.write_layout(layout, record())
            index = json.loads((layout / "index.json").read_bytes())
            descriptor = index["manifests"][0]
            blobdir = layout / "blobs" / "sha256"
            raw = (blobdir / descriptor["digest"].split(":")[1]).read_bytes()
            self.assertEqual(sync.sha256(raw), descriptor["digest"])
            manifest = json.loads(raw)
            self.assertEqual(manifest["mediaType"], sync.MANIFEST_TYPE)
            self.assertEqual(sync.validate(json.loads(manifest["annotations"][sync.ANNOTATION])), record())
            config = manifest["config"]
            self.assertEqual(sync.sha256((blobdir / config["digest"].split(":")[1]).read_bytes()), config["digest"])

    def test_backfill_requires_matching_official_release_and_catalog(self):
        with (patch("subprocess.check_output", return_value=sync.json_bytes(record())),
              patch.object(sync, "read_url", return_value={"version": "0.13.24", "image": "other"})):
            with self.assertRaisesRegex(ValueError, "disagree"):
                sync.get_record("v0.13.24")

    def test_anon_verification_requires_exact_digest_and_both_platforms(self):
        def index(architectures):
            return sync.json_bytes({"manifests": [{"platform": {"os": "linux", "architecture": a}} for a in architectures]})

        good, bad = index(["amd64", "arm64"]), index(["amd64"])
        with patch.object(sync, "inspect", side_effect=[good, good]):
            sync.verify_image("v0.13.24", sync.sha256(good), "anon")
        with patch.object(sync, "inspect", side_effect=[bad, bad]):
            with self.assertRaisesRegex(ValueError, "both supported"):
                sync.verify_image("v0.13.24", sync.sha256(bad), "anon")
        with patch.object(sync, "inspect", side_effect=[good, bad]):
            with self.assertRaisesRegex(ValueError, "differs"):
                sync.verify_image("v0.13.24", sync.sha256(good), "anon")


if __name__ == "__main__":
    unittest.main()
