/** Worker bindings. Secrets come from `wrangler secret put` / .dev.vars; vars from wrangler.jsonc. */
export type Env = {
  // secrets
  MONGODB_URI: string
  BETTER_AUTH_SECRET: string
  SENDGRID_API_KEY?: string
  // vars
  APP_NAME: string
  EMAIL_FROM: string
  TERMS_VERSION: string
  LAUNCH_STATE: string
  BETTER_AUTH_URL?: string
  OTP_DEBUG_LOG?: string
  /** '1' serves /docs and /openapi.json; anything else → 404. Off in wrangler.jsonc, on in .dev.vars. */
  DOCS_ENABLED?: string
}
