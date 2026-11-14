import type { IconName } from "../shared/components/Icon";

export type WorkspacePage =
  | "home"
  | "universal"
  | "instagram"
  | "clip"
  | "processing"
  | "library"
  | "settings";

interface NavigationItem {
  label: string;
  href?: string;
  icon: IconName;
  page?: WorkspacePage;
}

interface NavigationSection {
  label: string;
  items: NavigationItem[];
}

export const navigationSections: NavigationSection[] = [
  {
    label: "DOWNLOAD",
    items: [
      { label: "Home", href: "/", icon: "home", page: "home" },
      {
        label: "Universal Downloader",
        href: "/universal",
        icon: "globe",
        page: "universal",
      },
      {
        label: "Instagram Downloader",
        href: "/instagram",
        icon: "instagram",
        page: "instagram",
      },
    ],
  },
  {
    label: "CREATE & PROCESS",
    items: [
      { label: "Clip Studio", href: "/clip", icon: "scissors", page: "clip" },
      { label: "AI Summary", icon: "summary" },
      { label: "Subtitles", icon: "subtitles" },
    ],
  },
  {
    label: "MANAGE",
    items: [
      { label: "Settings", href: "/settings", icon: "settings", page: "settings" },
    ],
  },
];

export const pageForPath = (path: string): WorkspacePage => {
  if (path === "/universal") return "universal";
  if (path === "/instagram") return "instagram";
  if (path === "/clip") return "clip";
  if (path === "/processing") return "processing";
  if (path === "/library") return "library";
  if (path === "/settings") return "settings";
  return "home";
};

export const pageTitles: Record<WorkspacePage, string> = {
  home: "Home",
  universal: "Universal Downloader",
  instagram: "Instagram Downloader",
  clip: "Clip Studio",
  processing: "Processing",
  library: "Library",
  settings: "Settings",
};
