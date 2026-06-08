import "./settings.css";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { DetailedError, parseResponse } from "hono/client";
import type { InferRequestType, InferResponseType } from "hono/client";
import {
  ChartBarIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  GearSixIcon,
  KeyIcon,
  PlayIcon,
  SlidersHorizontalIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { httpClient } from "#/frontend/lib/http-client.ts";
import {
  AUTH_SESSION_QUERY_KEY,
  fetchOptionalSession,
  type BrowserNanitesContext,
  type SessionInstallationSnapshot,
} from "#/frontend/lib/auth.ts";
import { RoutePendingPage } from "#/frontend/lib/route-state.tsx";
import { Avatar } from "#/frontend/ui/components/Avatar.tsx";
import { Badge } from "#/frontend/ui/components/Badge.tsx";
import { Button } from "#/frontend/ui/components/Button.tsx";
import {
  ModelSelector,
  ModelSelectorBadge,
  ModelSelectorContent,
  ModelSelectorDescription,
  ModelSelectorDialog,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorItemContent,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorMeta,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "#/frontend/ui/components/ModelSelector.tsx";
import type {
  InstallationModelSettings,
  ModelSmokeTestResult,
  NanitesModelCatalogItem,
} from "#/backend/nanites/model-settings.ts";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsRoute,
  pendingComponent: RoutePendingPage,
});

const settingsModelQueryKey = (githubInstallationId: number | null) =>
  ["settings", "model", githubInstallationId] as const;

const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const emptyModels: readonly NanitesModelCatalogItem[] = [];

type ModelSettingsResponse = InferResponseType<typeof httpClient.api.settings.model.$get, 200>;
type SaveModelSettingsInput = InferRequestType<typeof httpClient.api.settings.model.$put>["json"];
type SaveModelSettingsResponse = InferResponseType<typeof httpClient.api.settings.model.$put, 200>;
type TestModelSettingsInput = InferRequestType<
  typeof httpClient.api.settings.model.test.$post
>["json"];
type TestModelSettingsResponse = InferResponseType<
  typeof httpClient.api.settings.model.test.$post,
  200
>;
type DraftModelSettings = {
  readonly modelId: string;
  readonly gatewayId: string;
  readonly byokAlias: string;
};
type ModelGroup = {
  readonly label: string;
  readonly models: readonly NanitesModelCatalogItem[];
};

async function fetchModelSettings(): Promise<ModelSettingsResponse> {
  return parseResponse(httpClient.api.settings.model.$get());
}

async function saveModelSettings(
  input: SaveModelSettingsInput,
): Promise<SaveModelSettingsResponse> {
  return parseResponse(httpClient.api.settings.model.$put({ json: input }));
}

async function testModelSettings(
  input: TestModelSettingsInput,
): Promise<TestModelSettingsResponse> {
  return parseResponse(httpClient.api.settings.model.test.$post({ json: input }));
}

function normalizedOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildPayload(draft: DraftModelSettings): SaveModelSettingsInput {
  return {
    modelId: draft.modelId,
    gatewayId: normalizedOptional(draft.gatewayId),
    byokAlias: normalizedOptional(draft.byokAlias),
  };
}

function readErrorData(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof DetailedError)) {
    return null;
  }

  const detail = error.detail;
  const data =
    typeof detail === "object" && detail !== null && "data" in detail
      ? (detail as { data?: unknown }).data
      : undefined;
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
}

function formatError(error: unknown): string {
  const data = readErrorData(error);
  if (typeof data?.reason === "string") {
    return data.reason;
  }
  if (typeof data?.code === "string") {
    return data.code.replaceAll("_", " ");
  }
  return error instanceof Error ? error.message : "Request failed.";
}

function avatarFallback(value: string | null | undefined): string {
  return (value ?? "?").slice(0, 2).toUpperCase();
}

function formatContextWindow(value: number | null): string {
  return value ? `${compactNumberFormatter.format(value)} tokens` : "Unknown";
}

function formatDate(value: string | null): string {
  return value ? dateFormatter.format(new Date(value)) : "Not tested";
}

function groupModels(models: readonly NanitesModelCatalogItem[]): readonly ModelGroup[] {
  const groups = new Map<string, NanitesModelCatalogItem[]>();
  for (const model of models) {
    const existing = groups.get(model.providerLabel);
    if (existing) {
      existing.push(model);
    } else {
      groups.set(model.providerLabel, [model]);
    }
  }

  return [...groups.entries()]
    .map(([label, groupModels]) => ({ label, models: groupModels }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function selectionMatchesDraft(
  settings: InstallationModelSettings | null,
  payload: SaveModelSettingsInput,
): boolean {
  if (!settings) {
    return false;
  }

  return (
    settings.modelId === payload.modelId &&
    settings.gatewayId === (payload.gatewayId ?? "default") &&
    settings.byokAlias === (payload.byokAlias ?? null)
  );
}

function savedSmokeTestResult(settings: InstallationModelSettings): ModelSmokeTestResult | null {
  if (!settings.lastTestStatus) {
    return null;
  }

  return {
    status: settings.lastTestStatus,
    message: settings.lastTestMessage ?? "",
    latencyMs: settings.lastTestLatencyMs ?? 0,
  };
}

function SettingsRoute() {
  const sessionQuery = useQuery({
    queryKey: AUTH_SESSION_QUERY_KEY,
    queryFn: fetchOptionalSession,
  });
  const session = sessionQuery.data ?? null;
  const activeInstallation = session?.activeInstallation ?? null;

  return (
    <main className="settings-shell">
      <SettingsHeader session={session} activeInstallation={activeInstallation} />
      {sessionQuery.isPending ? (
        <RoutePendingPage />
      ) : activeInstallation ? (
        <ModelSettingsPanel activeInstallation={activeInstallation} />
      ) : (
        <NoActiveInstallationPanel />
      )}
    </main>
  );
}

function SettingsHeader({
  session,
  activeInstallation,
}: {
  readonly session: BrowserNanitesContext | null;
  readonly activeInstallation: SessionInstallationSnapshot | null;
}) {
  return (
    <header className="settings-header">
      <div>
        <h1>Settings</h1>
        <nav aria-label="Authenticated app">
          <Link to="/nanites">Nanites</Link>
          <Link to="/observability">Observability</Link>
          <Link to="/settings" activeProps={{ "data-active": true }}>
            Settings
          </Link>
        </nav>
      </div>
      <div className="settings-header__meta">
        {activeInstallation ? <InstallationBadge installation={activeInstallation} /> : null}
        {session?.actor ? (
          <Badge variant="outline" color="neutral">
            {session.actor.login}
          </Badge>
        ) : null}
      </div>
    </header>
  );
}

function InstallationBadge({
  installation,
}: {
  readonly installation: SessionInstallationSnapshot;
}) {
  return (
    <span className="settings-installation">
      <Avatar.Root className="settings-installation__avatar">
        {installation.account.avatar_url ? (
          <Avatar.Image
            src={installation.account.avatar_url}
            alt={`${installation.account.login} avatar`}
          />
        ) : null}
        <Avatar.Fallback>{avatarFallback(installation.account.login)}</Avatar.Fallback>
      </Avatar.Root>
      <span>{installation.account.login}</span>
    </span>
  );
}

function NoActiveInstallationPanel() {
  return (
    <section className="settings-empty-panel">
      <div className="settings-panel__icon" aria-hidden="true">
        <GearSixIcon size={18} />
      </div>
      <div>
        <h2>No active installation</h2>
        <p>Select a GitHub installation before changing model settings.</p>
      </div>
      <Button render={<Link to="/nanites" />} nativeButton={false}>
        Open Nanites
      </Button>
    </section>
  );
}

function ModelSettingsPanel({
  activeInstallation,
}: {
  readonly activeInstallation: SessionInstallationSnapshot;
}) {
  const queryClient = useQueryClient();
  const queryKey = settingsModelQueryKey(activeInstallation.id);
  const settingsQuery = useQuery({
    queryKey,
    queryFn: fetchModelSettings,
  });
  const [draft, setDraft] = useState<DraftModelSettings>({
    modelId: "",
    gatewayId: "default",
    byokAlias: "",
  });
  const [localTestResult, setLocalTestResult] = useState<ModelSmokeTestResult | null>(null);
  const data = settingsQuery.data;
  const settings = data?.settings ?? null;
  const models = data?.catalog.models ?? emptyModels;
  const modelGroups = useMemo(() => groupModels(models), [models]);
  const selectedModel =
    models.find((model) => model.id === draft.modelId) ??
    (settings
      ? {
          id: settings.modelId,
          name: settings.modelName,
          provider: settings.provider,
          providerLabel: settings.providerLabel,
          source: "third-party",
          task: "Text Generation",
          description: "",
          capabilities: [],
          contextWindowTokens: null,
          deprecated: false,
        }
      : null);
  const payload = useMemo(() => buildPayload(draft), [draft]);
  const savedSelectionActive = selectionMatchesDraft(settings, payload);
  const isDirty = settings ? !savedSelectionActive : false;
  const savedTestResult = settings && savedSelectionActive ? savedSmokeTestResult(settings) : null;
  const visibleTestResult = localTestResult ?? savedTestResult;
  const testTimestamp = localTestResult ? "Just now" : formatDate(settings?.lastTestedAt ?? null);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setDraft({
      modelId: settings.modelId,
      gatewayId: settings.gatewayId,
      byokAlias: settings.byokAlias ?? "",
    });
  }, [settings?.byokAlias, settings?.gatewayId, settings?.modelId, settings]);

  useEffect(() => {
    setLocalTestResult(null);
  }, [draft.byokAlias, draft.gatewayId, draft.modelId]);

  const saveMutation = useMutation({
    mutationFn: saveModelSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const testMutation = useMutation({
    mutationFn: testModelSettings,
    onSuccess: async (response) => {
      setLocalTestResult(response.result);
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  const isPending = settingsQuery.isPending;
  const saveError = saveMutation.error ? formatError(saveMutation.error) : null;
  const testError = testMutation.error ? formatError(testMutation.error) : null;
  const smokeTestStatus = visibleTestResult?.status ?? "idle";

  return (
    <div className="settings-workspace">
      <aside className="settings-provider-rail" aria-label="Model provider">
        <div className="settings-provider-rail__header">
          <ModelSelectorLogo className="settings-provider-rail__logo" provider="cloudflare" />
          <div>
            <span className="settings-eyebrow">Provider</span>
            <h2>Cloudflare AI Gateway</h2>
          </div>
        </div>

        <div className="settings-provider-option" data-active="true">
          <span className="settings-provider-option__status" aria-hidden="true" />
          <div>
            <strong>Cloudflare</strong>
            <span>AI Gateway catalog</span>
          </div>
          <Badge variant="outline" color="neutral" size="sm">
            {models.length}
          </Badge>
        </div>

        <dl className="settings-rail-list">
          <div>
            <dt>Fetched</dt>
            <dd>{formatDate(data?.catalog.fetchedAt ?? null)}</dd>
          </div>
          <div>
            <dt>Installation</dt>
            <dd>{activeInstallation.account.login}</dd>
          </div>
          <div>
            <dt>Gateway</dt>
            <dd>{draft.gatewayId || "default"}</dd>
          </div>
        </dl>

        <div className="settings-rail-status" data-status={smokeTestStatus}>
          <span aria-hidden="true">
            {visibleTestResult?.status === "success" ? (
              <CheckCircleIcon size={16} />
            ) : (
              <WarningCircleIcon size={16} />
            )}
          </span>
          <div>
            <strong>{visibleTestResult ? visibleTestResult.status : "Not tested"}</strong>
            <small>
              {visibleTestResult ? `${testTimestamp} · ${visibleTestResult.latencyMs}ms` : "No run"}
            </small>
          </div>
        </div>

        <Button
          render={<Link to="/observability" />}
          nativeButton={false}
          variant="ghost"
          color="neutral"
          className="settings-provider-rail__link"
        >
          <ChartBarIcon size={16} aria-hidden="true" />
          <span>Observability</span>
        </Button>
      </aside>

      <form
        className="settings-config"
        onSubmit={(event) => {
          event.preventDefault();
          saveMutation.mutate(payload);
        }}
      >
        <div className="settings-config__header">
          <div>
            <span className="settings-eyebrow">Model</span>
            <h2>Nanite runtime</h2>
          </div>
          <Badge variant="outline" color={isDirty ? "warning" : "neutral"}>
            {isDirty ? "Unsaved" : settings?.source === "saved" ? "Saved" : "Default"}
          </Badge>
        </div>

        <section className="settings-selected-model" aria-label="Selected model">
          <ModelSelectorLogo
            className="settings-selected-model__logo"
            provider={selectedModel?.provider ?? "cloudflare"}
          />
          <div className="settings-selected-model__body">
            <div className="settings-selected-model__title">
              <div>
                <span className="settings-eyebrow">Selected model</span>
                <h3>{selectedModel?.name ?? "No model selected"}</h3>
              </div>
              {selectedModel ? (
                <Badge variant="outline" color="neutral">
                  {selectedModel.source === "third-party" ? "AI Gateway" : "Workers AI"}
                </Badge>
              ) : null}
            </div>
            {selectedModel ? (
              <>
                <span className="settings-model-id">{selectedModel.id}</span>
                <dl className="settings-model-stats">
                  <div>
                    <dt>Provider</dt>
                    <dd>{selectedModel.providerLabel}</dd>
                  </div>
                  <div>
                    <dt>Context</dt>
                    <dd>{formatContextWindow(selectedModel.contextWindowTokens)}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{selectedModel.source === "third-party" ? "Gateway" : "Workers AI"}</dd>
                  </div>
                </dl>
                {selectedModel.capabilities.length ? (
                  <div className="settings-badge-row" aria-label="Model capabilities">
                    {selectedModel.capabilities.slice(0, 6).map((capability) => (
                      <Badge key={capability} variant="outline" color="neutral" size="sm">
                        {capability}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </section>

        <div className="settings-config-grid">
          <div className="settings-field settings-field--model">
            <label htmlFor="settings-model-trigger">Provider model</label>
            <ModelSelector>
              <ModelSelectorTrigger
                id="settings-model-trigger"
                className="settings-model-trigger"
                disabled={isPending || models.length === 0}
              >
                {selectedModel ? (
                  <span className="settings-model-trigger__content">
                    <ModelSelectorLogo provider={selectedModel.provider} />
                    <span>
                      <strong>{selectedModel.name}</strong>
                      <small>{selectedModel.id}</small>
                    </span>
                  </span>
                ) : (
                  <span>Select model</span>
                )}
              </ModelSelectorTrigger>
              <ModelSelectorContent>
                <ModelSelectorDialog>
                  <ModelSelectorInput placeholder="Search Cloudflare catalog" />
                  <ModelSelectorList>
                    {modelGroups.map((group) => (
                      <ModelSelectorGroup key={group.label} label={group.label}>
                        {group.models.map((model) => (
                          <ModelSelectorItem
                            key={model.id}
                            value={model.id}
                            selected={model.id === draft.modelId}
                            keywords={`${model.name} ${model.id} ${model.providerLabel} ${model.capabilities.join(
                              " ",
                            )}`}
                            onSelect={() => {
                              setDraft((current) => ({ ...current, modelId: model.id }));
                            }}
                          >
                            <ModelSelectorLogo provider={model.provider} />
                            <ModelSelectorItemContent>
                              <ModelSelectorName>{model.name}</ModelSelectorName>
                              {model.description ? (
                                <ModelSelectorDescription>
                                  {model.description}
                                </ModelSelectorDescription>
                              ) : null}
                              <ModelSelectorMeta>
                                <span>{model.id}</span>
                                <ModelSelectorBadge>
                                  {model.source === "third-party" ? "Gateway" : "Workers AI"}
                                </ModelSelectorBadge>
                              </ModelSelectorMeta>
                            </ModelSelectorItemContent>
                          </ModelSelectorItem>
                        ))}
                      </ModelSelectorGroup>
                    ))}
                    <ModelSelectorEmpty>No matching models</ModelSelectorEmpty>
                  </ModelSelectorList>
                </ModelSelectorDialog>
              </ModelSelectorContent>
            </ModelSelector>
          </div>

          <label className="settings-field" htmlFor="settings-gateway-id">
            <span>Gateway id</span>
            <input
              id="settings-gateway-id"
              type="text"
              value={draft.gatewayId}
              aria-label="Gateway id"
              onChange={(event) => {
                setDraft((current) => ({ ...current, gatewayId: event.target.value }));
              }}
              placeholder="default"
              autoComplete="off"
            />
          </label>
          <label className="settings-field" htmlFor="settings-byok-alias">
            <span>BYOK alias</span>
            <span className="settings-field__control">
              <KeyIcon size={14} aria-hidden="true" />
              <input
                id="settings-byok-alias"
                type="password"
                value={draft.byokAlias}
                aria-label="BYOK alias"
                onChange={(event) => {
                  setDraft((current) => ({ ...current, byokAlias: event.target.value }));
                }}
                placeholder="optional"
                autoComplete="off"
              />
            </span>
          </label>
        </div>

        {saveError || testError ? (
          <div className="settings-alert" data-tone="destructive">
            <WarningCircleIcon size={16} aria-hidden="true" />
            <span>{saveError ?? testError}</span>
          </div>
        ) : null}

        <div className="settings-footer">
          <div className="settings-test-inline" data-status={smokeTestStatus}>
            <span className="settings-test-inline__icon" aria-hidden="true">
              {visibleTestResult?.status === "success" ? (
                <CheckCircleIcon size={18} />
              ) : (
                <WarningCircleIcon size={18} />
              )}
            </span>
            <div>
              <strong>{visibleTestResult ? visibleTestResult.status : "Not tested"}</strong>
              <span>
                {visibleTestResult
                  ? `${testTimestamp} · ${visibleTestResult.latencyMs}ms`
                  : "No smoke test result"}
              </span>
            </div>
            {visibleTestResult?.message ? <p>{visibleTestResult.message}</p> : null}
          </div>

          <div className="settings-actions">
            <Button
              type="submit"
              color="primary"
              disabled={!draft.modelId || saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <CircleNotchIcon className="settings-spin" size={16} aria-hidden="true" />
              ) : (
                <SlidersHorizontalIcon size={16} aria-hidden="true" />
              )}
              <span>Save</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              color="neutral"
              disabled={!draft.modelId || testMutation.isPending}
              onClick={() => testMutation.mutate(payload)}
            >
              {testMutation.isPending ? (
                <CircleNotchIcon className="settings-spin" size={16} aria-hidden="true" />
              ) : (
                <PlayIcon size={16} aria-hidden="true" />
              )}
              <span>Test model</span>
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
