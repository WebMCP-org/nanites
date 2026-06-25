// The self-host template should show setup without a deploy-form variable.
// Local dev opts out with NANITES_SHOW_SETUP=false in .dev.vars.
export function shouldShowSetup(env: Pick<Env, "NANITES_SHOW_SETUP">): boolean {
  return env.NANITES_SHOW_SETUP !== "false";
}
