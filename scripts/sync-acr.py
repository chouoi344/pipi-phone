"""Copy the official release without rebuilding, then publish its domestic update record."""
import hashlib
import json
import os
import re
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from urllib.request import urlopen


REPO = "chouoi344/pipi-phone"
HOST = "crpi-7a803jqeqt4g8l32.cn-hangzhou.personal.cr.aliyuncs.com"
MIRROR = HOST + "/" + REPO
SOURCE = "ghcr.io/" + REPO
ANNOTATION = "io.pipi-phone.release"
MANIFEST_TYPE = "application/vnd.oci.image.manifest.v1+json"
DIGEST = re.compile(r"sha256:[a-f0-9]{64}")
SEMVER = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)")


def version_key(version):
    if not isinstance(version, str) or len(version) > 32 or not SEMVER.fullmatch(version):
        raise ValueError("Invalid stable version")
    return tuple(map(int, version.split(".")))


def json_bytes(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def validate(record):
    if not isinstance(record, dict) or set(record) != {"version", "image", "publishedAt", "notes"}:
        raise ValueError("Unexpected update record")
    version_key(record["version"])
    image = record["image"]
    if not isinstance(image, str) or not image.startswith(SOURCE + "@") or not DIGEST.fullmatch(image.split("@", 1)[1]):
        raise ValueError("Invalid GHCR image digest")
    if not isinstance(record["notes"], str) or len(record["notes"]) > 12000:
        raise ValueError("Invalid release notes")
    if datetime.fromisoformat(record["publishedAt"].replace("Z", "+00:00")).tzinfo is None:
        raise ValueError("Invalid publication time")
    return record


def read_url(url):
    with urlopen(url, timeout=30) as response:
        data = response.read(65537)
    if len(data) > 65536:
        raise ValueError("Update metadata exceeds its size limit")
    return json.loads(data)


def get_record(tag):
    # Read from the GitHub contents API: raw.githubusercontent.com can serve an
    # earlier channel snapshot immediately after the preceding publication job.
    contents = subprocess.check_output(["gh", "api", "-H", "Accept: application/vnd.github.raw+json",
                                        f"repos/{REPO}/contents/versions/{tag}.json?ref=update-channel"])
    if len(contents) > 65536:
        raise ValueError("Official directory record exceeds 64 KiB")
    record = validate(json.loads(contents))
    manifest = read_url(f"https://github.com/{REPO}/releases/download/{tag}/update.json")
    if record["version"] != tag[1:] or manifest != {"version": record["version"], "image": record["image"]}:
        raise ValueError("Release attachment and public update directory disagree")
    return record


def registry(*args, data=None):
    return subprocess.run(["skopeo", *map(str, args)], input=data, stdout=subprocess.PIPE, check=True).stdout


def inspect(ref, auth):
    return registry("inspect", "--authfile", auth, "--retry-times", "3", "--raw", "docker://" + ref)


def existing_digest(ref, auth):
    result = subprocess.run(["skopeo", "inspect", "--authfile", str(auth), "--retry-times", "3",
                             "--raw", "docker://" + ref], capture_output=True)
    if result.returncode == 0:
        return sha256(result.stdout)
    error = result.stderr.decode(errors="replace")
    if re.search(r"manifest unknown|name unknown|manifest_unknown|name_unknown", error, re.I):
        return None
    raise RuntimeError(error)


def copy(source, destination, auth):
    registry("copy", "--all", "--preserve-digests", "--retry-times", "3", "--authfile", auth, source, destination)


def read_tag(tag, auth):
    return json.loads(inspect(MIRROR + ":" + tag, auth))


def verify_image(tag, digest, anonymous):
    raw = inspect(MIRROR + ":" + tag, anonymous)
    if sha256(raw) != digest or sha256(inspect(MIRROR + "@" + digest, anonymous)) != digest:
        raise ValueError("Domestic public image differs from the official digest")
    platforms = {(m.get("platform", {}).get("os"), m.get("platform", {}).get("architecture"))
                 for m in json.loads(raw)["manifests"]}
    if not {("linux", "amd64"), ("linux", "arm64")}.issubset(platforms):
        raise ValueError("Domestic image does not contain both supported platforms")


def write_layout(folder, record):
    # An ordinary zero-layer OCI image transports the catalog on Registry V2.
    blobs = folder / "blobs" / "sha256"
    blobs.mkdir(parents=True)

    def blob(value, media_type):
        data = json_bytes(value)
        digest = sha256(data)
        (blobs / digest.split(":")[1]).write_bytes(data)
        return {"mediaType": media_type, "size": len(data), "digest": digest}

    config = blob({"architecture": "amd64", "os": "linux", "rootfs": {"type": "layers", "diff_ids": []},
                   "config": {}}, "application/vnd.oci.image.config.v1+json")
    manifest = blob({"schemaVersion": 2, "mediaType": MANIFEST_TYPE, "config": config, "layers": [],
                     "annotations": {ANNOTATION: json_bytes(record).decode()}}, MANIFEST_TYPE)
    manifest["annotations"] = {"org.opencontainers.image.ref.name": "channel"}
    (folder / "index.json").write_bytes(json_bytes({"schemaVersion": 2, "manifests": [manifest]}))
    (folder / "oci-layout").write_bytes(b'{"imageLayoutVersion":"1.0.0"}')


def stored_record(tag, auth):
    manifest = read_tag(tag, auth)
    if manifest.get("mediaType") != MANIFEST_TYPE:
        raise ValueError("Unexpected channel manifest media type")
    return validate(json.loads(manifest["annotations"][ANNOTATION]))


def publish_channel(record, tags, read, write):
    fixed = "channel-v" + record["version"]
    if fixed in tags:
        if read(fixed) != record:
            raise ValueError("Refusing to change the existing version record")
    else:
        write(fixed)
    if "channel-latest" in tags:
        latest = read("channel-latest")
        if version_key(latest["version"]) > version_key(record["version"]):
            return
        if latest["version"] == record["version"]:
            if latest != record:
                raise ValueError("Existing latest version disagrees with its fixed record")
            return
    write("channel-latest")


def main():
    tag = os.environ["RELEASE_TAG"]
    if not tag.startswith("v"):
        raise ValueError("Expected vX.Y.Z")
    version_key(tag[1:])
    digest = os.environ.get("BUILD_DIGEST", "")
    record = None
    if not digest:
        record = get_record(tag)
        digest = record["image"].split("@")[1]
    if not DIGEST.fullmatch(digest):
        raise ValueError("Expected a valid build digest")
    user, password = os.environ.pop("ACR_USERNAME"), os.environ.pop("ACR_PASSWORD")
    if not user or not password:
        raise ValueError("Set ACR_USERNAME and ACR_PASSWORD in GitHub Actions secrets")

    with tempfile.TemporaryDirectory() as temporary:
        base = Path(temporary)
        auth, anonymous = base / "auth.json", base / "anonymous.json"
        anonymous.write_bytes(b'{"auths":{}}')
        registry("login", "--authfile", auth, "--username", user, "--password-stdin", HOST, data=password.encode())
        # No registry credentials are sent to any other host. The source is public.
        current_digest = existing_digest(MIRROR + ":" + tag, auth)
        if current_digest is None:
            copy("docker://" + SOURCE + "@" + digest, "docker://" + MIRROR + ":" + tag, auth)
        elif current_digest != digest:
            raise ValueError(f"Refusing to overwrite {tag} with another digest; retry the original successful build")
        verify_image(tag, digest, anonymous)
        # Download every referenced manifest and blob anonymously before advertising.
        copy("docker://" + MIRROR + "@" + digest, "oci:" + str(base / "verification") + ":release", anonymous)
        print(f"Verified public amd64/arm64 mirror: {MIRROR}@{digest}", flush=True)
        if record is None:
            return
        tags = json.loads(registry("list-tags", "--authfile", auth, "docker://" + MIRROR))["Tags"]
        layout = base / "channel"
        write_layout(layout, record)

        def write(channel_tag):
            copy("oci:" + str(layout) + ":channel", "docker://" + MIRROR + ":" + channel_tag, auth)
            if stored_record(channel_tag, anonymous) != record:
                raise ValueError("Public channel read-back failed")
            print(f"Verified {channel_tag} for {tag}", flush=True)

        publish_channel(record, tags, lambda channel_tag: stored_record(channel_tag, anonymous), write)


if __name__ == "__main__":
    main()
