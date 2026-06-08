import * as React from "react";

export type ModelProvider =
  | "openai"
  | "anthropic"
  | "google"
  | "meta"
  | "kimi"
  | "deepseek"
  | "mistral"
  | "mistralai"
  | "qwen"
  | "cloudflare";

type LogoProps = React.SVGAttributes<SVGSVGElement>;

function Svg({ children, size = 16, ...props }: LogoProps & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

const OpenAILogo = (props: LogoProps) => (
  <Svg {...props}>
    <path d="M22.28 9.81a5.99 5.99 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.52-2.9A6.05 6.05 0 0 0 10.58 0a6.05 6.05 0 0 0-5.77 4.18 5.99 5.99 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.09 5.99 5.99 0 0 0 .52 4.91 6.05 6.05 0 0 0 6.52 2.9A5.99 5.99 0 0 0 13.25 24a6.05 6.05 0 0 0 5.77-4.19 5.99 5.99 0 0 0 4-2.9 6.05 6.05 0 0 0-.74-7.1ZM13.25 22.44a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.79-2.76a.78.78 0 0 0 .39-.68v-6.75l2.02 1.17c.02 0 .04.03.04.05v5.58a4.5 4.5 0 0 1-4.5 4.5ZM3.57 18.3a4.5 4.5 0 0 1-.54-3.03l.14.09 4.79 2.76a.78.78 0 0 0 .78 0l5.85-3.37v2.33c0 .02 0 .04-.03.06L9.72 19.94a4.5 4.5 0 0 1-6.15-1.64ZM2.31 7.88a4.48 4.48 0 0 1 2.35-1.97v5.69a.78.78 0 0 0 .39.67l5.83 3.36-2.02 1.17a.07.07 0 0 1-.07 0l-4.83-2.8A4.5 4.5 0 0 1 2.3 7.9Zm16.64 3.87L13.1 8.37l2.02-1.17c.02 0 .05-.01.07 0l4.83 2.8a4.5 4.5 0 0 1-.67 8.11V12.4a.77.77 0 0 0-.4-.66Zm2-3.03-.14-.09-4.78-2.78a.78.78 0 0 0-.79 0L9.4 9.25V6.92c0-.02 0-.04.02-.05l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66Zm-12.68 4.17-2.02-1.17a.07.07 0 0 1-.04-.06V6.1a4.5 4.5 0 0 1 7.38-3.45l-.14.08L8.66 5.5a.78.78 0 0 0-.4.68v6.74Zm1.1-2.36 2.6-1.5 2.61 1.5v3l-2.6 1.5-2.6-1.5Z" />
  </Svg>
);

const AnthropicLogo = (props: LogoProps) => (
  <Svg {...props}>
    <path d="M13.83 4H17.3L24 20h-3.47l-1.37-3.52h-7L10.82 20H7.36ZM13.25 13.58h4.8l-2.4-6.15Z" />
    <path d="M0 4h3.47l6.7 16H6.7Z" />
  </Svg>
);

const GoogleLogo = (props: LogoProps) => (
  <Svg {...props}>
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2a8 8 0 0 1 5.34 2.05l-2.2 2.2A5 5 0 1 0 17 12.6h-5v-2.6h7.9A8 8 0 0 1 12 20 8 8 0 0 1 12 4Z" />
  </Svg>
);

const MetaLogo = (props: LogoProps) => (
  <Svg {...props}>
    <path d="M2 12.5c0-3.5 1.8-6.5 4.4-6.5 1.8 0 3.2 1.3 4.9 3.8 2.2 3.2 3.3 5 4.6 5 1 0 1.5-.8 1.5-2.3 0-2.1-1-4.3-2.7-4.3-1 0-2 .6-3.2 2l-1.3-1.7C11.5 6.8 12.9 6 14.5 6c3 0 5.5 3.3 5.5 7 0 3.3-1.6 5-3.8 5-2.3 0-3.6-1.6-6-5.3C8.9 10.4 8 9.2 6.8 9.2 5.4 9.2 4.3 10.6 4.3 13c0 1.8.5 3 1.3 3 .6 0 1.1-.3 1.8-1.1l1.3 1.7C7.6 17.6 6.3 18 5.3 18 3.3 18 2 16 2 12.5Z" />
  </Svg>
);

const KimiLogo = (props: LogoProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M8 7.5v9M8 12l4.5-4.5M8 12l5 4.5M14 7.5h2.5v9H14z"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </Svg>
);

const DeepSeekLogo = (props: LogoProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M8.25 7.25h3.5c2.49 0 4 1.87 4 4.75s-1.51 4.75-4 4.75h-3.5z"
      fill="none"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
    <path
      d="M11.5 9.25h.75c.96 0 1.75.73 1.75 1.62 0 1.14-.91 1.63-2.04 1.63h-.92c-1.13 0-2.04.49-2.04 1.63 0 .9.79 1.62 1.75 1.62h1"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.5"
    />
  </Svg>
);

const MistralLogo = (props: LogoProps) => (
  <Svg {...props}>
    <path d="M4 5h4v3h2v3h4V8h2V5h4v14h-4v-4h-2v-3h-4v3H8v4H4z" />
  </Svg>
);

const QwenLogo = (props: LogoProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path
      d="M8 12.1c0-2.45 1.65-4.1 4-4.1s4 1.65 4 4.1c0 1.14-.36 2.1-1 2.8l1.28 1.28-1.42 1.42-1.32-1.32c-.47.18-.99.27-1.54.27-2.35 0-4-1.68-4-4.45Zm2 0c0 1.34.78 2.32 2 2.32s2-.98 2-2.32-.78-2.25-2-2.25-2 .94-2 2.25Z"
      fill="currentColor"
    />
  </Svg>
);

const CloudflareLogo = (props: LogoProps) => (
  <Svg {...props}>
    <path d="M8.8 17.5h7.95a4.25 4.25 0 0 0 .2-8.5A6.1 6.1 0 0 0 5.5 8.05 4.75 4.75 0 0 0 6.75 17.5z" />
    <path d="M13.4 10.5h5.1a3 3 0 0 1-.75 6H8.5a2.25 2.25 0 0 1-.33-4.48 4.1 4.1 0 0 1 5.23-1.52Z" />
  </Svg>
);

const FallbackLogo = (props: LogoProps) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M8 12h8M12 8v8" fill="none" stroke="currentColor" strokeLinecap="round" />
  </Svg>
);

export function ProviderLogo({ provider, ...props }: LogoProps & { provider: string }) {
  const key = provider.toLowerCase() as ModelProvider;
  switch (key) {
    case "openai":
      return <OpenAILogo {...props} />;
    case "anthropic":
      return <AnthropicLogo {...props} />;
    case "google":
      return <GoogleLogo {...props} />;
    case "meta":
      return <MetaLogo {...props} />;
    case "kimi":
      return <KimiLogo {...props} />;
    case "deepseek":
      return <DeepSeekLogo {...props} />;
    case "mistral":
    case "mistralai":
      return <MistralLogo {...props} />;
    case "qwen":
      return <QwenLogo {...props} />;
    case "cloudflare":
      return <CloudflareLogo {...props} />;
    default:
      return <FallbackLogo {...props} />;
  }
}
