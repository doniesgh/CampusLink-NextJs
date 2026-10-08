import { initials } from "@/lib/alumni/types";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "h-9 w-9 text-xs",
  md: "h-12 w-12 text-sm",
  lg: "h-16 w-16 text-lg sm:h-20 sm:w-20 sm:text-xl",
} as const;

/** Initials in a circle (decorative: the name is always written next to it). */
export function AlumniAvatar({
  user,
  size = "md",
  className,
}: {
  user: { firstname?: string | null; lastname?: string | null } | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 select-none items-center justify-center rounded-full bg-accent font-semibold text-accent-foreground ring-1 ring-primary/15",
        SIZES[size],
        className
      )}
    >
      {initials(user)}
    </span>
  );
}
