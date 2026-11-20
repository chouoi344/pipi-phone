# 官方品牌素材与接口地址

核实日期：2026-11-15。2026-11-16随用户确认的配置页面接入，用于识别对应服务商；没有请求付费模型接口。所有图像均原样下载，未重绘、未截图裁切、未注入远程脚本。PNG/SVG/WebP 可本地静态加载，无 npm 依赖。

## 图像

| 品牌 | 建议列表图标 | 官方来源页面 | 原始素材 |
| --- | --- | --- | --- |
| OpenAI | `openai.png`（48×48） | https://developers.openai.com/ | https://developers.openai.com/favicon.png |
| OpenAI 兼容接口 | `openai.svg`（24×24） | [AstrBot v4.29.4 图标映射](https://github.com/AstrBotDevs/AstrBot/blob/v4.29.4/dashboard/src/utils/providerUtils.js#L11-L15) | [LobeHub icons-static-svg 1.66.0](https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@1.66.0/icons/openai.svg) |
| DeepSeek | `deepseek.svg`（27×20） | https://api-docs.deepseek.com/ | https://api-docs.deepseek.com/img/logo-mark-light.svg |
| Gemini | `gemini.svg`（100×100） | https://ai.google.dev/（页面导航中的 Gemini 图标） | https://storage.googleapis.com/gdm-deepmind-com-prod-public/media/original_images/NNmL1hUvjZQiOHC-/gemini_app_icon_nav.svg |
| 通义千问 Qwen | `qwen.png`（80×80） | https://qwen.ai/ | https://img.alicdn.com/imgextra/i4/O1CN01OXv3EM1FN8t9W4P79_!!6000000000474-2-tps-80-80.png |
| 硅基流动 | `siliconflow.png`（48×48） | https://www.siliconflow.cn/ | https://www.siliconflow.cn/favicon.ico （响应实际为 PNG，按 PNG 保存） |
| MiniMax | `minimax.png`（192×192） | https://platform.minimax.io/docs/api-reference/text-openai-api | https://platform.minimax.io/docs/mintlify-assets/_mintlify/favicons/minimax-cac98058/-WSO_KEoennf5XoM/_generated/favicon/android-chrome-192x192.png |

`openai.svg` 使用 LobeHub 1.66.0 的原始内容，项目许可见 [LobeHub-MIT.txt](LobeHub-MIT.txt)。该图标识别 OpenAI API 接口类型。

原演示另保留两个官方完整标识（此目录未包含）：`siliconflow.svg` 来自 https://www.siliconflow.cn/logo-new.svg ；`minimax.webp` 来自 https://www.minimax.cn/assets/logo/minimax-horizontal-brand-black.webp 。完整标识带文字，列表小方框优先使用上述 PNG 图标。

许可状态：上述为各品牌官网公开使用的品牌标识，未核实到这些具体素材的独立开源/自由再分发许可；不能将官网可下载解释为已获得品牌商商业授权。此处仅用于识别服务商，不表示合作、认证或背书。正式分发时继续遵守各品牌商标及品牌使用要求。Qwen 图标表示模型品牌，API 服务商名称可显示“通义千问（阿里云百炼）”。

## API 基础地址

| 服务商 | 可填基础地址 | 官方核实来源 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | https://developers.openai.com/api/reference/overview |
| DeepSeek | `https://api.deepseek.com`（兼容 `/v1`） | https://api-docs.deepseek.com/ |
| Gemini OpenAI 兼容 | `https://generativelanguage.googleapis.com/v1beta/openai/` | https://ai.google.dev/gemini-api/docs/openai （当前转至 https://aistudio.google.com/docs/openai） |
| 通义千问 / 百炼北京兼容旧域名 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope |
| 硅基流动中国站 | `https://api.siliconflow.cn/v1` | https://docs.siliconflow.cn/docs/usercases/use-siliconcloud-in-dify |
| MiniMax 中国站 | `https://api.minimax.cn/v1` | https://platform.minimax.cn/docs/api-reference/text-openai-api |
| MiniMax 国际站 | `https://api.minimax.io/v1` | https://platform.minimax.io/docs/api-reference/text-openai-api |

OpenAI 在同一基础地址下分别使用 `/chat/completions`（聊天）、`/audio/transcriptions`（语音转文字）、`/audio/speech`（文字转语音）、`/images/generations`（生成图片）。可共用基础地址不代表所有模型都支持所有能力，仍需按用途选择模型。接口文档：https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create 、https://developers.openai.com/api/reference/cli/resources/audio 、https://developers.openai.com/api/docs/guides/your-data 。本次未请求真实模型、未验证账号权限。

百炼当前官方文档优先推荐业务空间专属域名，`{WorkspaceId}` 须使用用户控制台中的真实业务空间 ID：北京 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，新加坡 `https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`，美国弗吉尼亚 `https://{WorkspaceId}.us-east-1.maas.aliyuncs.com/compatible-mode/v1`，日本东京 `https://{WorkspaceId}.ap-northeast-1.maas.aliyuncs.com/compatible-mode/v1`。官方明确原北京 `dashscope.aliyuncs.com` 域名仍可兼容使用，并建议迁移专属域名；旧新加坡域名为 `dashscope-intl.aliyuncs.com`。地区的 API Key 与接入地址须匹配，模型列表也可能不同。Demo 可先填北京兼容旧地址，并保留编辑入口，不能把带 `{WorkspaceId}` 的占位模板当成真实可连接地址。

MiniMax 国内文档旧入口 `platform.minimaxi.com` 当前跳转至 `platform.minimax.cn`，文档示例使用 `api.minimax.cn/v1`；本次未核实旧 `api.minimaxi.com` 的兼容期限。MiniMax OpenAI 兼容地址本次仅核实文本接口，原生语音/图片接口不因文本兼容而自动具有 OpenAI 协议。

## 语音地址补充核实

- MiniMax 中国站同步语音官方地址 `https://api.minimax.cn/v1/t2a_v2`，配置中基础地址为 `https://api.minimax.cn/v1`，使用 MiniMax 原生语音格式；来源：https://platform.minimax.cn/docs/api-reference/speech-t2a-http 。
- 百炼 Qwen-TTS 使用原生 DashScope 基础地址 `https://dashscope.aliyuncs.com/api/v1`；来源：https://help.aliyun.com/zh/model-studio/qwen-tts-api 。不能共用聊天的 compatible-mode 路径。
- 百炼 Qwen-ASR-Flash 支持 OpenAI 兼容的 chat/completions 输入音频形式，和 OpenAI audio/transcriptions 不同；来源：https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference 。本轮仅地址和界面预设，无真实适配调用。

## BreezeBlue 补充（2026-11-16）

- 官方列表图标：`breezeblue.webp`，原样下载自 https://breezeblue.ai/images/landing-v2/evaluation/logo-breezeblue.webp ，官网 https://breezeblue.ai/zh 的 BreezeBlue 排名条目实际使用该素材；未重绘。
- 官方 API 基础地址：`https://api.breeze.blue/v1`。来源：https://docs.breezeblue.ai/api-reference/introduction.md 。
- 原生 TTS：`POST /text-to-speech/{voice_id}`，请求头 `xi-api-key`；JSON 包含 `text`，可选 `model_id`、`instructions`、`voice_settings`；同步响应为二进制音频。官方示例模型 `breeze-tts-2`。来源：https://docs.breezeblue.ai/api-reference/text-to-speech/convert-text-to-speech.md 。本次只读公开文档和下载图标，没有生成语音或验证密钥。
