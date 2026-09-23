# LMM provider for DSH

Use the models available to your [LMM](https://api.lmm.best) account directly in DeepSeek Harness. Authentication uses browser OAuth with PKCE and a loopback callback. No API key is pasted into DSH.

This package is an alpha tested with DSH `0.1.5-rc.2`. It requires Node.js `22.19.0` or newer in the supported Node 22 / Node 24+ lines.

## Official DSH Desktop

Open **Plugins** in the Desktop application and add `@tokennotincluded/dsh-lmm-provider@alpha`. The official Desktop application owns an isolated `desktop` profile; installing into a CLI `web` profile does not install the plugin in Desktop. If an older local, Git or release archive copy of this package is already installed, remove that package in Desktop Plugins first, then add the npm package. The Desktop manager permits one dependency with this package name per profile, so two sources cannot run together there. Restart Desktop if the manager asks for it.

In **Settings → Models**, choose **Sign in with LMM**. Use **Open LMM authorization** if it opens your normal browser. If the link does nothing or opens a browser without your LMM login, choose **Copy link** and paste it into the browser where you are already signed in. On the LMM authorization page, choose **Continue** when already signed in. The **Sign in** link is for a browser without an active LMM session. Review the account and permissions, choose **Allow access**, and wait for DSH to show **Sign-in complete**. If the browser does not return to DSH automatically, use **Return to DSH** on the completion page.

Keep Desktop open throughout the attempt. The authorization link is short lived and tied to the local callback listener, so start a fresh attempt if it expires. A failed attempt now shows a credential-free reason in the card.

## DSH CLI / Web profile

Install the npm package in the profile you run:

```sh
dsh plugin --profile web add @tokennotincluded/dsh-lmm-provider@alpha
```

The DSH package manager also keys this dependency by package name. To switch from a local, Git or archive installation, remove `@tokennotincluded/dsh-lmm-provider` from that profile, then add the npm package. Credential records are stored separately from the package dependency.

### Install from source

```sh
npm install -g @deepseek-ai/dsh@0.1.5-rc.2
git clone --recurse-submodules https://github.com/TokenNotIncluded/dsh-lmm-provider.git
cd dsh-lmm-provider
npm ci
npm run build
dsh plugin --profile web add .
```

The submodule is required by the build. If the repository was cloned without it, run `git submodule update --init --recursive` before building. Keep the checkout after installation: DSH links local plugin directories.

The bundle includes the authorization service and the Web Models-page login card. Install it separately in each profile that needs LMM. A headless profile can use the credential after a Web login when both profiles share the same `DSH_HOME`:

```sh
dsh plugin --profile headless add /absolute/path/to/dsh-lmm-provider
```

## Sign in from the Web profile

1. Switch to your project directory, start `dsh web`, and open Settings → Models.
2. Find the **LMM** card and select **Sign in with LMM**.
3. Open the authorization link in the browser where you are signed in to LMM. Click **Continue** on the LMM page, review and approve access, then return to DSH.
4. The card reports **Sign-in complete** only after DSH observes the saved credential. Select an LMM model in your conversation.

Cancel stops the pending login; closing Settings also cancels that page's active attempt. A sign-in attempt expires after five minutes. Prompt answers and OAuth credentials are never returned in status responses. The Web controls use DSH's existing authenticated API transport and its Host/Origin checks.

**Sign out** removes the local credential. It does not revoke the server grant; revoke the authorization in your LMM account when needed. Model access, groups, capabilities, and prices come from the account-scoped LMM catalog. Token refresh is serialized by DSH and additionally fenced by a credential-free refresh journal under `DSH_HOME`.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run pack:check
```

The package ships both the Host adapter and the browser bundle. Tests cover credential isolation, OAuth client identity, loader dependency metadata, authorization prompts, cancellation, and secret-free responses. A successful build or installation alone is not proof of live OAuth and model invocation; verify those against an authorized test account before relying on a new release.
