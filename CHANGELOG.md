# Changelog

## [1.20.0](https://github.com/agustinsacco/tars/compare/v1.19.5...v1.20.0) (2026-04-13)


### Features

* **discord:** Add raw event fallback rescue mechanism for uncached DMs ([#93](https://github.com/agustinsacco/tars/issues/93)) ([4dac2b0](https://github.com/agustinsacco/tars/commit/4dac2b0572cfd3d19210eee7341186d22aa59b68))

## [1.19.5](https://github.com/agustinsacco/tars/compare/v1.19.4...v1.19.5) (2026-04-13)


### Bug Fixes

* definitive Discord DM routing fix v2 ([#91](https://github.com/agustinsacco/tars/issues/91)) ([39b5199](https://github.com/agustinsacco/tars/commit/39b5199523a8f9a52bf54f3da96f8f8c18c15716))

## [1.19.4](https://github.com/agustinsacco/tars/compare/v1.19.3...v1.19.4) (2026-04-13)


### Bug Fixes

* **discord:** completely revert all discord routing changes back to 1.18.2 stable base ([#88](https://github.com/agustinsacco/tars/issues/88)) ([5338038](https://github.com/agustinsacco/tars/commit/53380385bea6683c60b1295e2e548f19365cd2bd))

## [1.19.3](https://github.com/agustinsacco/tars/compare/v1.19.2...v1.19.3) (2026-04-13)


### Bug Fixes

* revert Partials.User and add defensive error handling to Discord message handler ([#86](https://github.com/agustinsacco/tars/issues/86)) ([4461da0](https://github.com/agustinsacco/tars/commit/4461da043a0bc890f57bc6509e67dedf424918f2))

## [1.19.2](https://github.com/agustinsacco/tars/compare/v1.19.1...v1.19.2) (2026-04-13)


### Bug Fixes

* include Partials.User to prevent discord.js from silently dropping DMs from uncached users ([#84](https://github.com/agustinsacco/tars/issues/84)) ([3eb0a96](https://github.com/agustinsacco/tars/commit/3eb0a96f521807af1bf856dbb61fa72992d3ee26))

## [1.19.1](https://github.com/agustinsacco/tars/compare/v1.19.0...v1.19.1) (2026-04-13)


### Bug Fixes

* resolve Discord DM routing bugs and hydration failures ([#82](https://github.com/agustinsacco/tars/issues/82)) ([83ffe97](https://github.com/agustinsacco/tars/commit/83ffe9750353fd083e22f2c8b89f1ad35d734194))

## [1.19.0](https://github.com/agustinsacco/tars/compare/v1.18.2...v1.19.0) (2026-04-13)


### Features

* add local inference image support ([#79](https://github.com/agustinsacco/tars/issues/79)) ([59da29c](https://github.com/agustinsacco/tars/commit/59da29c383b182915414752f498353790f02fb00))

## [1.18.2](https://github.com/agustinsacco/tars/compare/v1.18.1...v1.18.2) (2026-04-13)


### Bug Fixes

* **dash:** prevent crash loop on file deletion in watcher ([#78](https://github.com/agustinsacco/tars/issues/78)) ([7eb83f9](https://github.com/agustinsacco/tars/commit/7eb83f98c39162f866b00005e5fb8f95c25f3501))

## [1.18.1](https://github.com/agustinsacco/tars/compare/v1.18.0...v1.18.1) (2026-03-29)


### Bug Fixes

* **llamacpp:** agent tool calling resilience and loop detection bypass ([#76](https://github.com/agustinsacco/tars/issues/76)) ([f30030c](https://github.com/agustinsacco/tars/commit/f30030cd68394f68c251fbed275d3b7f6fd0c692))

## [1.18.0](https://github.com/agustinsacco/tars/compare/v1.17.2...v1.18.0) (2026-03-25)


### Features

* add --prefer-online to update check in tars restart ([754a2e8](https://github.com/agustinsacco/tars/commit/754a2e830d76c5441c0864d4bfbeb1756c3563d6))
* add 'tars restart' command with auto-update logic ([6ff34ee](https://github.com/agustinsacco/tars/commit/6ff34ee9e698f5c188e9ee8f45a66e6bb1801115))
* add assistant name to setup wizard ([50c1bb0](https://github.com/agustinsacco/tars/commit/50c1bb08d9a46306832f439468b49c86b40bd31c))
* add built-in subagents and dynamic settings patching ([f92090e](https://github.com/agustinsacco/tars/commit/f92090e13a78a65734f49a1866ca258a1074a966))
* add CI/CD validation and release automation workflows ([#2](https://github.com/agustinsacco/tars/issues/2)) ([c1f96a4](https://github.com/agustinsacco/tars/commit/c1f96a4917652de29ce53afb26323057b38db09d))
* add correct Gemini 3 models (gemini-3-flash, gemini-3-pro) ([b4157f1](https://github.com/agustinsacco/tars/commit/b4157f13e42a8d3c345cf20252d635c748c28b6a))
* add documentation website with Astro Starlight and cartoon Tars logo ([81017de](https://github.com/agustinsacco/tars/commit/81017de91af433c1f3c100e807a58bd66ef8c721))
* add Gemini 3.0 models to setup and refine interval options ([521ff2c](https://github.com/agustinsacco/tars/commit/521ff2c12170ff2ccd02bc700e4c49213a76c304))
* add Gemini API quota tracking tool and CLI command ([#3](https://github.com/agustinsacco/tars/issues/3)) ([d51f7b3](https://github.com/agustinsacco/tars/commit/d51f7b3294ab3dabe8d5c1041e811b7ed1cd020d))
* add gws-setup skill for automated workspace CLI management ([12cda08](https://github.com/agustinsacco/tars/commit/12cda0875a3ebaca06edccb8120427677de62b07))
* add local inference support via LlamaCpp ([#47](https://github.com/agustinsacco/tars/issues/47)) ([c6244cb](https://github.com/agustinsacco/tars/commit/c6244cb615224456a3bb1965faa887c017111f37))
* add multimodal support and resolve initialization hangs ([d8d3d30](https://github.com/agustinsacco/tars/commit/d8d3d30abf53d5b4ecbf08f4ae1286ba718b43f1))
* add narrative navigation and ensure cursor pointers on site ([7ee93e2](https://github.com/agustinsacco/tars/commit/7ee93e2b77dbabf3dc189a02052f596b8c09437c))
* add retry mechanism for Gemini API transient errors ([b000278](https://github.com/agustinsacco/tars/commit/b00027813ed468182a8d5cd386400864a559086f))
* add unit tests for critical components and enforce testing in CI ([20136eb](https://github.com/agustinsacco/tars/commit/20136eb7f936de95a9cd790ba70a9e074e2aaf83))
* add update command to CLI ([cb8a28e](https://github.com/agustinsacco/tars/commit/cb8a28e1bb7090f2a8ee5d2926d9ef97e16262d7))
* aggressive context pruning and heartbeat history isolation ([97ba663](https://github.com/agustinsacco/tars/commit/97ba66350a1cf5ee461a7228047ab2d502f28845))
* atomic session writes and loop detection resilience ([#21](https://github.com/agustinsacco/tars/issues/21)) ([d1baf9f](https://github.com/agustinsacco/tars/commit/d1baf9f3b0fcc3dc4b888082753f3958560075fa))
* Automated extension bootstrapping and Gemini CLI optimizations ([#1](https://github.com/agustinsacco/tars/issues/1)) ([7d07242](https://github.com/agustinsacco/tars/commit/7d072423e2f6b256c6052edc14ab55e259502c9b))
* **branding:** update logo and add docs link to readme ([2856075](https://github.com/agustinsacco/tars/commit/28560757ca8619ac1e587561fb91e7b669d238e0))
* bundle Tars Dashboard and automate its installation in setup wizard ([926ca1a](https://github.com/agustinsacco/tars/commit/926ca1a1bd2c9f160a09de8fa6ce534c7f4c3cf9))
* **cli:** improved Discord token detection in setup wizard ([0c2da80](https://github.com/agustinsacco/tars/commit/0c2da80ec13cd64ab974e798245697394cd1f14a))
* complete architectural transition to native core and overhaul documentation ([f2c58ff](https://github.com/agustinsacco/tars/commit/f2c58ff0c8d7fb7559441fccca116929a95fd3bd))
* comprehensive documentation overhaul and supervisor refactor ([7c98cf8](https://github.com/agustinsacco/tars/commit/7c98cf8c6ee9fbb33b535efa4b599b6890aa0bc5))
* configurable assistant name and home directory ([#6](https://github.com/agustinsacco/tars/issues/6)) ([1a8b257](https://github.com/agustinsacco/tars/commit/1a8b257a619bbeff634259c956b363840133f429))
* **dash:** add path-agnostic .env template ([#38](https://github.com/agustinsacco/tars/issues/38)) ([99eb459](https://github.com/agustinsacco/tars/commit/99eb459d0a279886de7ad98dae6a24414f8059d1))
* delay heartbeat execution to first interval ([b4438d0](https://github.com/agustinsacco/tars/commit/b4438d012f74efb482d686870f183e938ee9abf8))
* **docs:** refactor documentation to terminal console theme ([0a83cc7](https://github.com/agustinsacco/tars/commit/0a83cc72defeecd5cc6376ddf1cf51f39d090646))
* document Gemini CLI release and update setup model list ([33b58d0](https://github.com/agustinsacco/tars/commit/33b58d0264c771a7109e01f5b64ccb6c03a250c0))
* enable session compaction for background heartbeats ([3f05b88](https://github.com/agustinsacco/tars/commit/3f05b88018623505dfb436799fbdf1faa1ba997a))
* enable whatsapp message yourself functionality ([32bd165](https://github.com/agustinsacco/tars/commit/32bd16525d3ed77f35eefa4053e5e7abd1ad69b9))
* enhance brain auditor to clean nested tilde anomalies ([7b87b98](https://github.com/agustinsacco/tars/commit/7b87b982a751b30951c2db72338106e668b47a54))
* enhance Discord setup instructions and add versioning flags ([5826136](https://github.com/agustinsacco/tars/commit/5826136e7130dcaf9e101ac5198406f4f4197b06))
* enhance portability with path re-homing, workspace management, and subagent support ([0ba3114](https://github.com/agustinsacco/tars/commit/0ba3114185445f2bb504968d0edba07ade4df096))
* fix critical memory pathing and forbid self-restarts ([879ef15](https://github.com/agustinsacco/tars/commit/879ef150064d884fa34f2462296111f5971d1ae8))
* implement 'apps/' primitive and refactor dashboard as a stock app ([cacc65b](https://github.com/agustinsacco/tars/commit/cacc65b598935596641f9c2d79d95e60992a9340))
* implement autonomous tool injection and startup extension hydration ([a17c612](https://github.com/agustinsacco/tars/commit/a17c61238aa057dfa4b0317bee0b2791358924d8))
* implement BrainAuditor for automatic workspace healing and portability ([e75ed30](https://github.com/agustinsacco/tars/commit/e75ed301cc5be3fa4c22162d74fddc0eddea87b9))
* implement Data Loss Prevention (DLP) and security guardrails ([#66](https://github.com/agustinsacco/tars/issues/66)) ([b86aa84](https://github.com/agustinsacco/tars/commit/b86aa8402924aaf3eaea967a16c2e8691ea82c6c))
* implement extension discovery and fix memory tool loading in native core ([5c2a9f5](https://github.com/agustinsacco/tars/commit/5c2a9f578dd8c8a341a73e1d589e4faaaeca47bd))
* implement generic extension hydration in setup and refine ops skill ([97c42f8](https://github.com/agustinsacco/tars/commit/97c42f84dd1ae9d93aaceeae88e497be5c2fb664))
* implement runtime safety filter to prevent self-restarts ([b8eea5b](https://github.com/agustinsacco/tars/commit/b8eea5b7aa9efd8d310e55abbd80672e40ff513b))
* implement unified autonomous execution architecture ([74fc3dd](https://github.com/agustinsacco/tars/commit/74fc3dd78bb3cda5fe68ee43b1b38d58972f444d))
* improve Cron Service visibility at startup ([a3bf352](https://github.com/agustinsacco/tars/commit/a3bf3529302728934efee370f05771e6f8b7b947))
* improve npm upgrade robustness in restart command ([d58dec0](https://github.com/agustinsacco/tars/commit/d58dec0f7ad3b23e25f3462504a555698365c1e3))
* improve test coverage for core supervisor and utilities ([11a26f0](https://github.com/agustinsacco/tars/commit/11a26f07c4ec13c4f25061330dc54d1a78f838d7))
* improved tool call logging with counts and previews ([6011031](https://github.com/agustinsacco/tars/commit/601103186b7435a7924252dfae6b6e37bb0df245))
* increase max turns to 100 and refine command safety filter ([232e767](https://github.com/agustinsacco/tars/commit/232e767bb2af6613703adc4e47ebf15d164607c2))
* **infra:** add k8s deployment manifests and tailscale workflow for tars-docs ([08a7995](https://github.com/agustinsacco/tars/commit/08a7995a1bd43e3b74c71974470185b5a3bf3586))
* **infra:** change tars-docs port from 80 to 4242 ([b268166](https://github.com/agustinsacco/tars/commit/b26816620356187f156591f9f69c482b859499ab))
* **infra:** update tars-docs port to 5252 ([a2b520c](https://github.com/agustinsacco/tars/commit/a2b520c718f5f3eca8a98c1785965f01574d007a))
* initial commit of Tars AI assistant ([412a8d6](https://github.com/agustinsacco/tars/commit/412a8d606551c467eedb8a6338883a779183c12e))
* integrate Google Workspace and Tars Dashboard as core capabilities with robust process management ([be776c0](https://github.com/agustinsacco/tars/commit/be776c088641131b7bee89cab424870e42e27447))
* migrate to native gemini core and simplify bot logic ([f88e9df](https://github.com/agustinsacco/tars/commit/f88e9dfc867839fa9334b0bebf28cb3835d1dde5))
* move whatsapp qr generation to status command to avoid log mangling ([9f4f9fe](https://github.com/agustinsacco/tars/commit/9f4f9feb2a606f7ffd63443b3f683d1e79a60c92))
* Multi-Agent Swarm (Mesh) Specification and CLI Foundation ([#8](https://github.com/agustinsacco/tars/issues/8)) ([5787394](https://github.com/agustinsacco/tars/commit/57873944f204c1b6045b6b46049065a47e7554f0))
* multi-channel architecture and WhatsApp integration ([#12](https://github.com/agustinsacco/tars/issues/12)) ([927bfc2](https://github.com/agustinsacco/tars/commit/927bfc2d599427ca1cc4be9b4d0f849f85baa481))
* multi-channel architecture plan (Discord & WhatsApp) ([#10](https://github.com/agustinsacco/tars/issues/10)) ([6f0fbd1](https://github.com/agustinsacco/tars/commit/6f0fbd13073f014121326cd8c0ee198fc252411f))
* overhaul session management — single persistent session with compression ([1fda468](https://github.com/agustinsacco/tars/commit/1fda468e595016731ef22f80988a09e3eeb2ddab))
* override system prompt with custom Tars persona ([ec04f68](https://github.com/agustinsacco/tars/commit/ec04f68c740bf1500b3790a3b4521d08c1d3e3eb))
* persistent typing indicator, purge WhatsApp, clean startup logs ([d3811be](https://github.com/agustinsacco/tars/commit/d3811bec773ae43f5371c9a6558c5c6d6782de69))
* **prompts:** implement tiered memory system with Durable vs Active tiers ([#33](https://github.com/agustinsacco/tars/issues/33)) ([97f9ca8](https://github.com/agustinsacco/tars/commit/97f9ca8444c2c9dbf25bf7e5dce1933b3092393f))
* redesign setup wizard with backend-first flow for local inference ([#54](https://github.com/agustinsacco/tars/issues/54)) ([def284f](https://github.com/agustinsacco/tars/commit/def284fc04daccb102fca46d0ca821711b5ef831))
* refactor and streamline documentation ([e4edf31](https://github.com/agustinsacco/tars/commit/e4edf31896536923ea66e24f9a5413411a17f4d3))
* release v1.0.6 ([c3e143d](https://github.com/agustinsacco/tars/commit/c3e143dfa6af1a8088e69c92150d1c3b3ed45283))
* release v1.0.7 ([d9dbb10](https://github.com/agustinsacco/tars/commit/d9dbb109e60945ae882c4f09376d1027b201d281))
* release v1.0.8 ([98a079e](https://github.com/agustinsacco/tars/commit/98a079e7cb77f84cfdcec8a0317f7e9bb78fcae5))
* release version 1.8.0 with supervisor stability fixes ([#26](https://github.com/agustinsacco/tars/issues/26)) ([c60a9d3](https://github.com/agustinsacco/tars/commit/c60a9d3af69c01cb91acbdfe5f38384feef91e22))
* replace native memory with custom MCP server and episodic sessions ([28a7a6e](https://github.com/agustinsacco/tars/commit/28a7a6e89648c962520eeabc68ba694e9c1637ec))
* rule to ensure non-interactive execution of tools ([19cc06d](https://github.com/agustinsacco/tars/commit/19cc06d4a243f0214461f69a8ec21724ca2e325f))
* **skills:** add extension-manager skill for runtime extension control ([518ea21](https://github.com/agustinsacco/tars/commit/518ea21f24c52063e34f1edf6d53a64c4a9833a7))
* **skills:** add guides for creating commands and context ([950313e](https://github.com/agustinsacco/tars/commit/950313eb1de73d3e3e81c95659431f9527491473))
* Tars Swarm — A2A Remote Agent Support ([#65](https://github.com/agustinsacco/tars/issues/65)) ([63fda4c](https://github.com/agustinsacco/tars/commit/63fda4c06622309914dadc6d0dd902dde08315e3))
* track and display session token usage ([22338e7](https://github.com/agustinsacco/tars/commit/22338e7f4f20aac6c53f7d436e49eae46ae2b00b))


### Bug Fixes

* add code 42 recovery to executeTask and fix session file lookup ([bfa7fe2](https://github.com/agustinsacco/tars/commit/bfa7fe2812e77261bb219227384059dbc69b61d3))
* add missing .js extensions to test imports for ESM compatibility ([51b66c5](https://github.com/agustinsacco/tars/commit/51b66c5317ec0e5179c12e847fc48b03b44c383b))
* build extensions during publish and add workspace overrides for symlinked extensions ([0c02c69](https://github.com/agustinsacco/tars/commit/0c02c69cf750800fca09b0f5d9af88bb746ae61e))
* **ci:** add local kubectl action from shopify repo ([009598b](https://github.com/agustinsacco/tars/commit/009598b851b61f627385fe49723c07a18225c2f5))
* **ci:** decode kubeconfig content as base64 to match shopify pattern ([e71aa55](https://github.com/agustinsacco/tars/commit/e71aa55078e99902df68041cf26dfdc320e116ee))
* **cli:** correct setup for single-channel Discord, remove WhatsApp from site ([dc854b2](https://github.com/agustinsacco/tars/commit/dc854b2f8c340af44ea3ba21a08398e334971478))
* **cli:** unify instance name resolution and add health status ([#44](https://github.com/agustinsacco/tars/issues/44)) ([57da6a4](https://github.com/agustinsacco/tars/commit/57da6a444adbb4eaef083d54e54c8ca3bb4ffca0))
* copy extensions instead of symlinking to resolve workspace safety issues ([af448f6](https://github.com/agustinsacco/tars/commit/af448f66ed82fbdd4987e8d33252da6d16c6de50))
* **core:** bridge Google genai structural prototype gap for functionCalls root mapping ([9fa4d25](https://github.com/agustinsacco/tars/commit/9fa4d25bc2c90d2ebfd18fc28f9e8f5013f9f373))
* **core:** enable stream_options to capture and route native usage_metadata tokens for dashboard telemetry ([819d403](https://github.com/agustinsacco/tars/commit/819d403ca690db2c13389f073bd214b62450ba02))
* **core:** final bridge for local LlamaCpp router and tool-calling ([#62](https://github.com/agustinsacco/tars/issues/62)) ([ddb5c4f](https://github.com/agustinsacco/tars/commit/ddb5c4f453ce2bf379d698d0b09fee8c60cb764a))
* **core:** improve Gemini API resilience with expanded retries and autonomous fallback ([#31](https://github.com/agustinsacco/tars/issues/31)) ([9c84bc4](https://github.com/agustinsacco/tars/commit/9c84bc4c55844067979d8e5cd48308c41e52c625))
* **core:** link restored session ID and prevent premature streaming aborts ([#58](https://github.com/agustinsacco/tars/issues/58)) ([f394911](https://github.com/agustinsacco/tars/commit/f3949118b3d0cddccd886e17033e2ae098ea7a7b))
* **core:** link restored session ID with coreconfig and cleanly map null completion finish_reasons ([24177d2](https://github.com/agustinsacco/tars/commit/24177d22ff497c92d3c459321d5c6c9a897fcbdb))
* **core:** make disableModelRouterForAuth strictly conditional to llamacpp mode to preserve early API key validation for native gemini mode ([2d15ca7](https://github.com/agustinsacco/tars/commit/2d15ca7a4da6a04d4d7a3e19bcf8f1b08ea9e953))
* correctly assemble chunked tool call streams from OpenAI-compatible backends ([a42ac05](https://github.com/agustinsacco/tars/commit/a42ac05d3df6e2beaee0c1548923050580917bd9))
* cron tasks infinite loop and background process hangs, add proactive notifications ([54bb884](https://github.com/agustinsacco/tars/commit/54bb88429e4c23e7717bbd15cf14fa34939e16ad))
* **dash:** refine dashboard start logs and stabilize path detection ([#42](https://github.com/agustinsacco/tars/issues/42)) ([bae55a8](https://github.com/agustinsacco/tars/commit/bae55a80ec00dc95c3f6afcb30901e734b75c016))
* **dash:** strip PM2 internal env variables to prevent supervisor restart loop ([2cccc43](https://github.com/agustinsacco/tars/commit/2cccc43eaff658564448caa55c58f92082347678))
* **dlp:** resolve blank tool response crash and soften config access ([#72](https://github.com/agustinsacco/tars/issues/72)) ([833fdfe](https://github.com/agustinsacco/tars/commit/833fdfed04e4134687c0ada1147d27eb44372a03))
* **dlp:** resolve blank tool response from completed calls by querying request.callId ([019b615](https://github.com/agustinsacco/tars/commit/019b6156e0131985a059d3b22bcab8d7a358e01a))
* downgrade codebase_investigator subagent model to gemini-2.0-flash-exp to avoid 429 errors ([8fab98e](https://github.com/agustinsacco/tars/commit/8fab98ebc93632c29fedf5e50c83dabb5b4cb753))
* exhaustive workspace safety and path propagation fixes ([c64cea8](https://github.com/agustinsacco/tars/commit/c64cea8063490acd5dd3c83d94220b3a92027651))
* explicit npm ci in setup for extensions with verbose logging ([a697c8c](https://github.com/agustinsacco/tars/commit/a697c8c953e57f2d45c509a2922baacb7e7b451e))
* force exit on restart command to prevent hanging ([d7cee06](https://github.com/agustinsacco/tars/commit/d7cee06b645f706432e1ac6e98435fd2d9e7c1de))
* **gemini:** resolve session resume error and improve logging ([ede08dd](https://github.com/agustinsacco/tars/commit/ede08dd57f18129e8faf0492dd74fc5884edfa33))
* implement auto-recovery for corrupted sessions (code 42) ([57bb847](https://github.com/agustinsacco/tars/commit/57bb847288632ebee6f85a003ff282d8b4cee50b))
* improve log clarity for auto-binding registration ([ddb5d24](https://github.com/agustinsacco/tars/commit/ddb5d244404dfe0a57a75ee76b6fbd931c84bb9c))
* **llamacpp:** correctly map null finish_reasons in stream chunks to prevent early aborts ([85d1f6c](https://github.com/agustinsacco/tars/commit/85d1f6cb027a7612504e491482ed047687f42f59))
* Local LlamaCpp Tool Execution, Routing & Session Tracking ([#60](https://github.com/agustinsacco/tars/issues/60)) ([eb3dee5](https://github.com/agustinsacco/tars/commit/eb3dee5a4b80a5e7b7e862d125e6a10170fbc344))
* **main:** reset version to 1.17.1 to restore release pipeline ([b6ef7d9](https://github.com/agustinsacco/tars/commit/b6ef7d9b3c79096a7a52322a2ab46486de69b05f))
* make all scripts and dashboard path-agnostic ([#36](https://github.com/agustinsacco/tars/issues/36)) ([0643baa](https://github.com/agustinsacco/tars/commit/0643baac231a6108c240f525a9548583c7b5426d))
* make local LlamaCpp mode bypass Gemini auth natively and resolve URLs robustly ([5af6919](https://github.com/agustinsacco/tars/commit/5af6919c46a1988b92b856deecdf3d63a5ff1f33))
* package metadata and excludes ([464b6e0](https://github.com/agustinsacco/tars/commit/464b6e006ef8803506aeae76b2d3b64eeed2fa8e))
* pin gemini CLI CWD to ~/.tars to prevent workspace context leaking ([804e203](https://github.com/agustinsacco/tars/commit/804e203c98a05900e74e7b55bab8322befaebafe))
* promisify start and stop functions to prevent race conditions during restart ([4668d81](https://github.com/agustinsacco/tars/commit/4668d817d306c2938fa9b4993bc9d0b29d8b3d22))
* purge qrcode-terminal from status command to fix update crash ([699daca](https://github.com/agustinsacco/tars/commit/699daca253a07b831dabe0bb48480e31e0b460cd))
* resolve llamacpp initialization crash and extension hydration ([0e4e764](https://github.com/agustinsacco/tars/commit/0e4e764543c74186cce84ee6e05bf362ea7b2eb0))
* resolve repeated discord auto-bind and whatsapp connection errors ([ba1e93c](https://github.com/agustinsacco/tars/commit/ba1e93c5cbadc5e0cdc9f8f1e6c5612c635bbb92))
* restore correct version 1.7.8 and prepare for 1.8.0 release ([#24](https://github.com/agustinsacco/tars/issues/24)) ([53a9090](https://github.com/agustinsacco/tars/commit/53a90901a53c90c5cb46618f06dd9382626ca4ea))
* restore supervisor run loop and fix error serialization ([4a2cbce](https://github.com/agustinsacco/tars/commit/4a2cbcec41e3644fb1c95920858bf7695bebf4b0))
* revert unverified Gemini 3.0 models causing 404 ([3f277c8](https://github.com/agustinsacco/tars/commit/3f277c8c9b90fe89fb73ec56edee0d3de12aa8ed))
* run npm install after copying extensions in setup ([02e2624](https://github.com/agustinsacco/tars/commit/02e2624e92729de76c64ba58cf0bc06184befd1c))
* set codebase_investigator subagent models to auto instead of hardcoded strings ([3583580](https://github.com/agustinsacco/tars/commit/358358026c8836b99d70f38d4da74bbb0f989709))
* **supervisor:** support symlinked extensions and pre-build in distribution ([#69](https://github.com/agustinsacco/tars/issues/69)) ([d2e96b0](https://github.com/agustinsacco/tars/commit/d2e96b039b5102d2ea7ef92adf4449002fa69d52))
* update model selection in setup to default to auto ([ad57492](https://github.com/agustinsacco/tars/commit/ad57492af064d3f85227e4e5ca413e7058f6f9e7))

## [1.17.2](https://github.com/agustinsacco/tars/compare/v1.17.1...v1.17.2) (2026-03-25)


### Bug Fixes

* **dlp:** resolve blank tool response from completed calls by querying request.callId ([019b615](https://github.com/agustinsacco/tars/commit/019b6156e0131985a059d3b22bcab8d7a358e01a))

## [1.17.1](https://github.com/agustinsacco/tars/compare/v1.17.0...v1.17.1) (2026-03-25)


### Bug Fixes

* **dlp:** resolve blank tool response crash and soften config access ([#72](https://github.com/agustinsacco/tars/issues/72)) ([833fdfe](https://github.com/agustinsacco/tars/commit/833fdfed04e4134687c0ada1147d27eb44372a03))

## [1.17.0](https://github.com/agustinsacco/tars/compare/v1.16.1...v1.17.0) (2026-03-25)


### Features

* implement Data Loss Prevention (DLP) and security guardrails ([#66](https://github.com/agustinsacco/tars/issues/66)) ([b86aa84](https://github.com/agustinsacco/tars/commit/b86aa8402924aaf3eaea967a16c2e8691ea82c6c))
* Tars Swarm — A2A Remote Agent Support ([#65](https://github.com/agustinsacco/tars/issues/65)) ([63fda4c](https://github.com/agustinsacco/tars/commit/63fda4c06622309914dadc6d0dd902dde08315e3))


### Bug Fixes

* **core:** bridge Google genai structural prototype gap for functionCalls root mapping ([9fa4d25](https://github.com/agustinsacco/tars/commit/9fa4d25bc2c90d2ebfd18fc28f9e8f5013f9f373))
* **core:** enable stream_options to capture and route native usage_metadata tokens for dashboard telemetry ([819d403](https://github.com/agustinsacco/tars/commit/819d403ca690db2c13389f073bd214b62450ba02))
* **core:** final bridge for local LlamaCpp router and tool-calling ([#62](https://github.com/agustinsacco/tars/issues/62)) ([ddb5c4f](https://github.com/agustinsacco/tars/commit/ddb5c4f453ce2bf379d698d0b09fee8c60cb764a))
* **core:** link restored session ID and prevent premature streaming aborts ([#58](https://github.com/agustinsacco/tars/issues/58)) ([f394911](https://github.com/agustinsacco/tars/commit/f3949118b3d0cddccd886e17033e2ae098ea7a7b))
* **core:** link restored session ID with coreconfig and cleanly map null completion finish_reasons ([24177d2](https://github.com/agustinsacco/tars/commit/24177d22ff497c92d3c459321d5c6c9a897fcbdb))
* **core:** make disableModelRouterForAuth strictly conditional to llamacpp mode to preserve early API key validation for native gemini mode ([2d15ca7](https://github.com/agustinsacco/tars/commit/2d15ca7a4da6a04d4d7a3e19bcf8f1b08ea9e953))
* **llamacpp:** correctly map null finish_reasons in stream chunks to prevent early aborts ([85d1f6c](https://github.com/agustinsacco/tars/commit/85d1f6cb027a7612504e491482ed047687f42f59))
* Local LlamaCpp Tool Execution, Routing & Session Tracking ([#60](https://github.com/agustinsacco/tars/issues/60)) ([eb3dee5](https://github.com/agustinsacco/tars/commit/eb3dee5a4b80a5e7b7e862d125e6a10170fbc344))
* **supervisor:** support symlinked extensions and pre-build in distribution ([#69](https://github.com/agustinsacco/tars/issues/69)) ([d2e96b0](https://github.com/agustinsacco/tars/commit/d2e96b039b5102d2ea7ef92adf4449002fa69d52))

## [1.16.1](https://github.com/agustinsacco/tars/compare/v1.16.0...v1.16.1) (2026-03-25)


### Bug Fixes

* **supervisor:** support symlinked extensions and pre-build in distribution ([#69](https://github.com/agustinsacco/tars/issues/69)) ([d2e96b0](https://github.com/agustinsacco/tars/commit/d2e96b039b5102d2ea7ef92adf4449002fa69d52))

## [1.16.0](https://github.com/agustinsacco/tars/compare/v1.15.0...v1.16.0) (2026-03-24)


### Features

* implement Data Loss Prevention (DLP) and security guardrails ([#66](https://github.com/agustinsacco/tars/issues/66)) ([b86aa84](https://github.com/agustinsacco/tars/commit/b86aa8402924aaf3eaea967a16c2e8691ea82c6c))
* Tars Swarm — A2A Remote Agent Support ([#65](https://github.com/agustinsacco/tars/issues/65)) ([63fda4c](https://github.com/agustinsacco/tars/commit/63fda4c06622309914dadc6d0dd902dde08315e3))


### Bug Fixes

* **core:** bridge Google genai structural prototype gap for functionCalls root mapping ([9fa4d25](https://github.com/agustinsacco/tars/commit/9fa4d25bc2c90d2ebfd18fc28f9e8f5013f9f373))
* **core:** enable stream_options to capture and route native usage_metadata tokens for dashboard telemetry ([819d403](https://github.com/agustinsacco/tars/commit/819d403ca690db2c13389f073bd214b62450ba02))
* **core:** final bridge for local LlamaCpp router and tool-calling ([#62](https://github.com/agustinsacco/tars/issues/62)) ([ddb5c4f](https://github.com/agustinsacco/tars/commit/ddb5c4f453ce2bf379d698d0b09fee8c60cb764a))
* **core:** link restored session ID and prevent premature streaming aborts ([#58](https://github.com/agustinsacco/tars/issues/58)) ([f394911](https://github.com/agustinsacco/tars/commit/f3949118b3d0cddccd886e17033e2ae098ea7a7b))
* **core:** link restored session ID with coreconfig and cleanly map null completion finish_reasons ([24177d2](https://github.com/agustinsacco/tars/commit/24177d22ff497c92d3c459321d5c6c9a897fcbdb))
* **core:** make disableModelRouterForAuth strictly conditional to llamacpp mode to preserve early API key validation for native gemini mode ([2d15ca7](https://github.com/agustinsacco/tars/commit/2d15ca7a4da6a04d4d7a3e19bcf8f1b08ea9e953))
* correctly assemble chunked tool call streams from OpenAI-compatible backends ([a42ac05](https://github.com/agustinsacco/tars/commit/a42ac05d3df6e2beaee0c1548923050580917bd9))
* **llamacpp:** correctly map null finish_reasons in stream chunks to prevent early aborts ([85d1f6c](https://github.com/agustinsacco/tars/commit/85d1f6cb027a7612504e491482ed047687f42f59))
* Local LlamaCpp Tool Execution, Routing & Session Tracking ([#60](https://github.com/agustinsacco/tars/issues/60)) ([eb3dee5](https://github.com/agustinsacco/tars/commit/eb3dee5a4b80a5e7b7e862d125e6a10170fbc344))

## [1.15.0](https://github.com/agustinsacco/tars/compare/v1.14.5...v1.15.0) (2026-03-24)


### Features

* implement Data Loss Prevention (DLP) and security guardrails ([#66](https://github.com/agustinsacco/tars/issues/66)) ([b86aa84](https://github.com/agustinsacco/tars/commit/b86aa8402924aaf3eaea967a16c2e8691ea82c6c))

## [1.14.5](https://github.com/agustinsacco/tars/compare/v1.14.4...v1.14.5) (2026-03-22)


### Bug Fixes

* **core:** final bridge for local LlamaCpp router and tool-calling ([#62](https://github.com/agustinsacco/tars/issues/62)) ([ddb5c4f](https://github.com/agustinsacco/tars/commit/ddb5c4f453ce2bf379d698d0b09fee8c60cb764a))

## [1.14.4](https://github.com/agustinsacco/tars/compare/v1.14.3...v1.14.4) (2026-03-22)


### Bug Fixes

* Local LlamaCpp Tool Execution, Routing & Session Tracking ([#60](https://github.com/agustinsacco/tars/issues/60)) ([eb3dee5](https://github.com/agustinsacco/tars/commit/eb3dee5a4b80a5e7b7e862d125e6a10170fbc344))

## [1.14.3](https://github.com/agustinsacco/tars/compare/v1.14.2...v1.14.3) (2026-03-21)


### Bug Fixes

* **core:** link restored session ID and prevent premature streaming aborts ([#58](https://github.com/agustinsacco/tars/issues/58)) ([f394911](https://github.com/agustinsacco/tars/commit/f3949118b3d0cddccd886e17033e2ae098ea7a7b))

## [1.14.2](https://github.com/agustinsacco/tars/compare/v1.14.1...v1.14.2) (2026-03-21)


### Bug Fixes

* correctly assemble chunked tool call streams from OpenAI-compatible backends ([a42ac05](https://github.com/agustinsacco/tars/commit/a42ac05d3df6e2beaee0c1548923050580917bd9))

## [1.14.0](https://github.com/agustinsacco/tars/compare/v1.13.1...v1.14.0) (2026-03-21)


### Features

* add --prefer-online to update check in tars restart ([754a2e8](https://github.com/agustinsacco/tars/commit/754a2e830d76c5441c0864d4bfbeb1756c3563d6))
* add 'tars restart' command with auto-update logic ([6ff34ee](https://github.com/agustinsacco/tars/commit/6ff34ee9e698f5c188e9ee8f45a66e6bb1801115))
* add assistant name to setup wizard ([50c1bb0](https://github.com/agustinsacco/tars/commit/50c1bb08d9a46306832f439468b49c86b40bd31c))
* add built-in subagents and dynamic settings patching ([f92090e](https://github.com/agustinsacco/tars/commit/f92090e13a78a65734f49a1866ca258a1074a966))
* add CI/CD validation and release automation workflows ([#2](https://github.com/agustinsacco/tars/issues/2)) ([c1f96a4](https://github.com/agustinsacco/tars/commit/c1f96a4917652de29ce53afb26323057b38db09d))
* add correct Gemini 3 models (gemini-3-flash, gemini-3-pro) ([b4157f1](https://github.com/agustinsacco/tars/commit/b4157f13e42a8d3c345cf20252d635c748c28b6a))
* add documentation website with Astro Starlight and cartoon Tars logo ([81017de](https://github.com/agustinsacco/tars/commit/81017de91af433c1f3c100e807a58bd66ef8c721))
* add Gemini 3.0 models to setup and refine interval options ([521ff2c](https://github.com/agustinsacco/tars/commit/521ff2c12170ff2ccd02bc700e4c49213a76c304))
* add Gemini API quota tracking tool and CLI command ([#3](https://github.com/agustinsacco/tars/issues/3)) ([d51f7b3](https://github.com/agustinsacco/tars/commit/d51f7b3294ab3dabe8d5c1041e811b7ed1cd020d))
* add gws-setup skill for automated workspace CLI management ([12cda08](https://github.com/agustinsacco/tars/commit/12cda0875a3ebaca06edccb8120427677de62b07))
* add local inference support via LlamaCpp ([#47](https://github.com/agustinsacco/tars/issues/47)) ([c6244cb](https://github.com/agustinsacco/tars/commit/c6244cb615224456a3bb1965faa887c017111f37))
* add multimodal support and resolve initialization hangs ([d8d3d30](https://github.com/agustinsacco/tars/commit/d8d3d30abf53d5b4ecbf08f4ae1286ba718b43f1))
* add narrative navigation and ensure cursor pointers on site ([7ee93e2](https://github.com/agustinsacco/tars/commit/7ee93e2b77dbabf3dc189a02052f596b8c09437c))
* add retry mechanism for Gemini API transient errors ([b000278](https://github.com/agustinsacco/tars/commit/b00027813ed468182a8d5cd386400864a559086f))
* add unit tests for critical components and enforce testing in CI ([20136eb](https://github.com/agustinsacco/tars/commit/20136eb7f936de95a9cd790ba70a9e074e2aaf83))
* add update command to CLI ([cb8a28e](https://github.com/agustinsacco/tars/commit/cb8a28e1bb7090f2a8ee5d2926d9ef97e16262d7))
* aggressive context pruning and heartbeat history isolation ([97ba663](https://github.com/agustinsacco/tars/commit/97ba66350a1cf5ee461a7228047ab2d502f28845))
* atomic session writes and loop detection resilience ([#21](https://github.com/agustinsacco/tars/issues/21)) ([d1baf9f](https://github.com/agustinsacco/tars/commit/d1baf9f3b0fcc3dc4b888082753f3958560075fa))
* Automated extension bootstrapping and Gemini CLI optimizations ([#1](https://github.com/agustinsacco/tars/issues/1)) ([7d07242](https://github.com/agustinsacco/tars/commit/7d072423e2f6b256c6052edc14ab55e259502c9b))
* **branding:** update logo and add docs link to readme ([2856075](https://github.com/agustinsacco/tars/commit/28560757ca8619ac1e587561fb91e7b669d238e0))
* bundle Tars Dashboard and automate its installation in setup wizard ([926ca1a](https://github.com/agustinsacco/tars/commit/926ca1a1bd2c9f160a09de8fa6ce534c7f4c3cf9))
* **cli:** improved Discord token detection in setup wizard ([0c2da80](https://github.com/agustinsacco/tars/commit/0c2da80ec13cd64ab974e798245697394cd1f14a))
* complete architectural transition to native core and overhaul documentation ([f2c58ff](https://github.com/agustinsacco/tars/commit/f2c58ff0c8d7fb7559441fccca116929a95fd3bd))
* comprehensive documentation overhaul and supervisor refactor ([7c98cf8](https://github.com/agustinsacco/tars/commit/7c98cf8c6ee9fbb33b535efa4b599b6890aa0bc5))
* configurable assistant name and home directory ([#6](https://github.com/agustinsacco/tars/issues/6)) ([1a8b257](https://github.com/agustinsacco/tars/commit/1a8b257a619bbeff634259c956b363840133f429))
* **dash:** add path-agnostic .env template ([#38](https://github.com/agustinsacco/tars/issues/38)) ([99eb459](https://github.com/agustinsacco/tars/commit/99eb459d0a279886de7ad98dae6a24414f8059d1))
* delay heartbeat execution to first interval ([b4438d0](https://github.com/agustinsacco/tars/commit/b4438d012f74efb482d686870f183e938ee9abf8))
* **docs:** refactor documentation to terminal console theme ([0a83cc7](https://github.com/agustinsacco/tars/commit/0a83cc72defeecd5cc6376ddf1cf51f39d090646))
* document Gemini CLI release and update setup model list ([33b58d0](https://github.com/agustinsacco/tars/commit/33b58d0264c771a7109e01f5b64ccb6c03a250c0))
* enable session compaction for background heartbeats ([3f05b88](https://github.com/agustinsacco/tars/commit/3f05b88018623505dfb436799fbdf1faa1ba997a))
* enable whatsapp message yourself functionality ([32bd165](https://github.com/agustinsacco/tars/commit/32bd16525d3ed77f35eefa4053e5e7abd1ad69b9))
* enhance brain auditor to clean nested tilde anomalies ([7b87b98](https://github.com/agustinsacco/tars/commit/7b87b982a751b30951c2db72338106e668b47a54))
* enhance Discord setup instructions and add versioning flags ([5826136](https://github.com/agustinsacco/tars/commit/5826136e7130dcaf9e101ac5198406f4f4197b06))
* enhance portability with path re-homing, workspace management, and subagent support ([0ba3114](https://github.com/agustinsacco/tars/commit/0ba3114185445f2bb504968d0edba07ade4df096))
* fix critical memory pathing and forbid self-restarts ([879ef15](https://github.com/agustinsacco/tars/commit/879ef150064d884fa34f2462296111f5971d1ae8))
* implement 'apps/' primitive and refactor dashboard as a stock app ([cacc65b](https://github.com/agustinsacco/tars/commit/cacc65b598935596641f9c2d79d95e60992a9340))
* implement autonomous tool injection and startup extension hydration ([a17c612](https://github.com/agustinsacco/tars/commit/a17c61238aa057dfa4b0317bee0b2791358924d8))
* implement BrainAuditor for automatic workspace healing and portability ([e75ed30](https://github.com/agustinsacco/tars/commit/e75ed301cc5be3fa4c22162d74fddc0eddea87b9))
* implement extension discovery and fix memory tool loading in native core ([5c2a9f5](https://github.com/agustinsacco/tars/commit/5c2a9f578dd8c8a341a73e1d589e4faaaeca47bd))
* implement generic extension hydration in setup and refine ops skill ([97c42f8](https://github.com/agustinsacco/tars/commit/97c42f84dd1ae9d93aaceeae88e497be5c2fb664))
* implement runtime safety filter to prevent self-restarts ([b8eea5b](https://github.com/agustinsacco/tars/commit/b8eea5b7aa9efd8d310e55abbd80672e40ff513b))
* implement unified autonomous execution architecture ([74fc3dd](https://github.com/agustinsacco/tars/commit/74fc3dd78bb3cda5fe68ee43b1b38d58972f444d))
* improve Cron Service visibility at startup ([a3bf352](https://github.com/agustinsacco/tars/commit/a3bf3529302728934efee370f05771e6f8b7b947))
* improve npm upgrade robustness in restart command ([d58dec0](https://github.com/agustinsacco/tars/commit/d58dec0f7ad3b23e25f3462504a555698365c1e3))
* improve test coverage for core supervisor and utilities ([11a26f0](https://github.com/agustinsacco/tars/commit/11a26f07c4ec13c4f25061330dc54d1a78f838d7))
* improved tool call logging with counts and previews ([6011031](https://github.com/agustinsacco/tars/commit/601103186b7435a7924252dfae6b6e37bb0df245))
* increase max turns to 100 and refine command safety filter ([232e767](https://github.com/agustinsacco/tars/commit/232e767bb2af6613703adc4e47ebf15d164607c2))
* **infra:** add k8s deployment manifests and tailscale workflow for tars-docs ([08a7995](https://github.com/agustinsacco/tars/commit/08a7995a1bd43e3b74c71974470185b5a3bf3586))
* **infra:** change tars-docs port from 80 to 4242 ([b268166](https://github.com/agustinsacco/tars/commit/b26816620356187f156591f9f69c482b859499ab))
* **infra:** update tars-docs port to 5252 ([a2b520c](https://github.com/agustinsacco/tars/commit/a2b520c718f5f3eca8a98c1785965f01574d007a))
* initial commit of Tars AI assistant ([412a8d6](https://github.com/agustinsacco/tars/commit/412a8d606551c467eedb8a6338883a779183c12e))
* integrate Google Workspace and Tars Dashboard as core capabilities with robust process management ([be776c0](https://github.com/agustinsacco/tars/commit/be776c088641131b7bee89cab424870e42e27447))
* migrate to native gemini core and simplify bot logic ([f88e9df](https://github.com/agustinsacco/tars/commit/f88e9dfc867839fa9334b0bebf28cb3835d1dde5))
* move whatsapp qr generation to status command to avoid log mangling ([9f4f9fe](https://github.com/agustinsacco/tars/commit/9f4f9feb2a606f7ffd63443b3f683d1e79a60c92))
* Multi-Agent Swarm (Mesh) Specification and CLI Foundation ([#8](https://github.com/agustinsacco/tars/issues/8)) ([5787394](https://github.com/agustinsacco/tars/commit/57873944f204c1b6045b6b46049065a47e7554f0))
* multi-channel architecture and WhatsApp integration ([#12](https://github.com/agustinsacco/tars/issues/12)) ([927bfc2](https://github.com/agustinsacco/tars/commit/927bfc2d599427ca1cc4be9b4d0f849f85baa481))
* multi-channel architecture plan (Discord & WhatsApp) ([#10](https://github.com/agustinsacco/tars/issues/10)) ([6f0fbd1](https://github.com/agustinsacco/tars/commit/6f0fbd13073f014121326cd8c0ee198fc252411f))
* overhaul session management — single persistent session with compression ([1fda468](https://github.com/agustinsacco/tars/commit/1fda468e595016731ef22f80988a09e3eeb2ddab))
* override system prompt with custom Tars persona ([ec04f68](https://github.com/agustinsacco/tars/commit/ec04f68c740bf1500b3790a3b4521d08c1d3e3eb))
* persistent typing indicator, purge WhatsApp, clean startup logs ([d3811be](https://github.com/agustinsacco/tars/commit/d3811bec773ae43f5371c9a6558c5c6d6782de69))
* **prompts:** implement tiered memory system with Durable vs Active tiers ([#33](https://github.com/agustinsacco/tars/issues/33)) ([97f9ca8](https://github.com/agustinsacco/tars/commit/97f9ca8444c2c9dbf25bf7e5dce1933b3092393f))
* redesign setup wizard with backend-first flow for local inference ([#54](https://github.com/agustinsacco/tars/issues/54)) ([def284f](https://github.com/agustinsacco/tars/commit/def284fc04daccb102fca46d0ca821711b5ef831))
* refactor and streamline documentation ([e4edf31](https://github.com/agustinsacco/tars/commit/e4edf31896536923ea66e24f9a5413411a17f4d3))
* release v1.0.6 ([c3e143d](https://github.com/agustinsacco/tars/commit/c3e143dfa6af1a8088e69c92150d1c3b3ed45283))
* release v1.0.7 ([d9dbb10](https://github.com/agustinsacco/tars/commit/d9dbb109e60945ae882c4f09376d1027b201d281))
* release v1.0.8 ([98a079e](https://github.com/agustinsacco/tars/commit/98a079e7cb77f84cfdcec8a0317f7e9bb78fcae5))
* release version 1.8.0 with supervisor stability fixes ([#26](https://github.com/agustinsacco/tars/issues/26)) ([c60a9d3](https://github.com/agustinsacco/tars/commit/c60a9d3af69c01cb91acbdfe5f38384feef91e22))
* replace native memory with custom MCP server and episodic sessions ([28a7a6e](https://github.com/agustinsacco/tars/commit/28a7a6e89648c962520eeabc68ba694e9c1637ec))
* rule to ensure non-interactive execution of tools ([19cc06d](https://github.com/agustinsacco/tars/commit/19cc06d4a243f0214461f69a8ec21724ca2e325f))
* **skills:** add extension-manager skill for runtime extension control ([518ea21](https://github.com/agustinsacco/tars/commit/518ea21f24c52063e34f1edf6d53a64c4a9833a7))
* **skills:** add guides for creating commands and context ([950313e](https://github.com/agustinsacco/tars/commit/950313eb1de73d3e3e81c95659431f9527491473))
* track and display session token usage ([22338e7](https://github.com/agustinsacco/tars/commit/22338e7f4f20aac6c53f7d436e49eae46ae2b00b))


### Bug Fixes

* add code 42 recovery to executeTask and fix session file lookup ([bfa7fe2](https://github.com/agustinsacco/tars/commit/bfa7fe2812e77261bb219227384059dbc69b61d3))
* add missing .js extensions to test imports for ESM compatibility ([51b66c5](https://github.com/agustinsacco/tars/commit/51b66c5317ec0e5179c12e847fc48b03b44c383b))
* build extensions during publish and add workspace overrides for symlinked extensions ([0c02c69](https://github.com/agustinsacco/tars/commit/0c02c69cf750800fca09b0f5d9af88bb746ae61e))
* **ci:** add local kubectl action from shopify repo ([009598b](https://github.com/agustinsacco/tars/commit/009598b851b61f627385fe49723c07a18225c2f5))
* **ci:** decode kubeconfig content as base64 to match shopify pattern ([e71aa55](https://github.com/agustinsacco/tars/commit/e71aa55078e99902df68041cf26dfdc320e116ee))
* **cli:** correct setup for single-channel Discord, remove WhatsApp from site ([dc854b2](https://github.com/agustinsacco/tars/commit/dc854b2f8c340af44ea3ba21a08398e334971478))
* **cli:** unify instance name resolution and add health status ([#44](https://github.com/agustinsacco/tars/issues/44)) ([57da6a4](https://github.com/agustinsacco/tars/commit/57da6a444adbb4eaef083d54e54c8ca3bb4ffca0))
* copy extensions instead of symlinking to resolve workspace safety issues ([af448f6](https://github.com/agustinsacco/tars/commit/af448f66ed82fbdd4987e8d33252da6d16c6de50))
* **core:** improve Gemini API resilience with expanded retries and autonomous fallback ([#31](https://github.com/agustinsacco/tars/issues/31)) ([9c84bc4](https://github.com/agustinsacco/tars/commit/9c84bc4c55844067979d8e5cd48308c41e52c625))
* cron tasks infinite loop and background process hangs, add proactive notifications ([54bb884](https://github.com/agustinsacco/tars/commit/54bb88429e4c23e7717bbd15cf14fa34939e16ad))
* **dash:** refine dashboard start logs and stabilize path detection ([#42](https://github.com/agustinsacco/tars/issues/42)) ([bae55a8](https://github.com/agustinsacco/tars/commit/bae55a80ec00dc95c3f6afcb30901e734b75c016))
* **dash:** strip PM2 internal env variables to prevent supervisor restart loop ([2cccc43](https://github.com/agustinsacco/tars/commit/2cccc43eaff658564448caa55c58f92082347678))
* downgrade codebase_investigator subagent model to gemini-2.0-flash-exp to avoid 429 errors ([8fab98e](https://github.com/agustinsacco/tars/commit/8fab98ebc93632c29fedf5e50c83dabb5b4cb753))
* exhaustive workspace safety and path propagation fixes ([c64cea8](https://github.com/agustinsacco/tars/commit/c64cea8063490acd5dd3c83d94220b3a92027651))
* explicit npm ci in setup for extensions with verbose logging ([a697c8c](https://github.com/agustinsacco/tars/commit/a697c8c953e57f2d45c509a2922baacb7e7b451e))
* force exit on restart command to prevent hanging ([d7cee06](https://github.com/agustinsacco/tars/commit/d7cee06b645f706432e1ac6e98435fd2d9e7c1de))
* **gemini:** resolve session resume error and improve logging ([ede08dd](https://github.com/agustinsacco/tars/commit/ede08dd57f18129e8faf0492dd74fc5884edfa33))
* implement auto-recovery for corrupted sessions (code 42) ([57bb847](https://github.com/agustinsacco/tars/commit/57bb847288632ebee6f85a003ff282d8b4cee50b))
* improve log clarity for auto-binding registration ([ddb5d24](https://github.com/agustinsacco/tars/commit/ddb5d244404dfe0a57a75ee76b6fbd931c84bb9c))
* make all scripts and dashboard path-agnostic ([#36](https://github.com/agustinsacco/tars/issues/36)) ([0643baa](https://github.com/agustinsacco/tars/commit/0643baac231a6108c240f525a9548583c7b5426d))
* package metadata and excludes ([464b6e0](https://github.com/agustinsacco/tars/commit/464b6e006ef8803506aeae76b2d3b64eeed2fa8e))
* pin gemini CLI CWD to ~/.tars to prevent workspace context leaking ([804e203](https://github.com/agustinsacco/tars/commit/804e203c98a05900e74e7b55bab8322befaebafe))
* promisify start and stop functions to prevent race conditions during restart ([4668d81](https://github.com/agustinsacco/tars/commit/4668d817d306c2938fa9b4993bc9d0b29d8b3d22))
* purge qrcode-terminal from status command to fix update crash ([699daca](https://github.com/agustinsacco/tars/commit/699daca253a07b831dabe0bb48480e31e0b460cd))
* resolve llamacpp initialization crash and extension hydration ([0e4e764](https://github.com/agustinsacco/tars/commit/0e4e764543c74186cce84ee6e05bf362ea7b2eb0))
* resolve repeated discord auto-bind and whatsapp connection errors ([ba1e93c](https://github.com/agustinsacco/tars/commit/ba1e93c5cbadc5e0cdc9f8f1e6c5612c635bbb92))
* restore correct version 1.7.8 and prepare for 1.8.0 release ([#24](https://github.com/agustinsacco/tars/issues/24)) ([53a9090](https://github.com/agustinsacco/tars/commit/53a90901a53c90c5cb46618f06dd9382626ca4ea))
* restore supervisor run loop and fix error serialization ([4a2cbce](https://github.com/agustinsacco/tars/commit/4a2cbcec41e3644fb1c95920858bf7695bebf4b0))
* revert unverified Gemini 3.0 models causing 404 ([3f277c8](https://github.com/agustinsacco/tars/commit/3f277c8c9b90fe89fb73ec56edee0d3de12aa8ed))
* run npm install after copying extensions in setup ([02e2624](https://github.com/agustinsacco/tars/commit/02e2624e92729de76c64ba58cf0bc06184befd1c))
* set codebase_investigator subagent models to auto instead of hardcoded strings ([3583580](https://github.com/agustinsacco/tars/commit/358358026c8836b99d70f38d4da74bbb0f989709))
* update model selection in setup to default to auto ([ad57492](https://github.com/agustinsacco/tars/commit/ad57492af064d3f85227e4e5ca413e7058f6f9e7))

## [1.13.1](https://github.com/agustinsacco/tars/compare/v1.13.0...v1.13.1) (2026-03-21)


### Bug Fixes

* resolve llamacpp initialization crash and extension hydration ([0e4e764](https://github.com/agustinsacco/tars/commit/0e4e764543c74186cce84ee6e05bf362ea7b2eb0))

## [1.13.0](https://github.com/agustinsacco/tars/compare/v1.12.0...v1.13.0) (2026-03-21)


### Features

* overhaul session management — single persistent session with compression ([1fda468](https://github.com/agustinsacco/tars/commit/1fda468e595016731ef22f80988a09e3eeb2ddab))

## [1.12.0](https://github.com/agustinsacco/tars/compare/v1.11.2...v1.12.0) (2026-03-21)


### Features

* add local inference support via LlamaCpp ([#47](https://github.com/agustinsacco/tars/issues/47)) ([c6244cb](https://github.com/agustinsacco/tars/commit/c6244cb615224456a3bb1965faa887c017111f37))

## [1.11.2](https://github.com/agustinsacco/tars/compare/v1.11.1...v1.11.2) (2026-03-21)


### Bug Fixes

* **cli:** unify instance name resolution and add health status ([#44](https://github.com/agustinsacco/tars/issues/44)) ([57da6a4](https://github.com/agustinsacco/tars/commit/57da6a444adbb4eaef083d54e54c8ca3bb4ffca0))
* **dash:** refine dashboard start logs and stabilize path detection ([#42](https://github.com/agustinsacco/tars/issues/42)) ([bae55a8](https://github.com/agustinsacco/tars/commit/bae55a80ec00dc95c3f6afcb30901e734b75c016))

## [1.11.1](https://github.com/agustinsacco/tars/compare/v1.11.0...v1.11.1) (2026-03-17)


### Bug Fixes

* **dash:** strip PM2 internal env variables to prevent supervisor restart loop ([2cccc43](https://github.com/agustinsacco/tars/commit/2cccc43eaff658564448caa55c58f92082347678))

## [1.11.0](https://github.com/agustinsacco/tars/compare/v1.10.1...v1.11.0) (2026-03-17)


### Features

* **dash:** add path-agnostic .env template ([#38](https://github.com/agustinsacco/tars/issues/38)) ([99eb459](https://github.com/agustinsacco/tars/commit/99eb459d0a279886de7ad98dae6a24414f8059d1))

## [1.10.1](https://github.com/agustinsacco/tars/compare/v1.10.0...v1.10.1) (2026-03-17)


### Bug Fixes

* make all scripts and dashboard path-agnostic ([#36](https://github.com/agustinsacco/tars/issues/36)) ([0643baa](https://github.com/agustinsacco/tars/commit/0643baac231a6108c240f525a9548583c7b5426d))

## [1.10.0](https://github.com/agustinsacco/tars/compare/v1.9.1...v1.10.0) (2026-03-17)


### Features

* **prompts:** implement tiered memory system with Durable vs Active tiers ([#33](https://github.com/agustinsacco/tars/issues/33)) ([97f9ca8](https://github.com/agustinsacco/tars/commit/97f9ca8444c2c9dbf25bf7e5dce1933b3092393f))

## [1.9.1](https://github.com/agustinsacco/tars/compare/v1.9.0...v1.9.1) (2026-03-17)


### Bug Fixes

* **core:** improve Gemini API resilience with expanded retries and autonomous fallback ([#31](https://github.com/agustinsacco/tars/issues/31)) ([9c84bc4](https://github.com/agustinsacco/tars/commit/9c84bc4c55844067979d8e5cd48308c41e52c625))

## [1.9.0](https://github.com/agustinsacco/tars/compare/v1.8.1...v1.9.0) (2026-03-16)


### Features

* add gws-setup skill for automated workspace CLI management ([12cda08](https://github.com/agustinsacco/tars/commit/12cda0875a3ebaca06edccb8120427677de62b07))
* add retry mechanism for Gemini API transient errors ([b000278](https://github.com/agustinsacco/tars/commit/b00027813ed468182a8d5cd386400864a559086f))
* bundle Tars Dashboard and automate its installation in setup wizard ([926ca1a](https://github.com/agustinsacco/tars/commit/926ca1a1bd2c9f160a09de8fa6ce534c7f4c3cf9))
* implement 'apps/' primitive and refactor dashboard as a stock app ([cacc65b](https://github.com/agustinsacco/tars/commit/cacc65b598935596641f9c2d79d95e60992a9340))
* integrate Google Workspace and Tars Dashboard as core capabilities with robust process management ([be776c0](https://github.com/agustinsacco/tars/commit/be776c088641131b7bee89cab424870e42e27447))

## [1.8.1](https://github.com/agustinsacco/tars/compare/v1.8.0...v1.8.1) (2026-03-15)


### Bug Fixes

* restore supervisor run loop and fix error serialization ([4a2cbce](https://github.com/agustinsacco/tars/commit/4a2cbcec41e3644fb1c95920858bf7695bebf4b0))

## [1.8.0](https://github.com/agustinsacco/tars/compare/v1.7.0...v1.8.0) (2026-03-14)

### Features

- release version 1.8.0 with supervisor stability fixes ([#26](https://github.com/agustinsacco/tars/issues/26)) ([c60a9d3](https://github.com/agustinsacco/tars/commit/c60a9d3af69c01cb91acbdfe5f38384feef91e22))

### Bug Fixes

- restore correct version 1.7.8 and prepare for 1.8.0 release ([#24](https://github.com/agustinsacco/tars/issues/24)) ([53a9090](https://github.com/agustinsacco/tars/commit/53a90901a53c90c5cb46618f06dd9382626ca4ea))

## [1.7.0](https://github.com/agustinsacco/tars/compare/v1.6.0...v1.7.0) (2026-03-14)

### Features

- add --prefer-online to update check in tars restart ([754a2e8](https://github.com/agustinsacco/tars/commit/754a2e830d76c5441c0864d4bfbeb1756c3563d6))
- add 'tars restart' command with auto-update logic ([6ff34ee](https://github.com/agustinsacco/tars/commit/6ff34ee9e698f5c188e9ee8f45a66e6bb1801115))
- add assistant name to setup wizard ([50c1bb0](https://github.com/agustinsacco/tars/commit/50c1bb08d9a46306832f439468b49c86b40bd31c))
- add built-in subagents and dynamic settings patching ([f92090e](https://github.com/agustinsacco/tars/commit/f92090e13a78a65734f49a1866ca258a1074a966))
- add CI/CD validation and release automation workflows ([#2](https://github.com/agustinsacco/tars/issues/2)) ([c1f96a4](https://github.com/agustinsacco/tars/commit/c1f96a4917652de29ce53afb26323057b38db09d))
- add correct Gemini 3 models (gemini-3-flash, gemini-3-pro) ([b4157f1](https://github.com/agustinsacco/tars/commit/b4157f13e42a8d3c345cf20252d635c748c28b6a))
- add documentation website with Astro Starlight and cartoon Tars logo ([81017de](https://github.com/agustinsacco/tars/commit/81017de91af433c1f3c100e807a58bd66ef8c721))
- add Gemini 3.0 models to setup and refine interval options ([521ff2c](https://github.com/agustinsacco/tars/commit/521ff2c12170ff2ccd02bc700e4c49213a76c304))
- add Gemini API quota tracking tool and CLI command ([#3](https://github.com/agustinsacco/tars/issues/3)) ([d51f7b3](https://github.com/agustinsacco/tars/commit/d51f7b3294ab3dabe8d5c1041e811b7ed1cd020d))
- add multimodal support and resolve initialization hangs ([d8d3d30](https://github.com/agustinsacco/tars/commit/d8d3d30abf53d5b4ecbf08f4ae1286ba718b43f1))
- add narrative navigation and ensure cursor pointers on site ([7ee93e2](https://github.com/agustinsacco/tars/commit/7ee93e2b77dbabf3dc189a02052f596b8c09437c))
- add unit tests for critical components and enforce testing in CI ([20136eb](https://github.com/agustinsacco/tars/commit/20136eb7f936de95a9cd790ba70a9e074e2aaf83))
- add update command to CLI ([cb8a28e](https://github.com/agustinsacco/tars/commit/cb8a28e1bb7090f2a8ee5d2926d9ef97e16262d7))
- aggressive context pruning and heartbeat history isolation ([97ba663](https://github.com/agustinsacco/tars/commit/97ba66350a1cf5ee461a7228047ab2d502f28845))
- atomic session writes and loop detection resilience ([#21](https://github.com/agustinsacco/tars/issues/21)) ([d1baf9f](https://github.com/agustinsacco/tars/commit/d1baf9f3b0fcc3dc4b888082753f3958560075fa))
- Automated extension bootstrapping and Gemini CLI optimizations ([#1](https://github.com/agustinsacco/tars/issues/1)) ([7d07242](https://github.com/agustinsacco/tars/commit/7d072423e2f6b256c6052edc14ab55e259502c9b))
- **branding:** update logo and add docs link to readme ([2856075](https://github.com/agustinsacco/tars/commit/28560757ca8619ac1e587561fb91e7b669d238e0))
- **cli:** improved Discord token detection in setup wizard ([0c2da80](https://github.com/agustinsacco/tars/commit/0c2da80ec13cd64ab974e798245697394cd1f14a))
- complete architectural transition to native core and overhaul documentation ([f2c58ff](https://github.com/agustinsacco/tars/commit/f2c58ff0c8d7fb7559441fccca116929a95fd3bd))
- comprehensive documentation overhaul and supervisor refactor ([7c98cf8](https://github.com/agustinsacco/tars/commit/7c98cf8c6ee9fbb33b535efa4b599b6890aa0bc5))
- configurable assistant name and home directory ([#6](https://github.com/agustinsacco/tars/issues/6)) ([1a8b257](https://github.com/agustinsacco/tars/commit/1a8b257a619bbeff634259c956b363840133f429))
- delay heartbeat execution to first interval ([b4438d0](https://github.com/agustinsacco/tars/commit/b4438d012f74efb482d686870f183e938ee9abf8))
- **docs:** refactor documentation to terminal console theme ([0a83cc7](https://github.com/agustinsacco/tars/commit/0a83cc72defeecd5cc6376ddf1cf51f39d090646))
- document Gemini CLI release and update setup model list ([33b58d0](https://github.com/agustinsacco/tars/commit/33b58d0264c771a7109e01f5b64ccb6c03a250c0))
- enable session compaction for background heartbeats ([3f05b88](https://github.com/agustinsacco/tars/commit/3f05b88018623505dfb436799fbdf1faa1ba997a))
- enable whatsapp message yourself functionality ([32bd165](https://github.com/agustinsacco/tars/commit/32bd16525d3ed77f35eefa4053e5e7abd1ad69b9))
- enhance brain auditor to clean nested tilde anomalies ([7b87b98](https://github.com/agustinsacco/tars/commit/7b87b982a751b30951c2db72338106e668b47a54))
- enhance Discord setup instructions and add versioning flags ([5826136](https://github.com/agustinsacco/tars/commit/5826136e7130dcaf9e101ac5198406f4f4197b06))
- enhance portability with path re-homing, workspace management, and subagent support ([0ba3114](https://github.com/agustinsacco/tars/commit/0ba3114185445f2bb504968d0edba07ade4df096))
- fix critical memory pathing and forbid self-restarts ([879ef15](https://github.com/agustinsacco/tars/commit/879ef150064d884fa34f2462296111f5971d1ae8))
- implement autonomous tool injection and startup extension hydration ([a17c612](https://github.com/agustinsacco/tars/commit/a17c61238aa057dfa4b0317bee0b2791358924d8))
- implement BrainAuditor for automatic workspace healing and portability ([e75ed30](https://github.com/agustinsacco/tars/commit/e75ed301cc5be3fa4c22162d74fddc0eddea87b9))
- implement extension discovery and fix memory tool loading in native core ([5c2a9f5](https://github.com/agustinsacco/tars/commit/5c2a9f578dd8c8a341a73e1d589e4faaaeca47bd))
- implement generic extension hydration in setup and refine ops skill ([97c42f8](https://github.com/agustinsacco/tars/commit/97c42f84dd1ae9d93aaceeae88e497be5c2fb664))
- implement runtime safety filter to prevent self-restarts ([b8eea5b](https://github.com/agustinsacco/tars/commit/b8eea5b7aa9efd8d310e55abbd80672e40ff513b))
- implement unified autonomous execution architecture ([74fc3dd](https://github.com/agustinsacco/tars/commit/74fc3dd78bb3cda5fe68ee43b1b38d58972f444d))
- improve Cron Service visibility at startup ([a3bf352](https://github.com/agustinsacco/tars/commit/a3bf3529302728934efee370f05771e6f8b7b947))
- improve npm upgrade robustness in restart command ([d58dec0](https://github.com/agustinsacco/tars/commit/d58dec0f7ad3b23e25f3462504a555698365c1e3))
- improve test coverage for core supervisor and utilities ([11a26f0](https://github.com/agustinsacco/tars/commit/11a26f07c4ec13c4f25061330dc54d1a78f838d7))
- improved tool call logging with counts and previews ([6011031](https://github.com/agustinsacco/tars/commit/601103186b7435a7924252dfae6b6e37bb0df245))
- increase max turns to 100 and refine command safety filter ([232e767](https://github.com/agustinsacco/tars/commit/232e767bb2af6613703adc4e47ebf15d164607c2))
- **infra:** add k8s deployment manifests and tailscale workflow for tars-docs ([08a7995](https://github.com/agustinsacco/tars/commit/08a7995a1bd43e3b74c71974470185b5a3bf3586))
- **infra:** change tars-docs port from 80 to 4242 ([b268166](https://github.com/agustinsacco/tars/commit/b26816620356187f156591f9f69c482b859499ab))
- **infra:** update tars-docs port to 5252 ([a2b520c](https://github.com/agustinsacco/tars/commit/a2b520c718f5f3eca8a98c1785965f01574d007a))
- initial commit of Tars AI assistant ([412a8d6](https://github.com/agustinsacco/tars/commit/412a8d606551c467eedb8a6338883a779183c12e))
- migrate to native gemini core and simplify bot logic ([f88e9df](https://github.com/agustinsacco/tars/commit/f88e9dfc867839fa9334b0bebf28cb3835d1dde5))
- move whatsapp qr generation to status command to avoid log mangling ([9f4f9fe](https://github.com/agustinsacco/tars/commit/9f4f9feb2a606f7ffd63443b3f683d1e79a60c92))
- Multi-Agent Swarm (Mesh) Specification and CLI Foundation ([#8](https://github.com/agustinsacco/tars/issues/8)) ([5787394](https://github.com/agustinsacco/tars/commit/57873944f204c1b6045b6b46049065a47e7554f0))
- multi-channel architecture and WhatsApp integration ([#12](https://github.com/agustinsacco/tars/issues/12)) ([927bfc2](https://github.com/agustinsacco/tars/commit/927bfc2d599427ca1cc4be9b4d0f849f85baa481))
- multi-channel architecture plan (Discord & WhatsApp) ([#10](https://github.com/agustinsacco/tars/issues/10)) ([6f0fbd1](https://github.com/agustinsacco/tars/commit/6f0fbd13073f014121326cd8c0ee198fc252411f))
- override system prompt with custom Tars persona ([ec04f68](https://github.com/agustinsacco/tars/commit/ec04f68c740bf1500b3790a3b4521d08c1d3e3eb))
- persistent typing indicator, purge WhatsApp, clean startup logs ([d3811be](https://github.com/agustinsacco/tars/commit/d3811bec773ae43f5371c9a6558c5c6d6782de69))
- refactor and streamline documentation ([e4edf31](https://github.com/agustinsacco/tars/commit/e4edf31896536923ea66e24f9a5413411a17f4d3))
- release v1.0.6 ([c3e143d](https://github.com/agustinsacco/tars/commit/c3e143dfa6af1a8088e69c92150d1c3b3ed45283))
- release v1.0.7 ([d9dbb10](https://github.com/agustinsacco/tars/commit/d9dbb109e60945ae882c4f09376d1027b201d281))
- release v1.0.8 ([98a079e](https://github.com/agustinsacco/tars/commit/98a079e7cb77f84cfdcec8a0317f7e9bb78fcae5))
- replace native memory with custom MCP server and episodic sessions ([28a7a6e](https://github.com/agustinsacco/tars/commit/28a7a6e89648c962520eeabc68ba694e9c1637ec))
- rule to ensure non-interactive execution of tools ([19cc06d](https://github.com/agustinsacco/tars/commit/19cc06d4a243f0214461f69a8ec21724ca2e325f))
- **skills:** add extension-manager skill for runtime extension control ([518ea21](https://github.com/agustinsacco/tars/commit/518ea21f24c52063e34f1edf6d53a64c4a9833a7))
- **skills:** add guides for creating commands and context ([950313e](https://github.com/agustinsacco/tars/commit/950313eb1de73d3e3e81c95659431f9527491473))
- track and display session token usage ([22338e7](https://github.com/agustinsacco/tars/commit/22338e7f4f20aac6c53f7d436e49eae46ae2b00b))

### Bug Fixes

- add code 42 recovery to executeTask and fix session file lookup ([bfa7fe2](https://github.com/agustinsacco/tars/commit/bfa7fe2812e77261bb219227384059dbc69b61d3))
- add missing .js extensions to test imports for ESM compatibility ([51b66c5](https://github.com/agustinsacco/tars/commit/51b66c5317ec0e5179c12e847fc48b03b44c383b))
- build extensions during publish and add workspace overrides for symlinked extensions ([0c02c69](https://github.com/agustinsacco/tars/commit/0c02c69cf750800fca09b0f5d9af88bb746ae61e))
- **ci:** add local kubectl action from shopify repo ([009598b](https://github.com/agustinsacco/tars/commit/009598b851b61f627385fe49723c07a18225c2f5))
- **ci:** decode kubeconfig content as base64 to match shopify pattern ([e71aa55](https://github.com/agustinsacco/tars/commit/e71aa55078e99902df68041cf26dfdc320e116ee))
- **cli:** correct setup for single-channel Discord, remove WhatsApp from site ([dc854b2](https://github.com/agustinsacco/tars/commit/dc854b2f8c340af44ea3ba21a08398e334971478))
- copy extensions instead of symlinking to resolve workspace safety issues ([af448f6](https://github.com/agustinsacco/tars/commit/af448f66ed82fbdd4987e8d33252da6d16c6de50))
- cron tasks infinite loop and background process hangs, add proactive notifications ([54bb884](https://github.com/agustinsacco/tars/commit/54bb88429e4c23e7717bbd15cf14fa34939e16ad))
- downgrade codebase_investigator subagent model to gemini-2.0-flash-exp to avoid 429 errors ([8fab98e](https://github.com/agustinsacco/tars/commit/8fab98ebc93632c29fedf5e50c83dabb5b4cb753))
- exhaustive workspace safety and path propagation fixes ([c64cea8](https://github.com/agustinsacco/tars/commit/c64cea8063490acd5dd3c83d94220b3a92027651))
- explicit npm ci in setup for extensions with verbose logging ([a697c8c](https://github.com/agustinsacco/tars/commit/a697c8c953e57f2d45c509a2922baacb7e7b451e))
- force exit on restart command to prevent hanging ([d7cee06](https://github.com/agustinsacco/tars/commit/d7cee06b645f706432e1ac6e98435fd2d9e7c1de))
- **gemini:** resolve session resume error and improve logging ([ede08dd](https://github.com/agustinsacco/tars/commit/ede08dd57f18129e8faf0492dd74fc5884edfa33))
- implement auto-recovery for corrupted sessions (code 42) ([57bb847](https://github.com/agustinsacco/tars/commit/57bb847288632ebee6f85a003ff282d8b4cee50b))
- improve log clarity for auto-binding registration ([ddb5d24](https://github.com/agustinsacco/tars/commit/ddb5d244404dfe0a57a75ee76b6fbd931c84bb9c))
- package metadata and excludes ([464b6e0](https://github.com/agustinsacco/tars/commit/464b6e006ef8803506aeae76b2d3b64eeed2fa8e))
- pin gemini CLI CWD to ~/.tars to prevent workspace context leaking ([804e203](https://github.com/agustinsacco/tars/commit/804e203c98a05900e74e7b55bab8322befaebafe))
- promisify start and stop functions to prevent race conditions during restart ([4668d81](https://github.com/agustinsacco/tars/commit/4668d817d306c2938fa9b4993bc9d0b29d8b3d22))
- purge qrcode-terminal from status command to fix update crash ([699daca](https://github.com/agustinsacco/tars/commit/699daca253a07b831dabe0bb48480e31e0b460cd))
- resolve repeated discord auto-bind and whatsapp connection errors ([ba1e93c](https://github.com/agustinsacco/tars/commit/ba1e93c5cbadc5e0cdc9f8f1e6c5612c635bbb92))
- revert unverified Gemini 3.0 models causing 404 ([3f277c8](https://github.com/agustinsacco/tars/commit/3f277c8c9b90fe89fb73ec56edee0d3de12aa8ed))
- run npm install after copying extensions in setup ([02e2624](https://github.com/agustinsacco/tars/commit/02e2624e92729de76c64ba58cf0bc06184befd1c))
- set codebase_investigator subagent models to auto instead of hardcoded strings ([3583580](https://github.com/agustinsacco/tars/commit/358358026c8836b99d70f38d4da74bbb0f989709))
- update model selection in setup to default to auto ([ad57492](https://github.com/agustinsacco/tars/commit/ad57492af064d3f85227e4e5ca413e7058f6f9e7))

## [1.6.0](https://github.com/agustinsacco/tars/compare/v1.5.0...v1.6.0) (2026-03-14)

### Features

- enable whatsapp message yourself functionality ([32bd165](https://github.com/agustinsacco/tars/commit/32bd16525d3ed77f35eefa4053e5e7abd1ad69b9))

## [1.5.0](https://github.com/agustinsacco/tars/compare/v1.4.2...v1.5.0) (2026-03-14)

### Features

- move whatsapp qr generation to status command to avoid log mangling ([9f4f9fe](https://github.com/agustinsacco/tars/commit/9f4f9feb2a606f7ffd63443b3f683d1e79a60c92))

## [1.4.2](https://github.com/agustinsacco/tars/compare/v1.4.1...v1.4.2) (2026-03-13)

### Bug Fixes

- resolve repeated discord auto-bind and whatsapp connection errors ([ba1e93c](https://github.com/agustinsacco/tars/commit/ba1e93c5cbadc5e0cdc9f8f1e6c5612c635bbb92))

## [1.4.1](https://github.com/agustinsacco/tars/compare/v1.4.0...v1.4.1) (2026-03-13)

### Bug Fixes

- improve log clarity for auto-binding registration ([ddb5d24](https://github.com/agustinsacco/tars/commit/ddb5d244404dfe0a57a75ee76b6fbd931c84bb9c))

## [1.4.0](https://github.com/agustinsacco/tars/compare/v1.3.0...v1.4.0) (2026-03-13)

### Features

- Multi-Agent Swarm (Mesh) Specification and CLI Foundation ([#8](https://github.com/agustinsacco/tars/issues/8)) ([5787394](https://github.com/agustinsacco/tars/commit/57873944f204c1b6045b6b46049065a47e7554f0))

## [1.3.2](https://github.com/agustinsacco/tars/compare/v1.3.1...v1.3.2) (2026-03-13)

### Features

- **Multi-Channel**: Aggregate streaming chunks into single message blocks to avoid UI fragmentation and multiple notification bubbles.
- **Discord**: Prepend auto-binding system alerts to the first assistant response instead of sending separate messages.

## [1.3.1](https://github.com/agustinsacco/tars/compare/v1.3.0...v1.3.1) (2026-03-12)

### Features

- Multi-Agent Swarm (Mesh) Specification and CLI Foundation ([#8](https://github.com/agustinsacco/tars/issues/8))

### Bug Fixes

- fix formatting in CHANGELOG.md that caused lint failures

## [1.3.0](https://github.com/agustinsacco/tars/compare/v1.2.0...v1.3.0) (2026-03-12)

### Features

- multi-channel architecture and WhatsApp integration ([#12](https://github.com/agustinsacco/tars/issues/12)) ([927bfc2](https://github.com/agustinsacco/tars/commit/927bfc2d599427ca1cc4be9b4d0f849f85baa481))
- multi-channel architecture plan (Discord & WhatsApp) ([#10](https://github.com/agustinsacco/tars/issues/10)) ([6f0fbd1](https://github.com/agustinsacco/tars/commit/6f0fbd13073f014121326cd8c0ee198fc252411f))

## [1.2.0](https://github.com/agustinsacco/tars/compare/v1.1.0...v1.2.0) (2026-03-01)

### Features

- add assistant name to setup wizard ([50c1bb0](https://github.com/agustinsacco/tars/commit/50c1bb08d9a46306832f439468b49c86b40bd31c))
- configurable assistant name and home directory ([#6](https://github.com/agustinsacco/tars/issues/6)) ([1a8b257](https://github.com/agustinsacco/tars/commit/1a8b257a619bbeff634259c956b363840133f429))

## [1.1.0](https://github.com/agustinsacco/tars/compare/v1.0.53...v1.1.0) (2026-03-01)

### Features

- add CI/CD validation and release automation workflows ([#2](https://github.com/agustinsacco/tars/issues/2)) ([c1f96a4](https://github.com/agustinsacco/tars/commit/c1f96a4917652de29ce53afb26323057b38db09d))
- add Gemini API quota tracking tool and CLI command ([#3](https://github.com/agustinsacco/tars/issues/3)) ([d51f7b3](https://github.com/agustinsacco/tars/commit/d51f7b3294ab3dabe8d5c1041e811b7ed1cd020d))
