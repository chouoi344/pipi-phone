# v0.4.3 independent backend verification

Executed 2026-11-14T18:25:20.058Z: **30 passed, 0 failed, 0 skipped**, **5824.596343 ms**, exit code **0**. The complete existing adversarial and status suites ran against frozen 0.4.3 server sources in a separate disposable Node 24 container. Source was mounted read-only at `/app`; the container used `--network none --read-only --tmpfs /tmp:rw,nosuid,nodev --cap-drop ALL --security-opt no-new-privileges:true --user node`. Each fixture created temporary SQLite data. No production volume/container data, real provider credential or user browser was used.

Full stdout: `%TEMP%/pipi-v043-backend-final/backend-output.txt`. Reproduction: `node --test tests/adversarial.test.cjs tests/status.test.cjs` inside the isolated container described above. The release owner separately verifies the built image; this section reports the independent read-only source run only. No additional backend rerun was needed for subsequent CSS/frame-only changes.

All original 26 adversarial cases and four status cases remain enabled. These verify actual HTTP/protocol and persisted-state behavior, including authentication, CSRF/Host boundaries, provider-key privacy, local controlled model responses, per-role context isolation, concurrency, integer money, farm idempotency, receipt drafts without automatic ledger mutation, malformed input, SSRF/redirect prevention, backup atomicity, native conversation actions, voice/quote/favorite durability, and server-owned status timestamps/expiry. New cross-page browser checks and explicit browser protocol mocks are reported separately in `UI-VERIFICATION.md`; neither this backend result nor screenshot counts establish native WeChat appearance or real-device/provider compatibility.

| Verified file | SHA-256 |
| --- | --- |
| `server.cjs` | `190069a31d1833a65037269c0a63d7b74acea577c0ce51382c35156e7f42bc90` |
| `lib/state.cjs` | `f7b285c617618dce05b4b603d3efcbff4d349036df901d47722123f9c7f678a7` |
| `lib/providers.cjs` | `f9e0b0a57fadeba5a548e6d0c12bdc1f9c9ae15539d6ad0da8160e129eb2e4ae` |
| `tests/adversarial.test.cjs` | `5890662c39408663a0c30a505af93bb72f22445648eb66c6d4f5fe316952820e` |
| `tests/status.test.cjs` | `afb2e8fea942d76db7d8a66bee1048c6be43cea43a3f9066f7ee32f55fb52bfc` |

Historical execution records follow; they are not substituted for this run.

---

# v0.4.2 independent backend verification

Executed 2026-11-14T17:15:55.968Z: **30 passed, 0 failed, 0 skipped**, **6208.7 ms**. The final 0.4.2 server/status snapshot ran in a fresh nonroot disposable Node 24 container with source mounted read-only, no network, a read-only root filesystem, tmpfs `/tmp`, dropped capabilities and `no-new-privileges`. Every fixture uses separate temporary SQLite data. No production container/database, user browser, real credential or paid provider was operated. Full stdout: `%TEMP%/pipi-v042-qa/backend-output.txt`.

The original 26 adversarial cases remain enabled. Four status cases additionally verify all 14 whitelisted presets, 60 Unicode-code-point descriptions, server-owned timestamps and 24-hour expiry, literal hostile strings, rejection without revision changes, partial-profile isolation, login/restart/backup durability, idempotent ending, safe migration of old backups and atomic rejection of corrupt restores. Public expiry projection does not extend a restored status or mutate stored data.

| Verified file | SHA-256 |
| --- | --- |
| `server.cjs` | `8ee53f3691bd50aed08a9e88c3fc5342a87835416b302538fe766290fa5ffea4` |
| `lib/state.cjs` | `f7b285c617618dce05b4b603d3efcbff4d349036df901d47722123f9c7f678a7` |
| `lib/providers.cjs` | `f9e0b0a57fadeba5a548e6d0c12bdc1f9c9ae15539d6ad0da8160e129eb2e4ae` |
| `tests/adversarial.test.cjs` | `5890662c39408663a0c30a505af93bb72f22445648eb66c6d4f5fe316952820e` |
| `tests/status.test.cjs` | `afb2e8fea942d76db7d8a66bee1048c6be43cea43a3f9066f7ee32f55fb52bfc` |

Historical execution records follow.

---

# v0.4.1 independent backend rerun

Executed 2026-11-14: **26 passed, 0 failed, 0 skipped**, **5739.1 ms**. The same complete adversarial suite ran in a fresh nonroot disposable Node 24 container with repository source read-only, no external network, read-only root filesystem, temporary SQLite data, dropped capabilities and no-new-privileges. No production data/container, real credential or paid API was used. Full stdout: `%TEMP%/pipi-v041-qa/backend-output.txt`.

The backend version is now 0.4.1. State/provider implementations and existing endpoint semantics remain the same as the verified v0.4 snapshot; the new inline dictation interaction calls the existing transcription endpoint. Browser STT success/error/late-result tests are explicitly CDP protocol mocks and are documented separately; they do not prove real speech-recognition quality or provider availability.

| Tested file | SHA-256 |
| --- | --- |
| `server.cjs` | `65c217c819f3a655249cf5b5c3b3b79465bb68ceb10a72633cebc8c8d68256b4` |
| `lib/state.cjs` | `7e9c08dc2df7b0c4b8d87ac65aa0b5f9346fb60bcc524b963935acf30a4e5cf1` |
| `lib/providers.cjs` | `f9e0b0a57fadeba5a548e6d0c12bdc1f9c9ae15539d6ad0da8160e129eb2e4ae` |
| `tests/adversarial.test.cjs` | `5890662c39408663a0c30a505af93bb72f22445648eb66c6d4f5fe316952820e` |

The historical v0.4 result and detailed coverage follow.

---

# v0.4 independent backend verification

Executed 2026-11-14: **26 tests passed, 0 failed, 0 skipped**, **5794.6 ms**, Linux Node 24. Source was mounted read-only into a disposable `node:24-bookworm-slim` container with `--network none --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true --user node`. Every fixture uses a new temporary database; no production container, browser, account data or paid provider was used.

The 21 existing tests remain and five new integration tests verify:

| Area | Executed assertions |
| --- | --- |
| Favorite stickers | Valid image import, same-image deduplication, delete/missing-ID behavior, real app restart, backup/restore and separation from message favorites |
| Sticker boundaries | SVG, remote URL, invalid magic/base64 and wrong types reject without state or revision changes; corrupt backup object/null/duplicate IDs reject; 100-image and 16 MiB URI aggregate caps reject atomically |
| Contact fields | Tags trim/deduplicate, description and telephone persist, partial role save retains fields; invalid arrays, 11 tags, overlong tag/description/phone reject atomically |
| Compatibility | Older backups missing stickers, recents and contact fields migrate to empty collections/strings |
| Emoji recents | All 109 exact sprite-token whitelist entries are read from the shipped data file; action tests rotate 26 tokens into a 24-entry MRU, move a repeated token to the front, reject unknown/Unicode/HTML tokens atomically, survive actual app restart and restore |

MRU backup normalization explicitly **deduplicates while retaining first-occurrence order**. Unknown tokens and over-24 input lists reject atomically. The first new test run incorrectly expected duplicate MRU tokens to reject (25/26); the agreed MRU semantics were clarified and the new assertion now verifies deterministic normalization. This was a new test-contract correction, not a product security fix or a weakening of an existing test. Duplicate sticker IDs still reject.

Reproduce with `node --test tests/adversarial.test.cjs` in the isolated environment above. Full final stdout: `%TEMP%/pipi-v04-qa/backend-output.txt`. Backend source snapshot:

| File | SHA-256 |
| --- | --- |
| `server.cjs` | `1181ac150e08206d1568c93c986f793ed90880d91c9248bddff4d1f806fc4137` |
| `lib/state.cjs` | `7e9c08dc2df7b0c4b8d87ac65aa0b5f9346fb60bcc524b963935acf30a4e5cf1` |
| `lib/providers.cjs` | `f9e0b0a57fadeba5a548e6d0c12bdc1f9c9ae15539d6ad0da8160e129eb2e4ae` |
| `tests/adversarial.test.cjs` | `5890662c39408663a0c30a505af93bb72f22445648eb66c6d4f5fe316952820e` |

Only server-side protocols and persisted state are proved here. These checks do not establish native visual fidelity, real-device compatibility, successful paid-provider quality, or real payment/receipt/refund state machines. The existing historical report follows.

---

# Independent adversarial verification

Status: v0.3 isolated container rerun completed on 2026-11-14: **21 tests passed, 0 failed, 0 skipped**, duration **4649 ms**. This includes the original 15 cases, native conversation deletion/muting, validated cover images and comment replies, voice retention/retry/idempotency, message quote snapshots, favorited voice migration, and persisted transfer notes. Host-header checks use raw `node:http` so that `fetch` cannot silently ignore a manually supplied Host. No product assertion was weakened.

## Method and isolation

- Test entry: `node --test tests/adversarial.test.cjs` (`npm test` also discovers this file).
- 21 independent top-level integration tests use the exported `createApp` and real HTTP requests. Each app receives a fresh OS temporary data directory. No user runtime directory, real account, real provider key, or paid API is used.
- A local HTTP model server records actual OpenAI-compatible requests and returns controlled responses. `ALLOW_PRIVATE_PROVIDERS=1` is set only by the test fixture to permit this local mock. A separate fixture removes that flag to verify the production default blocks private destinations.
- Tests close apps and mocks and remove temporary SQLite directories. The delayed model response is released in a `finally` block so failed assertions do not intentionally leave a blocked model request.
- The production Dockerfile deliberately does not copy tests. To run against the production image, mount/copy `tests/` to `/app/tests` and execute `node --test /app/tests/adversarial.test.cjs` with `/app` as the working directory.

## Executed so far

Windows Node `v24.22.1` syntax check passed. The first Windows shell HTTP execution completed with 13 failed tests at their first network operation: every loopback `fetch` returned `connect EACCES 127.0.0.1:<temporary-port>`. This was an execution-environment restriction, before the relevant product assertions, and is not counted as a product pass or as 13 product defects. No test process from that run remained running.

Subsequent edits added two cases, stricter provider failure codes and 13 null/schema backup corruptions. Their syntax check passed. The first real Docker HTTP run reported 15 tests, 14 passed, 1 failed (request boundary). A transport issue was identified: Node `fetch` may ignore a caller-supplied Host. Both hostile-Host requests now use `node:http.request`, and each header case carries its own assertion label. The final Docker rerun passed all 15 tests, including hostile Host rejection. It ran with `--network none --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true --user node` against `node:24-bookworm-slim`, mounting the repository read-only at `/app`. No existing containers or runtime data were changed.

## Executed coverage

| Area | Adversarial checks |
| --- | --- |
| Authentication | Unauthenticated sensitive routes, weak password, repeated setup, wrong/correct login, cookie HttpOnly/SameSite, logout invalidates captured session cookie |
| Request boundary | Missing/forged CSRF, foreign/null/missing Origin, foreign Host, no state change on rejection |
| Provider secrets | No key in state/status/backup/provider responses; actual mock receives Authorization; blank key preserves and explicit clear removes |
| Model privacy | Per-role history, persona and explicit memory; other role markers and private ledger merchant/note absent from captured model payload |
| Failure honesty | Upstream HTTP error, malformed JSON and empty choices preserve failed user message; no assistant reply fabricated; explicit retry; secret in upstream error is not echoed |
| Concurrency | Same-role in-flight conflict, replayed and conflicting request IDs, one model request, profile and memory changes survive delayed model completion |
| Money | Negative/zero/fraction/string/NaN-like/null/unsafe/oversized amounts; insufficient virtual balance; concurrent duplicate transfer debits once; note persists in transaction/message and backup, changed-note replay conflicts, overlong note rejects without mutation |
| Farm | Premature harvest and duplicate planting; mature concurrent harvest succeeds once; repeat daily watering rejected |
| Vision | Actual multimodal request and structured draft response; recognizing receipt does not mutate ledger |
| Backup | Invalid version/schema/references preserve original state; cross-instance restore compares all ten business sections after creating PNG media, memory, moments, ledger, transfer, crop and favorite; local password and same-destination local key retained |
| Restore destinations | Changing custom URL clears that capability key; changing inherited preset URL clears affected keys; new mock receives no old credential |
| Static/input | Malformed JSON, >20 MiB request body, encoded/raw traversal, source/data/dotfile paths |
| SSRF | Loopback, localhost, IPv6, mapped IPv6, metadata address, integer IP and private address denied by default; actual redirect rejected without a second HTTP request |
| Remote setup | Forwarded-client header requires setup token; invalid token rejected; valid token consumed and token file removed |
| Native conversation actions | Delete clears messages, hides conversation and resets unread while retaining contact, wallet, memories and favorite content; mute is boolean and survives backup/restore; a redundant roleId cannot bypass the actual role.delete busy lock |
| Cover and comment replies | Valid PNG persists; remote URLs, wrong image magic and malformed base64 reject without partial profile changes; reply target must belong to the same moment; cross-moment backup references reject atomically |
| Voice | Missing configuration retains failed user voice with audio and duration and no assistant; explicit retry transcribes once and sends transcript to chat; invalid duration/base64/MIME or mixed text rejects before mutation; changed source with the same request ID conflicts; busy conversation deletion rejects |
| Quotes and voice favorites | Cross-role/missing quote rejects before adding a message; deleting quoted source detaches ID and retains text snapshot; favorited audio/transcript survives conversation deletion and backup/restore; replay before restore cannot resurrect a deleted conversation |

The final v0.3 run used `node:24-bookworm-slim`, `--network none --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges:true --user node`, with the repository mounted read-only at `/app`. Its output is in the test evidence directory `pipi-ui-v03/backend-tests.txt` beneath the OS temporary directory. No commercial API was contacted. The two extra fixture failures during test preparation were corrected: a second seeded role had no initial message, and restore deliberately clears operational idempotency records, so deletion replay is asserted before restoring a backup rather than incorrectly requiring backups to retain that operational log.

Tested backend snapshot (SHA-256):

| File | SHA-256 |
| --- | --- |
| `server.cjs` | `0b38e14dcaeb713127a929c8751b83922d057b3d731062d988fe3c9b1b68194b` |
| `lib/state.cjs` | `e678163ffccf557b16992065cb1cb6230af22d62e8fd78b66624dc1787686a43` |
| `lib/providers.cjs` | `f9e0b0a57fadeba5a548e6d0c12bdc1f9c9ae15539d6ad0da8160e129eb2e4ae` |

## Review findings and changes requested

1. Initial backup validator did not verify references from wallet balances/transactions, farm visits and favorite message IDs. Reported independently; backend author added reference checks and delete cascades. Runtime regression is included.
2. Restoring a different provider destination while retaining a local key could expose that key to the new destination. Parent review identified this; backend author clears keys when the effective URL changes. Both custom and inherited preset URL regressions are included.
3. `payload: null` was replaced by `{}` through `payload || {}`. Reported independently; backend author changed the default to apply only to absent payload. The malformed-input case passed in the first Docker execution.
4. Some null elements in backup arrays could cause an internal exception rather than a structured validation error. Reported independently; backend author added object checks. The restore test now exercises 13 null/schema corruptions and passed in the first Docker execution. Validation occurs before replacing persisted state.

## Source audit and limits

The reviewed provider implementation resolves all candidate addresses before connecting, rejects the request if any resolved address is private/special, and pins the selected address into the HTTP client's `lookup` callback. Redirects are explicitly rejected. These are source review observations; a live DNS rebinding attack has not been executed.

The reviewed static handler bounds paths to `public/`, rejects dot/backslash paths, checks `realpath` for symlink escape, and permits only a fixed extension list. Frontend text rendering in the reviewed chat/memory/role/model-list/moment paths uses HTML escaping; image/audio data URLs are restricted, and the server supplies a restrictive script CSP. Browser acceptance additionally executes inert XSS payload checks in chat, contacts and moments; see `UI-VERIFICATION.md` for exact outcomes and limits.

The local mock verifies protocol behavior and failure handling, not any commercial provider's real model quality, billing, API compatibility, voice output or availability. No long-duration load test, internet deployment, TLS reverse-proxy deployment, or independent penetration-test certification is claimed.
