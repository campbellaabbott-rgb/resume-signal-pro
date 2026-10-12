import * as React from "react";
import { MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The "⋯" menu: secondary actions on a card, a pane or a page header.
 *
 * The trigger's name says whose actions these are ("More actions for Staff
 * Nurse"), because a list of twenty cards with twenty buttons all called
 * "More" is unusable by ear. Each item has an icon AND its words.
 */
export interface OverflowMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  /** Draw a separator above this item. */
  separated?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}

export interface OverflowMenuProps {
  /** The trigger's full accessible name, e.g. t("…moreActionsFor", { title }). */
  label: string;
  items: OverflowMenuItem[];
  align?: "start" | "end";
  className?: string;
  triggerSize?: "sm" | "md" | "lg";
}

function OverflowMenu({ label, items, align = "end", className, triggerSize = "md" }: OverflowMenuProps) {
  if (!items.length) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label={label} size={triggerSize} className={className}>
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-[12rem]">
        {items.map((item) => (
          <React.Fragment key={item.key}>
            {item.separated ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              disabled={item.disabled}
              onSelect={() => item.onSelect()}
              className={cn("gap-2 coarse:min-h-11", item.destructive && "text-destructive focus:text-destructive")}
            >
              {item.icon ? <span aria-hidden="true" className="inline-flex text-muted-foreground [&_svg]:size-4">{item.icon}</span> : null}
              <span>{item.label}</span>
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { OverflowMenu };
