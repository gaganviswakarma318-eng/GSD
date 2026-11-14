import type { CSSProperties, ReactNode } from "react";
export type IconName =
  | "arrow"
  | "home"
  | "globe"
  | "instagram"
  | "image"
  | "summary"
  | "scissors"
  | "processing"
  | "subtitles"
  | "library"
  | "settings"
  | "collapse"
  | "expand"
  | "upload"
  | "layers"
  | "clipboard"
  | "trash"
  | "plus"
  | "chevron"
  | "download"
  | "link"
  | "paste"
  | "audio"
  | "video"
  | "folder"
  | "check"
  | "close"
  | "retry"
  | "external"
  | "clock"
  | "spark"
  | "help"
  | "sun"
  | "moon";
const paths: Record<IconName, ReactNode> = {
  home: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r=".7" fill="currentColor" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
    </>
  ),
  summary: <path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4zM19 2v4m-2-2h4M5 18v4m-2-2h4" />,
  scissors: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="m8.1 8.1 12.8 12.8M14 10l7-7M8.1 15.9l3.2-3.2" />
    </>
  ),
  processing: (
    <>
      <path d="M4 7h10m4 0h2M4 12h2m4 0h10M4 17h10m4 0h2" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="16" cy="17" r="2" />
    </>
  ),
  subtitles: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 10h4m2 0h4m-10 4h3m3 0h4" />
    </>
  ),
  library: (
    <>
      <path d="M4 4h16v16H4zM8 4v16m8-16v16M1 7v13m22-13v13" />
      <path d="M11 9h2m-2 4h2m-2 4h2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.5.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.5-.9l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.8l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.5-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.5.9l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.7Z" />
    </>
  ),
  collapse: <path d="m15 18-6-6 6-6" />,
  expand: <path d="m9 18 6-6-6-6" />,
  upload: (
    <>
      <path d="M12 16V4m-5 5 5-5 5 5" />
      <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5m-18 5 9 5 9-5" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="5" width="14" height="16" rx="2" />
      <path d="M9 5V3h6v2m-7 5h8m-8 4h8m-8 4h5" />
    </>
  ),
  trash: <path d="M3 6h18m-2 0-.9 14H5.9L5 6m4 0V4h6v2m-4 4v7m4-7v7" />,
  plus: <path d="M12 5v14m-7-7h14" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20.6 13.1A8.7 8.7 0 0 1 10.9 3.4a8.8 8.8 0 1 0 9.7 9.7Z" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  download: <path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4" />,
  link: (
    <path
      d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"
      transform="translate(1 0)"
    />
  ),
  paste: (
    <>
      <rect x="7" y="5" width="13" height="16" rx="2" />
      <path d="M15 5V3H4v14h3m4-7h5m-5 4h5" />
    </>
  ),
  audio: (
    <>
      <path d="M9 17V5l11-2v12M9 8l11-2" />
      <ellipse cx="6" cy="17.5" rx="3" ry="2.5" />
      <ellipse cx="17" cy="15.5" rx="3" ry="2.5" />
    </>
  ),
  video: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m10 9 5 3-5 3z" />
    </>
  ),
  folder: <path d="M3 7V5h6l2 2h10v13H3zM3 10h18" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  retry: <path d="M3 11a9 9 0 1 1 2 7M3 4v7h7" />,
  external: <path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  spark: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9a3 3 0 1 1 4 2.8c-1 .4-1 1.2-1 2.2m0 3h.01" />
    </>
  ),
};
export function Icon({
  name,
  size = 20,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
