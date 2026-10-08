import { Fragment } from "react";
import { cn } from "@/lib/utils";

const URL_RE = /(https?:\/\/[^\s<>"']+)/g;
const TRAILING_PUNCTUATION_RE = /[.,;:!?)\]}»"']+$/;

/** Splits "see https://x.tn/a." into ["see ", link "https://x.tn/a", "."]. */
function linkify(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  text.split(URL_RE).forEach((part, index) => {
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
        rel="noopener noreferrer nofollow ugc"
        className="relative z-10 break-all font-medium text-primary underline underline-offset-4 hover:no-underline"
      >
        {url}
      </a>
    );
    if (trailing) nodes.push(<Fragment key={`${index}-end`}>{trailing}</Fragment>);
  });
  return nodes;
}

/**
 * Text written by users (bios, posts, mentoring messages and replies): plain text with its line breaks kept, never
 * rendered as HTML. Web addresses (http/https only) become links opening in a new tab (rel="nofollow ugc").
 */
export function AlumniText({ text, className, testId }: { text: string; className?: string; testId?: string }) {
  return (
    <div className={cn("whitespace-pre-wrap break-words text-sm leading-6 text-foreground", className)} data-testid={testId}>
      {linkify(text)}
    </div>
  );
}

/** "example.com" of an https link (the full address otherwise). */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
