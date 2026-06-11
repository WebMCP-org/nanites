import "./setup.css";
import { useState, type ComponentProps, type ReactNode } from "react";
import { useAgent } from "agents/react";
import { createFileRoute } from "@tanstack/react-router";
import { GithubLogoIcon, LockKeyIcon, RocketLaunchIcon, StarIcon } from "@phosphor-icons/react";
import { Badge } from "#/frontend/ui/components/Badge.tsx";
import { Button } from "#/frontend/ui/components/Button.tsx";
import {
  Stepper,
  StepperContent,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperNav,
  StepperPanel,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from "#/frontend/ui/components/Stepper.tsx";
import { NANITES_SETUP_AGENT_INSTANCE_NAME, NANITES_SETUP_AGENT_NAME } from "#/nanites.ts";
import { AUTH_RETURN_TO_PARAM, GITHUB_OAUTH_LOGIN_PATH } from "#/auth.ts";
import type {
  CloudflareReadinessItemStatus,
  NanitesSetupAgent,
  NanitesSetupAgentState,
  StartGitHubManifestOutput,
} from "#/backend/agents/NanitesSetupAgent.ts";

const SETUP_OWNER_TOKEN_STORAGE_KEY = "nanites.setupOwnerToken";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});

type SetupStepState = "complete" | "ready" | "running" | "blocked" | "locked";
type SetupNaniteVariant = "helmet" | "working" | "celebrating";

function statusLabel(state: SetupStepState): string {
  if (state === "complete") return "Done";
  if (state === "ready") return "Ready";
  if (state === "running") return "Working";
  if (state === "blocked") return "Blocked";
  return "Locked";
}

function badgeColor(state: SetupStepState): ComponentProps<typeof Badge>["color"] {
  if (state === "complete") return "success";
  if (state === "ready" || state === "running") return "primary";
  if (state === "blocked") return "destructive";
  return "neutral";
}

function readinessBadgeColor(
  status: CloudflareReadinessItemStatus,
): ComponentProps<typeof Badge>["color"] {
  if (status === "ready") return "success";
  if (status === "blocked") return "destructive";
  if (status === "warning") return "warning";
  if (status === "checking") return "primary";
  return "neutral";
}

function readinessStatusLabel(status: CloudflareReadinessItemStatus): string {
  if (status === "ready") return "Ready";
  if (status === "blocked") return "Blocked";
  if (status === "warning") return "Note";
  if (status === "checking") return "Checking";
  return "Pending";
}

function cloudflareButtonLabel(status: NanitesSetupAgentState["cloudflare"]): string {
  if (status.status === "connecting" || status.status === "authenticating") {
    return "Restart Cloudflare";
  }
  if (status.status === "verifying" || status.readiness.status === "checking") {
    return "Restart Cloudflare";
  }
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

function SetupPanel({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="setup-panel">
      <div className="setup-panel__copy">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="setup-panel__action">{children}</div>
    </div>
  );
}

function SetupNaniteScene({ variant }: { readonly variant: SetupNaniteVariant }) {
  return (
    <div className="setup-nanite-scene" data-variant={variant} aria-hidden="true">
      <div className="setup-nanite-scene__screen">
        <span />
        <span />
        <span />
      </div>
      <div className="setup-nanite-scene__team">
        {[0, 1, 2].map((index) => (
          <div className="setup-nanite" data-index={index} key={index}>
            <span className="setup-nanite__hat" />
            <span className="setup-nanite__body">
              <span className="setup-nanite__eye setup-nanite__eye--left" />
              <span className="setup-nanite__eye setup-nanite__eye--right" />
              <span className="setup-nanite__tool" />
            </span>
            <span className="setup-nanite__shadow" />
          </div>
        ))}
      </div>
      <span className="setup-nanite-scene__sparkle setup-nanite-scene__sparkle--one" />
      <span className="setup-nanite-scene__sparkle setup-nanite-scene__sparkle--two" />
    </div>
  );
}

function CloudflareReadinessChecklist({
  readiness,
}: {
  readonly readiness: NanitesSetupAgentState["cloudflare"]["readiness"];
}) {
  return (
    <ul className="setup-readiness" aria-label="Cloudflare readiness">
      {readiness.items.map((item) => (
        <li className="setup-readiness__item" data-status={item.status} key={item.key}>
          <div className="setup-readiness__item-heading">
            <span>{item.label}</span>
            <Badge color={readinessBadgeColor(item.status)} size="sm" variant="outline">
              {readinessStatusLabel(item.status)}
            </Badge>
          </div>
          <p>{item.detail}</p>
          <span className="setup-readiness__scope">
            {item.severity === "required" ? "Required" : "Informational"}
          </span>
        </li>
      ))}
    </ul>
  );
}

type SetupStep = {
  readonly step: number;
  readonly state: SetupStepState;
  readonly title: string;
  readonly description: string;
};

function stepValueForCurrentStep(step: NanitesSetupAgentState["currentStep"]): number {
  if (step === "deploy") return 1;
  if (step === "cloudflare") return 2;
  if (step === "github-app") return 3;
  if (step === "repositories") return 4;
  if (step === "upstream-star") return 5;
  return 6;
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

  if (!status) {
    return (
      <main className="setup-screen">
        <section className="setup-hero" aria-labelledby="setup-title">
          <SetupNaniteScene variant="helmet" />
          <div className="setup-hero__copy">
            <p>Self-hosted setup</p>
            <h1 id="setup-title">Connecting to Nanites setup.</h1>
          </div>
        </section>
      </main>
    );
  }

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
  const cloudflareReady = cloudflareVerified && status.cloudflare.readiness.status === "ready";
  const setupComplete = status.setupComplete;
  const repositoriesComplete = status.repositories.status === "complete";
  const upstreamStarComplete = status.upstreamStar.status === "complete";
  const naniteVariant: SetupNaniteVariant = setupComplete
    ? "celebrating"
    : cloudflareVerified
      ? "working"
      : "helmet";
  const githubAppStepState: SetupStepState = githubAppComplete
    ? "complete"
    : githubAppFinishing
      ? "running"
      : cloudflareReady && githubAppCanCreate
        ? "ready"
        : "locked";
  const repositoryStepState: SetupStepState = repositoriesComplete
    ? "complete"
    : githubAppComplete
      ? "ready"
      : "locked";
  const upstreamStarStepState: SetupStepState = upstreamStarComplete
    ? "complete"
    : starActionRunning
      ? "running"
      : repositoriesComplete
        ? "ready"
        : "locked";
  const startStepState: SetupStepState = status.launch.status === "ready" ? "ready" : "locked";

  const cloudflareStepState: SetupStepState =
    status.cloudflare.status === "connecting" ||
    status.cloudflare.status === "authenticating" ||
    status.cloudflare.status === "verifying" ||
    status.cloudflare.readiness.status === "checking"
      ? "running"
      : cloudflareReady
        ? "complete"
        : cloudflareVerified && status.cloudflare.readiness.status === "blocked"
          ? "blocked"
          : "ready";
  const cloudflareCanConnect = setupConnectionReady;
  const activeStep = stepValueForCurrentStep(status.currentStep);

  const steps: readonly SetupStep[] = [
    {
      step: 1,
      state: "complete",
      title: "Deploy",
      description: "Worker is live.",
    },
    {
      step: 2,
      state: cloudflareStepState,
      title: "Cloudflare",
      description: cloudflareReady ? "Ready." : "Verify readiness.",
    },
    {
      step: 3,
      state: githubAppStepState,
      title: "GitHub App",
      description: githubAppComplete ? "Created." : "Create the app.",
    },
    {
      step: 4,
      state: repositoryStepState,
      title: "Repositories",
      description: "Pick access.",
    },
    {
      step: 5,
      state: upstreamStarStepState,
      title: "Star Nanites",
      description: upstreamStarComplete ? "Verified." : "Required.",
    },
    {
      step: 6,
      state: startStepState,
      title: "Launch",
      description: setupComplete ? "Ready." : "Almost there.",
    },
  ];

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

  return (
    <main className="setup-screen">
      <section className="setup-hero" aria-labelledby="setup-title">
        <SetupNaniteScene variant={naniteVariant} />
        <div className="setup-hero__copy">
          <p>Self-hosted setup</p>
          <h1 id="setup-title">Set up Nanites in a few clicks.</h1>
        </div>
      </section>

      <Stepper value={activeStep} orientation="vertical" className="setup-flow">
        <StepperNav aria-label="Setup steps" className="setup-flow__nav">
          {steps.map((step, index) => (
            <StepperItem
              key={step.step}
              step={step.step}
              completed={step.state === "complete"}
              disabled={step.state === "locked"}
              loading={step.state === "running"}
            >
              <StepperTrigger className="setup-flow__trigger" aria-label={step.title}>
                <StepperIndicator />
                <span className="setup-flow__text">
                  <StepperTitle>{step.title}</StepperTitle>
                  <StepperDescription>{step.description}</StepperDescription>
                </span>
                <Badge
                  color={badgeColor(step.state)}
                  size="sm"
                  variant={step.state === "locked" ? "outline" : "normal"}
                >
                  {statusLabel(step.state)}
                </Badge>
              </StepperTrigger>
              {index < steps.length - 1 ? <StepperSeparator /> : null}
            </StepperItem>
          ))}
        </StepperNav>

        <StepperPanel className="setup-flow__panel">
          <StepperContent value={1}>
            <SetupPanel title="Cloudflare deploy" description="Your self-hosted Worker is running.">
              <Badge color="success">Done</Badge>
            </SetupPanel>
          </StepperContent>
          <StepperContent value={2}>
            <SetupPanel
              title="Connect Cloudflare"
              description="Use the Cloudflare account that owns this Worker. Nanites checks billing and runtime readiness before creating the GitHub App."
            >
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
              {cloudflareActionError ? (
                <p className="setup-action-error">{cloudflareActionError}</p>
              ) : null}
              <p className="setup-action-note">
                Cloudflare bills your account directly. Default Kimi K2.6 runs through Workers AI,
                so no external provider API key is required.
              </p>
              <CloudflareReadinessChecklist readiness={status.cloudflare.readiness} />
              {localSetupOrigin && !cloudflareVerified ? (
                <p className="setup-action-note">
                  Local dev runs on localhost, so Cloudflare cannot confirm ownership of this
                  Worker. Use the local .dev.vars setup path, or retry from a deployed Cloudflare
                  Worker URL.
                </p>
              ) : null}
            </SetupPanel>
          </StepperContent>
          <StepperContent value={3}>
            <SetupPanel
              title="Create GitHub App"
              description={
                githubAppFinishing
                  ? "Finishing setup."
                  : "Nanites will use an app owned by this deployment."
              }
            >
              {githubAppFinishing ? (
                <Badge color="primary">Finishing</Badge>
              ) : (
                <div className="setup-github-form">
                  <div
                    className="setup-owner-toggle"
                    role="radiogroup"
                    aria-label="GitHub App owner"
                  >
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
                    <span>
                      {status.githubApp.status === "creating" ? "Creating" : "Create App"}
                    </span>
                  </Button>
                </div>
              )}
            </SetupPanel>
          </StepperContent>
          <StepperContent value={4}>
            <SetupPanel
              title="Pick repositories"
              description="Install the app wherever Nanites can maintain code."
            >
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
            </SetupPanel>
          </StepperContent>
          <StepperContent value={5}>
            <SetupPanel
              title="Star Nanites"
              description="Star the upstream repo before launching this self-hosted deployment. This helps other self-hosters find the project."
            >
              <div className="setup-star-actions">
                <Button
                  color="primary"
                  disabled={!repositoriesComplete || starActionRunning}
                  onClick={() => {
                    void runUpstreamStarAction("PUT");
                  }}
                >
                  <StarIcon weight="fill" />
                  <span>{starActionRunning ? "Checking" : "Star WebMCP-org/nanites"}</span>
                </Button>
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
              {status.upstreamStar.error || starActionError ? (
                <p className="setup-action-error">{status.upstreamStar.error ?? starActionError}</p>
              ) : null}
            </SetupPanel>
          </StepperContent>
          <StepperContent value={6}>
            <SetupPanel
              title="Start Nanites"
              description="Sign in and create your first maintainer."
            >
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
            </SetupPanel>
          </StepperContent>
          {status.error ? <p className="setup-action-error">{status.error.message}</p> : null}
        </StepperPanel>
      </Stepper>
    </main>
  );
}
