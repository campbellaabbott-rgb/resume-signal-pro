import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * A button that shows only an icon. Its name is REQUIRED BY ITS TYPE: the
 * header's credits button shipped with none (WCAG 4.1.2, audit 2026-10-11),
 * and a screen reader announced it as "button". The icon itself is hidden
 * from assistive technology; the label is the whole name.
 *
 * 36px square on a mouse, 44px under a finger.
 */
const iconButtonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-md transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 touch-manipulation",
  {
    variants: {
      variant: {
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        secondary: "border border-border-strong bg-card text-foreground hover:bg-accent",
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
      },
      size: {
        sm: "h-8 w-8 coarse:h-11 coarse:w-11",
        md: "h-9 w-9 coarse:h-11 coarse:w-11",
        lg: "h-10 w-10 coarse:h-11 coarse:w-11",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

type NativeButton = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children">;

export interface IconButtonProps extends NativeButton, VariantProps<typeof iconButtonVariants> {
  /** The button's whole accessible name. Required. */
  "aria-label": string;
  /** The icon (decorative). */
  children: React.ReactNode;
  asChild?: boolean;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, asChild = false, children, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : (type ?? "button")}
        className={cn(iconButtonVariants({ variant, size }), className)}
        {...props}
      >
        {asChild ? children : <span aria-hidden="true" className="inline-flex">{children}</span>}
      </Comp>
    );
  },
);
IconButton.displayName = "IconButton";

export { IconButton, iconButtonVariants };
