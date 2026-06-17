import "./setup.css";
import { useState, type ReactNode } from "react";
import { useAgent } from "agents/react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { parseResponse } from "hono/client";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  GithubLogoIcon,
  LockKeyIcon,
  RocketLaunchIcon,
  StarIcon,
} from "@phosphor-icons/react";
import { Button } from "#/frontend/ui/components/Button.tsx";
import { NaniteScene, type NaniteSceneVariant } from "#/frontend/ui/components/NaniteScene.tsx";
import { AgentConnectionPanel } from "#/frontend/ui/components/AgentConnection.tsx";
import { httpClient } from "#/frontend/lib/http-client.ts";
import { NANITES_SETUP_AGENT_INSTANCE_NAME, NANITES_SETUP_AGENT_NAME } from "#/nanites.ts";
import { AUTH_RETURN_TO_PARAM, GITHUB_OAUTH_LOGIN_PATH } from "#/auth.ts";
import type {
  GitHubAppManifest,
  NanitesSetupAgent,
  NanitesSetupState,
  SetupStep,
} from "#/backend/agents/NanitesSetupAgent.ts";

const SETUP_STEP_COUNT = 5;
const GITHUB_APP_BADGE_ASSET_PATH = "/assets/nanite-github-app-badge.png";

export const Route = createFileRoute("/setup")({
  loader: async () => {
    const setupStatus = await parseResponse(httpClient.api.setup.status.$get());
    if (!setupStatus.showSetup) {
      throw redirect({ to: "/" });
    }

    return { setupStatus };
  },
  component: SetupPage,
});

type SetupStepIndicatorState = "active" | "working" | "fail" | "done";

const NANITE_VARIANT_FOR_STATE: Record<SetupStepIndicatorState, NaniteSceneVariant> = {
  active: "helmet",
  working: "working",
  fail: "concerned",
  done: "celebrating",
};

/** Index of the wizard screen the agent's state machine is on. */
function agentStepIndex(step: SetupStep): number {
  switch (step) {
    case "cloudflare":
      return 0;
    case "github-app":
      return 1;
    case "repositories":
      return 2;
    case "launch":
      return 4;
  }
}

function cloudflareButtonLabel(cloudflare: NanitesSetupState["cloudflare"]): string {
  if (cloudflare.status === "verified" && cloudflare.readiness.status === "blocked") {
    return cloudflare.readiness.items.some(
      (item) => item.status === "blocked" && item.action === "reconnect",
    )
      ? "Reconnect Cloudflare"
      : "Check again";
  }
  if (cloudflare.status === "verified") {
    return "Reconnect Cloudflare";
  }
  if (cloudflare.status === "authenticating") {
    return "Restart connection";
  }
  return cloudflare.status === "failed" ? "Retry Cloudflare" : "Connect Cloudflare";
}

function postGitHubManifest(result: {
  readonly action: string;
  readonly manifest: GitHubAppManifest;
  readonly state: string;
}): void {
  const form = document.createElement("form");
  form.method = "post";
  form.action = result.action;
  form.hidden = true;

  const manifestInput = document.createElement("input");
  manifestInput.type = "hidden";
  manifestInput.name = "manifest";
  manifestInput.value = JSON.stringify(result.manifest);
  form.appendChild(manifestInput);

  const stateInput = document.createElement("input");
  stateInput.type = "hidden";
  stateInput.name = "state";
  stateInput.value = result.state;
  form.appendChild(stateInput);

  document.body.appendChild(form);
  form.submit();
  form.remove();
}

function indicatorDescription(state: SetupStepIndicatorState): string {
  if (state === "done") return "complete";
  if (state === "working") return "in progress";
  if (state === "fail") return "needs attention";
  return "ready";
}

function SetupFrame({
  progressIndex,
  viewIndex,
  indicatorState,
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  primaryAction,
  children,
}: {
  readonly progressIndex: number;
  readonly viewIndex: number;
  readonly indicatorState: SetupStepIndicatorState;
  readonly canGoBack?: boolean;
  readonly canGoForward?: boolean;
  readonly onGoBack?: () => void;
  readonly onGoForward?: () => void;
  readonly primaryAction?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <main className="setup-screen">
      <section className="setup-frame" aria-labelledby="setup-title">
        {(["tl", "tr", "bl", "br"] as const).map((corner) => (
          <span
            aria-hidden="true"
            className="setup-frame__corner"
            data-corner={corner}
            key={corner}
          />
        ))}
        <div className="setup-frame__body">
          <div className="setup-frame__content">
            <h1 id="setup-title">SigVelo Nanites Installer</h1>
            {children}
          </div>
          <div className="setup-frame__scene">
            <NaniteScene
              mode="solo"
              title="Nanite status"
              variant={NANITE_VARIANT_FOR_STATE[indicatorState]}
            />
          </div>
        </div>
        <footer className="setup-frame__footer">
          <div
            className="setup-progress"
            aria-label={`Step ${viewIndex + 1} of ${SETUP_STEP_COUNT}, ${indicatorDescription(indicatorState)}`}
          >
            {Array.from({ length: SETUP_STEP_COUNT }, (_, index) => (
              <span
                className="setup-progress__seg"
                data-state={
                  index < progressIndex ? "done" : index === progressIndex ? "active" : "upcoming"
                }
                key={index}
              />
            ))}
            <span className="setup-progress__label">
              Step {viewIndex + 1}/{SETUP_STEP_COUNT}
            </span>
            <span
              aria-hidden="true"
              className="setup-progress__state"
              data-state={indicatorState}
            />
          </div>
          <div className="setup-frame__nav">
            <div className="setup-frame__nav-steps">
              <Button
                aria-label="Go back a step"
                color="neutral"
                variant="ghost"
                size="sm"
                disabled={!canGoBack}
                onClick={onGoBack}
              >
                <ArrowLeftIcon size={16} />
                <span>Back</span>
              </Button>
              <Button
                aria-label="Go forward a completed step"
                color="neutral"
                variant="ghost"
                size="sm"
                disabled={!canGoForward}
                onClick={onGoForward}
              >
                <span>Forward</span>
                <ArrowRightIcon size={16} />
              </Button>
            </div>
            {primaryAction ? <div className="setup-frame__nav-action">{primaryAction}</div> : null}
          </div>
        </footer>
      </section>
    </main>
  );
}

function StepStatus({
  runningLabel,
  errors,
}: {
  readonly runningLabel?: string;
  readonly errors: readonly string[];
}) {
  return (
    <output aria-live="polite" className="setup-status">
      {runningLabel ? <p className="setup-status__line">{runningLabel}</p> : null}
      {errors.map((error) => (
        <p className="setup-status__line setup-status__line--error" key={error}>
          {error}
        </p>
      ))}
    </output>
  );
}

function buildGitHubLoginUrl(returnTo = "/nanites"): string {
  const loginUrl = new URL(GITHUB_OAUTH_LOGIN_PATH, window.location.href);
  loginUrl.searchParams.set(AUTH_RETURN_TO_PARAM, returnTo);
  return loginUrl.toString();
}

function isLocalSetupOrigin(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const hostname = window.location.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

async function postSetupAction<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(`Setup action failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

function SetupPage() {
  const setupAgent = useAgent<NanitesSetupAgent, NanitesSetupState>({
    agent: NANITES_SETUP_AGENT_NAME,
    name: NANITES_SETUP_AGENT_INSTANCE_NAME,
  });
  const status = setupAgent.state;
  const [viewOverride, setViewOverride] = useState<number | null>(null);
  const [ownerType, setOwnerType] = useState<"user" | "organization">("user");
  const [ownerLogin, setOwnerLogin] = useState("");
  const [cloudflareActionError, setCloudflareActionError] = useState<string | null>(null);
  const [cloudflareActionPending, setCloudflareActionPending] = useState(false);
  const [githubActionError, setGithubActionError] = useState<string | null>(null);
  const [starActionRunning, setStarActionRunning] = useState(false);
  const [starActionError, setStarActionError] = useState<string | null>(null);
  const localSetupOrigin = isLocalSetupOrigin();

  if (!status) {
    return (
      <SetupFrame progressIndex={0} viewIndex={0} indicatorState="working">
        <h2 className="setup-step__title">Connect a Cloudflare account to this Worker project</h2>
        <StepStatus runningLabel="Connecting to Nanites setup…" errors={[]} />
      </SetupFrame>
    );
  }

  const progressIndex = agentStepIndex(status.currentStep);
  const viewedStepIndex =
    viewOverride === null ? progressIndex : Math.min(viewOverride, progressIndex);
  const viewingCompletedStep = viewedStepIndex < progressIndex;
  const trimmedOwnerLogin = ownerLogin.trim();
  const cloudflareVerified = status.cloudflare.status === "verified";
  // "authenticating" waits on the user finishing Cloudflare's consent screen —
  // unbounded, and the consent tab can be lost — so the connect button stays
  // enabled as the restart path (connectCloudflare tears down and starts
  // over). "verifying" is server-side work whose every step carries a timeout,
  // so disabling for it cannot stick.
  const cloudflareAwaitingAuthorization = status.cloudflare.status === "authenticating";
  const cloudflareVerifying = status.cloudflare.status === "verifying";
  const githubAppFinishing =
    status.githubApp.status === "writing-secrets" || status.githubApp.status === "propagating";
  const githubAppCanCreate =
    status.githubApp.status === "ready" || status.githubApp.status === "stalled";
  const githubOwnerReady = ownerType === "user" || trimmedOwnerLogin.length > 0;
  const repositoriesComplete = status.repositories.status === "complete";
  const setupComplete = status.setupComplete;

  function showSetupStep(value: number): void {
    setViewOverride(value >= progressIndex ? null : Math.max(value, 0));
  }

  async function connectCloudflare(): Promise<void> {
    setCloudflareActionError(null);
    setCloudflareActionPending(true);
    try {
      const result = await postSetupAction<{
        state: NanitesSetupState;
        authorizationUrl: string | null;
      }>("/api/setup/cloudflare");
      if (result.authorizationUrl) {
        window.location.href = result.authorizationUrl;
      }
    } finally {
      setCloudflareActionPending(false);
    }
  }

  async function createGitHubApp(): Promise<void> {
    setGithubActionError(null);
    const result = await postSetupAction<{
      action: string;
      manifest: GitHubAppManifest;
      state: string;
    }>("/api/setup/github-app", {
      ownerType,
      ownerLogin: ownerType === "organization" ? trimmedOwnerLogin : null,
    });
    postGitHubManifest(result);
  }

  async function runUpstreamStarAction(method: "GET" | "PUT"): Promise<void> {
    setStarActionRunning(true);
    setStarActionError(null);
    try {
      const response = await fetch("/api/setup/upstream-star", {
        method,
        headers: { accept: "application/json" },
      });
      if (response.status === 401) {
        window.location.href = buildGitHubLoginUrl("/setup");
        return;
      }
      if (!response.ok) {
        setStarActionError("GitHub did not confirm the upstream star.");
      }
    } catch {
      setStarActionError("GitHub did not confirm the upstream star.");
    } finally {
      setStarActionRunning(false);
    }
  }

  let stepContent: ReactNode;
  let primaryAction: ReactNode = null;
  let stepWorking = false;
  let stepErrors: readonly string[] = [];

  if (viewedStepIndex === 0) {
    stepWorking = cloudflareActionPending || cloudflareVerifying || cloudflareAwaitingAuthorization;
    const blockedDetails = status.cloudflare.readiness.items
      .filter((item) => item.status === "blocked")
      .map((item) => item.detail);
    stepErrors = [
      ...(cloudflareActionError ? [cloudflareActionError] : []),
      ...(status.cloudflare.error && !blockedDetails.includes(status.cloudflare.error)
        ? [status.cloudflare.error]
        : []),
      ...blockedDetails,
      ...(localSetupOrigin && !cloudflareVerified
        ? [
            "Local dev runs on localhost, so Cloudflare cannot confirm ownership of this Worker. Use the local .dev.vars setup path, or retry from a deployed Worker URL.",
          ]
        : []),
    ];

    primaryAction = (
      <Button
        color="primary"
        disabled={cloudflareActionPending || cloudflareVerifying}
        onClick={() => {
          void connectCloudflare().catch(() => {
            setCloudflareActionError("Cloudflare setup did not start.");
          });
        }}
      >
        <LockKeyIcon weight="fill" />
        <span>{cloudflareButtonLabel(status.cloudflare)}</span>
      </Button>
    );
    stepContent = (
      <>
        <h2 className="setup-step__title">Connect a Cloudflare account to this Worker project</h2>
        <p className="setup-step__note">
          Cloudflare bills your account directly. The default model runs through Workers AI, so no
          external API provider key is required.
        </p>
        <StepStatus
          runningLabel={
            cloudflareActionPending
              ? "Contacting Cloudflare…"
              : cloudflareVerifying
                ? "Verifying…"
                : cloudflareAwaitingAuthorization
                  ? "Waiting for Cloudflare authorization. If the authorization tab is gone or stuck, restart the connection."
                  : undefined
          }
          errors={stepErrors}
        />
      </>
    );
  } else if (viewedStepIndex === 1) {
    stepWorking = githubAppFinishing;
    stepErrors = [
      ...(githubActionError ? [githubActionError] : []),
      ...(status.githubApp.error ? [status.githubApp.error] : []),
      ...(status.githubApp.orphanedAppUrl
        ? [
            `GitHub created an app before setup failed. Delete the unused app at ${status.githubApp.orphanedAppUrl} before retrying if you do not want an orphaned Nanites app.`,
          ]
        : []),
      ...(status.githubApp.status === "stalled"
        ? [
            "Generated Worker secrets are taking longer than expected to propagate. Retry creating the GitHub App.",
          ]
        : []),
    ];
    if (!githubAppFinishing) {
      primaryAction = (
        <Button
          color="primary"
          disabled={!githubAppCanCreate || !githubOwnerReady}
          onClick={() => {
            void createGitHubApp().catch(() => {
              setGithubActionError(
                "GitHub App setup did not start. Reconnect Cloudflare and try again.",
              );
            });
          }}
        >
          <GithubLogoIcon weight="fill" />
          <span>Create App</span>
        </Button>
      );
    }
    stepContent = (
      <>
        <h2 className="setup-step__title">Create the GitHub App for this deployment</h2>
        <p className="setup-step__note">
          Nanites will use an app owned by this deployment. GitHub App manifests cannot set a badge,
          so after creation you can upload the{" "}
          <a href={GITHUB_APP_BADGE_ASSET_PATH} download>
            Nanites badge
          </a>{" "}
          in GitHub App settings under Display information.
        </p>
        {githubAppFinishing ? null : (
          <div className="setup-step__actions">
            <div className="setup-owner-toggle" role="radiogroup" aria-label="GitHub App owner">
              <label>
                <input
                  checked={ownerType === "user"}
                  aria-label="Personal account"
                  name="ownerType"
                  type="radio"
                  value="user"
                  onChange={() => {
                    setOwnerType("user");
                  }}
                />
                <span>Personal</span>
              </label>
              <label>
                <input
                  checked={ownerType === "organization"}
                  aria-label="Organization account"
                  name="ownerType"
                  type="radio"
                  value="organization"
                  onChange={() => {
                    setOwnerType("organization");
                  }}
                />
                <span>Organization</span>
              </label>
            </div>
            {ownerType === "organization" ? (
              <input
                className="setup-owner-input"
                aria-label="GitHub organization"
                value={ownerLogin}
                placeholder="organization"
                type="text"
                onChange={(event) => {
                  setOwnerLogin(event.target.value);
                }}
              />
            ) : null}
          </div>
        )}
        <StepStatus
          runningLabel={githubAppFinishing ? "Finishing setup…" : undefined}
          errors={stepErrors}
        />
      </>
    );
  } else if (viewedStepIndex === 2) {
    stepErrors = status.repositories.error ? [status.repositories.error] : [];
    primaryAction = (
      <Button
        color="primary"
        disabled={!status.githubApp.installUrl || status.githubApp.status !== "complete"}
        onClick={() => {
          if (status.githubApp.installUrl && status.githubApp.status === "complete") {
            window.location.href = status.githubApp.installUrl;
          }
        }}
      >
        <GithubLogoIcon weight="fill" />
        <span>Pick Repos</span>
      </Button>
    );
    stepContent = (
      <>
        <h2 className="setup-step__title">Pick repositories for Nanites to maintain</h2>
        <p className="setup-step__note">
          Install {status.githubApp.slug ?? "the deployment GitHub App"} wherever Nanites can
          maintain code. GitHub will only show installations visible to the signed-in user.
        </p>
        <StepStatus errors={stepErrors} />
      </>
    );
  } else if (viewedStepIndex === 3) {
    stepWorking = starActionRunning;
    stepErrors = [
      ...(status.upstreamStar.error ? [status.upstreamStar.error] : []),
      ...(starActionError ? [starActionError] : []),
    ];

    primaryAction = (
      <Button
        color="primary"
        disabled={!repositoriesComplete || starActionRunning || status.upstreamStar.starred}
        onClick={() => {
          void runUpstreamStarAction("PUT");
        }}
      >
        <StarIcon weight="fill" />
        <span>{status.upstreamStar.starred ? "Starred" : "Star WebMCP-org/nanites"}</span>
      </Button>
    );
    stepContent = (
      <>
        <h2 className="setup-step__title">Star the upstream Nanites repo</h2>
        <p className="setup-step__note">
          Starring is optional, and it helps other self-hosters find the project.
        </p>
        <div className="setup-step__actions">
          <Button
            color="neutral"
            variant="outline"
            disabled={!repositoriesComplete || starActionRunning}
            onClick={() => {
              void runUpstreamStarAction("GET");
            }}
          >
            <GithubLogoIcon weight="fill" />
            <span>I already starred it</span>
          </Button>
        </div>
        <StepStatus
          runningLabel={starActionRunning ? "Checking with GitHub…" : undefined}
          errors={stepErrors}
        />
      </>
    );
  } else {
    primaryAction = (
      <Button
        color="primary"
        disabled={!setupComplete}
        onClick={() => {
          window.location.href = buildGitHubLoginUrl();
        }}
      >
        <RocketLaunchIcon weight="fill" />
        <span>Start Nanites</span>
      </Button>
    );
    stepContent = (
      <>
        <h2 className="setup-step__title">Connect your agent and launch Nanites</h2>
        <p className="setup-step__note">
          Setup is complete. Install the agent-facing pieces, then start Nanites.
        </p>
        <AgentConnectionPanel className="setup-agent-connect" />
        <StepStatus errors={[]} />
      </>
    );
  }

  const indicatorState: SetupStepIndicatorState =
    viewingCompletedStep || (viewedStepIndex === SETUP_STEP_COUNT - 1 && setupComplete)
      ? "done"
      : stepErrors.length > 0
        ? "fail"
        : stepWorking
          ? "working"
          : "active";

  return (
    <SetupFrame
      progressIndex={progressIndex}
      viewIndex={viewedStepIndex}
      indicatorState={indicatorState}
      canGoBack={viewedStepIndex > 0}
      canGoForward={viewedStepIndex < progressIndex}
      onGoBack={() => {
        showSetupStep(viewedStepIndex - 1);
      }}
      onGoForward={() => {
        showSetupStep(viewedStepIndex + 1);
      }}
      primaryAction={
        // Step 0 (Cloudflare reconnect) and step 3 (the optional upstream
        // star) stay actionable when revisited after setup moves past them.
        viewingCompletedStep && viewedStepIndex !== 0 && viewedStepIndex !== 3
          ? null
          : primaryAction
      }
    >
      {stepContent}
    </SetupFrame>
  );
}
