# DSH integration validation — 2026-09-19

Runtime: Node.js 22.23.2, DSH 0.1.5-rc.2, provider 0.1.0-alpha.2.

- Clean dependency installation succeeds without `--legacy-peer-deps`.
- Eight tests, type checking, production build and npm package-content validation pass.
- A real DSH Web profile loads the plugin without the former `cannot get property "llm" without inject` startup failure.
- Settings → Models displays the LMM card. Its sign-in link opens LMM's real authorization page. After explicit user approval, DSH observes the persisted grant and displays signed-in status.
- The mounted DSH adapter lists account-scoped models. A real streamed request through `ctx.llm.stream`, the DSH PiAi adapter and the LMM OAuth relay returned `OK` with a normal stop: 20 input tokens and 3 output tokens. The request enforced `maxTokens: 64` and advertised no tools. Model: GLM-5.3-Flash.
- The live authenticated API responds 401 without its cookie, 403 to a foreign Origin, 400 to an invalid RPC envelope, and 200 with only `signedIn`/`busy` for a valid status request.

An earlier DeepSeek V4 Flash attempt reached LMM but its upstream channel returned 503. LMM's retry exhaustion surfaced as 500 and refunded the precharge. That upstream availability result is separate from the successful integration test; no universal model availability is implied.

No bearer tokens, authorization codes, cookies, balance values or credential files are included in this record. Live account login was explicitly authorized by the user. The local smoke-test overlay is not shipped in this package.
