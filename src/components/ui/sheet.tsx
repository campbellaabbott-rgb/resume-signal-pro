import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/icon-button";

/**
 * SHEET: a panel that slides over the page from the right, the bottom, or
 * fills it. Built on Radix Dialog, so it traps focus, closes on Escape, hands
 * focus back to whatever opened it, and hides the rest of the page from
 * assistive technology while it is open.
 *
 * It sits on the overlay layer (z-50), above the site header (z-40), so the
 * header can never cover its close button. Its header (an h2 and a named
 * Close) and an optional footer stay put while the body scrolls.
 */
const Sheet = DialogPrimitive.Root;
const SheetTrigger = DialogPrimitive.Trigger;
const SheetClose = DialogPrimitive.Close;
const SheetPortal = DialogPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-sheet-overlay=""
    className={cn(
      "fixed inset-0 z-50 bg-background/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
SheetOverlay.displayName = "SheetOverlay";

const sheetVariants = cva(
  "fixed z-50 flex flex-col bg-card text-card-foreground shadow-overlay outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 duration-base",
  {
    variants: {
      side: {
        right: "inset-y-0 right-0 h-full w-[min(100vw,24rem)] border-l border-border-strong",
        bottom: "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-xl border-t border-border-strong",
        full: "inset-0 h-[100dvh] w-full",
      },
    },
    defaultVariants: { side: "right" },
  },
);

export interface SheetContentProps
  extends Omit<React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, "title">,
    VariantProps<typeof sheetVariants> {
  /** The sheet's heading, rendered as its h2 and its accessible name. */
  title: React.ReactNode;
  /** Visually hide the heading (it still names the dialog). */
  hideTitle?: boolean;
  description?: React.ReactNode;
  /** Name of the close button; "Close" in the reader's language by default. */
  closeLabel?: string;
  /** Extra props for the close button, e.g. aria-expanded when it also closes a menu. */
  closeProps?: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label">;
  /** Before the heading in the sticky header: a back chevron, say. */
  headerStart?: React.ReactNode;
  /** After the heading, before Close: an overflow menu, say. */
  headerEnd?: React.ReactNode;
  /** The sticky footer: the sheet's primary actions. */
  footer?: React.ReactNode;
  bodyClassName?: string;
  /**
   * Where focus goes when the sheet closes. Defaults to whatever held focus
   * when it opened (the card that opened a posting), so a sheet opened from
   * code, with no SheetTrigger, still hands focus back.
   */
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}

const SheetContent = React.forwardRef<React.ElementRef<typeof DialogPrimitive.Content>, SheetContentProps>(
  (
    { side, className, children, title, hideTitle, description, closeLabel, closeProps, headerStart, headerEnd, footer, bodyClassName, returnFocusTo, onOpenAutoFocus, onCloseAutoFocus, ...props },
    ref,
  ) => {
    const { t } = useTranslation();
    const opener = React.useRef<HTMLElement | null>(null);
    return (
      <SheetPortal>
        <SheetOverlay />
        <DialogPrimitive.Content
          ref={ref}
          data-sheet=""
          data-side={side ?? "right"}
          className={cn(sheetVariants({ side }), className)}
          {...(description ? {} : { "aria-describedby": undefined })}
          {...props}
          onOpenAutoFocus={(e) => {
            // Still the control that opened the sheet: focus has not moved yet.
            const active = typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
            opener.current = active && active !== document.body ? active : null;
            onOpenAutoFocus?.(e);
          }}
          onCloseAutoFocus={(e) => {
            onCloseAutoFocus?.(e);
            if (e.defaultPrevented) return;
            const target = returnFocusTo?.current ?? opener.current;
            if (target && target.isConnected) {
              e.preventDefault();
              target.focus();
            }
          }}
        >
          <div className="sticky top-0 z-10 flex min-h-14 items-center gap-2 border-b border-border bg-card px-4 py-2">
            {headerStart}
            <DialogPrimitive.Title asChild>
              <h2 className={cn("min-w-0 flex-1 truncate text-base font-semibold", hideTitle && "sr-only")}>{title}</h2>
            </DialogPrimitive.Title>
            {hideTitle ? <span className="flex-1" /> : null}
            {headerEnd}
            <DialogPrimitive.Close asChild>
              <IconButton aria-label={closeLabel ?? t("common.close", "Close")} {...closeProps}>
                <X />
              </IconButton>
            </DialogPrimitive.Close>
          </div>
          {description ? (
            <DialogPrimitive.Description className="px-4 pt-3 text-sm text-muted-foreground">{description}</DialogPrimitive.Description>
          ) : null}
          <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4", bodyClassName)}>{children}</div>
          {footer ? (
            <div className="sticky bottom-0 z-10 border-t border-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </SheetPortal>
    );
  },
);
SheetContent.displayName = "SheetContent";

export { Sheet, SheetTrigger, SheetClose, SheetPortal, SheetOverlay, SheetContent, sheetVariants };
