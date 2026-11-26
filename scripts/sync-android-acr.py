"""Mirror a signed GitHub release asset as an exact, anonymously readable OCI blob."""
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path


REPO = "chouoi344/pipi-phone"
HOST = "crpi-7a803jqeqt4g8l32.cn-hangzhou.personal.cr.aliyuncs.com"
MIRROR = HOST + "/" + REPO
ANNOTATION = "io.pipi-phone.android"
LATEST = "android-channel-latest"
APK = re.compile(r"pipi-phone-android-([0-9]+(?:\.[0-9]+){1,3})-([1-9][0-9]{0,9})\.apk")
TAG = re.compile(r"android-v[0-9]+(?:\.[0-9]+){1,3}|v[0-9]+\.[0-9]+\.[0-9]+")
# Personal ACR only accepts image-layer descriptors. This is an artifact tag
# for the updater: the blob holds the original signed APK and is read by digest.
# No runnable image or filesystem extraction is involved.
LAYER = "application/vnd.oci.image.layer.v1.tar"
CONFIG = "application/vnd.oci.image.config.v1+json"
MANIFEST = "application/vnd.oci.image.manifest.v1+json"
# OfficialUpdates.java requires the exact same signer set as the installed APK.
OFFICIAL_SIGNER = "3dc5fb291f3314c96d36c8fd1c2177ac4679ed4c3d7a10fcd9764c5acb99990a"


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
    return {"name": name, "versionName": version, "versionCode": int(code), "size": size, "sha256": digest[7:]}


def github(tag):
    if tag:
        if not TAG.fullmatch(tag):
            raise ValueError("Expected a public stable release tag")
        item = json.loads(subprocess.check_output(["gh", "api", f"repos/{REPO}/releases/tags/{tag}"]))
        if item["tag_name"] != tag:
            raise ValueError("GitHub returned another tag")
        return tag, release_record(item)
    pages = json.loads(subprocess.check_output(["gh", "api", "--paginate", "--slurp", f"repos/{REPO}/releases?per_page=100"]))
    versions = {}
    for page in pages:
        for item in page:
            record = release_record(item)
            if record:
                code = record["versionCode"]
                if code in versions and versions[code][1] != record:
                    raise ValueError(f"Published APKs conflict for versionCode {code}")
                versions[code] = (item["tag_name"], record)
    return versions[max(versions)] if versions else (None, None)


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
    if (len(layers) != 1 or layers[0]["digest"] != "sha256:" + record["sha256"]
            or layers[0]["size"] != record["size"] or layers[0]["mediaType"] != LAYER):
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


def main():
    requested = os.environ.get("RELEASE_TAG", "")
    tag, record = github(requested)
    if not record:
        print("No official Android APK attached; nothing to sync")
        return
    fixed = "android-apk-" + str(record["versionCode"])
    with tempfile.TemporaryDirectory() as tmp:
        folder = Path(tmp)
        public, writer = folder / "public.json", folder / "writer.json"
        public.write_text('{"auths":{}}')

        def oras(*args, auth=public, data=None):
            return subprocess.run(["oras", *map(str, args), "--registry-config", str(auth)],
                                  input=data, cwd=folder, stdout=subprocess.PIPE, check=True).stdout

        def read(tag_name):
            return manifest_record(json.loads(oras("manifest", "fetch", MIRROR + ":" + tag_name)))

        tags = set(oras("repo", "tags", MIRROR).decode().splitlines())
        latest = read(LATEST) if LATEST in tags else None
        if latest and latest["versionCode"] == record["versionCode"] and latest != record:
            raise ValueError("Refusing to replace a published APK versionCode")
        if fixed in tags and read(fixed) != record:
            raise ValueError("Fixed domestic APK differs from GitHub")
        if not requested and latest == record and fixed in tags:
            print("Latest APK already verified and in sync:", record["name"])
            return
        user, password = os.environ.pop("ACR_USERNAME"), os.environ.pop("ACR_PASSWORD")
        if not (user and password):
            raise ValueError("Set ACR_USERNAME and ACR_PASSWORD in GitHub Actions secrets")
        oras("login", "--username", user, "--password-stdin", HOST, auth=writer, data=password.encode())
        if fixed not in tags:
            name = record["name"]
            subprocess.run(["gh", "release", "download", tag, "--repo", REPO, "--pattern", name, "--dir", folder], check=True)
            check_file(folder / name, record)
            check_signature(folder / name, record)
            (folder / "config.json").write_text('{"architecture":"unknown","os":"unknown","config":{},"rootfs":{"type":"layers","diff_ids":[]}}')
            oras("push", "--image-spec", "v1.0", "--config", "config.json:" + CONFIG,
                 "--annotation", ANNOTATION + "=" + json.dumps(record, separators=(",", ":")),
                 MIRROR + ":" + fixed, name + ":" + LAYER, auth=writer)
        if read(fixed) != record:
            raise ValueError("Public fixed APK manifest readback differs from GitHub")
        downloaded = folder / "public-download.apk"
        oras("blob", "fetch", "--output", downloaded, MIRROR + "@sha256:" + record["sha256"])
        check_file(downloaded, record)
        if latest is None or latest["versionCode"] < record["versionCode"]:
            oras("tag", MIRROR + ":" + fixed, LATEST, auth=writer)
            if read(LATEST) != record:
                raise ValueError("Public Android channel readback failed")
        print(f"Verified public APK {record['name']}: {record['size']} bytes, SHA-256 {record['sha256']}")


if __name__ == "__main__":
    main()
