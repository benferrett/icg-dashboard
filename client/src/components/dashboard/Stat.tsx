import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";

interface StatProps {
  label: string;
  value: string;
  sub?: string;
  delta?: number; // percentage, optional
  testId?: string;
  accent?: boolean;
}

export function Stat({ label, value, sub, delta, testId, accent }: StatProps) {
  const dir = delta == null ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  return (
    <Card className="p-4 flex flex-col gap-1.5" data-testid={testId}>
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <span
        className={cn(
          "text-xl font-semibold tabular-nums leading-none",
          accent && "text-primary",
        )}
        style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
      >
        {value}
      </span>
      <div className="flex items-center gap-2 min-h-[18px]">
        {dir && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium tabular-nums",
              dir === "up" && "text-emerald-600 dark:text-emerald-400",
              dir === "down" && "text-destructive",
              dir === "flat" && "text-muted-foreground",
            )}
          >
            {dir === "up" && <ArrowUp className="h-3 w-3" />}
            {dir === "down" && <ArrowDown className="h-3 w-3" />}
            {dir === "flat" && <Minus className="h-3 w-3" />}
            {Math.abs(delta!).toFixed(0)}%
          </span>
        )}
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
    </Card>
  );
}
