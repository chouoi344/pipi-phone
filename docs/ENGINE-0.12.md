# 0.12.0 角色引擎

当前提供0.12.0源码安装包，未部署上线。保留原有微信风格页面、native.css尺寸与已有资料；本次没有把 AstrBot 全部功能移入小手机，引擎继续独立运行于 Node.js 24，不新增 npm 运行依赖。

## 从哪里使用

“我 → 设置 → 小手机 → 模型”继续管理七类模型。聊天与生图使用 OpenAI 兼容接口，语音接入范围见下表。

“我 → 设置 → 功能 → 角色动作”管理动作权限；“自主活动”选择好友、填写作息、保存并生成计划预览。原有好友人设管理与聊天入口保持不变。

## 本轮能力与兼容范围

| 能力 | 当前范围 |
| --- | --- |
| 聊天 | 原有好友人设、用户身份、摘要、图片与工具循环；每次请求按当前模型容量检查，切换备用模型后重新检查，保留最新用户原文；容量不足明确失败 |
| 角色动作 | 保留钱包、提醒与互动等已有动作；增加生成/发送图片、修改自己的名字、签名、拍一拍、头像和封面。图片媒体按好友隔离，可在后续会话继续引用 |
| 执行记录 | 记录动作执行及发送进度，重试尽量复用已有结果；重启后未知结果不自动重发，失败与中断可追踪 |
| 可见正文 | 独立推理字段不显示；过滤完整或截断的think/thinking标签，覆盖正文、摘要、图片转述及计划备注；工具请求所需metadata保留 |
| 生图 | 使用生成图片模型与OpenAI兼容图片接口，返回图片后保存为角色媒体；需要用户配置自己的服务，未验证真实服务效果 |
| 语音 | OpenAI兼容语音接口；MiniMax语音合成、Qwen语音合成/转写、BreezeBlue语音合成适配。音色、可用模型、账户额度与服务商实际支持有关，配置成功不代表真实调用成功 |
| decision / rerank | 配置入口保留，尚无实际业务调用 |
| embedding知识库 | 不在首期业务范围，未实现知识库导入和检索流程 |

工具每轮最多8次，另受连续动作步数限制；单个工具结果超过32768字符或总上下文无法容纳时明确报错。超过150字的整份回复仍由原有发送流程作为一条发送。

## 当前日常活动入口

原「自主活动」页与自动执行入口已经停用。旧备份里的计划和活动历史仍可随资料恢复。日程、主动信息、自动朋友圈和定时提醒继续使用各自的入口及开关。

「好友配置 → 日程」可选正常、夜猫子和自由三种作息。日程生成继续使用最近 72 小时内是否有用户发言的规则。日程微调仅在明确约定时间或调整安排时触发。

新好友默认关闭自动发朋友圈。主动消息第一次开启后从当前时间计时，各好友在已配置的间隔内错开。模型本次决定保持安静会计入当天主动次数，未回复次数保持原计数。

## 数据、升级与验证

保留旧好友、独立设定、人设绑定、消息、模型和登录资料。0.13.0 导出的 `.tar` 可包含媒体、运行记录、旧作息及模型密钥。恢复密钥时仍匹配服务商和原接口地址，每个实例分别管理登录密码与会话。[安装与升级](../INSTALL.zh-CN.md) · [0.13.0 升级说明](../升级说明_0.13.0.md)

本轮使用隔离测试、模拟上游与本地检查，具体完成项和结果以工作区项目交接为准。没有用模拟接口证明真实服务商成功，真实上游、费用、音色效果和真机均未验证。旧版本全量记录保留在 [0.11历史说明](ENGINE-0.11.md)，不作为本轮全量通过声明。

## 对标核对与维护位置

参考 AstrBot v4.29.4 的固定提交 `61335414433db721b3f7ecc93f90deafe0a59d78`；本轮参考能力划分与协议，不直接引入其运行时或复制 Python 插件。现有项目整体 AGPL-3.0-only 许可不变。

| 对标环节 | 小手机实现位置及本轮结果 |
| --- | --- |
| 提供商、模型与备用选择 | `lib/engine/models.cjs`、`lib/providers.cjs`、`lib/provider-native.cjs`；保留配置并补执行适配 |
| 人设、上下文、压缩、分段 | 既有人设库；`pipeline.cjs`、`delivery.cjs`；补容量和推理隔离，保留分段规则 |
| 工具执行与持久化 | `actions.cjs`、`execution.cjs`、`runtime.cjs`；权限、好友隔离、落盘结果与重试复用 |
| 定时与自主活动 | `scheduler.cjs`、`autonomy.cjs`；已有提醒保留，新增计划与条件唤醒 |
| 平台适配、插件市场、知识库等 | 不属于本轮小手机核心范围，未引入 |

协议参考：[AstrBot 上下文压缩](https://github.com/AstrBotDevs/AstrBot/blob/61335414433db721b3f7ecc93f90deafe0a59d78/docs/zh/use/context-compress.md)、[Gemini thought signatures](https://aistudio.google.com/docs/thought-signatures)、[Gemini OpenAI 兼容](https://aistudio.google.com/docs/openai)、[OpenAI 图片生成](https://developers.openai.com/api/reference/resources/images/methods/generate)、[MiniMax T2A](https://platform.minimax.cn/docs/api-reference/speech-t2a-http)、[Qwen TTS](https://help.aliyun.com/zh/model-studio/qwen-tts-api)、[Qwen ASR](https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference)、[BreezeBlue TTS](https://docs.breezeblue.ai/api-reference/text-to-speech/convert-text-to-speech)。实际中转站仍可能修改上游协议，需要真实模型验收。
