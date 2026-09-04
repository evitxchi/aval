"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({ className, classNames, showOutsideDays = true, components: userComponents, ...props }: CalendarProps) {
  const defaultClassNames = {
    months: "relative flex flex-col gap-6 sm:flex-row",
    month: "w-full",
    month_caption: "relative mb-2 flex h-9 items-center justify-center text-base font-semibold text-foreground",
    caption_label: "text-sm font-medium",
    nav: "absolute top-1 z-10 flex w-full justify-between px-2",
    button_previous: cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-8 rounded-full text-muted-foreground hover:text-foreground"),
    button_next: cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-8 rounded-full text-muted-foreground hover:text-foreground"),
    weekdays: "grid grid-cols-7 text-center text-xs font-medium uppercase text-muted-foreground/80",
    weekday: "py-1",
    week: "grid grid-cols-7",
    day_button: cn(
      "relative flex size-9 items-center justify-center rounded-full text-sm transition-all",
      "hover:bg-accent hover:text-accent-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
      "group-data-[selected=true]:bg-foreground group-data-[selected=true]:text-background group-data-[selected=true]:shadow-md",
      "group-data-[disabled=true]:cursor-not-allowed group-data-[disabled=true]:opacity-40",
    ),
    day: "group text-center",
    range_start: "rounded-l-full bg-foreground text-background shadow-md",
    range_end: "rounded-r-full bg-foreground text-background shadow-md",
    range_middle: "rounded-none bg-foreground/10 text-foreground transition-colors dark:bg-white/20",
    today: "after:absolute after:bottom-1 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-primary",
    outside: "text-muted-foreground/50 hover:bg-accent/30 hover:text-accent-foreground",
    hidden: "invisible",
    week_number: "size-9 p-0 text-xs font-medium text-muted-foreground/80",
  };

  const mergedClassNames = Object.keys(defaultClassNames).reduce<Record<string, string>>((acc, key) => {
    const override = classNames?.[key as keyof typeof classNames];
    acc[key] = cn(defaultClassNames[key as keyof typeof defaultClassNames], override);
    return acc;
  }, {});

  const mergedComponents = {
    Chevron: ({ orientation, ...chevronProps }: React.ComponentProps<"svg"> & { orientation?: "left" | "right" | "up" | "down" }) => {
      const Icon = orientation === "left" ? ChevronLeft : ChevronRight;
      return <Icon size={18} strokeWidth={2} {...chevronProps} aria-hidden="true" />;
    },
    ...userComponents,
  };

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("w-fit rounded-xl border bg-card p-3 shadow-sm", className)}
      classNames={mergedClassNames}
      components={mergedComponents}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
