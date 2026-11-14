import { DownloadComposer } from "../../shared/components/DownloadComposer";
import type { DownloadComposerProps } from "../../shared/components/DownloadComposer";

type Props = Omit<DownloadComposerProps, "mode" | "pageTitle">;

export function ClipDownloader(props: Props) {
  return <DownloadComposer {...props} mode="clip" pageTitle="Create a clip" />;
}
