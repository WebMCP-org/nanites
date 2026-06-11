export function shouldShowSetup(env: Pick<Env, "NANITES_SHOW_SETUP">): boolean {
  return env.NANITES_SHOW_SETUP !== "false";
}
