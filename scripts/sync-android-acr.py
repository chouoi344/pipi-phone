"""Publish the original signed APK inside a standard, one-file OCI image layer."""
import gzip
import hashlib
import json
import os
import re
import runpy
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path


REPO = "chouoi344/pipi-phone"
HOST = "crpi-7a803jqeqt4g8l32.cn-hangzhou.personal.cr.aliyuncs.com"
MIRROR = HOST + "/" + REPO
ANNOTATION = "io.pipi-phone.android"
LATEST = "android-image-latest"
APK = re.compile(r"pipi-phone-android-([0-9]+(?:\.[0-9]+){1,3})-([1-9][0-9]{0,9})\.apk")
TAG = re.compile(r"android-v[0-9]+(?:\.[0-9]+){1,3}|v[0-9]+\.[0-9]+\.[0-9]+")
LAYER = "application/vnd.oci.image.layer.v1.tar+gzip"
CONFIG = "application/vnd.oci.image.config.v1+json"
MANIFEST = "application/vnd.oci.image.manifest.v1+json"
# OfficialUpdates.java requires the exact same signer set as the installed APK.
OFFICIAL_SIGNER = "3dc5fb291f3314c96d36c8fd1c2177ac4679ed4c3d7a10fcd9764c5acb99990a"
acr = runpy.run_path(str(Path(__file__).with_name("sync-acr.py")))


def release_record(release):
    tag = release["tag_name"]
    if release["draft"] or release["prerelease"] or not TAG.fullmatch(tag):
        return None
    files = [a for a in release["assets"] if APK.fullmatch(a["name"])]
    if not files and tag.startswith("v"):
        return None  # Web-only release.
    if len(files) != 1:
        raise ValueError(f"{tag} must have exactly one official APK attached when published")
    a = files[0]
    name, digest, size = a["name"], a["digest"], a["size"]
    version, code = APK.fullmatch(name).groups()
    if (a["state"] != "uploaded" or not isinstance(digest, str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest)
            or not 0 < size <= 512 * 1024**2 or int(code) > 2147483647
            or a["browser_download_url"] != f"https://github.com/{REPO}/releases/download/{tag}/{name}"
            or (tag.startswith("android-v") and tag != "android-v" + version)):
        raise ValueError(f"Invalid APK asset in {tag}")
    return {"name": name, "versionName": version, "versionCode": int(code), "size": size, "sha256": digest[7:],
            "encoding": "tar+gzip"}


def github(tag):
    if not TAG.fullmatch(tag):
        raise ValueError("Expected a public stable release tag")
    item = json.loads(subprocess.check_output(["gh", "api", f"repos/{REPO}/releases/tags/{tag}"]))
    if item["tag_name"] != tag:
        raise ValueError("GitHub returned another tag")
    return tag, release_record(item)


def check_file(path, record):
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if path.stat().st_size != record["size"] or digest != record["sha256"]:
        raise ValueError("APK bytes do not match the release asset size and digest")


def manifest_record(manifest):
    if manifest.get("mediaType") != MANIFEST or manifest["config"]["mediaType"] != CONFIG:
        raise ValueError("Unexpected APK channel manifest or config")
    record = json.loads(manifest["annotations"][ANNOTATION])
    layers = manifest["layers"]
    if (record.get("encoding") != "tar+gzip" or len(layers) != 1 or layers[0]["mediaType"] != LAYER
            or not re.fullmatch(r"sha256:[a-f0-9]{64}", layers[0]["digest"]) or layers[0]["size"] <= 0):
        raise ValueError("Domestic APK layer differs from channel metadata")
    return record


def check_signature(path, record):
    tools = Path(os.environ["ANDROID_HOME"]) / "build-tools" / "35.0.0"
    certificates = subprocess.check_output([tools / "apksigner", "verify", "--print-certs", path], text=True)
    signers = re.findall(r"^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})$", certificates, re.MULTILINE)
    if signers != [OFFICIAL_SIGNER]:
        raise ValueError(f"APK signer check failed, expected {OFFICIAL_SIGNER}, parsed {signers}: {certificates}")
    badging = subprocess.check_output([tools / "aapt", "dump", "badging", path], text=True)
    expected = f"package: name='com.pipiphone.app' versionCode='{record['versionCode']}' versionName='{record['versionName']}'"
    if not badging.startswith(expected + " ") and badging.splitlines()[0] != expected:
        raise ValueError("APK package, version name or version code differs from the official asset")


def image_layout(layout, apk, record):
    blobs = layout / "blobs" / "sha256"
    blobs.mkdir(parents=True)

    def blob(value, media_type):
        data = acr["json_bytes"](value)
        digest = hashlib.sha256(data).hexdigest()
        (blobs / digest).write_bytes(data)
        return {"mediaType": media_type, "digest": "sha256:" + digest, "size": len(data)}

    with tempfile.TemporaryDirectory(dir=layout.parent) as scratch:
        raw = Path(scratch) / "layer.tar"
        with tarfile.open(raw, "w", format=tarfile.USTAR_FORMAT) as archive, apk.open("rb") as signed:
            entry = tarfile.TarInfo(record["name"])
            entry.size, entry.mode = record["size"], 0o644
            archive.addfile(entry, signed)
        compressed = Path(scratch) / "layer.gz"
        with raw.open("rb") as plain, compressed.open("wb") as output:
            diff_id = "sha256:" + hashlib.file_digest(plain, "sha256").hexdigest()
            plain.seek(0)
            with gzip.GzipFile(filename="", mode="wb", compresslevel=1, fileobj=output, mtime=0) as gz:
                shutil.copyfileobj(plain, gz)
        with compressed.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        layer = {"mediaType": LAYER, "digest": "sha256:" + digest, "size": compressed.stat().st_size}
        compressed.replace(blobs / digest)
    config = blob({"architecture": "amd64", "os": "linux", "config": {},
                   "rootfs": {"type": "layers", "diff_ids": [diff_id]}}, CONFIG)
    manifest = blob({"schemaVersion": 2, "mediaType": MANIFEST, "config": config, "layers": [layer],
                     "annotations": {ANNOTATION: acr["json_bytes"](record).decode()}}, MANIFEST)
    manifest["annotations"] = {"org.opencontainers.image.ref.name": "apk"}
    (layout / "oci-layout").write_text('{"imageLayoutVersion":"1.0.0"}')
    (layout / "index.json").write_bytes(acr["json_bytes"]({"schemaVersion": 2, "manifests": [manifest]}))


def verify_download(layout, manifest, record):
    layer = manifest["layers"][0]
    blob = layout / "blobs" / "sha256" / layer["digest"][7:]
    with blob.open("rb") as stream:
        if blob.stat().st_size != layer["size"] or "sha256:" + hashlib.file_digest(stream, "sha256").hexdigest() != layer["digest"]:
            raise ValueError("Anonymous layer differs from the public descriptor")
    with tarfile.open(blob, "r:gz") as archive:
        entry = archive.next()
        if entry is None or not entry.isfile() or entry.name != record["name"] or entry.size != record["size"]:
            raise ValueError("The image layer did not contain the official single APK")
        with archive.extractfile(entry) as apk:
            if hashlib.file_digest(apk, "sha256").hexdigest() != record["sha256"]:
                raise ValueError("Downloaded APK differs from the signed GitHub release")
        if archive.next() is not None:
            raise ValueError("Extra entries in the APK layer")


def main():
    tag, record = github(os.environ["RELEASE_TAG"])
    if not record:
        print("No official Android APK attached; nothing to sync")
        return
    fixed = "android-image-" + str(record["versionCode"])
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        public, writer = folder / "public.json", folder / "writer.json"
        public.write_text('{"auths":{}}')

        def read(name):
            return json.loads(acr["inspect"](MIRROR + ":" + name, public))

        tags = json.loads(acr["registry"]("list-tags", "--authfile", public, "docker://" + MIRROR))["Tags"]
        latest = manifest_record(read(LATEST)) if LATEST in tags else None
        if latest and latest["versionCode"] == record["versionCode"] and latest != record:
            raise ValueError("Refusing to replace a published APK versionCode")
        if fixed in tags and manifest_record(read(fixed)) != record:
            raise ValueError("Fixed domestic APK differs from GitHub")
        user, password = os.environ.pop("ACR_USERNAME"), os.environ.pop("ACR_PASSWORD")
        if not (user and password):
            raise ValueError("Set ACR_USERNAME and ACR_PASSWORD in GitHub Actions secrets")
        acr["registry"]("login", "--authfile", writer, "--username", user, "--password-stdin", HOST, data=password.encode())
        if fixed not in tags:
            name = record["name"]
            subprocess.run(["gh", "release", "download", tag, "--repo", REPO, "--pattern", name, "--dir", folder], check=True)
            check_file(folder / name, record)
            check_signature(folder / name, record)
            layout = folder / "image"
            image_layout(layout, folder / name, record)
            acr["copy"]("oci:" + str(layout) + ":apk", "docker://" + MIRROR + ":" + fixed, writer)
        raw = acr["inspect"](MIRROR + ":" + fixed, public)
        manifest = json.loads(raw)
        if manifest_record(manifest) != record:
            raise ValueError("Public fixed Android image readback differs from GitHub")
        immutable = "docker://" + MIRROR + "@" + acr["sha256"](raw)
        received = folder / "received"
        acr["copy"](immutable, "oci:" + str(received) + ":apk", public)
        verify_download(received, manifest, record)
        if latest is None or latest["versionCode"] < record["versionCode"]:
            acr["copy"](immutable, "docker://" + MIRROR + ":" + LATEST, writer)
            if acr["inspect"](MIRROR + ":" + LATEST, public) != raw:
                raise ValueError("Public Android channel readback failed")
        print(f"Verified public APK {record['name']}: {record['size']} bytes, SHA-256 {record['sha256']}")


if __name__ == "__main__":
    main()
