# Initial prototype contract

Node 24+, built-in HTTP / crypto / SQLite only. Start with `node server.cjs`. Frontend is plain HTML/CSS/JS in `public/`, same origin. No build or npm installation required.

All API responses are JSON. Errors: `{error: 'human readable', code?: '... '}`. Auth cookie HttpOnly, SameSite=Strict. Mutations require Origin match and `X-CSRF-Token` after authentication. Every protected route checks session. Never return provider secrets.

## Authentication
- GET /api/status -> `{setupRequired,authenticated,csrfToken?,version}`.
- POST /api/setup `{password,displayName?,setupToken?}` -> `{csrfToken,state}`. Local loopback initial setup allowed; remote first setup requires secret setup token in runtime data directory.
- POST /api/login `{password}` -> `{csrfToken,state}`.
- POST /api/logout -> `{ok:true}`.
- GET /api/state -> state below.

## State
`{revision,profile,personas,roles,messages,memories,moments,ledger,wallet,farm,favorites,stickers,emojiRecents,settings}`
- profile `{name,wechatId,avatar,cover,bio,region}`. Avatar and Moments cover are validated image data URLs or empty (native neutral placeholders).
- personas `[{id,name,prompt,avatar}]`.
- roles `[{id,name,remark,tags,description,phone,wechatId,avatar,chatBackground,bio,prompt,personaId,relationship,pinned,muted,hidden,unread,proactive,proactiveMinutes,quietStart,quietEnd,lastActiveAt}]`. Tags: at most ten unique strings of up to 30 characters; description: 500 characters; phone: 80 characters of display-only text. `chatBackground` is a validated image data URL or empty; omitted partial edits retain it. Old records default to empty values.
- messages `[{id,roleId,sender:'user'|'assistant'|'system',type:'text'|'image'|'voice'|'transfer'|'redpacket',content,createdAt,status:'sent'|'error'|'pending'|'demo',error?,meta?}]`.
- memories `[{id,roleId,content,createdAt}]`.
- moments `[{id,authorId:'me'|roleId,content,image?,visibility:'all'|[roleId],likes:[string],comments:[{id,authorId,content,replyTo?,replyToAuthorId?,createdAt}],createdAt}]`.
- ledger `[{id,amountCents,type:'expense'|'income',category,merchant,date:'YYYY-MM-DD',note}]`.
- wallet `{balanceCents,roleBalances:{[roleId]:integer},transactions:[{id,roleId,type:'transfer'|'redpacket',amountCents,direction:'out'|'in',note?,createdAt}]}`. Positive integer cents, no real money.
- farm `{coins,seeds,plots:[{id,crop:null|'carrot'|'tomato',plantedAt,readyAt}],visits:[{roleId,date}]}`. Six plots. Server validates maturity and double harvest.
- favorites `[{id,messageId?,content,type,meta?,createdAt}]`. Voice favorites retain playable audio and transcription in `meta`, even after the source message is deleted.
- stickers `[{id,image,createdAt}]`: validated local image data URLs; at most 100 entries and 16 MiB of total encoded image data. Duplicate image uploads retain the existing entry. Sticker sending uses the existing chat image payload.
- emojiRecents `[token]`: at most 24 unique built-in emoji tokens, newest first. The server validates tokens against the same static `public/emoji.js` data as the frontend. Missing sticker/recent fields in old databases and backups default to empty arrays.
- settings `{preset:{label,baseUrl,model},providers:{chat,vision,tts,stt},userName?,...}`. Each provider `{mode:'preset'|'custom',baseUrl,model,keySet:boolean,voice?:string}`. API Key is submitted only through settings.save and never returned. Empty key means keep previous; explicit clearKey clears.
- For the model page, each entry in `settings.ai.sources` exposes an opaque `keyRevision`. Send its original value as `expectedKeyRevision` when replacing or clearing credentials through `/api/engine/models/card` or deleting a provider. The one-click station endpoint takes `expectedKeyRevisions` keyed by group ID. A stale write returns HTTP 409 with code `PROVIDER_KEY_CHANGED` and `keyRevisions` for the conflicting providers. The whole submission remains pending. Retry with the returned revisions only after explicit confirmation.

## Actions
POST /api/action `{type,payload}` -> `{state}`. Use exact names:
- `profile.save` with profile fields
- `persona.save` (id optional), `persona.delete` {id}
- `role.save` (id optional), `role.delete` {id}
- `conversation.pin` {roleId,pinned}, `conversation.mute` {roleId,muted}, `conversation.hide` {roleId,hidden}, `conversation.read` {roleId}, `conversation.unread` {roleId}, `conversation.clear` {roleId}, `conversation.delete` {roleId}. Delete clears messages and hides the conversation, retains the contact and unrelated records, and detaches referenced favorites/quotes without deleting their saved content.
- `message.delete` {id}, `message.favorite` {id}, `message.pat` {roleId}
- `message.deleteMany` {roleId,ids}: 1–100 unique existing IDs from that conversation; validate the whole selection before deletion. Saved favorites and quote snapshots remain detached. Generation in that conversation blocks deletion with 409.
- `message.forward` {ids,targetRoleId}: 1–100 unique existing successful user/assistant text or image messages from one source conversation, copied in source order as new target user messages. Preserve media and quote snapshots; remove quote.messageId and retain quote.senderName so the source author stays correct across conversations and backup/restore. No model request or wallet operation. System, voice, financial, failed, pending and demo messages are rejected. Invalid selections leave the entire state unchanged.
- `memory.save` {id?,roleId,content}, `memory.delete` {id}
- `moment.create` {content,image?,visibility}, `moment.like` {id}, `moment.comment` {id,content,replyTo?}, `moment.delete` {id}. `replyTo` must name a comment in the same Moment; the server derives `replyToAuthorId` and rejects fabricated authors.
- `ledger.save` {id?,amountCents,type,category,merchant,date,note}, `ledger.delete` {id}
- `wallet.transfer` {roleId,amountCents,type:'transfer'|'redpacket',requestId,note?}. Notes are limited to 200 characters, saved with the transaction and message, and included in idempotency checks.
- `farm.plant` {plotId,crop}, `farm.harvest` {plotId}, `farm.water` {roleId}
- `favorite.delete` {id}, `favorite.deleteMany` {ids}: batch requires 1–100 unique existing IDs and never deletes source messages; invalid selection rejects atomically.
- `sticker.add` {image}, `sticker.delete` {id}, `emoji.use` {token}
- `settings.save` {preset?,providers?:{chat?:{...provider,key?},vision?:...,tts?:...,stt?:...}}

## AI and files
- POST /api/chat (also `/api/chat/send`) `{roleId,text?,image?,audio?,durationMs?,quoteId?,requestId}` -> `{state}`. Text plus image remains supported; audio is mutually exclusive with text/image and requires a positive duration up to ten minutes and at most 8 MiB decoded audio. Save user message first, transcribe voice if needed, call the configured model, and save replies. Failures retain the playable voice or text with error state; retries reuse a successful transcription. `quoteId` must reference this contact's message and is saved as a safe snapshot. Concurrent generation for the same contact is rejected with 409. Idempotency covers text/image/audio/duration/quote and prevents duplicate replay.
- POST /api/chat/retry `{messageId}` -> `{state}`; only failed user messages can retry.
- POST /api/moments/generate `{roleId}` -> `{state}`. Real provider call, no fake generated posts.
- POST /api/providers/test `{capability:'chat'|'vision'|'tts'|'stt'}` -> `{ok,message}`. Test configured service; no key in response. Can focus chat in v0.1 and clearly reject unsupported checks.
- POST /api/providers/models `{capability}` -> `{models:[string]}`.
- POST /api/ledger/recognize `{image:dataURL}` -> `{drafts:[{amountCents,type,category,merchant,date,note}]}`. Never insert automatically. No ledger access in chat contexts unless user pastes/shares data themselves.
- POST /api/voice/transcribe with `{audio:dataURL,roleId}` uses the recording-to-text assignment (`stt`). The chat gesture sends the result through `/api/chat` as text. Keyboard dictation inserts it into the draft. Sending a voice bubble through `/api/chat/send` uses the separate `voiceUnderstanding` assignment. Long-press transcription of an existing voice message uses its saved transcript when available or requests transcription with `{messageId}`.
- POST /api/voice/speak `{messageId}` -> `{audio:dataURL,state}` using configured OpenAI-compatible TTS, saves audio in message meta.
- GET /api/backup -> versioned JSON download, business state including media; omit login sessions/password hash/provider keys. Document that keys must be re-entered after migration.
- POST /api/restore `{backup,confirm:true}` -> `{state}`. Validate format, bounded data, schemas and referential integrity before transaction. Retain local credentials and keys. No arbitrary paths/SQL from backup.

Initial state may have 2 original example characters and clearly marked status=demo messages. No model key is provided: no real paid API calls until user configures. Proactive off by default. Memory MVP is editable explicit records; automatic plugin memory and image generation remain a labeled future adapter, not a fake capability.

Frontend integration: global `window.Pipi` exposes `getState()`, `api(path,body?,method?)`, `act(type,payload)`, `showView(name,arg?)`, `openModal(title,html,onSubmit?,submitLabel?)`, `closeModal()`, `toast(text)`, `esc(value)`, `avatar(entity,size?)`, `icons`, `refresh()` and `setState(state)`. Main app owns navigation/header/shell/auth/chat/settings/personas/roles/memory. Optional `window.PipiFeatures.render(name,arg)` returns HTML for moments/ledger/wallet/farm/favorites/services; `.bind(name,arg)` binds handlers after view rendering. Use safe escaping; no user/model text as HTML. No external CDN fonts/images/runtime.
