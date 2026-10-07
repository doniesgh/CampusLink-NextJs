"use client";

import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Confirmation dialog (role="alertdialog") for destructive actions.
 *
 *   <ConfirmDialog
 *     trigger={<Button variant="outline" size="sm">Delete</Button>}
 *     title="Delete Ada Admin?" description="This can't be undone."
 *     confirmLabel="Confirm delete" onConfirm={async () => { await remove(); }} />
 *
 * `onConfirm` may be async: the confirm button shows a spinner and the dialog closes when it settles.
 * Report the outcome (success or error) outside the dialog, inside <main> (e.g. <InlineFeedback>).
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  destructive = true,
  open: controlledOpen,
  onOpenChange,
}: {
  trigger?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  destructive?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations("common.actions");
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const open = controlledOpen ?? uncontrolledOpen;

  const setOpen = (value: boolean) => {
    if (pending) return;
    if (controlledOpen === undefined) setUncontrolledOpen(value);
    onOpenChange?.(value);
  };

  const confirm = async (event: React.MouseEvent) => {
    event.preventDefault();
    setPending(true);
    try {
      await onConfirm();
    } finally {
      setPending(false);
      if (controlledOpen === undefined) setUncontrolledOpen(false);
      onOpenChange?.(false);
    }
  };

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={setOpen}>
      {trigger && <AlertDialogPrimitive.Trigger asChild>{trigger}</AlertDialogPrimitive.Trigger>}
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]" />
        <AlertDialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 grid w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-5 rounded-3xl border bg-background p-6 text-foreground shadow-2xl focus:outline-none"
          {...(description ? {} : { "aria-describedby": undefined })}
        >
          <div className="grid gap-1.5">
            <AlertDialogPrimitive.Title className="font-heading text-xl font-semibold leading-tight">
              {title}
            </AlertDialogPrimitive.Title>
            {description && (
              <AlertDialogPrimitive.Description className="text-sm text-muted-foreground">
                {description}
              </AlertDialogPrimitive.Description>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel className={cn(buttonVariants({ variant: "outline" }))} disabled={pending}>
              {cancelLabel ?? t("cancel")}
            </AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action
              className={cn(buttonVariants({ variant: destructive ? "destructive" : "default" }))}
              onClick={confirm}
              disabled={pending}
              aria-busy={pending || undefined}
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {confirmLabel}
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
