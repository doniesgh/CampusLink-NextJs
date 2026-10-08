"use client";

import { useActionState, useState } from "react";
import { Package, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { deleteEquipmentAction, saveEquipmentAction } from "@/app/(back)/dashboard/admin/bookings/actions";
import { resourceIcon } from "@/components/bookings/resource-icon";
import { SubmitButton } from "@/components/auth/submit-button";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, useFeedback, type Feedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { ActionState } from "@/lib/server-api";
import { EQUIPMENT_CATEGORIES, type Equipment } from "@/lib/bookings/types";

type DialogState = { open: boolean; editing: Equipment | null; key: number };
const initialState: ActionState = {};

function EquipmentDialog({
  dialog,
  onOpenChange,
  onSaved,
}: {
  dialog: DialogState;
  onOpenChange: (open: boolean) => void;
  onSaved: (feedback: Feedback) => void;
}) {
  const t = useTranslations("bookings.admin.equipment");
  const tCategories = useTranslations("bookings.categories");
  const { editing } = dialog;
  const [state, formAction, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await saveEquipmentAction(prev, formData);
    if (result.ok) {
      onSaved({ type: "success", message: result.message ?? "" });
      onOpenChange(false);
    }
    return result;
  }, initialState);

  const errors = state.ok ? {} : (state.fieldErrors ?? {});
  const values = state.ok ? undefined : state.values;
  const text = (name: "name" | "category" | "location" | "description", fallback: string | undefined) => values?.[name] ?? fallback ?? "";
  const checked = (name: "requiresApproval" | "active", fallback: boolean) => (values ? values[name] === "on" : fallback);

  return (
    <Dialog open={dialog.open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{editing ? t("editTitle") : t("addTitle")}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <Field id="equipment-name" label={t("name")} error={errors.name}>
            {(props) => <Input {...props} name="name" maxLength={100} defaultValue={text("name", editing?.name)} required />}
          </Field>
          <Field id="equipment-category" label={t("category")} error={errors.category}>
            {(props) => (
              <Select {...props} name="category" defaultValue={text("category", editing?.category ?? "PROJECTOR")}>
                {EQUIPMENT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {tCategories(category)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="equipment-location" label={t("location")} hint={t("locationHint")} error={errors.location}>
            {(props) => <Input {...props} name="location" maxLength={200} defaultValue={text("location", editing?.location)} />}
          </Field>
          <Field id="equipment-description" label={t("description")} error={errors.description}>
            {(props) => <Textarea {...props} name="description" rows={3} maxLength={1000} defaultValue={text("description", editing?.description)} />}
          </Field>
          <CheckboxField
            id="equipment-approval"
            name="requiresApproval"
            label={t("requiresApproval")}
            description={t("requiresApprovalHint")}
            defaultChecked={checked("requiresApproval", editing?.requiresApproval ?? false)}
          />
          <CheckboxField
            id="equipment-active"
            name="active"
            label={t("active")}
            description={t("activeHint")}
            defaultChecked={checked("active", editing?.active ?? true)}
          />
          <InlineFeedback feedback={state.ok === false && state.message ? { type: "error", message: state.message, at: state.at } : null} />
          <div className="flex justify-end">
            <SubmitButton pending={pending} className="h-10 w-auto rounded-full px-6 shadow-none">
              {t("save")}
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Equipment tab: every item (inactive ones too), "Add equipment", edit and delete (IN_USE while booked). */
export function EquipmentManager({ items }: { items: Equipment[] }) {
  const t = useTranslations("bookings.admin.equipment");
  const tCategories = useTranslations("bookings.categories");
  const [feedback, setFeedback] = useFeedback();
  const [dialog, setDialog] = useState<DialogState>({ open: false, editing: null, key: 0 });
  const open = (editing: Equipment | null) => setDialog((current) => ({ open: true, editing, key: current.key + 1 }));

  const remove = async (item: Equipment) => {
    const result = await deleteEquipmentAction(item.id, item.name);
    setFeedback(result.message ? { type: result.ok ? "success" : "error", message: result.message } : null);
  };

  return (
    <section aria-labelledby="equipment-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="equipment-title" className="text-lg font-semibold">
          {t("title")}
        </h2>
        <Button className="rounded-full" onClick={() => open(null)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("add")}
        </Button>
      </div>
      <InlineFeedback feedback={feedback} />

      {items.length === 0 ? (
        <EmptyState icon={Package} headingLevel="h3" title={t("empty")} />
      ) : (
        <Table aria-label={t("title")}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("name")}</TableHead>
              <TableHead>{t("category")}</TableHead>
              <TableHead>{t("location")}</TableHead>
              <TableHead>{t("state")}</TableHead>
              <TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const Icon = resourceIcon("EQUIPMENT", item.category);
              return (
                <TableRow key={item.id} data-equipment-id={item.id}>
                  <TableCell>
                    <span className="flex items-center gap-2 font-medium">
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      {item.name}
                    </span>
                    {item.description && <span className="mt-0.5 line-clamp-1 block max-w-xs text-xs text-muted-foreground">{item.description}</span>}
                  </TableCell>
                  <TableCell>{tCategories(item.category)}</TableCell>
                  <TableCell>{item.location || "—"}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={item.active ? "success" : "neutral"}>{item.active ? t("activeBadge") : t("inactiveBadge")}</Badge>
                      {item.requiresApproval && <Badge variant="warning">{t("approvalBadge")}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button variant="outline" size="sm" className="rounded-full" onClick={() => open(item)} aria-label={t("editLabel", { name: item.name })}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        {t("edit")}
                      </Button>
                      <ConfirmDialog
                        trigger={
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-full text-destructive hover:text-destructive"
                            aria-label={t("deleteLabel", { name: item.name })}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            {t("delete")}
                          </Button>
                        }
                        title={t("confirmDeleteTitle", { name: item.name })}
                        description={t("confirmDeleteDescription")}
                        confirmLabel={t("confirmDelete")}
                        onConfirm={() => remove(item)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <EquipmentDialog key={dialog.key} dialog={dialog} onOpenChange={(value) => setDialog((current) => ({ ...current, open: value }))} onSaved={setFeedback} />
    </section>
  );
}
