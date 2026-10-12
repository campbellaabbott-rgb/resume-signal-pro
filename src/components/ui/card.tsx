import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * SURFACES. One radius (8px), a 1px border, flat by default.
 *   default      a card on the page
 *   raised       a card that sits above the page (a hairline shadow on light)
 *   inset        a well inside a card (muted fill, no border)
 *   interactive  a card the whole of which is a target; `selected` draws the
 *                ring and the tint, never the tint alone
 */
const surfaceVariants = cva("rounded-lg text-card-foreground", {
  variants: {
    variant: {
      default: "border border-border bg-card",
      raised: "border border-border bg-card shadow-xs",
      inset: "bg-muted",
      interactive:
        "border border-border bg-card transition-colors duration-fast hover:border-border-strong focus-within:border-border-strong",
    },
    selected: {
      true: "ring-2 ring-primary bg-primary-tint/50",
      false: "",
    },
  },
  defaultVariants: {
    variant: "default",
    selected: false,
  },
});

export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof surfaceVariants> {
  as?: "div" | "section" | "article" | "aside" | "li";
}

const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  ({ className, variant, selected, as = "div", ...props }, ref) => {
    // Every allowed tag is a block element; typed as div for the ref.
    const Tag = as as "div";
    return <Tag ref={ref} className={cn(surfaceVariants({ variant, selected }), className)} {...props} />;
  },
);
Surface.displayName = "Surface";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn(surfaceVariants({ variant: "default" }), className)} {...props} />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("text-xl font-semibold leading-tight", className)} {...props} />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />,
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, Surface, surfaceVariants };
