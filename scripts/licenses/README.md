# License sources

These files are included locally so extension builds do not require network access.

- `ai-provider-utils-5.0.36-LICENSE.txt` is the unchanged repository license at the [official `@ai-sdk/provider-utils@5.0.36` release commit](https://github.com/vercel/ai/blob/8a09c78c039e2c092468eaeff97faaabf3b77366/LICENSE). The [package manifest at that same commit](https://github.com/vercel/ai/blob/8a09c78c039e2c092468eaeff97faaabf3b77366/packages/provider-utils/package.json) declares version `5.0.36` and license `Apache-2.0`. Its installed npm package omits the root license. The fallback is restricted to this exact name, version, and declared license; an upgrade must be checked separately.
- `Apache-2.0.txt` is the unchanged [complete Apache License 2.0 text](https://www.apache.org/licenses/LICENSE-2.0.txt). It accompanies the original package copyright notices, some of which contain only a link to the license.

Sources retrieved on 2026-09-05. The generator also includes license and notice files nested in bundled packages, including the ISC notice for provider-utils' vendored `zod3-to-json-schema` code.
