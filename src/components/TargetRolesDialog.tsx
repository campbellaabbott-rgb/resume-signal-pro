/**
 * THE ROLES ATS DEFENSE TARGETS, ASKED BEFORE CHECKOUT (S11-074).
 * Mounted once in App; purchaseProduct opens it through askForTargetRoles.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MAX_TARGET_ROLES, answerTargetRoles, cleanTargetRoles, registerTargetRolesHost, useTargetRolesRequest,
} from "@/lib/target-roles-request";

export function TargetRolesDialog() {
  const { t } = useTranslation();
  const { open, suggested } = useTargetRolesRequest();
  const [roles, setRoles] = useState<string[]>(["", "", ""]);
  useEffect(() => registerTargetRolesHost(), []);
  useEffect(() => {
    if (open) setRoles(Array.from({ length: MAX_TARGET_ROLES }, (_, i) => suggested[i] ?? ""));
  }, [open, suggested]);

  const chosen = cleanTargetRoles(roles);
  const examples = [t("atsRoles.example1"), t("atsRoles.example2"), t("atsRoles.example3")];

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) answerTargetRoles(null); }}>
      <DialogContent className="sm:max-w-md" data-testid="target-roles-dialog">
        <DialogHeader>
          <DialogTitle>{t("atsRoles.title")}</DialogTitle>
          <DialogDescription>{t("atsRoles.description", { count: MAX_TARGET_ROLES })}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-2"
          onSubmit={(e) => { e.preventDefault(); if (chosen.length) answerTargetRoles(chosen); }}
        >
          {roles.map((role, i) => (
            <Input
              key={i}
              value={role}
              maxLength={80}
              aria-label={t("atsRoles.roleLabel", { n: i + 1 })}
              placeholder={examples[i]}
              onChange={(e) => setRoles((prev) => prev.map((r, j) => (j === i ? e.target.value : r)))}
            />
          ))}
          <DialogFooter className="pt-2 gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => answerTargetRoles(null)}>{t("atsRoles.cancel")}</Button>
            <Button type="submit" disabled={chosen.length === 0}>{t("atsRoles.continue")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
