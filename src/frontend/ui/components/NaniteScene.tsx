import { useEffect, useRef } from "react";
import gsap from "gsap";

export type NaniteSceneVariant = "idle" | "working" | "celebrating" | "concerned";

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
const SHADOW_FILL = "#0d1520";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function NaniteScene({ variant, mode = "trio", className, title }: NaniteSceneProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const naniteRefs = useRef<(SVGGElement | null)[]>([]);
  const hatRefs = useRef<(SVGGElement | null)[]>([]);
  const sparklesRef = useRef<SVGGElement | null>(null);
  const glassRef = useRef<SVGGElement | null>(null);
  const badgeRef = useRef<SVGGElement | null>(null);
  const screenSignalRef = useRef<SVGGElement | null>(null);
  const screenScanRef = useRef<SVGRectElement | null>(null);

  useEffect(() => {
    const nanites = naniteRefs.current.filter((el): el is SVGGElement => el !== null);
    const hats = hatRefs.current.filter((el): el is SVGGElement => el !== null);
    const sparkles = sparklesRef.current;
    const glass = glassRef.current;
    const badge = badgeRef.current;
    const screenSignal = screenSignalRef.current;
    const screenScan = screenScanRef.current;

    if (nanites.length === 0) return;

    const setTerminalPose = () => {
      gsap.set(nanites, { y: 0, rotation: 0 });
      if (variant === "working") {
        gsap.set(hats, { autoAlpha: 1, y: 0 });
      } else {
        gsap.set(hats, { autoAlpha: 0, y: -6 });
      }
      if (sparkles) gsap.set(sparkles, { autoAlpha: 0 });
      if (glass) gsap.set(glass, { autoAlpha: 1, rotation: 0 });
      if (badge) gsap.set(badge, { autoAlpha: 1, scale: 1, transformOrigin: "50% 50%" });
      if (screenSignal) {
        gsap.set(screenSignal, { autoAlpha: 1, scale: 1, transformOrigin: "50% 50%" });
      }
      if (screenScan) gsap.set(screenScan, { autoAlpha: 0, x: -20 });
    };

    setTerminalPose();

    if (prefersReducedMotion()) return;

    const tl = gsap.timeline();

    if (variant === "idle") {
      nanites.forEach((nanite, index) => {
        tl.to(
          nanite,
          {
            y: -3,
            rotation: index % 2 === 0 ? -1.2 : 1.2,
            duration: 1.45,
            ease: "sine.inOut",
            yoyo: true,
            repeat: -1,
            transformOrigin: "50% 100%",
          },
          index * 0.12,
        );
      });
    } else if (variant === "working") {
      hats.forEach((hat, index) => {
        tl.fromTo(
          hat,
          { autoAlpha: 0, y: -8 },
          { autoAlpha: 1, y: 0, duration: 0.4, ease: "bounce.out" },
          index * 0.08,
        );
      });
      nanites.forEach((nanite, index) => {
        tl.to(
          nanite,
          { y: -2, duration: 0.6, ease: "power1.inOut", yoyo: true, repeat: -1 },
          0.4 + index * 0.14,
        );
      });
      if (glass) {
        tl.to(
          glass,
          {
            rotation: -12,
            transformOrigin: "50% 100%",
            duration: 0.45,
            ease: "power1.inOut",
            yoyo: true,
            repeat: -1,
          },
          0.4,
        );
      }
      if (screenSignal) {
        const nodes = screenSignal.querySelectorAll<SVGCircleElement>(".nanite-scene__github-node");
        tl.to(
          nodes,
          {
            scale: 1.22,
            transformOrigin: "50% 50%",
            duration: 0.58,
            ease: "sine.inOut",
            stagger: 0.14,
            yoyo: true,
            repeat: -1,
          },
          0.5,
        );
        tl.to(
          screenSignal,
          {
            y: -0.8,
            duration: 1.35,
            ease: "sine.inOut",
            yoyo: true,
            repeat: -1,
          },
          0.65,
        );
      }
      if (screenScan) {
        tl.fromTo(
          screenScan,
          { autoAlpha: 0, x: -20 },
          {
            autoAlpha: 0.55,
            x: 20,
            duration: 1.25,
            ease: "power2.inOut",
            repeat: -1,
            repeatDelay: 0.25,
          },
          0.7,
        );
      }
    } else if (variant === "celebrating") {
      nanites.forEach((nanite, index) => {
        tl.to(
          nanite,
          { keyframes: [{ y: -4 }, { y: 0 }], duration: 0.5, ease: "bounce.out" },
          index * 0.1,
        );
      });
      hats.forEach((hat, index) => {
        tl.set(hat, { autoAlpha: 1, y: 0 }, 0);
        tl.to(hat, { y: -20, autoAlpha: 0, duration: 1.2, ease: "power2.out" }, 0.2 + index * 0.12);
      });
      if (sparkles) {
        const dots = sparkles.querySelectorAll<SVGCircleElement>("circle");
        tl.fromTo(
          dots,
          { autoAlpha: 0, scale: 0.6, transformOrigin: "50% 50%" },
          { autoAlpha: 1, scale: 1.1, duration: 0.4, ease: "power2.out", stagger: 0.08 },
          0.7,
        );
        tl.to(dots, { scale: 0.9, duration: 0.3, yoyo: true, repeat: 3, ease: "sine.inOut" }, 1.1);
        tl.to(dots, { autoAlpha: 0, duration: 0.5, ease: "power1.in" }, 2.6);
      }
      if (badge) {
        tl.fromTo(
          badge,
          { autoAlpha: 0, scale: 0.4, transformOrigin: "50% 50%" },
          { autoAlpha: 1, scale: 1, duration: 0.4, ease: "back.out(2)" },
          0.5,
        );
      }
    } else if (variant === "concerned") {
      nanites.forEach((nanite, index) => {
        tl.to(
          nanite,
          {
            rotation: 2,
            duration: 2,
            ease: "sine.inOut",
            yoyo: true,
            repeat: -1,
            transformOrigin: "50% 100%",
          },
          index * 0.3,
        );
      });
      if (badge) {
        tl.fromTo(
          badge,
          { autoAlpha: 0, scale: 0.4, transformOrigin: "50% 50%" },
          { autoAlpha: 1, scale: 1, duration: 0.4, ease: "back.out(2)" },
          0.3,
        );
      }
    }

    return () => {
      tl.kill();
    };
  }, [variant]);

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
    const xs = [40, 100, 160];
    const centerY = 34;
    return (
      <div ref={rootRef} className={wrapperClass}>
        <svg
          viewBox="0 0 200 68"
          width="200"
          height="68"
          preserveAspectRatio="xMidYMid meet"
          fill="none"
          {...ariaProps}
        >
          {title ? <title>{title}</title> : null}
          {xs.map((x, index) => (
            <Nanite
              key={x}
              index={index}
              cx={x}
              cy={centerY}
              scale={1}
              registerNanite={(el) => {
                naniteRefs.current[index] = el;
              }}
              registerHat={(el) => {
                hatRefs.current[index] = el;
              }}
            />
          ))}
        </svg>
      </div>
    );
  }

  const showBrowser = variant !== "idle";
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
    <div ref={rootRef} className={wrapperClass}>
      <svg
        viewBox={soloViewBox}
        width={soloWidth}
        height="56"
        preserveAspectRatio="xMidYMid meet"
        fill="none"
        {...ariaProps}
      >
        {title ? <title>{title}</title> : null}

        <Nanite
          index={0}
          cx={naniteX}
          cy={centerY}
          scale={naniteScale}
          registerNanite={(el) => {
            naniteRefs.current[0] = el;
          }}
          registerHat={(el) => {
            hatRefs.current[0] = el;
          }}
        />

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
              ref={screenScanRef}
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
            <g ref={screenSignalRef} className="nanite-scene__github-signal">
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
          <g ref={glassRef} transform={`translate(${screenCx - 4}, ${screenCy + 2})`}>
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
        ) : null}

        {showSuccessBadge ? (
          <g
            ref={badgeRef}
            transform={`translate(${screenCx + 14}, ${screenCy - 10})`}
            style={{ visibility: "hidden" }}
          >
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
        ) : null}

        {showFailBadge ? (
          <g
            ref={badgeRef}
            transform={`translate(${screenCx + 14}, ${screenCy - 10})`}
            style={{ visibility: "hidden" }}
          >
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
        ) : null}

        {showSuccessBadge ? (
          <g ref={sparklesRef} style={{ visibility: "hidden" }}>
            <circle cx={naniteX - 10} cy={centerY - 24} r="1.6" fill={HAT_BULB} />
            <circle cx={naniteX + 2} cy={centerY - 28} r="1.9" fill={BODY_COLORS[0]} />
            <circle cx={naniteX + 14} cy={centerY - 22} r="1.6" fill={BODY_COLORS[2]} />
          </g>
        ) : null}
      </svg>
    </div>
  );
}

export function NaniteTrioStudying({
  className,
  title,
}: {
  readonly className?: string;
  readonly title?: string;
}) {
  const glassRef = useRef<SVGGElement | null>(null);

  useEffect(() => {
    const glass = glassRef.current;
    if (!glass) return;
    if (prefersReducedMotion()) return;

    const tween = gsap.to(glass, {
      rotation: -10,
      transformOrigin: "50% 100%",
      duration: 0.55,
      ease: "power1.inOut",
      yoyo: true,
      repeat: -1,
    });

    return () => {
      tween.kill();
    };
  }, []);

  const xs = [60, 120, 180];
  const naniteY = 70;
  const wrapperClass = ["nanite-scene", "nanite-scene--studying", className]
    .filter(Boolean)
    .join(" ");
  const ariaProps = title
    ? { role: "img" as const, "aria-label": title }
    : { "aria-hidden": true as const };

  return (
    <div className={wrapperClass}>
      <svg viewBox="0 0 240 110" preserveAspectRatio="xMidYMid meet" fill="none" {...ariaProps}>
        {title ? <title>{title}</title> : null}

        <g transform="translate(120, 20)">
          <rect
            x="-28"
            y="-4"
            width="56"
            height="36"
            rx="3"
            fill={SCREEN_BG}
            stroke={SCREEN_BORDER}
            strokeWidth="1"
          />
          <circle cx="-21" cy="2" r="1.5" fill={SCREEN_ICON_WARN} />
          <circle cx="-15" cy="2" r="1.5" fill={HAT_SHELL} />
          <circle cx="-9" cy="2" r="1.5" fill={BODY_COLORS[0]} />
          <rect x="-22" y="8" width="30" height="2" rx="1" fill={SCREEN_LINE} />
          <rect x="-22" y="13" width="20" height="2" rx="1" fill={SCREEN_LINE} />
          <rect x="-22" y="18" width="26" height="2" rx="1" fill={SCREEN_LINE} />
          <rect x="-22" y="23" width="16" height="4" rx="2" fill={BODY_COLORS[1]} opacity="0.5" />
        </g>

        <g ref={glassRef} transform="translate(140, 44)">
          <circle cx="0" cy="0" r="6" fill="none" stroke={GLASS_STROKE} strokeWidth="1.2" />
          <line
            x1="4.5"
            y1="4.5"
            x2="9"
            y2="9"
            stroke={GLASS_STROKE}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </g>

        {xs.map((x, index) => (
          <g key={x} transform={`translate(${x}, ${naniteY})`}>
            <NaniteBody index={index} />
          </g>
        ))}
      </svg>
    </div>
  );
}

export function NaniteTrioStatic({
  className,
  title,
}: {
  readonly className?: string;
  readonly title?: string;
}) {
  const xs = [20, 92, 164];
  const cy = 28;
  const groundY = 52;
  const wrapperClass = ["nanite-scene", "nanite-scene--static-trio", className]
    .filter(Boolean)
    .join(" ");
  const ariaProps = title
    ? { role: "img" as const, "aria-label": title }
    : { "aria-hidden": true as const };

  return (
    <div className={wrapperClass}>
      <svg viewBox="0 4 184 52" preserveAspectRatio="xMidYMid meet" fill="none" {...ariaProps}>
        {title ? <title>{title}</title> : null}
        {xs.map((x) => (
          <ellipse
            key={`shadow-${x}`}
            cx={x}
            cy={groundY}
            rx="18"
            ry="2.8"
            fill={SHADOW_FILL}
            opacity="0.08"
          />
        ))}
        {xs.map((x, index) => (
          <g key={x} transform={`translate(${x}, ${cy})`}>
            <NaniteBody index={index} />
          </g>
        ))}
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
  registerNanite,
  registerHat,
}: {
  readonly index: number;
  readonly cx: number;
  readonly cy: number;
  readonly scale: number;
  readonly registerNanite: (el: SVGGElement | null) => void;
  readonly registerHat: (el: SVGGElement | null) => void;
}) {
  return (
    <g transform={`translate(${cx}, ${cy}) scale(${scale})`}>
      <g ref={registerNanite} className="nanite-scene__nanite" data-index={index}>
        <NaniteBody index={index} />
        <g ref={registerHat} className="nanite-scene__hat" style={{ visibility: "hidden" }}>
          <path d="M -9 -22 Q -9 -31 0 -31 Q 9 -31 9 -22 Z" fill={HAT_SHELL} />
          <rect x="-12" y="-23" width="24" height="3.5" rx="1.5" fill={HAT_BRIM} />
          <circle cx="0" cy="-28" r="2" fill={HAT_BULB} />
        </g>
      </g>
    </g>
  );
}
