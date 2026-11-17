# Dynamic model directory and cached metadata

DSH uses the pinned [Pi provider implementation](https://github.com/TokenNotIncluded/pi-lmm-provider/blob/358960d02828eb385aa35514c5c56470a4349572/DYNAMIC_CATALOG.md) for OAuth catalog parsing, server metadata, prices and supported model registration. The account catalog is the authority for authorized groups, routes and prices. The adapter preserves those wire IDs. New compatible models remain available even when their names are absent from public metadata.

Public metadata comes from models.dev and fills missing capabilities through fuzzy matching of model and provider names. The shared runtime caches successful responses for 24 hours, refreshes expired data automatically and retains stale data when refresh is unavailable. Set `LMM_MODELS_DEV_CACHE` to choose the cache file or `LMM_MODELS_DEV_TTL_MS` to adjust its lifetime. No credentials are sent to models.dev.

Positive server limits take precedence. Missing or zero public limits use the documented conservative defaults rather than rejecting the model. An explicit non-chat model type, incompatible modalities or a protocol unsupported by the Pi adapter remains visible in account reports with an explanation. Unknown prices are labelled as unknown; reference costs are estimates, never substituted for account billing rates.

The DSH model lifecycle refreshes the account directory with a 60-second coordination TTL; explicit refresh invalidates that snapshot. Catalog responses allow up to 32 MiB without widening the smaller OAuth-response limits. Server additions, deletions and metadata changes do not need another plugin publication.

The nested gitlink must be pushed and reachable before this repository is pushed. Unit and packaging checks are separate from native host acceptance.
