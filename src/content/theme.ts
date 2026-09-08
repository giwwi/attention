/** Shared palettes inside the extension's private shadow roots. CSS media
 * queries follow the user's browser/system preference, including live changes. */
export const CONTENT_THEME_CSS = `
  .card, .panel {
    color-scheme: light;
    --attention-bg: #fbfdfb;
    --attention-fg: #193428;
    --attention-muted: #5f7068;
    --attention-secondary: #3f5a4d;
    --attention-border: #d8e3dc;
    --attention-border-hover: #a5bdaf;
    --attention-control-bg: #fff;
    --attention-control-hover: #eef5f0;
    --attention-inset-bg: #eef4ef;
    --attention-input-border: #c9d8ce;
    --attention-accent: #17684c;
    --attention-accent-hover: #12583f;
    --attention-on-accent: #fff;
    --attention-focus: #26805f;
    --attention-warning: #735b32;
    --attention-warning-border: #ad813a;
    --attention-error: #9a3333;
    --attention-shadow: rgba(25,52,40,.16);
  }
  @media (prefers-color-scheme: dark) {
    .card, .panel {
      color-scheme: dark;
      --attention-bg: #15221b;
      --attention-fg: #e4eee7;
      --attention-muted: #a5b9ad;
      --attention-secondary: #c2d5ca;
      --attention-border: #3b5143;
      --attention-border-hover: #688c76;
      --attention-control-bg: #1b2b22;
      --attention-control-hover: #253c2f;
      --attention-inset-bg: #1b2b22;
      --attention-input-border: #526d5c;
      --attention-accent: #7bd5ad;
      --attention-accent-hover: #98e3bd;
      --attention-on-accent: #0d2b20;
      --attention-focus: #7bd5ad;
      --attention-warning: #e8c28a;
      --attention-warning-border: #b99150;
      --attention-error: #ffb4ad;
      --attention-shadow: rgba(0,0,0,.4);
    }
  }
`;
