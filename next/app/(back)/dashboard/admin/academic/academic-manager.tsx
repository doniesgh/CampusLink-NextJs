"use client";

import { useActionState, useState } from "react";
import { BookOpen, DoorOpen, GraduationCap, Pencil, Plus, Trash2, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { SubmitButton } from "@/components/auth/submit-button";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, useFeedback, type Feedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { ActionState } from "@/lib/server-api";
import { ROOM_TYPES, type Group, type Program, type Room, type Subject } from "@/lib/types";
import { deleteAcademicAction, saveAcademicAction, type AcademicResource } from "./actions";

type Item = Program | Group | Subject | Room;
type DialogState = { open: boolean; resource: AcademicResource; editing: Item | null; key: number };

const initialState: ActionState = {};
const LEVELS = [1, 2, 3, 4, 5];

function ResourceDialog({
  state: dialog,
  onOpenChange,
  programs,
  defaultAcademicYear,
  onSaved,
}: {
  state: DialogState;
  onOpenChange: (open: boolean) => void;
  programs: Program[];
  defaultAcademicYear: string;
  onSaved: (feedback: Feedback) => void;
}) {
  const t = useTranslations("admin.academic");
  const { resource, editing } = dialog;
  const [state, formAction, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await saveAcademicAction(prev, formData);
    if (result.ok) {
      onSaved({ type: "success", message: result.message ?? "" });
      onOpenChange(false);
    }
    return result;
  }, initialState);

  const errors = state.ok ? {} : (state.fieldErrors ?? {});
  const values = state.ok ? {} : (state.values ?? {});
  const current = (editing ?? {}) as Partial<Program & Group & Subject & Room>;
  const value = (name: string, fallback: string | number | undefined) => values[name] ?? (fallback === undefined ? "" : String(fallback));

  return (
    <Dialog open={dialog.open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{editing ? t(`editTitle.${resource}`) : t(`addTitle.${resource}`)}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          <input type="hidden" name="resource" value={resource} />
          {editing && <input type="hidden" name="id" value={editing.id} />}

          <Field id="academic-name" label={t("fields.name")} error={errors.name}>
            {(props) => <Input {...props} name="name" defaultValue={value("name", current.name)} required />}
          </Field>

          {(resource === "programs" || resource === "subjects") && (
            <Field id="academic-code" label={t("fields.code")} error={errors.code}>
              {(props) => <Input {...props} name="code" className="uppercase" defaultValue={value("code", current.code)} required />}
            </Field>
          )}

          {resource === "programs" && (
            <Field id="academic-description" label={t("fields.description")} error={errors.description}>
              {(props) => <Textarea {...props} name="description" rows={3} defaultValue={value("description", current.description)} />}
            </Field>
          )}

          {resource === "groups" && (
            <>
              <Field id="academic-program" label={t("fields.program")} error={errors.program}>
                {(props) => (
                  <Select {...props} name="program" defaultValue={value("program", current.program?.id)} required>
                    <option value="">{t("fields.chooseProgram")}</option>
                    {programs.map((program) => (
                      <option key={program.id} value={program.id}>
                        {program.name} ({program.code})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="academic-level" label={t("fields.level")} error={errors.level}>
                  {(props) => (
                    <Select {...props} name="level" defaultValue={value("level", current.level ?? 1)}>
                      {LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {t("levelValue", { level })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field id="academic-year" label={t("fields.academicYear")} hint={t("fields.academicYearHint")} error={errors.academicYear}>
                  {(props) => (
                    <Input
                      {...props}
                      name="academicYear"
                      inputMode="numeric"
                      pattern="\d{4}-\d{4}"
                      defaultValue={value("academicYear", current.academicYear ?? defaultAcademicYear)}
                      required
                    />
                  )}
                </Field>
              </div>
            </>
          )}

          {resource === "subjects" && (
            <Field id="academic-color" label={t("fields.color")} error={errors.color}>
              {(props) => (
                <Input {...props} type="color" name="color" className="h-11 w-24 cursor-pointer p-1" defaultValue={value("color", current.color ?? "#253C6D")} />
              )}
            </Field>
          )}

          {resource === "rooms" && (
            <>
              <Field id="academic-building" label={t("fields.building")} error={errors.building}>
                {(props) => <Input {...props} name="building" defaultValue={value("building", current.building)} />}
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="academic-capacity" label={t("fields.capacity")} error={errors.capacity}>
                  {(props) => <Input {...props} type="number" min={0} step={1} name="capacity" defaultValue={value("capacity", current.capacity)} />}
                </Field>
                <Field id="academic-type" label={t("fields.type")} error={errors.type}>
                  {(props) => (
                    <Select {...props} name="type" defaultValue={value("type", current.type ?? "CLASSROOM")}>
                      {ROOM_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {t(`roomTypes.${type}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            </>
          )}

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

export function AcademicManager({
  programs,
  groups,
  subjects,
  rooms,
  defaultAcademicYear,
}: {
  programs: Program[];
  groups: Group[];
  subjects: Subject[];
  rooms: Room[];
  defaultAcademicYear: string;
}) {
  const t = useTranslations("admin.academic");
  const [tab, setTab] = useState<AcademicResource>("programs");
  const [feedback, setFeedback] = useFeedback();
  const [dialog, setDialog] = useState<DialogState>({ open: false, resource: "programs", editing: null, key: 0 });

  const openDialog = (resource: AcademicResource, editing: Item | null) =>
    setDialog((d) => ({ open: true, resource, editing, key: d.key + 1 }));

  const remove = async (resource: AcademicResource, item: Item) => {
    const result = await deleteAcademicAction(resource, item.id, item.name);
    setFeedback(result.message ? { type: result.ok ? "success" : "error", message: result.message } : null);
  };

  const actions = (resource: AcademicResource, item: Item) => (
    <div className="flex justify-end gap-2">
      <Button variant="outline" size="sm" className="rounded-full" onClick={() => openDialog(resource, item)}>
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        {t("edit")}
      </Button>
      <ConfirmDialog
        trigger={
          <Button variant="outline" size="sm" className="rounded-full text-destructive hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t("delete")}
          </Button>
        }
        title={t("confirmDeleteTitle", { name: item.name })}
        description={t("confirmDeleteDescription")}
        confirmLabel={t("confirmDelete")}
        onConfirm={() => remove(resource, item)}
      />
    </div>
  );

  const addButton = (resource: AcademicResource) => (
    <Button className="rounded-full" onClick={() => openDialog(resource, null)}>
      <Plus className="h-4 w-4" aria-hidden="true" />
      {t(`add.${resource}`)}
    </Button>
  );

  const section = (resource: AcademicResource, icon: typeof Users, count: number, table: React.ReactNode) => (
    <TabsContent value={resource} className="space-y-4">
      <div className="flex justify-end">{addButton(resource)}</div>
      {count === 0 ? <EmptyState icon={icon} title={t(`empty.${resource}`)} headingLevel="h3" /> : table}
    </TabsContent>
  );

  return (
    <div className="space-y-4">
      <InlineFeedback feedback={feedback} />

      <Tabs value={tab} onValueChange={(value) => setTab(value as AcademicResource)}>
        <TabsList aria-label={t("title")}>
          <TabsTrigger value="programs">{t("tabs.programs")}</TabsTrigger>
          <TabsTrigger value="groups">{t("tabs.groups")}</TabsTrigger>
          <TabsTrigger value="subjects">{t("tabs.subjects")}</TabsTrigger>
          <TabsTrigger value="rooms">{t("tabs.rooms")}</TabsTrigger>
        </TabsList>

        {section(
          "programs",
          GraduationCap,
          programs.length,
          <Table aria-label={t("tabs.programs")}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fields.name")}</TableHead>
                <TableHead>{t("fields.code")}</TableHead>
                <TableHead>{t("fields.description")}</TableHead>
                <TableHead className="text-right">{t("fields.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {programs.map((program) => (
                <TableRow key={program.id}>
                  <TableCell className="font-medium">{program.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{program.code}</Badge>
                  </TableCell>
                  <TableCell className="max-w-sm text-muted-foreground">{program.description}</TableCell>
                  <TableCell>{actions("programs", program)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {section(
          "groups",
          Users,
          groups.length,
          <Table aria-label={t("tabs.groups")}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fields.name")}</TableHead>
                <TableHead>{t("fields.program")}</TableHead>
                <TableHead>{t("fields.level")}</TableHead>
                <TableHead>{t("fields.academicYear")}</TableHead>
                <TableHead>{t("fields.students")}</TableHead>
                <TableHead className="text-right">{t("fields.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell className="font-medium">{group.name}</TableCell>
                  <TableCell>{group.program ? `${group.program.name} (${group.program.code})` : "—"}</TableCell>
                  <TableCell>{t("levelValue", { level: group.level })}</TableCell>
                  <TableCell>{group.academicYear}</TableCell>
                  <TableCell>{group.studentCount ?? 0}</TableCell>
                  <TableCell>{actions("groups", group)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {section(
          "subjects",
          BookOpen,
          subjects.length,
          <Table aria-label={t("tabs.subjects")}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fields.name")}</TableHead>
                <TableHead>{t("fields.code")}</TableHead>
                <TableHead>{t("fields.color")}</TableHead>
                <TableHead className="text-right">{t("fields.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subjects.map((subject) => (
                <TableRow key={subject.id}>
                  <TableCell className="font-medium">{subject.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{subject.code}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-4 w-4 rounded-full border" style={{ backgroundColor: subject.color }} aria-hidden="true" />
                      <span className="font-mono text-xs">{subject.color}</span>
                    </span>
                  </TableCell>
                  <TableCell>{actions("subjects", subject)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {section(
          "rooms",
          DoorOpen,
          rooms.length,
          <Table aria-label={t("tabs.rooms")}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("fields.name")}</TableHead>
                <TableHead>{t("fields.building")}</TableHead>
                <TableHead>{t("fields.capacity")}</TableHead>
                <TableHead>{t("fields.type")}</TableHead>
                <TableHead className="text-right">{t("fields.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rooms.map((room) => (
                <TableRow key={room.id}>
                  <TableCell className="font-medium">{room.name}</TableCell>
                  <TableCell>{room.building || "—"}</TableCell>
                  <TableCell>{room.capacity ?? "—"}</TableCell>
                  <TableCell>{t(`roomTypes.${room.type}`)}</TableCell>
                  <TableCell>{actions("rooms", room)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Tabs>

      <ResourceDialog
        key={dialog.key}
        state={dialog}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        programs={programs}
        defaultAcademicYear={defaultAcademicYear}
        onSaved={setFeedback}
      />
    </div>
  );
}
