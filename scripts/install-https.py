#!/usr/bin/env python3
"""Install the public-IP HTTPS entry point on a Docker host."""
import ipaddress
from itertools import chain
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
BASE = ["docker", "compose", "-f", "compose.yaml"]
HTTPS = [*BASE, "-f", "compose.https.yaml"]
PRODUCTION = "https://acme-v02.api.letsencrypt.org/directory"
MARKER = Path("compose.override.yaml")
SETTINGS = Path(".env.https")


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
    with env_file.open("a") as env:
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
    if Path(".pipi-updater/active-compose.json").exists() or Path(".env.updates").exists():
        sys.exit("此实例已配置网页一键更新，请使用原更新服务管理业务容器。请参阅安装说明中的已有实例。")
    config = json.loads(output([*BASE, "config", "--format", "json"]))
    project = config["name"]
    own = set(output([*BASE, "ps", "--all", "--quiet", "pipi-phone"]).split())
    local = set(output(["docker", "ps", "-aq", "--no-trunc", "--filter",
                        f"label=com.docker.compose.project.working_dir={ROOT}",
                        "--filter", "label=com.docker.compose.service=pipi-phone"]).split())
    if not own and not local:
        return
    containers = json.loads(output(["docker", "inspect", *(own | local)]))
    for container in containers:
        labels = container["Config"]["Labels"]
        sources = {Path(name).resolve() for name in labels["com.docker.compose.project.config_files"].split(",")}
        data = next((mount for mount in container["Mounts"] if mount["Destination"] == "/app/data"), {})
        if (labels["com.docker.compose.project"] != project
                or Path(labels["com.docker.compose.project.working_dir"]).resolve() != ROOT
                or not sources <= {ROOT / "compose.yaml", ROOT / "compose.https.yaml"}
                or data.get("Name") != config["volumes"]["pipi-data"]["name"]):
            sys.exit("检测到已有实例使用其他项目名、配置或数据卷。请在原部署中配置 HTTPS，保持原资料。")


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
        response = subprocess.run(["curl", "-4fsS", "--noproxy", "*", "--max-time", "5", url],
                                  capture_output=True, text=True)
        if response.returncode == 0:
            try:
                address = ipaddress.IPv4Address(response.stdout.strip())
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
        result = subprocess.run(command, text=True, capture_output=True)
        if result.returncode == 0:
            if not application:
                return
            try:
                if isinstance(json.loads(result.stdout).get("authenticated"), bool):
                    return
            except (ValueError, AttributeError):
                pass
        if time.monotonic() >= deadline:
            if application:
                sys.exit("证书已生效，但小手机尚未响应。请运行 docker compose logs --tail 30 pipi-phone 查看原因。")
            sys.exit("尚未取得手机可信的证书。请检查公网 IP、云安全组及防火墙的 TCP 80/443。\n"
                     "查看日志：docker compose -f compose.yaml -f compose.https.yaml logs --tail 30 pipi-https\n"
                     "代理会继续重试。问题排除后重新运行安装命令即可。\n" + result.stderr.strip())
        time.sleep(2)


def main():
    os.chdir(ROOT)
    check_installation()
    host = configure_address()
    configure_proxy_network()
    subprocess.run([*HTTPS, "config", "--quiet"], check=True)
    print(f"正在为 {host} 启动 HTTPS 并验证证书。公网 TCP 80 和 443 需能访问。", flush=True)
    # Obtain a valid certificate before moving an existing HTTP service behind the proxy.
    subprocess.run([*HTTPS, "up", "-d", "--no-deps", "pipi-https"], check=True)
    wait_for_https(host, application=False)
    if not MARKER.is_symlink():
        MARKER.symlink_to("compose.https.yaml")
    subprocess.run([*HTTPS, "up", "-d", "--build", "pipi-phone"], check=True)
    wait_for_https(host, application=True)
    print(f"小手机已就绪，网页和安卓 App 的地址为 https://{host}/ 。证书会自动续期。")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        sys.exit(f"安装未完成：{error}")
