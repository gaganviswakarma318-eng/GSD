import { DownloadComposer } from "../../shared/components/DownloadComposer";
import type { DownloadComposerProps } from "../../shared/components/DownloadComposer";

type Props = Omit<DownloadComposerProps, "mode" | "pageTitle">;

export function UniversalDownloader(props: Props) {
  return <DownloadComposer {...props} mode="full" pageTitle="Download media" />;
}
