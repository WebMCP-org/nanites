export type NaniteSceneVariant = "idle" | "helmet" | "working" | "celebrating" | "concerned";

type NaniteSceneProps = {
  readonly variant: NaniteSceneVariant;
  readonly mode?: "trio" | "solo";
  readonly className?: string;
  readonly title?: string;
};

const BODY_COLORS = ["#0f7b6c", "#2d5a8a", "#7eb8c9"] as const;
const HAT_SHELL = "#d4a636";
const HAT_BRIM = "#c49525";
const HAT_BULB = "#f0d060";
const EYE_FILL = "#0d1520";
const EYE_HIGHLIGHT = "rgba(255,255,255,0.45)";
const SCREEN_BG = "#1e2d3d";
const SCREEN_BORDER = "#3a5068";
const SCREEN_LINE = "#2e3d50";
const SCREEN_ICON_WARN = "#c87832";
const GLASS_STROKE = "#8ba7b8";
const BADGE_SUCCESS = "#0f7b6c";
const BADGE_FAIL = "#dc2626";
const TRIO_XS = [40, 100, 160] as const;

export function NaniteScene({ variant, mode = "trio", className, title }: NaniteSceneProps) {
  const wrapperClass = [
    "nanite-scene",
    `nanite-scene--${variant}`,
    `nanite-scene--${mode}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const ariaProps = title
    ? { role: "img" as const, "aria-label": title }
    : { "aria-hidden": true as const };

  if (mode === "trio") {
    const centerY = 34;
    return (
      <div className={wrapperClass}>
        <svg
          viewBox="0 0 200 68"
          width="200"
          height="68"
          preserveAspectRatio="xMidYMid meet"
          fill="none"
          {...ariaProps}
        >
          {title ? <title>{title}</title> : null}
          {TRIO_XS.map((x, index) => (
            <Nanite key={x} index={index} cx={x} cy={centerY} scale={1} />
          ))}
        </svg>
      </div>
    );
  }

  const showBrowser = variant !== "idle" && variant !== "helmet";
  const showGlass = variant === "working";
  const showSuccessBadge = variant === "celebrating";
  const showFailBadge = variant === "concerned";
  const soloViewBox = showBrowser ? "0 0 120 56" : "0 0 52 56";
  const soloWidth = showBrowser ? 120 : 52;

  const naniteX = 24;
  const naniteScale = 0.95;
  const centerY = 30;
  const screenCx = 82;
  const screenCy = 30;

  return (
    <div className={wrapperClass}>
      <svg
        viewBox={soloViewBox}
        width={soloWidth}
        height="56"
        preserveAspectRatio="xMidYMid meet"
        fill="none"
        {...ariaProps}
      >
        {title ? <title>{title}</title> : null}

        <Nanite index={0} cx={naniteX} cy={centerY} scale={naniteScale} />

        {showBrowser ? (
          <g transform={`translate(${screenCx}, ${screenCy})`}>
            <rect
              x="-22"
              y="-17"
              width="44"
              height="34"
              rx="3"
              fill={SCREEN_BG}
              stroke={SCREEN_BORDER}
              strokeWidth="1"
            />
            <circle cx="-17" cy="-13" r="1.3" fill={SCREEN_ICON_WARN} />
            <circle cx="-12" cy="-13" r="1.3" fill={HAT_SHELL} />
            <circle cx="-7" cy="-13" r="1.3" fill={BODY_COLORS[0]} />
            <rect x="-18" y="-6" width="24" height="1.8" rx="0.9" fill={SCREEN_LINE} />
            <rect x="-18" y="-2" width="16" height="1.8" rx="0.9" fill={SCREEN_LINE} />
            <rect x="-18" y="2" width="20" height="1.8" rx="0.9" fill={SCREEN_LINE} />
            <rect
              className="nanite-scene__screen-scan"
              x="-20"
              y="-9"
              width="6"
              height="23"
              rx="3"
              fill={BODY_COLORS[2]}
              opacity="0"
            />
            <rect
              x="-18"
              y="7"
              width="12"
              height="3"
              rx="1.5"
              fill={BODY_COLORS[1]}
              opacity="0.55"
            />
            <g className="nanite-scene__github-signal">
              <path
                d="M 3 5.5 L 9 0 L 14 5.5"
                stroke={BODY_COLORS[2]}
                strokeWidth="1.15"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle
                className="nanite-scene__github-node"
                cx="3"
                cy="5.5"
                r="2"
                fill={BODY_COLORS[0]}
              />
              <circle className="nanite-scene__github-node" cx="9" cy="0" r="2" fill={HAT_SHELL} />
              <circle
                className="nanite-scene__github-node"
                cx="14"
                cy="5.5"
                r="2"
                fill={BODY_COLORS[1]}
              />
            </g>
          </g>
        ) : null}

        {showGlass ? (
          <g transform={`translate(${screenCx - 4}, ${screenCy + 2})`}>
            <g className="nanite-scene__glass">
              <circle
                cx="0"
                cy="0"
                r="7"
                fill="rgba(255,255,255,0.06)"
                stroke={GLASS_STROKE}
                strokeWidth="1.5"
              />
              <line
                x1="5"
                y1="5"
                x2="10"
                y2="10"
                stroke={GLASS_STROKE}
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </g>
          </g>
        ) : null}

        {showSuccessBadge ? (
          <g transform={`translate(${screenCx + 14}, ${screenCy - 10})`}>
            <g className="nanite-scene__badge">
              <circle cx="0" cy="0" r="7" fill={BADGE_SUCCESS} stroke="#ffffff" strokeWidth="1.5" />
              <path
                d="M -3 0 L -0.5 2.5 L 3.5 -2"
                stroke="#ffffff"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </g>
          </g>
        ) : null}

        {showFailBadge ? (
          <g transform={`translate(${screenCx + 14}, ${screenCy - 10})`}>
            <g className="nanite-scene__badge">
              <circle cx="0" cy="0" r="7" fill={BADGE_FAIL} stroke="#ffffff" strokeWidth="1.5" />
              <line
                x1="-3"
                y1="-3"
                x2="3"
                y2="3"
                stroke="#ffffff"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <line
                x1="3"
                y1="-3"
                x2="-3"
                y2="3"
                stroke="#ffffff"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </g>
          </g>
        ) : null}

        {showSuccessBadge ? (
          <g className="nanite-scene__sparkles">
            <circle
              className="nanite-scene__sparkle"
              cx={naniteX - 10}
              cy={centerY - 24}
              r="1.6"
              fill={HAT_BULB}
            />
            <circle
              className="nanite-scene__sparkle"
              cx={naniteX + 2}
              cy={centerY - 28}
              r="1.9"
              fill={BODY_COLORS[0]}
            />
            <circle
              className="nanite-scene__sparkle"
              cx={naniteX + 14}
              cy={centerY - 22}
              r="1.6"
              fill={BODY_COLORS[2]}
            />
          </g>
        ) : null}
      </svg>
    </div>
  );
}

function NaniteBody({ index }: { readonly index: number }) {
  const color = BODY_COLORS[index % BODY_COLORS.length];
  return (
    <>
      <rect x="-15" y="-21" width="30" height="36" rx="8" fill={color} />
      <circle cx="-5.5" cy="-8" r="4.5" fill={EYE_FILL} />
      <circle cx="5.5" cy="-8" r="4.5" fill={EYE_FILL} />
      <circle cx="-4" cy="-10" r="1.5" fill={EYE_HIGHLIGHT} />
      <circle cx="7" cy="-10" r="1.5" fill={EYE_HIGHLIGHT} />
      <rect x="-12" y="13" width="9" height="5" rx="2.5" fill={color} opacity="0.7" />
      <rect x="3" y="13" width="9" height="5" rx="2.5" fill={color} opacity="0.7" />
    </>
  );
}

function Nanite({
  index,
  cx,
  cy,
  scale,
}: {
  readonly index: number;
  readonly cx: number;
  readonly cy: number;
  readonly scale: number;
}) {
  return (
    <g transform={`translate(${cx}, ${cy}) scale(${scale})`}>
      <g className="nanite-scene__nanite" data-index={index}>
        <NaniteBody index={index} />
        <g className="nanite-scene__hat">
          <path d="M -9 -22 Q -9 -31 0 -31 Q 9 -31 9 -22 Z" fill={HAT_SHELL} />
          <rect x="-12" y="-23" width="24" height="3.5" rx="1.5" fill={HAT_BRIM} />
          <circle cx="0" cy="-28" r="2" fill={HAT_BULB} />
        </g>
      </g>
    </g>
  );
}
