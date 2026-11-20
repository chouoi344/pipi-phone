# API contract for 0.13.0

Node 24+, built-in HTTP / crypto / SQLite only. Start with `node server.cjs`. Frontend is plain HTML/CSS/JS in `public/`, same origin. No build or npm installation required.

Most responses are JSON. Media and TAR downloads are binary and the live update endpoint uses server-sent events. JSON larger than 1 KiB can use Brotli or gzip according to `Accept-Encoding`. Errors include a readable Chinese `error` string and an optional `code`. Authentication uses an HttpOnly, SameSite=Strict cookie. Write requests require a same-origin `Origin` and `X-CSRF-Token` after authentication. Ordinary state and setting responses omit provider secrets. Explicit backup exports can contain model keys.

## Authentication
- `GET /api/status` returns `{setupRequired,authenticated,csrfToken?,version,setupTokenRequired,accountSecurity,messageLimit,binaryMedia,imageVariants,storageMaintenance,streamingBackup,momentExclusions}` with other feature flags. The setup token itself is withheld.
- `POST /api/setup` takes `{password,displayName?,setupToken?}` and returns `{csrfToken,state}`. Remote setup and setup behind a trusted proxy require the one-time token from the runtime data directory.
- POST /api/login `{password}` -> `{csrfToken,state}`.
- POST /api/logout -> `{ok:true}`.
- `GET /api/account` returns `{sessionCount,otherSessionCount}`. `POST /api/account/password` takes `{currentPassword,newPassword,confirmPassword}`. The new password needs at least eight characters. `POST /api/account/sessions/revoke` takes `{}`. Both successful writes return `{ok,sessionCount,otherSessionCount,message}` and keep the current session while revoking the others.
- `GET /api/state` returns the state below. Pass `?since=<revision>` to receive `{revision,unchanged:true}` when no revision has changed.

## State
`{revision,profile,personas,roles,messages,memories,moments,ledger,wallet,farm,favorites,stickers,emojiRecents,settings}`
- profile `{name,wechatId,avatar,cover,bio,region}`. Avatars and covers are authenticated media URLs, accepted legacy data URLs or empty placeholders.
- personas `[{id,name,prompt,avatar}]`.
- roles `[{id,name,remark,tags,description,phone,wechatId,avatar,chatBackground,bio,prompt,personaId,relationship,pinned,muted,hidden,unread,proactive,proactiveMinutes,quietStart,quietEnd,lastActiveAt}]`. Tags: at most ten unique strings of up to 30 characters; description: 500 characters; phone: 80 characters of display-only text. `chatBackground` is a validated image data URL or empty; omitted partial edits retain it. Old records default to empty values.
- messages `[{id,roleId,sender:'user'|'assistant'|'system',type:'text'|'image'|'voice'|'forward'|'transfer'|'redpacket',content,createdAt,status:'sent'|'error'|'pending'|'demo',error?,meta?}]`. The limit is 50,000 messages. Expired media uses `meta.expired:{kind,at}` without the original; existing thumbnails, captions and voice transcripts can remain.
- memories `[{id,roleId,content,createdAt}]`.
- moments include `visibility` as `'all'`, an array of fixed audience IDs (`[]` for private), or `{exclude:[roleId,...]}` for a dynamic exclusion list.
- ledger `[{id,amountCents,type:'expense'|'income',category,merchant,date:'YYYY-MM-DD',note}]`.
- wallet includes `balanceCents`, `roleBalances` and `transactions`. Transactions keep `status`, `returnedAt` when returned, and `roleDeleted:true` plus `roleName` after contact deletion. All amounts are virtual integer cents.
- farm `{coins,seeds,plots:[{id,crop:null|'carrot'|'tomato',plantedAt,readyAt}],visits:[{roleId,date}]}`. Six plots. Server validates maturity and double harvest.
- favorites `[{id,messageId?,content,type,meta?,createdAt}]`. Voice favorites retain playable audio and transcription in `meta`, even after the source message is deleted.
- stickers `[{id,image,createdAt}]`: at most 200 entries and 16 MiB of stored image bytes per library. Matching image bytes reuse the media filename. A chat sticker uses the chat image fields and `stickerId`.
- emojiRecents `[token]`: at most 24 unique built-in emoji tokens, newest first. The server validates tokens against the same static `public/emoji.js` data as the frontend. Missing sticker/recent fields in old databases and backups default to empty arrays.
- settings includes `mediaRetentionDays` (`7`, `30`, `90`, or `'forever'`) and the model setup in `settings.ai`. Provider summaries show `keySet` without returning a key. Use `/api/engine/models/card` for provider and model edits, `/api/engine/models/assign` for assignments, and `/api/engine/modules` with `{id,values}` for module settings.
- For the model page, each entry in `settings.ai.sources` exposes an opaque `keyRevision`. Send its original value as `expectedKeyRevision` when replacing or clearing credentials through `/api/engine/models/card` or deleting a provider. The one-click station endpoint takes `expectedKeyRevisions` keyed by group ID. A stale write returns HTTP 409 with code `PROVIDER_KEY_CHANGED` and `keyRevisions` for the conflicting providers. The whole submission remains pending. Retry with the returned revisions only after explicit confirmation.

## Actions
POST /api/action `{type,payload}` -> `{state}`. Use exact names:
- `profile.save` with profile fields
- `persona.save` (id optional), `persona.delete` {id}
- `role.save` (id optional), `role.delete` {id}. Deleting a contact preserves payment history and returns any open payment.
- `conversation.pin` {roleId,pinned}, `conversation.mute` {roleId,muted}, `conversation.hide` {roleId,hidden}, `conversation.read` {roleId}, `conversation.unread` {roleId}, `conversation.clear` {roleId}, `conversation.delete` {roleId}. Clear and delete return unclaimed virtual payments, retain the contact and favorites, and remove the messages. Delete also hides the conversation.
- `message.delete` {id}, `message.favorite` {id}, `message.pat` {roleId}
- `message.deleteMany` {roleId,ids}: 1–100 unique existing IDs from that conversation; validate the whole selection before deletion. Saved favorites and quote snapshots remain detached. Generation in that conversation blocks deletion with 409.
- `message.forward` {ids,targetRoleId,mode?}: one to 100 sent messages from one conversation. `individual` and `separate` copy supported messages in source order. `merged` stores a combined snapshot. Text, images, voice and existing combined records are supported. Expired media, payments, pending, failed and system messages are refused. No model request is made.
- `memory.save` {id?,roleId,content}, `memory.delete` {id}
- `moment.create` {content,image?,visibility}, `moment.like` {id}, `moment.comment` {id,content,replyTo?}, `moment.delete` {id}. `replyTo` must name a comment in the same Moment; the server derives `replyToAuthorId` and rejects fabricated authors.
- `ledger.save` {id?,amountCents,type,category,merchant,date,note}, `ledger.delete` {id}
- `wallet.transfer` {roleId,amountCents,type:'transfer'|'redpacket',requestId,note?}. Notes are limited to 200 characters, saved with the transaction and message, and included in idempotency checks.
- `farm.plant` {plotId,crop}, `farm.harvest` {plotId}, `farm.water` {roleId}
- `favorite.delete` {id}, `favorite.deleteMany` {ids}: batch requires 1–100 unique existing IDs and never deletes source messages; invalid selection rejects atomically.
- `sticker.add` {image}, `sticker.delete` {id}, `emoji.use` {token}
- `settings.save` retains the old preset/provider contract for legacy clients. The browser uses the current model endpoints above for provider writes.

## AI and files
- `POST /api/chat` or `/api/chat/send` accepts `{roleId,requestId,text?,image?,thumb?,modelImage?,stickerId?,audio?,durationMs?,quoteId?}`. A new submission saves the user's message before returning `{accepted:true,messageId,state}`, then processes it in the background. Reusing a matching request ID returns `{state}` with no duplicate. Text and image can be combined. Audio needs a recording duration of at most ten minutes and is separate from text or images. Quotes must be from the same conversation.
- `POST /api/chat/retry` takes `{messageId}` and returns `{accepted:true,messageId,state}` for a failed user message with available media.
- `POST /api/moments/generate` takes `{roleId}` and returns `{accepted:true,state}` if queued.
- POST /api/providers/test `{capability:'chat'|'vision'|'tts'|'stt'}` -> `{ok,message}`. Test configured service; no key in response. Can focus chat in v0.1 and clearly reject unsupported checks.
- POST /api/providers/models `{capability}` -> `{models:[string]}`.
- `POST /api/ledger/recognize` takes `{image}` and returns `{drafts:[{amountCents,type,category,merchant,date,note}]}` for explicit review. It asks for a default or currently used ledger category and uses `其他` for unknown categories.
- POST /api/voice/transcribe with `{audio:dataURL,roleId}` uses the recording-to-text assignment (`stt`). The chat gesture sends the result through `/api/chat` as text. Keyboard dictation inserts it into the draft. Sending a voice bubble through `/api/chat/send` uses the separate `voiceUnderstanding` assignment. Long-press transcription of an existing voice message uses its saved transcript when available or requests transcription with `{messageId}`.
- `POST /api/voice/speak` takes `{messageId}` and returns `{audio,state}`. The audio address may point to a media file.
- `POST /api/media/upload` accepts raw supported image or audio bytes and returns `{url}`. Size limits are 20 MiB static image, 10 MiB animation, and 8 MiB audio. The older POST with `{image}` and accepted legacy data URLs remain supported. `GET` and `HEAD /api/media/<file>` require a session and provide ETag, a private cache policy, and the correct type. A valid `Range` returns `206` and `Content-Range`.
- `GET /api/storage` returns the retention setting, measured usage, cleanup records, and migration state. `POST /api/storage/retention` with `{retention,preview:true}` returns `{requiresConfirmation,affected,confirmationToken}`. Save with `{retention,confirmationToken}`. A stale confirmation returns a fresh preview. Success returns `{storage,state}`.

## Backup formats

- `POST /api/backup/prepare` takes `{includeKeys,includeMedia}` and returns `{token,estimatedBytes,filename}`. The standard UI enables both options by default. `GET /api/backup/download?token=...` provides the sized TAR stream. The token lasts five minutes, works once, and is tied to the same session.
- `POST /api/restore/tar` consumes the raw TAR (`application/x-tar` or `application/octet-stream`). The archive begins with `manifest.json` and contains `state.json.gz` and optional `media/<filename>` entries. Media lengths, types and SHA-256 digests are checked before commit. A two-minute idle connection is closed. Restore returns `{state,clearedModelKeys,...}`.
- Legacy `GET /api/backup` produces a JSON backup without keys. Legacy `POST /api/backup` takes `{includeModelKeys}`. `POST /api/restore` takes `{backup,confirm:true}` and retains the 88 MiB request limit. Model keys in authorized exports are cleartext and restore only where the provider and URL match. Neither format exports login passwords or login sessions.

Normal first startup has no seeded contacts or chats. Isolated demo tools can load marked sample records and supply fixed model responses. A normal instance requires user-configured model credentials before external calls.

Frontend integration: global `window.Pipi` exposes `getState()`, `api(path,body?,method?)`, `act(type,payload)`, `showView(name,arg?)`, `openModal(title,html,onSubmit?,submitLabel?)`, `closeModal()`, `toast(text)`, `esc(value)`, `avatar(entity,size?)`, `icons`, `refresh()` and `setState(state)`. Main app owns navigation/header/shell/auth/chat/settings/personas/roles/memory. Optional `window.PipiFeatures.render(name,arg)` returns HTML for moments/ledger/wallet/farm/favorites/services; `.bind(name,arg)` binds handlers after view rendering. Use safe escaping; no user/model text as HTML. No external CDN fonts/images/runtime.
