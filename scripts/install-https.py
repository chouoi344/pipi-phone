#!/usr/bin/env python3
"""Install the public-IP HTTPS entry point on a Docker host."""
import argparse
from datetime import datetime, timezone
import http.client
import ipaddress
from itertools import chain
import json
import os
from pathlib import Path
import re
import shutil
import socket
import ssl
import stat
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, build_opener


ROOT = Path.cwd() if __file__ == "<stdin>" else Path(__file__).resolve().parents[1]
SOURCE = ROOT
BASE = ["docker", "compose", "-f", "compose.yaml"]
HTTPS = [*BASE, "-f", "compose.https.yaml"]
PRODUCTION = "https://acme-v02.api.letsencrypt.org/directory"
MARKER = Path("compose.override.yaml")
SETTINGS = Path(".env.https")
UPDATE_ENV = Path(".env.updates")
STATE = Path(".pipi-updater")
CHANNEL = Path(".pipi-update-channel")
ACTIVE = STATE / "active-compose.json"
GENERATED = "# Managed by pipi-phone install-https.py"
SYSTEM_UNITS = Path("/etc/systemd/system")


def require_root_control(path):
    # A persistent root service must not execute files an unprivileged account can replace.
    path = path.absolute()
    for leaf in {path, path.resolve()}:
        for item in (*reversed(leaf.parents), leaf):
            info = item.lstat()
            sticky_parent = item != leaf and stat.S_ISDIR(info.st_mode) and info.st_mode & stat.S_ISVTX
            if info.st_uid != 0 or (not item.is_symlink() and info.st_mode & 0o022 and not sticky_parent):
                sys.exit(f"宿主机更新服务需要 root 管理的部署路径。请核对 {item} 的所有者和写入权限。")


def check_host_files():
    if any(ord(char) < 32 for char in str(ROOT)):
        sys.exit("部署目录名不能包含换行或控制字符。")
    require_root_control(ROOT)
    for name in ("scripts/compose-updater.cjs", "lib/updates.cjs", "package.json", "compose.yaml", "compose.updates.yaml",
                 "compose.https.yaml", "deploy/Caddyfile", "deploy/bundled-gateway.yaml", ".env", ".env.https", ".env.updates", "compose.override.yaml",
                 ".pipi-updater", ".pipi-updater/active-compose.json"):
        path = ROOT / name
        if path.exists() or path.is_symlink():
            require_root_control(path)


def output(command):
    return subprocess.check_output(command, text=True).strip()


def configure_proxy_network():
    # Compose interpolates network addresses from the project .env, including on restart/update.
    env_file = Path(".env")
    current = env_file.read_text() if env_file.is_file() else ""
    if re.search(r"(?m)^\s*(?:export\s+)?PIPI_HTTPS_PREFIX\s*=", current):
        return
    explicit = os.environ.get("PIPI_HTTPS_PREFIX")
    if explicit:
        network = ipaddress.IPv4Network(f"{explicit}.0/28")
        if not network.is_private:
            sys.exit("PIPI_HTTPS_PREFIX 必须指定空闲的私网网段。")
        prefix = explicit
    else:
        reserved = []
        ids = output(["docker", "network", "ls", "-q"]).split()
        if ids:
            for line in output(["docker", "network", "inspect", "--format", "{{json .IPAM.Config}}", *ids]).splitlines():
                reserved.extend(ipaddress.ip_network(config["Subnet"], strict=False) for config in json.loads(line) or []
                                if config.get("Subnet"))
        if shutil.which("ip"):
            routes = json.loads(output(["ip", "-4", "-j", "route", "show", "table", "all"]))
            reserved.extend(ipaddress.ip_network(route["dst"], strict=False) for route in routes
                            if route.get("dst") not in (None, "default", "0.0.0.0/0"))
        ranges = ("172.30.0.0/16", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
        slots = (ipaddress.IPv4Network((subnet.network_address, 28))
                 for block in ranges for subnet in ipaddress.IPv4Network(block).subnets(new_prefix=24))
        candidates = chain([ipaddress.IPv4Network("172.30.187.0/28")], slots)
        network = next((n for n in candidates if all(not n.overlaps(r) for r in reserved if r.version == 4)), None)
        if network is None:
            sys.exit("未找到可用的私网网段，请在 .env 中指定 PIPI_HTTPS_PREFIX。")
        prefix = str(network.network_address).rsplit(".", 1)[0]
    # The root updater reads this file on every run. Create it with explicit
    # owner-only permissions even when /opt supplies a default group ACL.
    with os.fdopen(os.open(env_file, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600), "a") as env:
        leading = "\n" if current and not current.endswith("\n") else ""
        env.write(f"{leading}PIPI_HTTPS_PREFIX={prefix}\n")


def check_installation():
    if (MARKER.exists() or MARKER.is_symlink()) and not (
            MARKER.is_symlink() and MARKER.readlink() == Path("compose.https.yaml")):
        sys.exit("此目录已有自定义 compose.override.yaml；请沿用现有面板或代理，不会覆盖其配置。")
    env_file = Path(".env")
    if (Path("compose.override.yml").exists() or os.environ.get("COMPOSE_FILE")
            or (env_file.is_file() and re.search(r"(?m)^\s*(?:export\s+)?COMPOSE_FILE\s*=", env_file.read_text()))):
        sys.exit("检测到自定义 Compose 文件。请在原部署配置中接入 HTTPS，保留原服务与数据卷。")
    managed = UPDATE_ENV.is_file() and UPDATE_ENV.read_text().startswith(GENERATED + "\n")
    if UPDATE_ENV.is_symlink() or (not managed and (ACTIVE.exists() or UPDATE_ENV.exists())):
        sys.exit("此实例已有手工配置的网页更新服务，请继续使用原更新服务。")
    config = json.loads(output([*BASE, "config", "--format", "json"]))
    project = config["name"]
    own = set(output([*BASE, "ps", "--all", "--quiet", "pipi-phone"]).split())
    local = set(output(["docker", "ps", "-aq", "--no-trunc", "--filter",
                        f"label=com.docker.compose.project.working_dir={ROOT}",
                        "--filter", "label=com.docker.compose.service=pipi-phone"]).split())
    if not own and not local:
        return config, None
    containers = json.loads(output(["docker", "inspect", *(own | local)]))
    if len({item["Id"] for item in containers}) != 1:
        sys.exit("此目录关联了多个小手机实例，请核对原项目。")
    for container in containers:
        labels = container["Config"]["Labels"]
        if labels["com.docker.compose.project"] != project and not own:
            project = labels["com.docker.compose.project"]
            config = json.loads(output([*BASE, "--project-name", project, "config", "--format", "json"]))
        sources = {Path(name).resolve() for name in labels["com.docker.compose.project.config_files"].split(",")}
        data = next((mount for mount in container["Mounts"] if mount["Destination"] == "/app/data"), {})
        files = {ROOT / "compose.yaml", ROOT / "compose.https.yaml"}
        volume = config["volumes"]["pipi-data"]["name"]
        if managed:
            files.update({ROOT / "compose.updates.yaml", ROOT / ACTIVE})
            if ACTIVE.is_file():
                volume = json.loads(ACTIVE.read_text())["volumes"]["pipi-update-data"]["name"]
        if (labels["com.docker.compose.project"] != project
                or Path(labels["com.docker.compose.project.working_dir"]).resolve() != ROOT
                or not sources <= files or data.get("Type") != "volume"
                or data.get("Name") != volume and not worker_busy()):
            sys.exit("检测到已有实例使用其他项目名、配置或数据卷。请在原部署中配置 HTTPS，保持原资料。")
    return config, containers[0]


def public_ip():
    local_ipv6 = None
    if shutil.which("ip"):
        try:
            interfaces = json.loads(output(["ip", "-j", "address", "show", "up", "scope", "global"]))
        except (subprocess.CalledProcessError, json.JSONDecodeError):
            interfaces = []
        for link in interfaces:
            # iproute2 may leave empty records when filtering addresses by scope.
            for info in link.get("addr_info", []):
                value = info.get("local")
                if not isinstance(value, str) or "%" in value:
                    continue
                try:
                    address = ipaddress.ip_address(value)
                except ValueError:
                    continue
                if not address.is_global or address.is_multicast:
                    continue
                if address.version == 4:
                    return str(address)
                if local_ipv6 is None:
                    local_ipv6 = address
    # Cloud NAT commonly assigns only a private address to the guest.
    for url in ("https://api.ipify.org", "https://checkip.amazonaws.com"):
        try:
            response = subprocess.run(["curl", "-4fsS", "--noproxy", "*", "--max-time", "5", url],
                                      capture_output=True, text=True)
            value = response.stdout if response.returncode == 0 else ""
        except FileNotFoundError:
            try:
                with build_opener(ProxyHandler({})).open(url, timeout=5) as response:
                    value = response.read(64).decode("ascii")
            except (OSError, ValueError):
                continue
        try:
            address = ipaddress.IPv4Address(value.strip())
        except ValueError:
            continue
        if address.is_global and not address.is_multicast:
            return str(address)
    if local_ipv6 is not None:
        return str(local_ipv6)
    sys.exit("未能识别公网 IP。可用 PIPI_PUBLIC_IP=你的公网IP python3 scripts/install-https.py 重试。")


def configure_address():
    saved = {}
    if SETTINGS.exists():
        saved = dict(line.split("=", 1) for line in SETTINGS.read_text().splitlines() if line)
        if not saved.keys() <= {"PIPI_PUBLIC_IP", "PIPI_HTTPS_HOST", "PIPI_ACME_DIRECTORY"}:
            sys.exit(".env.https 含有其他配置，未覆盖。")
    directory = os.environ.get("PIPI_ACME_DIRECTORY") or saved.get("PIPI_ACME_DIRECTORY", PRODUCTION)
    parsed = urlsplit(directory)
    if not parsed.hostname or not re.fullmatch(r"https://[\w.:\[\]-]+/[\w./%-]+", directory):
        sys.exit("证书服务地址必须是有效的 HTTPS 网址。")
    address = ipaddress.ip_address(os.environ.get("PIPI_PUBLIC_IP") or saved.get("PIPI_PUBLIC_IP") or public_ip())
    if ("%" in str(address) or address.is_multicast or address.is_unspecified
            or (directory == PRODUCTION and not address.is_global)):
        sys.exit("公网证书需要公开可路由的 IP，请检查 PIPI_PUBLIC_IP。")
    host = str(address) if address.version == 4 else f"[{address}]"
    content = f"PIPI_PUBLIC_IP={address}\nPIPI_HTTPS_HOST={host}\nPIPI_ACME_DIRECTORY={directory}\n"
    if not SETTINGS.exists() or SETTINGS.read_text() != content:
        with tempfile.NamedTemporaryFile("w", dir=ROOT, delete=False) as temporary:
            temporary.write(content)
        os.replace(temporary.name, SETTINGS)
    return host


def wait_for_https(host, *, application):
    path = "/api/status" if application else "/"
    command = ["curl", "--noproxy", "*", "--silent", "--show-error", "--max-time", "4",
               "--connect-to", f"{host}:443:127.0.0.1:443", f"https://{host}{path}"]
    if application:
        command.append("--fail")
    deadline = time.monotonic() + (30 if application else 120)
    while True:
        try:
            result = subprocess.run(command, text=True, capture_output=True)
            ok, body, error = result.returncode == 0, result.stdout, result.stderr
        except FileNotFoundError:
            # Minimal image-based hosts need only Python, Docker and Compose.
            # Connect via loopback while checking the certificate for the public IP.
            context = ssl.create_default_context(cafile=os.environ.get("CURL_CA_BUNDLE"))
            connection = http.client.HTTPConnection(host, 443, timeout=4)
            try:
                with socket.create_connection(("127.0.0.1", 443), timeout=4) as raw:
                    connection.sock = context.wrap_socket(raw, server_hostname=host.strip("[]"))
                    connection.request("GET", path)
                    response = connection.getresponse()
                    ok, body, error = not application or response.status == 200, response.read(65536), str(response.status)
            except (OSError, http.client.HTTPException) as failure:
                ok, body, error = False, "", str(failure)
            finally:
                connection.close()
        if ok:
            if not application:
                return
            try:
                if isinstance(json.loads(body).get("authenticated"), bool):
                    return
            except (ValueError, AttributeError):
                pass
        if time.monotonic() >= deadline:
            if application:
                sys.exit("证书已生效，但小手机尚未响应。请运行 docker compose logs --tail 30 pipi-phone 查看原因。")
            sys.exit("尚未取得手机可信的证书。请检查公网 IP、云安全组及防火墙的 TCP 80/443。\n"
                     "查看日志：docker compose -f compose.yaml -f compose.https.yaml logs --tail 30 pipi-https\n"
                     "代理会继续重试。问题排除后重新运行安装命令即可。\n" + error.strip())
        time.sleep(2)


def write_atomic(path, content, mode=0o600):
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as temporary:
        temporary.write(content)
        os.fchmod(temporary.fileno(), mode)
    os.replace(temporary.name, path)


def node_runtime(installed_image=None):
    private_node = (STATE / "node").resolve()
    for node in (private_node, Path("/usr/bin/node"), Path("/usr/local/bin/node")):
        if node.is_file():
            require_root_control(node)
            result = subprocess.run([node, "--version"], capture_output=True, text=True)
            match = re.fullmatch(r"v(\d+)\.\d+\.\d+", result.stdout.strip())
            if result.returncode == 0 and match and int(match[1]) >= 24:
                return node
    # The app is built from this official multi-architecture image. Never copy code out of a live app.
    image = installed_image or "docker.io/library/node:24-bookworm-slim"
    container = output(["docker", "create", *(["--pull", "never"] if installed_image else []),
                        "--network", "none", "--entrypoint", "/bin/true", image])
    try:
        with tempfile.TemporaryDirectory(dir=STATE) as directory:
            candidate = Path(directory).resolve() / "node"
            subprocess.run(["docker", "cp", container + ":/usr/local/bin/node", str(candidate)], check=True)
            candidate.chmod(0o755)
            if not re.fullmatch(r"v24\.\d+\.\d+", output([candidate, "--version"])):
                sys.exit("官方镜像中的 Node 24 无法在这台服务器运行。")
            os.replace(candidate, private_node)
    finally:
        subprocess.run(["docker", "rm", container], check=True, stdout=subprocess.DEVNULL)
    return private_node


def worker_busy():
    journal = STATE / "current.json"
    if not journal.is_file():
        return False
    job = json.loads(journal.read_text())
    return job["stage"] != "done" or job["status"]["phase"] not in {"succeeded", "rolled-back", "failed"}


def update_settings(config, container, https):
    app = config["services"]["pipi-phone"]
    published = next(p for p in app["ports"] if p["target"] == 8000)
    port, bind = str(published["published"]), published.get("host_ip", "0.0.0.0")
    repository = app["environment"]["PIPI_UPDATE_REPOSITORY"]
    if container:
        bindings = container["HostConfig"]["PortBindings"].get("8000/tcp") or []
        if len(bindings) != 1 or bindings[0]["HostIp"] not in {"", "0.0.0.0", "127.0.0.1"}:
            sys.exit("原容器没有可供网页更新服务检查的本机端口，未修改原部署。")
        port, bind = bindings[0]["HostPort"], bindings[0]["HostIp"] or "0.0.0.0"
        original = dict(item.split("=", 1) for item in container["Config"]["Env"])
        repository = original.get("PIPI_UPDATE_REPOSITORY", repository)
        # An ephemeral shell override must not silently disappear when Compose recreates the app.
        for key, value in app["environment"].items():
            if key not in {"PIPI_UPDATE_REPOSITORY", "PIPI_UPDATE_DIR", "TRUST_PROXY"} and key in original and original[key] != value:
                sys.exit(f"原容器的 {key} 与现有 Compose 设置不同。请先在原 .env 中保留该值。")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9][A-Za-z0-9._-]*", repository):
        sys.exit("现有更新仓库格式无效，请核对 PIPI_UPDATE_REPOSITORY。")
    return {"PIPI_UPDATE_REPOSITORY": repository, "PIPI_UPDATE_DIR": str(ROOT / CHANNEL),
            "PIPI_UPDATE_STATE_DIR": str(ROOT / STATE), "PIPI_UPDATE_COMPOSE_FILE": str(ROOT / "compose.yaml"),
            "PIPI_UPDATE_COMPOSE_PROJECT": config["name"], "PIPI_UPDATE_HEALTH_ORIGIN": "http://127.0.0.1:" + port,
            "PIPI_PORT": port, **({} if https else {"PIPI_HOST_BIND": bind})}


def wait_worker(service, *, require_mirror=False):
    started = datetime.now(timezone.utc)
    deadline = time.monotonic() + 35
    while time.monotonic() < deadline:
        try:
            fd = os.open(CHANNEL / "worker-ready.json", os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
        except FileNotFoundError:
            pass
        else:
            with os.fdopen(fd) as heartbeat:
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_size > 4096:
                    sys.exit("更新服务写入的心跳文件异常，请核对共享目录。")
                record = json.load(heartbeat)
                stamp = record["updatedAt"].replace("Z", "+00:00")
            if (started <= datetime.fromisoformat(stamp) <= datetime.now(timezone.utc)
                    and (not require_mirror or record.get("acrMirror") is True)):
                if subprocess.run(["systemctl", "is-active", "--quiet", service]).returncode == 0:
                    return
        time.sleep(1)
    sys.exit(f"网页更新服务尚未就绪。请查看 journalctl -u {service} -n 30 后重试。")


def command_arg(filename):
    # systemd expands percent specifiers and command arguments separately.
    return json.dumps(str(filename), ensure_ascii=False).replace("%", "%%").replace("$", "$$")


def enable_updates(config, container, enable_only, installed_image=None):
    if not Path("/run/systemd/system").is_dir() or not shutil.which("systemctl"):
        sys.exit("此安装方式需要使用 systemd 的 Ubuntu 宿主机。")
    if not (Path("scripts/compose-updater.cjs").is_file() and Path("compose.updates.yaml").is_file()):
        sys.exit("原目录缺少网页更新服务文件，请确认指定的是小手机部署目录。")
    output(["systemctl", "show", "--property=Version", "--value"])
    project = config["name"]
    service = f"pipi-phone-updater-{project}.service"
    unit_path = SYSTEM_UNITS / service
    unit_marker = f"{GENERATED} for {ROOT}\n"
    existing_unit = output(["systemctl", "show", service, "--property=FragmentPath", "--value"])
    if ((existing_unit and Path(existing_unit) != unit_path) or unit_path.is_symlink()
            or unit_path.exists() and not unit_path.read_text().startswith(unit_marker)):
        sys.exit(f"同名系统服务 {service} 已用于其他部署，未覆盖。")
    if enable_only and not container and not ACTIVE.exists() and not worker_busy():
        sys.exit("此目录没有已部署的小手机。首次安装请使用普通安装命令。")
    if STATE.is_symlink() or CHANNEL.is_symlink() or ACTIVE.is_symlink():
        sys.exit("更新状态或共享目录是非预期的符号链接，未修改。")
    STATE.mkdir(mode=0o700, exist_ok=True)
    if STATE.stat().st_uid != 0 or STATE.stat().st_mode & 0o077:
        sys.exit(".pipi-updater 必须是 root 私有目录，未修改现有资料。")
    if worker_busy():
        if not UPDATE_ENV.is_file() or not unit_path.is_file():
            sys.exit("原更新任务尚未结束，请通过原更新服务恢复。")
        subprocess.run(["systemctl", "enable", "--now", service], check=True)
        sys.exit("原网页更新服务正在处理尚未结束的任务。待任务结束后可重新运行此命令。")
    previous_https = MARKER.is_symlink()
    https = not enable_only or previous_https
    settings = update_settings(config, container, https)
    node = node_runtime(installed_image)
    # Docker inherits these values directly; systemd reads the same values on boot.
    def env_quote(value):
        return '"' + re.sub(r'([\\"$`])', r'\\\1', value) + '"'
    content = GENERATED + "\n" + "".join(key + "=" + env_quote(value) + "\n" for key, value in settings.items())
    if UPDATE_ENV.exists():
        previous = UPDATE_ENV.read_text()
        # A formerly HTTP-only instance may retain its old bind; HTTPS always uses loopback.
        if https:
            previous = re.sub(r"(?m)^PIPI_HOST_BIND=\"(?:0\.0\.0\.0|127\.0\.0\.1)\"\n", "", previous)
        if content != previous:
            sys.exit("现有更新配置与此项目不一致，请沿用原项目名、仓库和端口。")
    else:
        write_atomic(UPDATE_ENV, content)
    CHANNEL.mkdir(mode=0o770, exist_ok=True)
    os.chown(CHANNEL, 1000, 1000)
    CHANNEL.chmod(0o770)
    unit_root = str(ROOT).replace("%", "%%")
    unit = (unit_marker + "[Unit]\nDescription=Pipi Phone web updater\nAfter=docker.service network-online.target\n"
            "[Service]\nType=simple\n" + f"WorkingDirectory={unit_root}\nEnvironmentFile={unit_root}/.env.updates\n"
            + "ExecStart=" + command_arg(node) + " " + command_arg(ROOT / "scripts/compose-updater.cjs") + "\n"
            + "Restart=on-failure\nRestartSec=5\nTimeoutStopSec=infinity\n[Install]\nWantedBy=multi-user.target\n")
    if not unit_path.is_file() or unit_path.read_text() != unit:
        write_atomic(unit_path, unit, 0o644)
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    compose = [*BASE, "--project-name", project]
    env = {**os.environ, **settings}
    already_attached = container and any(m["Destination"] == "/app/update-channel" and m.get("Type") == "bind"
                                          and Path(m["Source"]) == ROOT / CHANNEL for m in container["Mounts"])
    if not enable_only:
        host = configure_address()
        configure_proxy_network()
    if https:
        compose.extend(["-f", "compose.https.yaml"])
    def run_compose(*args):
        subprocess.run([*compose, *args], env=env, check=True)
    if not enable_only:
        print(f"正在为 {host} 启动 HTTPS 并验证证书。公网 TCP 80 和 443 需能访问。", flush=True)
        run_compose("up", "-d", "--no-deps", *(["--no-build", "--pull", "never"] if installed_image else []), "pipi-https")
        wait_for_https(host, application=False)
        if not MARKER.is_symlink():
            MARKER.symlink_to("compose.https.yaml")
    compose.extend(["-f", "compose.updates.yaml"])
    if container and not already_attached and not ACTIVE.exists():
        # Preserve the exact running image even if an identically named tag has since moved.
        volume = next(m["Name"] for m in container["Mounts"] if m["Destination"] == "/app/data")
        overlay = {"services": {"pipi-phone": {"image": container["Image"], "volumes": [
            {"type": "volume", "source": "pipi-update-data", "target": "/app/data"}]}},
            "volumes": {"pipi-update-data": {"external": True, "name": volume}}}
        write_atomic(ACTIVE, json.dumps(overlay) + "\n")
    if ACTIVE.exists():
        compose.extend(["-f", str(ACTIVE)])
    run_compose("config", "--quiet")
    if not already_attached or not container["State"]["Running"] or (https and not previous_https):
        run_compose("up", "-d", "--no-deps", *(["--no-build", "--pull", "never"] if installed_image or ACTIVE.exists() else ["--build"]), "pipi-phone")
    subprocess.run(["systemctl", "enable", "--now", service], check=True)
    wait_worker(service)
    if https and not enable_only:
        wait_for_https(host, application=True)
        print(f"小手机已就绪，网页和安卓 App 的地址为 https://{host}/ 。证书会自动续期。")
    print("网页一键更新已启用，可在「我 → 设置 → 关于屁屁机 → 网页程序更新」检查和安装新版。")


def stage_release_worker(version):
    # Keep custom deployment files intact. Each official worker has its own private
    # directory; switching the unit only after staging all files avoids mixed versions.
    worker_root = ROOT / STATE / "release-workers" / version
    if worker_root.resolve() != worker_root:
        sys.exit("宿主更新程序目录不能重定向到其他路径。")
    files = ("scripts/compose-updater.cjs", "lib/updates.cjs", "package.json")
    for name in files:
        source = SOURCE / name
        require_root_control(source)
        destination = worker_root / name
        if destination.resolve() != destination:
            sys.exit(f"宿主更新程序文件不能重定向到其他路径：{name}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        content = source.read_text(encoding="utf-8")
        if destination.exists() and destination.read_text(encoding="utf-8") != content:
            sys.exit(f"宿主上已安装的 {version} 文件与来源不一致：{name}")
        if not destination.exists():
            write_atomic(destination, content, 0o600)
    return worker_root


def upgrade_from_release(config, container):
    """Bridge an existing managed installation without requiring its own .git directory."""
    if not container or not container["State"]["Running"] or not UPDATE_ENV.is_file():
        sys.exit("请指定正在运行、已启用网页更新的原部署目录。")
    env = dict(entry.split("=", 1) for entry in container["Config"]["Env"])
    if env.get("PIPI_UPDATE_REPOSITORY", "").lower() != "chouoi344/pipi-phone":
        sys.exit("只有使用官方更新仓库的小手机才能接入对应的阿里云镜像。")
    service = f"pipi-phone-updater-{config['name']}.service"
    unit_path = SYSTEM_UNITS / service
    if (not unit_path.is_file() or unit_path.is_symlink()
            or not unit_path.read_text().startswith(f"{GENERATED} for {ROOT}\n")
            or output(["systemctl", "show", service, "-p", "WorkingDirectory", "--value"]) != str(ROOT)):
        sys.exit("此目录与标准宿主更新服务不匹配。")
    version = json.loads((SOURCE / "package.json").read_text())["version"]
    stable = r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)"
    current = output(["docker", "exec", container["Id"], "node", "-p", "require('./package.json').version"])
    if not all(re.fullmatch(stable, value) for value in (version, current)):
        sys.exit("安装程序和原服务需要使用正式版本。")
    if tuple(map(int, current.split("."))) > tuple(map(int, version.split("."))):
        sys.exit(f"服务器已运行更高版本 {current}。")
    if worker_busy():
        sys.exit("请等服务器当前的更新任务结束。")
    subprocess.run(["systemctl", "is-active", "--quiet", service], check=True)
    if not STATE.is_dir() or STATE.is_symlink() or STATE.stat().st_uid != 0 or STATE.stat().st_mode & 0o077:
        sys.exit("宿主更新状态目录必须是现有的 root 私有目录。")
    worker_root = stage_release_worker(version)
    worker = worker_root / "scripts/compose-updater.cjs"
    dropins = SYSTEM_UNITS / (service + ".d")
    dropins.mkdir(exist_ok=True)
    override = dropins / "50-pipi-release-worker.conf"
    marker = f"{GENERATED} for {ROOT}\n"
    if override.exists() and not override.read_text().startswith(marker):
        sys.exit(f"{override} 已有自定义配置。")
    write_atomic(override, marker + "[Service]\nExecStart=\nExecStart="
                 + command_arg(node_runtime()) + " " + command_arg(worker) + "\n", 0o644)
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "restart", service], check=True)
    wait_worker(service, require_mirror=True)
    if current == version:
        print(f"服务器已是 {version}，宿主更新服务已接入阿里云仓库。")
        return
    # The new client submits the selected release through the old container's own
    # (non-root) account, using the same worker lock and pin checks as the About page.
    client = (worker_root / "lib/updates.cjs").read_text(encoding="utf-8") + """
;module.exports.createUpdateService({currentVersion:require('./package.json').version})
  .request({version:process.argv[2]}).then(({job})=>console.log('已提交更新 v'+job.version))
  .catch(error=>{console.error(error.message);process.exitCode=1;});
"""
    active_id = output([*BASE, "--project-name", config["name"], "ps", "-q", "pipi-phone"])
    subprocess.run(["docker", "exec", "-i", active_id, "node", "-", version],
                   input=client.encode("utf-8"), check=True)


def prepare_image_install(image):
    repository = "crpi-7a803jqeqt4g8l32.cn-hangzhou.personal.cr.aliyuncs.com/chouoi344/pipi-phone"
    if not re.fullmatch(re.escape(repository) + r"@sha256:[0-9a-f]{64}", image):
        sys.exit("首次镜像安装需要官方阿里云仓库中带 sha256 指纹的完整镜像地址。")
    if "${PIPI_INSTALL_IMAGE:?" not in Path("compose.yaml").read_text():
        sys.exit("请在从官方镜像 /opt/pipi-install 导出的安装目录中运行。")
    version = output(["docker", "image", "inspect", "--format", '{{index .Config.Labels "org.opencontainers.image.version"}}', image])
    if version != json.loads(Path("package.json").read_text())["version"]:
        sys.exit("本机镜像的发布版本和安装目录不一致。")
    if os.environ.get("PIPI_INSTALL_IMAGE", image) != image:
        sys.exit("当前环境中的 PIPI_INSTALL_IMAGE 与所选镜像不一致。")
    env_file = Path(".env")
    pin = f"PIPI_INSTALL_IMAGE={image}"
    if env_file.exists():
        if pin not in env_file.read_text().splitlines():
            sys.exit("原目录已有其他配置，请在新目录安装或沿用原安装方式升级。")
    elif UPDATE_ENV.exists() or ACTIVE.exists() or MARKER.is_symlink():
        sys.exit("此目录已有小手机实例，请沿用原安装方式升级。")
    else:
        write_atomic(env_file, pin + "\n")


def main():
    global ROOT
    parser = argparse.ArgumentParser()
    options = parser.add_mutually_exclusive_group()
    options.add_argument("--enable-updates", type=Path, metavar="原部署目录")
    options.add_argument("--upgrade-from-release", type=Path, metavar="原部署目录")
    options.add_argument("--install-from-image", metavar="官方国内镜像@sha256:指纹")
    args = parser.parse_args()
    existing = args.enable_updates or args.upgrade_from_release
    if existing:
        ROOT = existing.resolve()
    os.chdir(ROOT)
    if os.geteuid() != 0:
        sys.exit("请用 sudo 或 root 运行安装命令，以便启用宿主机网页更新服务。")
    import fcntl
    lock = os.open(ROOT, os.O_RDONLY)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        check_host_files()
        if args.install_from_image:
            prepare_image_install(args.install_from_image)
        config, container = check_installation()
        if args.upgrade_from_release:
            upgrade_from_release(config, container)
        else:
            enable_updates(config, container, args.enable_updates is not None, args.install_from_image)
    finally:
        os.close(lock)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        sys.exit(f"安装未完成：{error}")
