import * as React from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";

const inputBase =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-subtle-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 md:text-sm";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return <input type={type} className={cn(inputBase, className)} ref={ref} {...props} />;
  },
);
Input.displayName = "Input";

export interface SearchFieldProps extends Omit<React.ComponentProps<"input">, "type"> {
  /** The field's name. Always rendered: visibly, or for screen readers only. A placeholder is never the label. */
  label: string;
  labelVisible?: boolean;
  /** The leading icon; a magnifier by default. */
  icon?: React.ReactNode;
  wrapperClassName?: string;
}

/**
 * A text field with a leading icon and a real <label>. The keyword and
 * location boxes on the board relied on placeholder text for their names
 * (WCAG 1.3.1 / 4.1.2, audit 2026-10-11).
 */
const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  ({ label, labelVisible = false, icon, className, wrapperClassName, id, ...props }, ref) => {
    const auto = React.useId();
    const fieldId = id ?? `sf-${auto}`;
    return (
      <div className={cn("min-w-0", wrapperClassName)}>
        <label htmlFor={fieldId} className={labelVisible ? "mb-1 block text-sm font-medium text-foreground" : "sr-only"}>
          {label}
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground [&_svg]:size-4" aria-hidden="true">
            {icon ?? <Search />}
          </span>
          <input id={fieldId} ref={ref} type="search" className={cn(inputBase, "pl-9", className)} {...props} />
        </div>
      </div>
    );
  },
);
SearchField.displayName = "SearchField";

export { Input, SearchField };
