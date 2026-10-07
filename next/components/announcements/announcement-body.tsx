import { Fragment } from "react";
import { cn } from "@/lib/utils";

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
const TRAILING_PUNCTUATION_RE = /[.,;:!?)\]}»"']+$/;

/** Splits "see https://x.tn/a." into ["see ", link "https://x.tn/a", "."]. */
function linkify(text: string): React.ReactNode[] {
  const parts = text.split(URL_RE);
  const nodes: React.ReactNode[] = [];
  parts.forEach((part, index) => {
    if (index % 2 === 0) {
      if (part) nodes.push(<Fragment key={index}>{part}</Fragment>);
      return;
    }
    const trailing = TRAILING_PUNCTUATION_RE.exec(part)?.[0] ?? "";
    const url = trailing ? part.slice(0, -trailing.length) : part;
    nodes.push(
      <a
        key={index}
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="break-all font-medium text-primary underline underline-offset-4 hover:no-underline"
      >
        {url}
      </a>
    );
    if (trailing) nodes.push(<Fragment key={`${index}-end`}>{trailing}</Fragment>);
  });
  return nodes;
}

/**
 * Announcement text: plain text with its line breaks kept (never rendered as HTML). Web addresses
 * (http/https only) become links that open in a new tab.
 */
export function AnnouncementBody({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("whitespace-pre-wrap break-words text-base leading-7 text-foreground", className)} data-testid="announcement-body">
      {linkify(text)}
    </div>
  );
}
