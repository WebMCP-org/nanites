// Hidden unless explicitly enabled: every surface that wants the wizard
// (deploy-button template, production) sets the var to "true" in its wrangler
// config, so an unset flag means a context that never opted in (local dev).
export function shouldShowSetup(env: Pick<Env, "NANITES_SHOW_SETUP">): boolean {
  return env.NANITES_SHOW_SETUP === "true";
}
