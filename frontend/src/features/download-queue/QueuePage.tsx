import type { ComponentProps } from "react";
import { QueuePanel } from "./QueuePanel";

type QueueProps = Omit<
  ComponentProps<typeof QueuePanel>,
  "title" | "initialFilter"
>;

interface Props {
  eyebrow: string;
  description: string;
  title: string;
  initialFilter: "active" | "done";
  queueProps: QueueProps;
}

export function QueuePage({
  eyebrow,
  description,
  title,
  initialFilter,
  queueProps,
}: Props) {
  return (
    <section className="queue-page">
      <div className="page-intro">
        <span className="eyebrow">{eyebrow}</span>
        <p>{description}</p>
      </div>
      <QueuePanel
        {...queueProps}
        title={title}
        initialFilter={initialFilter}
      />
    </section>
  );
}
