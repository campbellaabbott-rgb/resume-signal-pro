import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * LEDGER BUTTONS. Flat: no gradient, no glow, no press-scale. One filled
 * primary per view; secondary for the next most likely action; ghost for
 * quiet controls; link for an inline action that reads as a link.
 *
 * Heights: sm 36, md 40 (default), lg 44, and 44 under a finger whatever the
 * size (the `coarse:` variant). `wrap` lets a long label (a "Watch" button
 * that carries an employer's full name) break onto two lines instead of
 * pushing the page sideways.
 *
 * `outline`, `hero` and `xl` stay as aliases so no existing caller changes.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 touch-manipulation",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary: "border border-border-strong bg-card text-foreground hover:bg-accent",
        outline: "border border-border-strong bg-transparent text-foreground hover:bg-accent",
        ghost: "text-foreground hover:bg-accent",
        link: "h-auto px-0 text-primary underline underline-offset-2 decoration-primary/50 hover:decoration-primary",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        hero: "bg-primary text-primary-foreground font-semibold hover:bg-primary-hover",
      },
      size: {
        sm: "h-9 px-3 coarse:min-h-11",
        default: "h-10 px-4 coarse:min-h-11",
        md: "h-10 px-4 coarse:min-h-11",
        lg: "h-11 px-6 text-base",
        xl: "h-12 px-8 text-base",
        icon: "h-10 w-10 coarse:h-11 coarse:w-11",
      },
      wrap: {
        true: "h-auto min-h-10 max-w-full whitespace-normal py-2 text-left",
        false: "whitespace-nowrap",
      },
    },
    compoundVariants: [
      { variant: "link", className: "h-auto px-0" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
      wrap: false,
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, wrap, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, wrap, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
