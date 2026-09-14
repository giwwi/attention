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

/** Recommendation colors belong to the large card, independently of passage panels. */
export const CARD_VERDICT_THEME_CSS = `
  .card.expanded[data-verdict="read"] {
    --attention-bg: #f1f8f3;
    --attention-border: #9ab8a6;
  }
  .card.expanded[data-verdict="maybe"], .card.expanded:not([data-verdict]) {
    --attention-bg: #f6f7f9;
    --attention-fg: #272b33;
    --attention-muted: #626974;
    --attention-secondary: #4c535e;
    --attention-border: #b4bac4;
    --attention-border-hover: #838c9b;
    --attention-control-bg: #fff;
    --attention-control-hover: #e8ebef;
    --attention-inset-bg: #e9ecf0;
    --attention-input-border: #b4bac4;
    --attention-accent: #535c69;
    --attention-accent-hover: #434c59;
    --attention-on-accent: #fff;
    --attention-focus: #535c69;
    --attention-shadow: rgba(27,32,41,.18);
  }
  .card.expanded[data-verdict="skip"] {
    --attention-bg: #fff3f2;
    --attention-fg: #512b31;
    --attention-muted: #79575d;
    --attention-secondary: #684149;
    --attention-border: #d5a3a8;
    --attention-border-hover: #b87781;
    --attention-control-bg: #fffafa;
    --attention-control-hover: #f6e1e3;
    --attention-inset-bg: #f7e6e7;
    --attention-input-border: #d5a3a8;
    --attention-accent: #923f4e;
    --attention-accent-hover: #7d303e;
    --attention-on-accent: #fff;
    --attention-focus: #923f4e;
    --attention-shadow: rgba(63,25,32,.18);
  }
  @media (prefers-color-scheme: dark) {
    .card.expanded[data-verdict="read"] {
      --attention-bg: #15221b;
      --attention-border: #5b856c;
    }
    .card.expanded[data-verdict="maybe"], .card.expanded:not([data-verdict]) {
      --attention-bg: #22252b;
      --attention-fg: #eef0f4;
      --attention-muted: #b0b7c3;
      --attention-secondary: #ced3dd;
      --attention-border: #666f7f;
      --attention-border-hover: #8994a7;
      --attention-control-bg: #2b3038;
      --attention-control-hover: #383f4a;
      --attention-inset-bg: #2b3038;
      --attention-input-border: #747f91;
      --attention-accent: #bcc4d1;
      --attention-accent-hover: #d2d8e2;
      --attention-on-accent: #232831;
      --attention-focus: #bcc4d1;
      --attention-shadow: rgba(0,0,0,.4);
    }
    .card.expanded[data-verdict="skip"] {
      --attention-bg: #2c1d21;
      --attention-fg: #f8e8eb;
      --attention-muted: #d1aeb5;
      --attention-secondary: #e2c2c8;
      --attention-border: #925761;
      --attention-border-hover: #b97782;
      --attention-control-bg: #39262c;
      --attention-control-hover: #4a3039;
      --attention-inset-bg: #39262c;
      --attention-input-border: #a16873;
      --attention-accent: #eaa8b3;
      --attention-accent-hover: #f4bfc7;
      --attention-on-accent: #391a23;
      --attention-focus: #eaa8b3;
      --attention-shadow: rgba(0,0,0,.4);
    }
  }
`;
