"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Pencil, Search, Trash2, UserPlus, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { SubmitButton } from "@/components/auth/submit-button";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineFeedback, useFeedback, type Feedback } from "@/components/ui/feedback";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ActionState } from "@/lib/server-api";
import { ROLES, type Group, type Role, type User } from "@/lib/types";
import { MIN_PASSWORD_LENGTH } from "@/lib/validation";
import { deleteUserAction, saveUserAction } from "./actions";

const initialState: ActionState = {};

function groupLabel(group: { name: string; level?: number; program?: { code: string } }): string {
  return [group.name, group.program?.code].filter(Boolean).join(" · ");
}

/** Add user / Edit dialog. */
function UserDialog({
  open,
  onOpenChange,
  editing,
  groups,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: User | null;
  groups: Group[];
  onSaved: (feedback: Feedback) => void;
}) {
  const t = useTranslations("admin.users");
  const tRoles = useTranslations("common.roles");
  const [role, setRole] = useState<Role>(editing?.role ?? "STUDENT");
  const [state, formAction, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await saveUserAction(prev, formData);
    if (result.ok) {
      onSaved({ type: "success", message: result.message ?? "" });
      onOpenChange(false);
    }
    return result;
  }, initialState);

  const fieldErrors = state.ok ? {} : (state.fieldErrors ?? {});
  const values = state.ok ? {} : (state.values ?? {});
  const name = editing ? `${editing.firstname} ${editing.lastname}` : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? t("editTitle", { name }) : t("addTitle")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4" noValidate>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="user-firstname" label={t("form.firstname")} error={fieldErrors.firstname}>
              {(props) => <Input {...props} name="firstname" defaultValue={values.firstname ?? editing?.firstname ?? ""} required />}
            </Field>
            <Field id="user-lastname" label={t("form.lastname")} error={fieldErrors.lastname}>
              {(props) => <Input {...props} name="lastname" defaultValue={values.lastname ?? editing?.lastname ?? ""} required />}
            </Field>
          </div>
          <Field id="user-email" label={t("form.email")} error={fieldErrors.email}>
            {(props) => <Input {...props} type="email" name="email" autoComplete="off" defaultValue={values.email ?? editing?.email ?? ""} required />}
          </Field>
          <Field
            id="user-password"
            label={t("form.password")}
            hint={editing ? t("form.passwordEditHint") : t("form.passwordHint", { min: MIN_PASSWORD_LENGTH })}
            error={fieldErrors.password}
          >
            {(props) => <Input {...props} type="password" name="password" autoComplete="new-password" required={!editing} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="user-role" label={t("form.role")} error={fieldErrors.role}>
              {(props) => (
                <Select {...props} name="role" value={role} onChange={(event) => setRole(event.target.value as Role)}>
                  {ROLES.map((value) => (
                    <option key={value} value={value}>
                      {tRoles(value)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="user-group" label={t("form.group")} hint={role === "STUDENT" ? undefined : t("form.groupHint")} error={fieldErrors.group}>
              {(props) => (
                <Select {...props} name="group" defaultValue={values.group ?? editing?.group?.id ?? ""} disabled={role !== "STUDENT"}>
                  <option value="">{t("form.noGroup")}</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {groupLabel(group)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <InlineFeedback feedback={state.ok === false && state.message ? { type: "error", message: state.message, at: state.at } : null} />
          <div className="flex justify-end">
            <SubmitButton pending={pending} className="h-10 w-auto rounded-full px-6 shadow-none">
              {t("form.save")}
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Search + role filter: updates the URL (?q=&role=) and the server page renders the list.
 * Values live in local state (initialised from the URL) so typing is never lost while the page re-renders.
 */
function UsersFilters({ q, role }: { q: string; role: string }) {
  const t = useTranslations("admin.users");
  const tRoles = useTranslations("common.roles");
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState(q);
  const [selectedRole, setSelectedRole] = useState(role);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = (nextQ: string, nextRole: string) => {
    if (timer.current) clearTimeout(timer.current);
    const params = new URLSearchParams();
    if (nextQ.trim()) params.set("q", nextQ.trim());
    if (nextRole) params.set("role", nextRole);
    const query = params.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname));
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <form
      role="search"
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        apply(search, selectedRole);
      }}
    >
      <div className="flex-1 space-y-2">
        <label htmlFor="users-search" className="block text-sm font-medium">
          {t("search")}
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id="users-search"
            type="search"
            name="q"
            value={search}
            placeholder={t("searchPlaceholder")}
            className="pl-10"
            onChange={(event) => {
              const value = event.target.value;
              setSearch(value);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => apply(value, selectedRole), 400);
            }}
          />
        </div>
      </div>
      <div className="space-y-2 sm:w-56">
        <label htmlFor="users-role" className="block text-sm font-medium">
          {t("role")}
        </label>
        <Select
          id="users-role"
          name="role"
          value={selectedRole}
          onChange={(event) => {
            setSelectedRole(event.target.value);
            apply(search, event.target.value);
          }}
        >
          <option value="">{t("allRoles")}</option>
          {ROLES.map((value) => (
            <option key={value} value={value}>
              {tRoles(value)}
            </option>
          ))}
        </Select>
      </div>
    </form>
  );
}

export function UsersManager({
  users,
  total,
  groups,
  currentUserId,
  filters,
  loadError,
}: {
  users: User[];
  total: number;
  groups: Group[];
  currentUserId: string;
  filters: { q: string; role: string };
  loadError: string | null;
}) {
  const t = useTranslations("admin.users");
  const tRoles = useTranslations("common.roles");
  const tPagination = useTranslations("common.pagination");
  const [feedback, setFeedback] = useFeedback();
  const [dialog, setDialog] = useState<{ open: boolean; editing: User | null; key: number }>({ open: false, editing: null, key: 0 });

  const openDialog = (editing: User | null) => setDialog((d) => ({ open: true, editing, key: d.key + 1 }));

  const remove = async (target: User) => {
    const name = `${target.firstname} ${target.lastname}`;
    const result = await deleteUserAction(target.id, name);
    setFeedback(result.message ? { type: result.ok ? "success" : "error", message: result.message } : null);
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Button className="rounded-full" onClick={() => openDialog(null)}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            {t("add")}
          </Button>
        }
      />

      <UsersFilters q={filters.q} role={filters.role} />

      <InlineFeedback feedback={loadError ? { type: "error", message: loadError } : feedback} />

      {!loadError && users.length === 0 ? (
        <EmptyState icon={Users} title={t("empty")} />
      ) : (
        !loadError && (
          <>
            <p className="text-sm text-muted-foreground">{tPagination("total", { count: total })}</p>
            <Table aria-label={t("title")}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.name")}</TableHead>
                  <TableHead>{t("columns.email")}</TableHead>
                  <TableHead>{t("columns.role")}</TableHead>
                  <TableHead>{t("columns.group")}</TableHead>
                  <TableHead className="text-right">{t("columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((row) => {
                  const name = `${row.firstname} ${row.lastname}`;
                  const isSelf = row.id === currentUserId;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        {name}
                        {isSelf && <span className="ml-2 text-xs text-muted-foreground">({t("you")})</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{row.email}</TableCell>
                      <TableCell>
                        <Badge variant={row.role === "ADMIN" ? "default" : "secondary"}>{tRoles(row.role)}</Badge>
                      </TableCell>
                      <TableCell>{row.group ? groupLabel(row.group) : "—"}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" className="rounded-full" onClick={() => openDialog(row)}>
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            {t("edit")}
                          </Button>
                          {!isSelf && (
                            <ConfirmDialog
                              trigger={
                                <Button variant="outline" size="sm" className="rounded-full text-destructive hover:text-destructive">
                                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  {t("delete")}
                                </Button>
                              }
                              title={t("confirmDeleteTitle", { name })}
                              description={t("confirmDeleteDescription")}
                              confirmLabel={t("confirmDelete")}
                              onConfirm={() => remove(row)}
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )
      )}

      <UserDialog
        key={dialog.key}
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        editing={dialog.editing}
        groups={groups}
        onSaved={setFeedback}
      />
    </>
  );
}
