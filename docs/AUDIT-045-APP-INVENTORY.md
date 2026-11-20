# app.js 页面、控件和交互盘点（v0.4.5 工作轮次）

盘点日期：2026-11-14。主范围为 `public/app.js`，仅在说明持久化契约时查看 `lib/state.cjs`，不替代 features 模块、服务端、安全或原生视觉审查。原生功能依据另见 [AUDIT-045-REFERENCES.md](AUDIT-045-REFERENCES.md)。

本文“有实现”只表示存在可追踪的渲染、事件和动作路径；“部分”表示真实能力或页面层次仍缺；“未实现”包含只显示“暂未开放”的按钮。**这些词都不表示浏览器验证或 iPhone 微信 8.0.80 视觉通过。** 浏览器由主代理单独实测，本作者未运行浏览器、headless 或真实手机。

## 1. 入口范围和静态数量

`refresh()` 的固定 renderer 表有 24 个路由，额外处理 5 个路由（contact-more、stickers、sticker-store、contact-tags、tag-contacts），另转交 features 模块 6 个，合计 **35 个内建路由**。认证是独立界面，不计作路由；`registerRoute()` 可再注册扩展页面，须由扩展模块另盘点。

当前 `handleAction()` 有 **70 个 switch 分支**；此外有 data-nav、表单、消息/会话手势、表情、筛选、文件选择和 provider 专用事件，故不能用 70 当按钮总数或覆盖率。去重后有 **32 个 coming-* 标识**，其中 coming-more 只保留提示映射，没有在当前渲染函数发现可见入口；另有“自拍表情”和“表情商店”直接渲染未开放说明。

| 模块 | 固定路由 | 类型 | 主证据 |
| --- | --- | --- | --- |
| 四主页 | chats、contacts、discover、me | 微信式原生结构 | renderChats/renderContacts/renderDiscover/renderMe |
| 聊天/联系人 | chat、role、contact-more、chat-info、contact-settings、chat-search、new-friends、add-friend、contact-tags、tag-contacts | 微信式结构；联系人实际为本机 AI 角色 | refresh、renderRole、renderChatInfo、renderContactSettings |
| 个人/状态/表情 | profile、profile-more、status、status-picker、status-editor、stickers、sticker-store | 微信式结构与本地实现 | renderProfile、renderStatus*、renderStickers |
| 设置/AI管理 | settings、providers、personas、memories、role-manager、role-config、about、backup | 本小手机新增/混合 | renderSettings、renderRoleConfig、renderProviders |
| features 外交 | moments、ledger、wallet、farm、favorites、services | 原生式/本小手机新增混合 | featureNames、refresh；本文只盘点入口，不给实现判定 |

## 2. 共享导航、认证和弹层

| 编号 | 可见控件/触发 | 状态与边界 | 源码路径 |
| --- | --- | --- | --- |
| A01 | 微信/通讯录/发现/我底栏 | 有实现：切根页、选中态、未读总数；底栏双击定位未读未实现 | tabbar、bindMain、showView |
| A02 | 子页面返回、浏览器 Back | 有实现：路由栈、聊天草稿和面板恢复；iPhone 边缘手势未真机验证 | showView、goBack、popstate 处理 |
| A03 | 编辑页取消/保存、普通子页返回 | 有实现：openModal 与 openPage 区分；保存中禁用正文和按钮、错误写在表单内 | openModal、openPage |
| A04 | 操作面板、确认框、遮罩、Esc、Tab/方向键 | 有实现：嵌套父层保留、最上层关闭、菜单键盘移动、焦点限制 | actionSheet、confirmDialog、openChildDialog、keydown |
| A05 | 首次设置/密码登录/重新连接 | 有实现：真实 /api/setup、/api/login、/api/status；不等同腾讯账号登录 | renderAuth、boot、api |
| A06 | 退出登录 | 有实现：确认后 /api/logout，服务器数据保留；认证会话过期返回登录页 | handleAction.logout、api |
| A07 | 状态同步与安全区 | 有实现：6.5 秒轮询、编辑期间延迟重画、聊天滚动快照；本轮补可见会话已读同步，安全区由样式/phone-frame 负责，本文不代验 | api、refresh、captureChatLayout、末尾轮询 |

## 3. 微信列表和通讯录

| 编号 | 可见控件/触发 | 状态与边界 | 源码路径 |
| --- | --- | --- | --- |
| B01 | 首页会话卡片、头像/标题/时间/摘要、失败符号、未读、静音 | 有实现：按置顶和最后消息排序、点会话进入、阅读归零；头像默认占位为通用图标 | renderChats、lastMessage、shortTime、showView |
| B02 | 首页搜索 | 本轮新增：联系人和全部历史记录分组，含隐藏会话旧正文，点结果定位；返回保留词，主动切主tab清空；独立全屏搜索页/原生分类样式未完成 | renderChats、bindMain、globalSearchTerm |
| B03 | 会话长按/右键菜单 | 有实现：置顶/取消、未读、隐藏、查看资料；长按后 click 抑制 | conversationMenu、bindConversations |
| B04 | 会话左滑 | 有实现：不显示、标为未读、删除；删除有确认，动作分别为 conversation.hide/unread/delete | renderChats、bindConversations |
| B05 | 右上 + 菜单/遮罩 | 部分：添加朋友可进入；发起群聊、扫一扫、收付款明确未开放 | topMenu、handleAction |
| B06 | 空列表“添加朋友” | 部分：进入添加页，只搜索已有本机联系人；不会搜真实微信账号 | renderChats、renderAddFriend |
| C01 | 通讯录名字/备注搜索、拼音分组、右侧字母轨道 | 有实现：已保存本机联系人排序、索引点击/拖动、空搜索计数；返回原列表滚动未见专门保存 | renderContacts、contactInitial、bindContactIndex |
| C02 | 新的朋友/添加朋友 | 部分：新的朋友页为空态，添加页只查已有联系人；没有真实好友申请/通过流程 | renderNewFriends、renderAddFriend |
| C03 | 群聊/公众号/服务号 | 未实现：可见占位入口 | renderContacts.tools、coming-* |
| C04 | 标签列表 → 标签内联系人 | 有实现：由 role.tags 汇总、人数和资料跳转；没有独立批量改标签页 | renderContactTags |
| C05 | 好友资料主体、微信号、地区、更多信息 | 有实现：资料分层、备注优先；地区/签名/来源读取本机记录 | renderRole、renderContactMore |
| C06 | 设置备注和标签、电话、描述 | 有实现：role.save 持久化；标签上限校验；不是外部通讯录/拨号服务 | editContactRemark |
| C07 | 朋友权限、音视频通话 | 未实现：只提示未开放 | renderRole |
| C08 | 好友朋友圈、发消息 | 有入口：前者转 features，后者进入真实本机会话；不据入口认定朋友圈完整 | renderRole、handleAction.contact-moments |
| C09 | 好友 … → 资料设置 | 有实现：与聊天信息、AI角色管理分别路由 | handleAction.role-menu、renderContactSettings |
| C10 | 星标开关与通讯录星标 | 本轮新增：独立 role.starred，持久化开关和名字后的标记；当前原生分组/图形证据不足，不宣称视觉一致 | renderContactSettings、handleAction.toggle-star、renderContacts |
| C11 | 推荐朋友、黑名单、投诉 | 未实现：占位；黑名单属于本地可实现缺口，不笼统归平台外范围 | renderContactSettings |
| C12 | 删除联系人/删除角色 | 有实现：确认后 role.delete，删除相关消息/记忆；本轮未点击真实数据的删除 | handleAction.delete-role |

## 4. 聊天消息、输入和工具面板

| 编号 | 可见控件/触发 | 状态与边界 | 源码路径 |
| --- | --- | --- | --- |
| D01 | 消息列表/时间/自己与对方气泡/连续分段 | 有实现：支持 text、image、voice、transfer、redpacket、system；示例消息有明确标记 | renderChat |
| D02 | 头像单击/双击 | 本轮新增：单击等待 500ms 后资料；双击自己/对方发 message.pat(target=self/contact)；长按、拖动、取消、右键和三连击防误触 | bindChat.avatar、patChat |
| D03 | 拍一拍反馈 | 本轮新增：使用既有服务端动作、成功后重画系统消息和头像晃动、同目标在途锁；两分钟撤回未实现 | patChat；lib/state.cjs message.pat |
| D04 | 文字双击放大全屏 | 本轮新增：完整文字/换行/表情、返回或点正文关闭；非文字/附图气泡排除；真实手机选择文字交互未验证 | bindChat.ondblclick、readTextMessage |
| D05 | 气泡长按/右键/键盘菜单 | 有实现：引用、仅文字复制、收藏、语音播放、AI文字朗读、失败重试、删除；本轮加多选和已发送文字/图片转发 | bindChat、messageMenu |
| D06 | 消息引用与取消 | 有实现：草稿引用、发送携带 quoteId、显示引用快照；本轮加点击定位，原文已删/转发快照无ID时禁用，转发引用优先来源 senderName | messageMenu、renderChat、renderComposer、sendMessage |
| D07 | 失败消息重试/提示 | 有实现：点击 ! 确认或菜单重试；真实 /api/chat/retry，失败保留错误；未配置服务不会造回复 | retryMessage、bindChat |
| D08 | 消息删除/收藏 | 有实现：服务端 action 与确认；本轮补批量多选/删除和逐条转发；收藏详情由 features 负责；撤回未实现 | messageMenu |
| D09 | 图片点开 | 部分：安全数据图片放大和关闭；没有连续图片浏览、下载/保存、原生缩放工具 | lightbox、readImage |
| D10 | 语音点播/文字朗读 | 部分：已存安全音频可播；朗读调用配置的 TTS；本轮未调付费服务、未验证系统听筒路由 | playAudio、speakMessage |
| D11 | 文本编辑器/发送按钮 | 有实现：contenteditable 表情混排、Selection/Range 光标、换行、复制粘贴/拖放、undo/redo、中文 composition；真实发送 /api/chat | composerDOM、bindComposer、sendMessage |
| D12 | 表情/键盘/语音/更多切换 | 有实现：互斥、草稿/选区/面板/滚动保存；消息空白点按收起；滚动抬手、卡片/按钮不作空白点击 | showView、changeComposerMode、bindChat |
| D13 | 表情面板分类/搜索/最近/删除/发送 | 有实现：七列纵滚、最近持久化、搜索 token/标签、整枚删除、发送；自拍分类明确未开放 | renderEmojiBoard、bindComposer、emoji.use |
| D14 | 拖动表情面板高度/键盘上下键 | 有实现：高度限于可用视口，保留聊天滚动；不据限值认定原生像素 | bindComposer.emoji-drag-handle |
| D15 | 收藏表情/添加/整理/移除 | 有实现：上传本地图片存服务器、发送/移除有对应动作；商店和自拍没有伪造内容 | renderStickers、renderStickerStore、bindMain、bindComposer |
| D16 | 更多两页/左右滑/页点 | 有实现：14 工具位置按既有布局；不是目标 8.0.80 排序已证 | renderComposer、bindComposer |
| D17 | 更多“照片”/草稿预览/移除 | 有实现：PNG/JPEG/WebP/GIF ≤5MB，上传入口校验，切会话不串图 | readImage、bindComposer、renderComposer |
| D18 | 更多“红包/转账/收藏” | 有入口：虚拟钱包的 roleId/mode 与收藏转 features；原有返回保留面板/草稿/滚动逻辑保留 | handleAction、showView |
| D19 | 更多“拍摄/视频通话/位置/名片/文件/卡券/音乐/礼物” | 未实现：各按钮明确提示；不计完成，不接腾讯生态后端 | renderComposer.tools、coming-* |
| D20 | 更多“拍一拍” | 有实现：与头像复用同一 message.pat 动作/锁；此工具入口不替代头像手势 | handleAction.chat-pat、patChat |
| D21 | 按住说话、松开/上滑取消/丢失捕获 | 有实现路径：需麦克风与 STT 配置；取消/离开/切后台释放轨道，过短/过大错误可见 | bindComposer.record、startRecording、stopRecording、finishRecording |
| D22 | 输入框麦克风 → 转文字/取消 | 有实现路径：转写写入当前光标草稿，composition 完成后再加入，不串会话；需真实 STT，当前未实调 | dictation 分支、applyDictationTranscript |
| D23 | 多选、选择计数、转发/删除、返回/取消 | 本轮新增：最多100条；头像/长按菜单/阅读在选择态抑制，Enter/Space选择；Back/Esc先退出选择，保留输入草稿/面板；删除确认，转发先选择真实联系人后发送，失败留表单 | startMessageSelection、finishMessageSelection、toggleSelectedMessage、forwardMessages、renderMessageSelection |

## 5. 聊天信息、搜索和个人信息

| 编号 | 可见控件/触发 | 状态与边界 | 源码路径 |
| --- | --- | --- | --- |
| E01 | 聊天 … → 聊天信息 → 成员头像 | 有实现：继续到好友资料；添加成员为群聊占位 | renderChatInfo |
| E02 | 查找聊天内容/结果点回原消息 | 有实现：关键词、原消息居中高亮、返回聊天；不查其他角色 | renderChatSearch、bindMain.data-search-message、scrollChat |
| E03 | 搜索全部/图片/交易/日期 | 本轮新增：查已保存消息，图片含文本附图、交易含红包和转账，按浏览器本地日历日组合筛选/清日期；不是原生分类样式已证 | renderChatSearch、bindMain |
| E04 | 免打扰/置顶 | 有实现：独立 conversation.mute/pin 动作，列表状态联动；免打扰不等同系统推送权限 | renderChatInfo、handleAction |
| E05 | 强提醒/投诉 | 未实现：强提醒偏好可本地继续做，腾讯投诉外范围 | renderChatInfo |
| E07 | 设置当前聊天背景 | 本轮新增：选本地图、预览、保存、恢复默认，只改当前角色chatBackground；取消不保存 | editChatBackground、renderChat、role.save |
| E06 | 清空聊天记录 | 有实现：确认与 conversation.clear，文案说明保留联系人/记忆；本轮不操作真实数据 | handleAction.clear-conversation |
| F01 | 我 → 资料卡/二维码图形 | 部分：资料卡进个人信息；二维码图形未生成功能，个人信息二维码入口明确未开放 | renderMe、renderProfile |
| F02 | 头像上传/移除、名字、微信号、地区、签名 | 有实现：profile.save；头像安全类型/大小校验；名字必填 | renderProfile、renderProfileMore、editProfileField、bindAvatar |
| F03 | 本人拍一拍后缀 | 本轮新增：编辑、保存、清空为默认，self 提示由服务端拼接；100 字符是项目限制，未宣称微信原生限制 | renderProfile、editProfileField、handleAction.profile-pat |
| F04 | 微信豆/我的地址/卡包 | 未实现：未接腾讯余额、地址服务或真实卡券 | renderProfile、renderMe |
| F05 | 我 → 状态按钮/状态描述 | 有实现：14 预设分组、选择、说明、就这样、取消、查看/修改/结束 | renderMe、renderStatusPicker、renderStatusEditor、bindStatusEditor |
| F06 | 状态有效期/错误/过期刷新 | 有实现：本项目24小时状态、60字说明、真实保存/结束；好友状态/历史未实现，未据本项目规则证明原生参数 | activeStatus、bindStatusEditor |
| F07 | 我 → 服务/收藏/朋友圈/表情 | 部分：服务/收藏/朋友圈转 features；表情商店是说明页、可转本地表情管理 | renderMe、handleAction |
| F08 | 关于页 | 有实现：项目说明、未开放说明、虚拟资金/服务费用边界；本轮修正旧版本文案到0.4.5，包版本由主代理统一 | renderAbout |

## 6. 设置里的本小手机/AI能力

| 编号 | 可见控件/触发 | 状态与边界 | 源码路径 |
| --- | --- | --- | --- |
| G01 | 模型与服务四能力页签 | 有实现：chat/vision/tts/stt 独立设置，草稿切页保留；非微信原生页面 | renderProviders、bindProviders |
| G02 | 预设/自定义地址、模型、密钥、清密钥、声音、保存 | 有实现：settings.save，已存密钥不回显，不写浏览器存储；预设需部署者真实配置 | editPreset、bindProviders |
| G03 | 测试连接/获取模型/选择模型 | 有实现路径：使用已保存服务，异步错误可见；真实服务结果/费用本轮未测试 | bindProviders、/api/providers/test、/api/providers/models |
| G04 | 角色管理 → 角色资料/新增/保存 | 有实现：名称、备注、头像、微信号、签名、角色设定、关系、绑定人设；全部放设置下 | renderRoleManager、renderRoleConfig、editRole |
| G05 | 我的人设 → 新增/编辑/删除 | 有实现：独立 persona、头像与设定，删除需确认；按角色绑定 | renderPersonas、editPersona、bindPersona |
| G06 | 共同记忆 → 新增/编辑/删除 | 有实现：明确记忆按角色存，发送提供模型；自动提取/检索插件未选定 | renderMemories、editMemory、bindMain |
| G07 | 主动消息开关/间隔/免打扰时段/保存 | 有实现路径：role.save；UTC 时段说明与调用费用可见；服务器真实定时发送另验 | editProactive |
| G08 | 朋友圈管理 | 只盘点入口：转 PipiFeatures.manageMoments；具体控件由 features 盘点 | renderSettings、handleAction |
| G09 | 备份导出/恢复文件选择/确认/恢复 | 有实现路径：真实/api/backup 和/api/restore，恢复覆盖提示；不含登录/密钥，文件大小校验 | renderBackup、downloadBackup、pickBackup |
| G10 | 自动记忆/生图 | 未实现：关于页明示未开放；没有把未来插件兼容性当成已接入 | renderAbout、PRODUCT-BASELINE |

`editProfile()` 和 `roleMenu()` 仍有旧辅助实现，但当前 UI 分别经 edit-profile → profile、role-menu → contact-settings，不调用这两个函数。`search`/`record` 等 action 也不能仅因 switch 中存在就算新增可见控件。未在本轮顺手删除旧代码。

## 7. 发现页与全部未开放能力

发现页已有朋友圈与自定义小农场入口；本轮把过时“摇一摇”改为“听一听”。视频号/直播没有在现有授权图标中找到专属符号，入口补充等待主代理/资料代理确定；不能拿视频通话图标证明视频号视觉一致。

| 编号 | coming-* 标识 | 可见位置/含义 | 边界 |
| --- | --- | --- | --- |
| P01 | coming-address、coming-beans、coming-cards | 个人信息/我/工具：地址、微信豆、卡包卡券 | 真实腾讯业务外范围；入口仍计缺口 |
| P02 | coming-block、coming-permissions | 资料设置/好友资料：黑名单、朋友权限 | **本地可实现缺口**，应有真实策略后才能启用 |
| P03 | coming-call、coming-video | 好友资料/工具：音视频通话 | 真实会话服务未接入 |
| P04 | coming-camera、coming-location、coming-contact-card、coming-file、coming-music、coming-gift | 更多工具/推荐朋友 | 未实现；其中本地文件/名片可后续独立实现，不假发送 |
| P05 | coming-strong-alert、coming-report | 聊天信息：强提醒、投诉 | 提醒偏好可本地实现；腾讯投诉外范围；背景已实现，不在此占位清单 |
| P06 | coming-group、coming-radar、coming-phone-contacts、coming-work-contacts | 顶部菜单/通讯录/添加朋友/成员添加 | 群聊在产品后续；雷达/外部通讯录互通未接入 |
| P07 | coming-official、coming-service-account | 通讯录/添加朋友：公众号/服务号 | 腾讯内容互通外范围 |
| P08 | coming-scan、coming-pay、coming-profile-qr | 扫一扫、收付款、个人二维码 | 真微信扫码/支付外范围；本机可读名片码为独立后续候选 |
| P09 | coming-listen、coming-news、coming-search、coming-nearby、coming-shopping、coming-games、coming-mini | 发现：听一听/看一看/搜一搜/附近/购物/游戏/小程序 | 平台内容未接入，不能把 toast 当功能完成 |
| P10 | coming-more | 仅通用提示映射 | 未发现当前可见触发 |
| P11 | 无 coming 标识：自拍表情、表情商店 | 表情分类/我→表情 | 直接显示未开放说明；本机图片表情可管理 |

## 8. 权限、外部依赖和数据边界

- 认证和服务端数据：api 统一 same-origin credentials，变更请求带 CSRF；401 清状态回登录。本文没有改登录/权限，没有操作真实数据库。
- 麦克风：仅开始语音/转写时请求 getUserMedia；拒绝、请求中放手、切后台、离页均有显式路径。HTTPS/localhost 和浏览器录音能力是实际依赖。
- 文件/相册：只用浏览器文件选择；没有访问真实微信/系统通讯录。图片在入口校验类型与体积；安全图片/音频使用 data URL。
- 剪贴板：优先 Clipboard API，失败回退 execCommand 并报告结果；本轮未验证真实系统剪贴板授权。
- 模型：文本、识图、TTS、STT、主动消息依赖用户配置服务，可能产生费用；没有未经授权调用真实付费服务，没有伪造模型回复。
- 本地草稿和滚动：Map 只做当前页面内临时编辑状态；发送/资料/记忆/拍一拍等业务使用服务器 API。没有把 browser-only 记录当持久业务数据。

## 9. 本轮验证证据与待验

本作者已执行 `node --check public/app.js`；新增 `tests/chat045-offline.test.cjs` **34 项通过**，直接提取并执行已发货处理函数，覆盖头像自己/他人、单击延迟、双击不导航、三连击/在途去重、失败释放锁、长按/第二次长按/拖动/取消/右键、键盘单击、离开会话、文字放大/转义与非文字排除、长按菜单、交易拖动防误开、图片/交易/日期搜索组合及会话隔离；另验证全局旧正文检索、头像延迟导航让位其它操作、选择态键盘、可见会话已读去重/隐藏排除/失败重试/延迟返回根页角标。它使用受控时钟/小DOM模型，不能证明浏览器事件时序、视觉或系统手势。

相邻回归已执行：`tests/chat-input044-offline.test.cjs` 24 项、`tests/navigation044-offline.test.cjs` 21 项通过（含后续追加9项HTML嵌套确认回归）。保留红包/转账子流程返回时面板/草稿/选区/滚动、空白收起、输入模式互斥、composition 及导航子层行为。新增选择态头部/浏览器Back、转页消费选择历史、草稿面板恢复，以及全局搜索返回词/切主tab清空回归。主代理的后端持久化/浏览器结果须由其报告另附，不在这里凭通知替代亲自测试。

首次功能收口后本作者实际执行整套 `node --test tests/*.test.cjs`，**130 项通过、0 失败**，包含隔离 HTTP/持久化、模型模拟服务45秒超时、批量动作、转发引用作者、背景备份恢复、安全区和上述离线交互。环境未安装 npm，直接执行与 package.json test 脚本相同的 node 命令；没有运行仓库里的 headless UI 脚本。整套测试结果仍不能替代浏览器或原生视觉检查。

随后修复收藏多选删除确认成功后的父层幽灵历史：HTML弹层记录overlayDepth，成功丢弃父页时消费所有保留层，取消恢复同一DOM和勾选；pending取消期间的discard、queuedView/Back与waiter按顺序完成。新增9项HTML确认导航回归，导航21项+输入24项共45项通过；这次导航修复后未重复运行含45秒超时的整套测试。浏览器复验仍由主代理负责。

待浏览器逐项：真实 click/dblclick 交付、头像晃动、500ms 单击等待体验、消息选择与全屏长文滚动、日期原生控件、分类换行/小屏触区、星标/后缀实际保存、返回后草稿/面板、微信8.0.80原生视觉对照。真实 iPhone/Android 键盘、安全区、录音/音频与付费模型均未由本作者验证。

## 10. 本地高价值剩余缺口（不是平台外排除项）

1. 消息合并转发、滑动连续多选、全局搜索独立原生分类/链接等类别；本轮已实现逐条转发和现存消息日期/图片/交易过滤，精确工具栏布局待原生图。
2. 拍一拍撤回、普通消息撤回/再次编辑；需要明确后端动作、时间规则和AI已回复后的行为，不能拿删除冒充撤回。
3. 朋友权限/黑名单对主动消息、朋友圈和聊天的真实一致策略；不能只加开关颜色。
4. 语音菜单转文字/已存转写查看、图片浏览保存/相邻切换；系统听筒路由不伪造。
5. 个人资料头像预览/选择来源、性别；通讯录原列表滚动恢复；星标优先展示待目标证据。
6. 状态历史/好友状态、个人相册时间筛选/消息盒子、收藏新笔记、本机通知偏好与发现管理；features 相关项由主代理另定并盘点。

全历史正文搜索、引用定位、多选/批量删除/逐条转发、聊天背景已在本轮补上。以上剩余候选不自动算已完成。本轮保留明确范围，不新增腾讯支付、视频号/小程序后端，不用复制无授权原生素材填补视觉缺口。
