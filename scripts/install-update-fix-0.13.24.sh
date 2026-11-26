#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# One-time bridge for the managed HTTPS installation. Run from its original Git directory.
set -euo pipefail
tag=v0.13.24
target=${tag#v}
cd "$(git rev-parse --show-toplevel)"
cid=$(docker compose ps -q pipi-phone)
if [[ -z "$cid" || ! -f .env.updates ]]; then
  echo '请在原有标准 HTTPS 部署目录运行，确认小手机和网页更新服务已启用。' >&2
  exit 1
fi
project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$cid")
unit="pipi-phone-updater-${project}.service"
systemctl is-active --quiet "$unit"
[[ "$(systemctl show "$unit" -p WorkingDirectory --value)" == "$PWD" ]]
current=$(docker exec "$cid" node -p "require('./package.json').version")
if [[ "$current" == "$target" ]]; then
  echo "服务器已经是 $tag。"
  # Still update the host worker below if the web image was installed separately.
fi
docker exec "$cid" node -e '
  const u=require("./lib/updates.cjs");
  if(u.compareVersions(process.argv[1],process.argv[2])>0)throw Error("当前版本更新，无须执行");
  u.createUpdateService().status().then(s=>{
    if(!s.canUpdate || s.state!=="ok")throw Error("请在更新服务在线且没有正在处理的任务时重试");
  });' "$current" "$target"

file=lib/updates.cjs
candidate=$(mktemp lib/.updates.XXXXXXXX)
trap 'rm -f -- "$candidate"' EXIT
git show "$tag:$file" > "$candidate"
if ! cmp -s "$candidate" "$file"; then
  if ! git diff --quiet HEAD -- "$file"; then
    echo '宿主更新程序有本地修改，请先核对；已停止安装。' >&2
    exit 1
  fi
  chmod 644 "$candidate"
  mv -f -- "$candidate" "$file"
fi
systemctl restart "$unit"
if [[ "$current" == "$target" ]]; then exit 0; fi

# Execute the verified tag's client in the OLD container with its original UID and update directory.
{
  cat "$file"
  cat <<'NODE'
;(async()=>{
  const svc=module.exports.createUpdateService({currentVersion:require('./package.json').version});
  for(let i=0;i<20 && !(await svc.status()).workerAvailable;i++)await new Promise(r=>setTimeout(r,500));
  const result=await svc.request({version:process.argv[2]});
  console.log('已提交更新 v'+result.job.version+'，服务器将备份资料并短暂重启。');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
NODE
} | docker exec -i "$cid" node - "$target"
echo '稍后刷新原网址，在「我 → 设置 → 关于屁屁机」确认版本。'
