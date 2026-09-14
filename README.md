# LMM provider for DSH

Use the models available to your [LMM](https://api.lmm.best) account directly in DeepSeek Harness. Authentication uses browser OAuth with PKCE and a loopback callback. No API key is pasted into DSH.

This package is an alpha for DSH `0.1.5-rc`.

## Install

Add the bundle to each DSH profile where LMM should be available:

```sh
dsh plugin --profile web add @tokennotincluded/dsh-lmm-provider@alpha
dsh plugin --profile headless add @tokennotincluded/dsh-lmm-provider@alpha
```

For local development:

```sh
npm install
npm run build
dsh plugin --profile web add /absolute/path/to/dsh-lmm-provider
```

## Sign in

1. Start `dsh web` and open Settings, then Models.
2. Choose **LMM** and **Sign in with LMM**.
3. Approve access in the browser and return to DSH.
4. Select one of the LMM models now shown by DSH.

The login is stored in DSH's credential store and shared by profiles using the same `DSH_HOME`. Model access, groups, capabilities, and prices come from the account-scoped LMM catalog. Token refresh is serialized by DSH and additionally fenced by a credential-free refresh journal under `DSH_HOME`.

Signing out in DSH removes the local credential. The current DSH authorization interface has no server-revocation hook, so local sign-out does not revoke the LMM grant yet.
