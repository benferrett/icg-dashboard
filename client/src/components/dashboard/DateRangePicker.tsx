import { useState } from "react";
import { DateRange } from "react-day-picker";
import { Calendar as CalendarIcon, Check } from "lucide-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PeriodKey, PERIOD_OPTIONS } from "@/lib/api";
import { cn } from "@/lib/utils";

// Hybrid date-range picker: preset quick-picks (This Week, Last Month, ...) on
// the left, and a two-month range calendar on the right for ad-hoc ranges.
//
// Selection model (lifted to the parent):
//   - preset  -> a PeriodKey (fast, pre-warmed on the server)
//   - custom  -> { start, end } as YYYY-MM-DD (cold query, then cached)
// Exactly one of `preset` / `custom` is active at a time.

export interface CustomRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

// Format a local Date as YYYY-MM-DD (no timezone shift — we want the calendar
// day the user clicked, interpreted as a Melbourne calendar day by the server).
function ymd(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function DateRangePicker({
  preset,
  custom,
  onSelectPreset,
  onSelectCustom,
}: {
  preset: PeriodKey | null;
  custom: CustomRange | null;
  onSelectPreset: (key: PeriodKey) => void;
  onSelectCustom: (range: CustomRange) => void;
}) {
  const [open, setOpen] = useState(false);
  // Draft range while the user is clicking start/end in the calendar.
  const [draft, setDraft] = useState<DateRange | undefined>(
    custom
      ? { from: new Date(custom.start + "T00:00:00"), to: new Date(custom.end + "T00:00:00") }
      : undefined,
  );

  const activeLabel = custom
    ? `${format(new Date(custom.start + "T00:00:00"), "d MMM")} – ${format(
        new Date(custom.end + "T00:00:00"),
        "d MMM",
      )}`
    : PERIOD_OPTIONS.find((p) => p.key === preset)?.label ?? "This Week";

  const pickPreset = (key: PeriodKey) => {
    setDraft(undefined);
    onSelectPreset(key);
    setOpen(false);
  };

  const applyCustom = () => {
    if (draft?.from && draft?.to) {
      onSelectCustom({ start: ymd(draft.from), end: ymd(draft.to) });
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="h-9 min-w-[150px] justify-start gap-2 font-normal"
          data-testid="button-daterange"
        >
          <CalendarIcon className="h-4 w-4 text-muted-foreground" />
          <span className="truncate">{activeLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-0"
        align="end"
        data-testid="popover-daterange"
      >
        <div className="flex flex-col sm:flex-row">
          {/* Preset quick-picks */}
          <div className="flex flex-row flex-wrap gap-1 border-b p-2 sm:w-40 sm:flex-col sm:border-b-0 sm:border-r">
            <p className="hidden px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground sm:block">
              Quick ranges
            </p>
            {PERIOD_OPTIONS.map((p) => {
              const active = !custom && preset === p.key;
              return (
                <button
                  key={p.key}
                  data-testid={`preset-${p.key}`}
                  onClick={() => pickPreset(p.key)}
                  className={cn(
                    "flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors text-left",
                    active
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-foreground hover:bg-muted",
                  )}
                >
                  <span>{p.label}</span>
                  {active && <Check className="h-3.5 w-3.5" />}
                </button>
              );
            })}
          </div>

          {/* Custom calendar range */}
          <div className="p-2">
            <p className="px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground">
              Custom range
            </p>
            <Calendar
              mode="range"
              numberOfMonths={2}
              selected={draft}
              onSelect={setDraft}
              defaultMonth={draft?.from}
              disabled={{ after: new Date() }}
              data-testid="calendar-range"
            />
            <div className="flex items-center justify-between gap-2 border-t px-2 py-2">
              <span className="text-xs text-muted-foreground">
                {draft?.from
                  ? draft?.to
                    ? `${format(draft.from, "d MMM yyyy")} – ${format(draft.to, "d MMM yyyy")}`
                    : `${format(draft.from, "d MMM yyyy")} – …`
                  : "Pick a start and end date"}
              </span>
              <Button
                size="sm"
                className="h-7"
                disabled={!draft?.from || !draft?.to}
                onClick={applyCustom}
                data-testid="button-apply-range"
              >
                Apply
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
