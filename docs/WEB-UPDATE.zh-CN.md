# Docker 部署的网页更新

打开「我 → 设置 → 关于屁屁机 → 网页程序更新」。服务器会检查 GitHub 正式版本，页面显示版本号和更新说明。安装服务器更新服务后，点「立即更新」并确认，页面会显示下载、备份、安装、重启和结果。只启用版本检查时，也能看到新版和说明。安卓 0.1.3 起在关于页另设「安卓 App 更新」，安装包由同一台服务器提供。[安卓更新说明](../android/README.md#在-app-里更新)

从 v0.13.17 开始，在 Ubuntu 管理员终端运行标准公网 HTTPS 安装命令会同时设置网页更新服务。安装完成后直接用网页更新。

## 旧版公网 HTTPS 安装

如果「网页程序更新」能查到新版，却显示「未启用一键更新」，请在原服务器的管理员终端执行一次。以下命令适用于从官方 Git 仓库装在 `/opt/pipi-phone` 的标准公网 HTTPS 实例。

```sh
cd /opt/pipi-phone && git -c http.version=HTTP/1.1 fetch --depth=1 origin tag v0.13.17 && git show FETCH_HEAD:scripts/install-https.py | python3 - --enable-updates "$PWD"
```

命令中的版本号用来读取这次修好的安装脚本。启用后刷新「关于屁屁机」，点「网页程序更新 → 检查更新 → 立即更新」。网页会安装当时的最新正式版。

之后请从网页升级。单独执行 `docker compose up -d --build` 会按源码目录重新建容器，可能切回旧版并移除更新入口。服务器正常重启会自动恢复当前应用和更新服务。

## 自行管理更新服务的 Docker 部署

先按[已有实例升级](../INSTALL.zh-CN.md#已有实例升级)完成带更新功能的版本切换，保留原部署目录、Compose 项目名、环境变量和资料卷。下面以 Linux 宿主机、现有目录 /opt/pipi-phone、项目名 pipi-phone、映射端口 18766 为例。把路径、项目名和端口换成现有安装实际使用的值。宿主机更新程序需要 Node.js 24 和可管理该 Compose 项目的 Docker CLI，无需安装 npm 依赖。

切换前先备份。程序与默认 Compose 已使用官方更新仓库 chouoi344/pipi-phone，可通过 PIPI_UPDATE_REPOSITORY 覆盖。暂无正式 Release 时显示“暂无正式发布版本”，检查失败时单独提示；发现新版且宿主机更新服务在线后才显示“立即更新”。需要网页一键安装时，准备下面的共享目录和更新服务。

先在原部署目录核对当前项目名、端口和资料卷；这些命令只读取运行状态。默认目录 `/opt/pipi-phone` 的 Compose 项目名是 `pipi-phone`。使用过 `-p`、`--project-name` 或 `COMPOSE_PROJECT_NAME` 时，以容器标签中的项目名为准。

```sh
cd /opt/pipi-phone
node --version
docker compose version
docker compose ps
docker compose ps --quiet pipi-phone | xargs docker inspect --format '项目={{index .Config.Labels "com.docker.compose.project"}} 资料={{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Type}}:{{.Name}}{{end}}{{end}} 端口={{json .NetworkSettings.Ports}}'
```

Node 版本应为 24 或更新版本，资料应为 `volume:资料卷名`。没有显示当前容器、资料为 `bind` 或项目名不一致时，先按已有部署方式核对，不继续切换。网页更新服务只支持命名数据卷，不能直接替换目录挂载。

将以下配置保存在原部署目录的 .env.updates。用已有 Compose 项目名，才能找到原来的资料卷。PIPI_UPDATE_DIR 是宿主机与小手机容器交换任务状态的目录。PIPI_UPDATE_STATE_DIR 保存宿主机自己的版本、资料卷和恢复记录，权限应只给更新服务管理员。

```dotenv
PIPI_UPDATE_REPOSITORY=chouoi344/pipi-phone
PIPI_UPDATE_DIR=/opt/pipi-phone/.pipi-update-channel
PIPI_UPDATE_STATE_DIR=/opt/pipi-phone/.pipi-updater
PIPI_UPDATE_COMPOSE_FILE=/opt/pipi-phone/compose.yaml
PIPI_UPDATE_COMPOSE_PROJECT=pipi-phone
PIPI_UPDATE_HEALTH_ORIGIN=http://127.0.0.1:18766
```

创建供容器中 Node 用户访问的共享目录，从原部署目录执行一次启动。官方镜像中的 Node 用户默认 UID/GID 为 1000。

```sh
cd /opt/pipi-phone
sudo install -d -m 0770 -o 1000 -g 1000 .pipi-update-channel
chmod 600 .env.updates
set -a
. ./.env.updates
set +a
set -- -f compose.yaml
if [ "$(readlink compose.override.yaml)" = "compose.https.yaml" ]; then
  set -- "$@" -f compose.https.yaml
fi
docker compose --project-name "$PIPI_UPDATE_COMPOSE_PROJECT" "$@" -f compose.updates.yaml up -d --build
```

使用公网 IP 自动 HTTPS 安装的服务器应保留安装程序生成的 `compose.override.yaml` 链接和 `.env.https`。更新服务在升级和回退时会沿用 HTTPS 配置。

这次启动使用现有程序源码，只接通更新通道；原 `.env` 会由 Compose 继续读取。先打开原地址确认聊天和资料仍在，再启动下面的更新服务。网页程序只读写这个共享目录；Docker 管理权限留在宿主机更新服务，网页容器不挂载 Docker socket。

在宿主机执行更新服务。可先在终端启动验证，确认网页中可用后，再用系统服务保持运行。

```sh
node --env-file=/opt/pipi-phone/.env.updates /opt/pipi-phone/scripts/compose-updater.cjs
```

使用 systemd 的部署可以把下面的内容保存为 /etc/systemd/system/pipi-phone-updater.service。若已有 systemd 单元，先核对文件名与实际目录。执行该单元的账户必须拥有 Docker 管理权限。下面的例子使用系统服务账户环境和该服务器上的 Node 路径。与自己的 Node 路径不一致时，先用 command -v node 核实。

```ini
[Unit]
Description=Pipi Phone Compose Updater
After=docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=/opt/pipi-phone
EnvironmentFile=/opt/pipi-phone/.env.updates
ExecStart=/usr/bin/node /opt/pipi-phone/scripts/compose-updater.cjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

如果终端里的测试服务还在运行，先停止该测试进程，再启用 systemd 服务。

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now pipi-phone-updater.service
sudo systemctl status pipi-phone-updater.service
```

## 更新和恢复

- 更新服务先下载 GitHub 发布清单指定的镜像，核对镜像版本，再停小手机并复制整个资料卷。新版继续挂载原资料卷。安装中需要短暂停服。
- 新版启动或版本检查失败时，更新服务会用更新前的资料快照启动旧镜像。原备份卷和失败现场资料卷均保留，便于恢复。服务或资料卷回退失败时，可看宿主机的更新日志和状态目录。
- 系统用 .pipi-updater/active-compose.json 保存现在应使用的镜像和资料卷。一旦这个文件生成，后续手动管理容器也要带上同一个覆盖文件与原项目名，避免手动操作重新启动旧镜像。保留原 .env、.env.updates 及状态目录。以下以已从 .env.updates 导入变量为前提。

```sh
set -- -f compose.yaml
if [ "$(readlink compose.override.yaml)" = "compose.https.yaml" ]; then
  set -- "$@" -f compose.https.yaml
fi
docker compose --project-name "$PIPI_UPDATE_COMPOSE_PROJECT" "$@" -f compose.updates.yaml \
  -f "$PIPI_UPDATE_STATE_DIR/active-compose.json" up -d --no-build
```

更新前需要为完整资料快照预留磁盘空间。资料卷涉及聊天、图片、账号和模型设置。备份卷保存在服务器本机。

极少数情况下，应用在提交请求的瞬间异常退出，交换目录可能残留 request.lock 空目录。如果页面一直提示有请求正在提交，先确认应用已恢复、宿主日志没有在更新，且没有其他管理员点击更新，再由服务器管理员用 rmdir 移除这个空目录后重新提交。

如果宿主更新服务在启动瞬间异常退出，并提示残留 worker-start.lock，先确认更新服务进程已经退出，再按宿主日志处理状态目录中的启动锁。不要移除正在工作的进程锁或恢复记录。

## 发布一个新版本

先把 package.json 增到下个版本，例如 0.12.2。更新说明写入发布提交，发布相同版本的 Git 标签 v0.12.2。工作流执行测试、构建对应的 amd64 和 arm64 镜像、验证镜像可匿名下载，然后在 GitHub 正式发布中附带 update.json。

update.json 把版本号关联到镜像的固定摘要。服务器核对来自已配置仓库的清单后才会安装。GHCR 是 GitHub 的容器镜像仓库。如果它首次把项目镜像设为私有，需要在 GitHub 软件包设置将它公开，再重试发布工作流。在「关于屁屁机」看到包含清单的新版后，可点击安装。
