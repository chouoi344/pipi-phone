# 可选 FCM 系统推送

默认 APK 不包含 Firebase SDK、不需要 Google 凭据，继续使用用户主动开启的实时连接与系统延迟检查。FCM 是管理员可选构建，要求设备 Android 7.0 及以上且具有可用的 Google Play 服务。

## 管理员构建

1. 在自己的 Firebase 项目注册 Android 应用 `com.pipiphone.app`；调试包还需注册 `com.pipiphone.app.qa`。下载对应 `google-services.json`，放到源码目录外。
2. 从 `android/` 执行 `.\Build-Preview.ps1 -GoogleServices C:/private/google-services.json`。使用已配置的 JDK 与 Android SDK。脚本沿用普通版的侧载签名，输出放在 `app/build-fcm/outputs/apk/preview/`。省去 `-GoogleServices` 参数即可构建普通版。
3. 构建仅提取项目 ID、发送者 ID、Android App ID 和公开客户端 API 标识；检查实际包名。误给带 `private_key` 的服务账号文件会直接构建失败。原始 JSON 不复制到 APK。配置文件和服务账号私钥均不得提交 Git。
4. 服务器通过 `PIPI_FCM_SERVICE_ACCOUNT_FILE` 指定自己的服务账号 JSON 绝对路径。服务端凭据仅留在服务器，不能进入 APK；没有该显式配置时不启用 FCM 注册和发送。服务账号需有目标项目 FCM HTTP v1 发送权限。

## 用户启用与关闭

「我 → 设置 → App 连接设置」会显示安装包是否配置 FCM。先登录并开启「后台消息通知」，再开启「使用可选 FCM 系统推送」。只有服务器项目与客户端匹配、当前登录会话完成设备注册后，才停止原实时连接和延迟检查。缺 Google Play 服务、服务器未配置或注册失败时保留兼容通知，设置页显示实际状态。

关闭 FCM 会恢复兼容通知。关闭后台通知、退出登录、切换服务器会停用并尝试解绑设备，令牌作废与服务端注销在后台执行。注册和点击跳转同时核对服务器、登录会话及本机 Cookie 的摘要，不把 Cookie 或 CSRF 值写进本机 FCM 注册记录。

## 投递与隐私边界

FCM 使用 HTTP v1 的 `notification + data`：系统文案固定为「小手机／收到好友新消息」，不发送姓名和聊天正文；附带好友 ID、服务器与会话标识供点击跳转。服务器在发送前过滤免打扰、已读及静音好友，同会话使用同一通知 tag，过期时间 60 秒。前台由页面横幅显示消息，避免再创建一条系统通知。

通知交给 Google 和系统后，退出或换服时，已经排队的泛化提醒仍可能在 60 秒内迟到。当前活跃通知会清除，迟到通知点击仍需通过当下服务器与会话核对。系统设置、网络和厂商限制也影响送达；注册成功只代表注册完成。

## 本轮验证

使用无效的合成 Google 客户端配置验证独立 FCM 构建；未安装或运行该合成配置 APK，没有向真实 FCM 注册设备或发送消息。服务端 OAuth／FCM 接收端使用本地模拟。冷启动路由的 9 种会话／地址／退出组合用独立 JVM 验证。普通 APK 继续单独构建验证；真实项目、Google Play 设备及真实投递尚未验收。

Firebase Messaging Android SDK 固定为 `26.0.2`，来自 Google Maven，使用 Apache-2.0 许可；只在显式 FCM 构建中加入。参考：[Android 配置](https://firebase.google.com/docs/android/setup)、[接收通知与数据](https://firebase.google.com/docs/cloud-messaging/android/receive-messages)、[HTTP v1 授权](https://firebase.google.com/docs/cloud-messaging/send/v1-api)。
