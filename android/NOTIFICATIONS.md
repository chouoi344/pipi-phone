# 安卓后台通知

## 已实现的两条路径

「后台连接状态」和「好友新消息」属于两个系统通知类别。实时连接按安卓要求提交一条低优先级状态通知。网络重连只更新 App 内的状态文字。Android 8 及以上可在系统设置里单独关闭「后台连接状态」，同时保留「好友新消息」。[安卓前台服务说明](https://developer.android.com/develop/background-work/services/fgs/launch)

首次连接页的「新消息提醒」默认选中。登录成功并获得系统通知权限后，App 启用下面两种接收方式。用户可以在首次连接时关掉提醒，也可以稍后在「我 → 设置 → App 连接设置」调整。关闭开关会停止接收并撤下已有的消息通知。

| 路径 | 实际行为 | 系统限制 |
| --- | --- | --- |
| 实时连接 | 显示持续通知，通过现有 `/api/events` 收到变更后查询新消息；中断后退避重连 | 使用 `dataSync` 前台服务。Android 15、target 35 起累计后台运行受 6 小时/24 小时限制；返回应用会重置系统计时。超时后停止实时连接，设置页显示原因。 |
| 系统延迟检查 | 使用原生 `JobScheduler`，每次只查询通知元数据，与实时连接共用游标 | 请求 15 分钟周期，实际执行由系统决定；省电、深度休眠、后台配额及厂商策略可能继续推迟。它不提供即时送达保证。 |

周期检查保存在系统调度器中，重启后由系统恢复，不在开机广播中启动前台服务。系统结束或用户强行停止应用后，实时连接不会偷偷自启；重新打开应用会补建调度并恢复实时连接。用户在系统中强行停止应用时，后台工作也可能停止，须再次打开应用。

以上路径不依赖 Google 服务和第三方推送账号，仍受手机系统的后台规则约束。前台服务也不能消除深度休眠的网络限制。依据：[前台服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types)、[Android 15 时限](https://developer.android.com/about/versions/15/behavior-changes-15)、[周期任务与持久化](https://developer.android.com/reference/android/app/job/JobInfo.Builder)、[Doze 与后台网络](https://developer.android.com/training/monitoring-device-state/doze-standby)。

## 消息、登录和隐私

服务器需包含本版新增的 `GET /api/android/notifications?cursor=…`。该接口每次验证现有登录会话，返回版本号、游标、会话名称/免打扰/未读数量，以及入站消息 ID/时间；不返回正文、图片、语音、模型配置或 API Key。

首次成功连接只建立游标，不用历史消息刷屏；之后仅提醒已提交入库的好友消息和好友拍一拍。游标记住同毫秒消息 ID，实时连接与周期检查串行使用同一游标；断线后可补收未过期的新消息。消息提醒有效期一小时，同一好友合并为一条通知，显示未读数量；API 26 起通知也设置系统自动过期。API 23～25 不支持这个自动撤下字段，后续检查仍会清理已读、免打扰和失效会话的通知。

好友免打扰、黑名单和「主动信息」全局免打扰时段均生效，跨午夜按服务器设置时区判断。在应用前台时不叠加系统消息通知，由页内横幅处理。点后台通知打开对应好友；点击携带的服务器地址需与当前地址相同。

原生代码只从 WebView 的 CookieManager 读取当前可信服务器的登录 Cookie，通过 HTTPS 发送；仅模拟器精确开发地址 `http://127.0.0.1:18766` 可用本机转发。网络请求禁止跨地址重定向，Cookie 不复制到偏好设置或日志。锁屏公开版本显示「收到好友新消息」，聊天正文不进入系统通知。

退出登录、服务端撤销会话或切换服务器后停止后台路径；切服先停止旧连接，再提交新地址。迟到的旧请求按连接代数丢弃，不修改新地址的游标或通知。服务端撤销会话会关闭现有 SSE，后续查询返回 401 后停用；周期模式在下次检查时发现失效。

兼容通知的聊天跳转另由 App 私有随机密钥签发，绑定本次开启实例、服务器、好友和当前登录 Cookie 的摘要。关闭后重开、重新登录或切服后，旧签名失效；普通启动里外部附带的好友 ID 不会触发聊天跳转。覆盖安装旧 APK 时，下一次合法前台活动或新通知会自动初始化标识，旧通知仍无效，下一条新通知可正常点击。冷启动先等待页面完成当前登录的启动，再复核签名；进入登录页时丢弃待跳转，防止带入之后的新登录。Cookie 和私有签名密钥均不进入通知 Intent。

## 模拟器关联检查

使用独立临时数据和模拟模型服务；不要转发到用户现有的 18766 正式资料。主机隔离服务例如监听 19773 时，可执行：

```powershell
adb reverse tcp:18766 tcp:19773
```

1. 打开 APK，连接模拟器开发地址并登录隔离账号，开启后台通知。确认持续通知出现，首次连接不提醒旧消息。
2. 回桌面或锁屏，通过隔离服务器正常 `/api/chat` 与模拟模型生成入库回复。确认通知出现，同一好友新消息合并，正文不在锁屏公开版本显示。
3. 点通知应进入该好友聊天；在应用前台再次生成消息，应仅走页内横幅。检查好友免打扰、全局跨午夜免打扰、已读和黑名单。
4. Android 15 模拟器可按官方方法缩短 dataSync 时限，确认 `onTimeout` 正常停止持续连接而不崩溃，周期任务 2002 仍保留；恢复原系统配置后再做其他检查。不要用 force-stop 替代服务超时测试。
5. 实时服务已停止、应用仍在后台时，生成另一条未过期消息，然后强制执行已注册的周期任务，确认延迟路径独立送达且不重复上一条通知。

```powershell
adb shell cmd jobscheduler get-job-state com.pipiphone.app.qa 2002
adb shell cmd jobscheduler run -f com.pipiphone.app.qa 2002
```

强制执行只证明该任务能收信，不证明系统自然调度的准点率。验收还需分别核对：关闭开关后任务移除、切服旧连接停止、服务端撤销登录后停止、网络恢复后补收、重复任务不重复提醒。真机省电策略和长时间自然调度须另行实测。

本轮独立自动检查为 `node --test tests/android-notifications.test.cjs`，覆盖首连基线、同毫秒/重连去重、入站落盘筛选、过期/免打扰/黑名单/时区、请求鉴权与退出登录、接口不写数据库和不传正文。原生 APK 编译、模拟器与真机证据须以本次实际验收记录为准。

## 可选 FCM 配置

本版另有显式开启的 FCM 构建与服务端实现。默认 APK 不包含 Firebase SDK，默认服务器不请求 Google。FCM APK 注册成功后停止兼容实时服务和周期检查；注册失败保留兼容路径。当前没有管理员可信凭据，因此只验证代码、隔离模拟协议和构建边界，没有做真实 Firebase 注册或投递。

管理员需要同一 Firebase 项目的两个不同文件：

| 文件 | 放置位置 | 用途 |
| --- | --- | --- |
| `google-services.json` | 管理员本机，构建时用绝对路径传入 | APK 的客户端项目标识，须匹配包名；不是服务端身份。 |
| 服务账号 JSON | 只在服务器的私密文件目录 | 服务端用私钥换短期 OAuth token，调用 FCM HTTP v1；不得打入 APK、源码包或网页资源。 |

直接运行 Node 时，唯一服务端启用入口是环境变量 `PIPI_FCM_SERVICE_ACCOUNT_FILE`，值为服务账号 JSON 的绝对路径。文件必须是 Google `service_account` 类型、RSA 私钥，且 token 地址为固定的 `https://oauth2.googleapis.com/token`；错误配置会直接报错。外部请求只发往此 OAuth 地址与 `https://fcm.googleapis.com`，禁止跳转。参见 [官方服务身份与 HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api)。

Docker 另提供 `compose.fcm.yaml`：管理员显式使用 `-f compose.yaml -f compose.fcm.yaml` 才挂载只读服务身份并启用；正常 Compose 不受影响。不要将私钥 JSON 复制进项目目录。这里只提供源码与配置，不替管理员启动、升级或更改现有容器。

客户端构建需显式传 `-PpipiFcm=true -PpipiGoogleServices=<google-services.json绝对路径>`；构建入口和完整步骤见 [FCM.md](FCM.md)。APK 的 Firebase 项目 ID 必须与服务端相同，设备需有 Google Play 服务；设备上再主动开启「使用可选 FCM 系统推送」，服务端和客户端均确认注册成功后才切换。

注册接口 `GET /api/android/fcm`、`POST /api/android/fcm/register`、`POST /api/android/fcm/unregister` 使用现有登录和 CSRF 防跨站校验。设备注册绑定当前登录会话；退出登录、撤销其他设备会话会删除相应注册。设备 token 存服务器私有 metadata，不进入聊天备份；失效 token 被 Firebase 确认后撤销。

发送使用系统 `notification + data`：标题固定「小手机」、内容固定「收到好友新消息」，不向 Firebase 发送好友姓名、聊天正文或模型配置；按好友 tag 合并，有效期 60 秒，通知点击再核对服务器与登录范围。发出前再次检查已读、好友/全局免打扰、黑名单及会话有效性。系统自动展示已经排队的泛化提醒时，客户端无法先行拦截，因此退出或切服后仍可能迟到极少量 60 秒内的泛化提醒；点击会被旧登录范围检查挡住。高优先级表示向系统申请及时投递，仍不等于保证每台手机即时必达。参见 [Firebase 优先级](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-priority)。

短期网络故障、服务暂不可用和限流会在 60 秒消息有效期内有限重试，并遵守 `Retry-After`。每次重试前复查会话、未读和免打扰；永久错误不会伪装为发送成功，鉴权后的 FCM 状态接口显示不含密钥的失败原因。

`node --test tests/android-fcm.test.cjs` 使用临时数据库、临时 RSA 身份、本机模拟聊天模型和模拟 Google HTTP，覆盖 OAuth JWT 签名/缓存、正常聊天落盘发送、静默过滤、注册鉴权/CSRF/项目核对、注销/退出、OAuth 等待中取消、失效 token 清理及临时错误重试。它没有向真实 Google 服务发送请求。

## 其他厂商推送与 UnifiedPush 的边界

当前没有接入华为、小米、OPPO、vivo 等厂商系统推送。正式厂商路径需要应用开发者身份、固定包名/签名、厂商开通及密钥、服务端设备注册、服务端发送适配和对应真机验证；密钥须保留在服务端。FCM Android 客户端要求 Google Play 商店/Google APIs 环境，不能用本次无 GMS 模拟器代替验证。参见 [Firebase Android 接入条件](https://firebase.google.com/docs/cloud-messaging/android/get-started)、[华为 Push Kit](https://developer.huawei.com/consumer/en/hms/huawei-pushkit/)、[小米 Android 接入准备](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1543)。

UnifiedPush 是可进一步落地的自托管路径：手机须另外安装并配置真实 distributor，例如 ntfy 或 NextPush；小手机须实现注册、端点绑定、消息确认与注销，服务器向该端点发送唤醒，再由客户端鉴权取消息。它不是 Android 内置通道，未安装 distributor 时不能启用或显示已连接。ntfy 自身也有长连接/FCM与电量策略的取舍。当前版本未实现这套协议，不把研究文档当作已接入证据。参见 [UnifiedPush Android 接入](https://github.com/UnifiedPush/documentation/blob/main/content/developers/android.md)、[协议](https://unifiedpush.org/developers/spec/android/)、[ntfy 发送和即时送达](https://docs.ntfy.sh/publish/)。
