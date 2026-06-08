interface GitHubRoute {
  readonly method?: string;
  readonly path: string | RegExp;
  readonly response: (request: Request) => Response | Promise<Response>;
}

const GITHUB_API_ORIGIN = "https://api.github.com";
let activeGitHubFetchRestore: (() => void) | null = null;

function matchesPath(path: string | RegExp, requestPath: string): boolean {
  if (typeof path === "string") {
    return requestPath === path;
  }

  return path.test(requestPath);
}

export function mockGitHubApi(routes: readonly GitHubRoute[]): () => void {
  if (activeGitHubFetchRestore) {
    throw new Error("mockGitHubApi called before the previous GitHub fetch mock was restored");
  }

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);

    if (url.origin !== GITHUB_API_ORIGIN) {
      return originalFetch(input, init);
    }

    const requestPath = `${url.pathname}${url.search}`;
    const match = routes.find((route) => {
      const expectedMethod = route.method?.toUpperCase() ?? "GET";
      return (
        request.method.toUpperCase() === expectedMethod && matchesPath(route.path, requestPath)
      );
    });

    if (!match) {
      throw new Error(`Unexpected GitHub API request: ${request.method} ${requestPath}`);
    }

    return match.response(request);
  };

  const restore = () => {
    if (activeGitHubFetchRestore !== restore) {
      return;
    }

    globalThis.fetch = originalFetch;
    activeGitHubFetchRestore = null;
  };

  activeGitHubFetchRestore = restore;
  return restore;
}
