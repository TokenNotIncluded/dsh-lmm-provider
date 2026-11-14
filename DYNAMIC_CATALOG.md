# Server model metadata

DSH uses the pinned `vendor/pi-lmm-provider` implementation for OAuth catalog parsing, authoritative server metadata, effective prices and model admission. See [the shared contract](https://github.com/TokenNotIncluded/pi-lmm-provider/blob/11054ff3cc32e840e100497bea1d64281eecfbda/DYNAMIC_CATALOG.md). Its model lifecycle refreshes the directory, with a 60-second coordination TTL; explicit refresh invalidates that snapshot. Server additions, deletions and metadata changes do not need another plugin publication. Unknown capability/price data stays read-only, and DSH still only supports the protocols implemented by its Pi adapter.

The nested gitlink must be pushed and reachable before this repository is pushed. This source update is not a package release or host acceptance result.
