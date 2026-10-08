"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { DocumentForm, editableFields } from "@/components/marketplace/document-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { InlineFeedback, type Feedback } from "@/components/ui/feedback";
import type { MarketDocument } from "@/lib/marketplace/types";
import type { Subject } from "@/lib/types";
import { updateDocumentAction } from "@/app/(back)/dashboard/marketplace/actions";

/**
 * "Edit" of one of my documents (dialog): every field while it waits for a review or after a rejection (saving a
 * rejected document sends it back to the review queue), only the price once published. Errors stay in the dialog;
 * the outcome goes to the page (`onSaved`).
 */
export function EditDocumentDialog({
  document,
  subjects,
  currentYear,
  maxUploadMb,
  isAdmin,
  onSaved,
}: {
  document: MarketDocument;
  subjects: Subject[];
  currentYear: string;
  maxUploadMb: number;
  isAdmin: boolean;
  onSaved: (document: MarketDocument | undefined, message: string | undefined) => void;
}) {
  const t = useTranslations("marketplace.mine");
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  if (editableFields(document, isAdmin).length === 0) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setFeedback(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="rounded-full">
          <Pencil className="h-4 w-4" aria-hidden="true" />
          {t("edit")}
          <span className="sr-only">: {document.title}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("editTitle")}</DialogTitle>
          <DialogDescription className="break-words">{document.title}</DialogDescription>
        </DialogHeader>
        <InlineFeedback feedback={feedback} />
        <DocumentForm
          idPrefix={`edit-${document.id}`}
          document={document}
          subjects={subjects}
          currentYear={currentYear}
          maxUploadMb={maxUploadMb}
          isAdmin={isAdmin}
          submit={({ values, fields }) => updateDocumentAction(document.id, values, [...fields], document.status === "REJECTED")}
          onDone={(saved, message) => {
            setOpen(false);
            setFeedback(null);
            onSaved(saved, message);
          }}
          onFailure={(message) => setFeedback({ type: "error", message, at: Date.now() })}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
