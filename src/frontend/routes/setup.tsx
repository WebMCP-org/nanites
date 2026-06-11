import "./setup.css";
import { useState, type ReactNode } from "react";
import { useAgent } from "agents/react";
import { createFileRoute } from "@tanstack/react-router";
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
import { NANITES_SETUP_AGENT_INSTANCE_NAME, NANITES_SETUP_AGENT_NAME } from "#/nanites.ts";
import { AUTH_RETURN_TO_PARAM, GITHUB_OAUTH_LOGIN_PATH } from "#/auth.ts";
import type {
  NanitesSetupAgent,
  NanitesSetupAgentState,
  StartGitHubManifestOutput,
  SetupStep as SetupStepId,
} from "#/backend/agents/NanitesSetupAgent.ts";

const SETUP_OWNER_TOKEN_STORAGE_KEY = "nanites.setupOwnerToken";
const SETUP_STEP_COUNT = 5;

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});

type SetupStepIndicatorState = "active" | "working" | "fail" | "done";

const NANITE_VARIANT_FOR_STATE: Record<SetupStepIndicatorState, NaniteSceneVariant> = {
  active: "helmet",
  working: "working",
  fail: "concerned",
  done: "celebrating",
};

function activeStepIndex(step: NanitesSetupAgentState["currentStep"]): number {
  if (step === "deploy" || step === "cloudflare") return 0;
  if (step === "github-app") return 1;
  if (step === "repositories") return 2;
  if (step === "upstream-star") return 3;
  return 4;
}

function cloudflareButtonLabel(status: NanitesSetupAgentState["cloudflare"]): string {
  if (status.status === "verified" && status.readiness.status === "blocked") {
    return status.readiness.items.some(
      (item) => item.status === "blocked" && item.action === "reconnect",
    )
      ? "Reconnect Cloudflare"
      : "Check again";
  }
  if (status.status === "verified" && status.readiness.status === "ready") {
    return "Reconnect Cloudflare";
  }
  return status.status === "failed" ? "Retry Cloudflare" : "Connect Cloudflare";
}

function postGitHubManifest(result: StartGitHubManifestOutput): void {
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

function setupStepForViewIndex(value: number): SetupStepId | null {
  if (value === 0) return "cloudflare";
  if (value === 1) return "github-app";
  if (value === 2) return "repositories";
  if (value === 3) return "upstream-star";
  if (value === 4) return "launch";
  return null;
}

function buildGitHubLoginUrl(returnTo = "/nanites"): string {
  const loginUrl = new URL(GITHUB_OAUTH_LOGIN_PATH, window.location.href);
  loginUrl.searchParams.set(AUTH_RETURN_TO_PARAM, returnTo);
  return loginUrl.toString();
}

function readSetupOwnerToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(SETUP_OWNER_TOKEN_STORAGE_KEY);
}

function writeSetupOwnerToken(setupOwnerToken: string): void {
  window.localStorage.setItem(SETUP_OWNER_TOKEN_STORAGE_KEY, setupOwnerToken);
}

function clearSetupOwnerToken(): void {
  window.localStorage.removeItem(SETUP_OWNER_TOKEN_STORAGE_KEY);
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

function SetupPage() {
  const setupAgent = useAgent<NanitesSetupAgent, NanitesSetupAgentState>({
    agent: NANITES_SETUP_AGENT_NAME,
    name: NANITES_SETUP_AGENT_INSTANCE_NAME,
  });
  const [ownerType, setOwnerType] = useState<"user" | "organization">("user");
  const [ownerLogin, setOwnerLogin] = useState("");
  const [setupOwnerToken, setSetupOwnerToken] = useState(readSetupOwnerToken);
  const [cloudflareActionError, setCloudflareActionError] = useState<string | null>(null);
  const [starActionRunning, setStarActionRunning] = useState(false);
  const [starActionError, setStarActionError] = useState<string | null>(null);
  const status = setupAgent.state;
  const setupConnectionReady = Boolean(setupAgent.stub);
  const localSetupOrigin = isLocalSetupOrigin();
  const agentStepIndex = status
    ? activeStepIndex(status.currentStepOverride?.baseStep ?? status.currentStep)
    : 0;

  if (!status) {
    return (
      <SetupFrame progressIndex={0} viewIndex={0} indicatorState="working">
        <h2 className="setup-step__title">Connect a Cloudflare account to this Worker project</h2>
        <StepStatus runningLabel="Connecting to Nanites setup…" errors={[]} />
      </SetupFrame>
    );
  }

  const viewedStepIndex = activeStepIndex(status.currentStep);
  const viewingCompletedStep = viewedStepIndex < agentStepIndex;
  const trimmedOwnerLogin = ownerLogin.trim();
  const githubAppComplete = status.githubApp.status === "complete";
  const githubAppFinishing =
    status.githubApp.status === "secrets-writing" ||
    status.githubApp.status === "secrets-propagating";
  const githubAppCanCreate =
    status.githubApp.status === "ready" ||
    status.githubApp.status === "creating" ||
    status.githubApp.status === "secrets-propagation-stalled" ||
    status.githubApp.status === "failed";
  const githubOwnerReady = ownerType === "user" || trimmedOwnerLogin.length > 0;
  const githubManifestCanStart = setupConnectionReady && githubAppCanCreate && githubOwnerReady;
  const cloudflareVerified = status.cloudflare.status === "verified";
  const setupComplete = status.setupComplete;
  const repositoriesComplete = status.repositories.status === "complete";
  const cloudflareRunning =
    status.cloudflare.status === "connecting" ||
    status.cloudflare.status === "authenticating" ||
    status.cloudflare.status === "verifying" ||
    status.cloudflare.readiness.status === "checking";
  // Reconnecting must stay available even when Cloudflare reports ready: the
  // setup claim cookie is only issued by the OAuth callback, so a browser that
  // lost (or never received) it needs this round-trip to recover.
  const cloudflareCanConnect = setupConnectionReady && !cloudflareRunning;
  const globalErrors = status.error ? [status.error.message] : [];

  function showSetupStep(value: number): void {
    const step = setupStepForViewIndex(value);
    if (!step || !setupAgent.stub) {
      return;
    }

    void setupAgent.stub.showSetupStep({ step }).catch(() => undefined);
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

  async function connectCloudflareForSetup(): Promise<void> {
    if (!setupAgent.stub) {
      return;
    }

    setCloudflareActionError(null);
    let ownerToken = setupOwnerToken;
    if (!ownerToken) {
      const ownerClaim = await setupAgent.stub.claimSetupOwner();
      if (!ownerClaim.claimed || !ownerClaim.setupOwnerToken) {
        setCloudflareActionError("Setup is already in progress in another browser.");
        return;
      }

      ownerToken = ownerClaim.setupOwnerToken;
      writeSetupOwnerToken(ownerToken);
      setSetupOwnerToken(ownerToken);
    }

    const result = await setupAgent.stub.connectCloudflare({
      setupOwnerToken: ownerToken,
      forceReconnect: true,
    });
    if (result.setupOwnerClaimRequired) {
      clearSetupOwnerToken();
      setSetupOwnerToken(null);
      setCloudflareActionError("Setup is already in progress in another browser.");
      return;
    }
    if (result.authorizationUrl) {
      window.location.href = result.authorizationUrl;
    }
  }

  let stepContent: ReactNode;
  let primaryAction: ReactNode = null;
  let stepWorking = false;
  let stepErrors: readonly string[] = [];

  if (viewedStepIndex === 0) {
    stepWorking = cloudflareRunning;
    const blockedDetails = status.cloudflare.readiness.items
      .filter((item) => item.status === "blocked")
      .map((item) => item.detail);
    stepErrors = [
      ...(cloudflareActionError ? [cloudflareActionError] : []),
      ...blockedDetails,
      ...(localSetupOrigin && !cloudflareVerified
        ? [
            "Local dev runs on localhost, so Cloudflare cannot confirm ownership of this Worker. Use the local .dev.vars setup path, or retry from a deployed Worker URL.",
          ]
        : []),
      ...globalErrors,
    ];

    primaryAction = (
      <Button
        color="primary"
        disabled={!cloudflareCanConnect}
        onClick={() => {
          void connectCloudflareForSetup().catch(() => {
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
          Cloudflare bills your account directly. Default Kimi K2.6 runs through Workers AI, so no
          external API provider key is required.
        </p>
        <StepStatus
          runningLabel={cloudflareRunning ? "Verifying…" : undefined}
          errors={stepErrors}
        />
      </>
    );
  } else if (viewedStepIndex === 1) {
    stepWorking = githubAppFinishing || status.githubApp.status === "creating";
    stepErrors = globalErrors;
    if (!githubAppFinishing) {
      primaryAction = (
        <Button
          color="primary"
          disabled={!githubManifestCanStart}
          onClick={() => {
            void setupAgent.stub
              ?.startGitHubManifest({
                ownerType,
                ownerLogin: ownerType === "organization" ? trimmedOwnerLogin : null,
              })
              .then(postGitHubManifest)
              .catch(() => undefined);
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
        <p className="setup-step__note">Nanites will use an app owned by this deployment.</p>
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
    stepErrors = globalErrors;
    primaryAction = (
      <Button
        color="primary"
        disabled={!status.githubApp.installUrl || !githubAppComplete}
        onClick={() => {
          if (status.githubApp.installUrl && githubAppComplete) {
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
        <p className="setup-step__note">Install the app wherever Nanites can maintain code.</p>
        <StepStatus errors={stepErrors} />
      </>
    );
  } else if (viewedStepIndex === 3) {
    stepWorking = starActionRunning;
    stepErrors = [
      ...(status.upstreamStar.error ? [status.upstreamStar.error] : []),
      ...(starActionError ? [starActionError] : []),
      ...globalErrors,
    ];

    primaryAction = (
      <Button
        color="primary"
        disabled={!repositoriesComplete || starActionRunning}
        onClick={() => {
          void runUpstreamStarAction("PUT");
        }}
      >
        <StarIcon weight="fill" />
        <span>Star WebMCP-org/nanites</span>
      </Button>
    );
    stepContent = (
      <>
        <h2 className="setup-step__title">Star the upstream Nanites repo</h2>
        <p className="setup-step__note">
          Starring is required before launch and helps other self-hosters find the project.
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
    stepErrors = globalErrors;
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
        <h2 className="setup-step__title">Sign in and create your first maintainer</h2>
        <p className="setup-step__note">Setup is complete. Nanites is ready to launch.</p>
        <StepStatus errors={stepErrors} />
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
      progressIndex={agentStepIndex}
      viewIndex={viewedStepIndex}
      indicatorState={indicatorState}
      canGoBack={viewedStepIndex > 0 && !status.currentStepOverride}
      canGoForward={viewedStepIndex < agentStepIndex}
      onGoBack={() => {
        showSetupStep(Math.max(viewedStepIndex - 1, 0));
      }}
      onGoForward={() => {
        showSetupStep(Math.min(viewedStepIndex + 1, agentStepIndex));
      }}
      primaryAction={viewingCompletedStep && viewedStepIndex !== 0 ? null : primaryAction}
    >
      {stepContent}
    </SetupFrame>
  );
}
