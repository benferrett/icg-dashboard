// Shared building blocks for the tabbed dashboard views.
// Extracted from the original single-page dashboard so each view file can
// import the same chart palette, tooltip, and empty/loading helpers.

export const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export function ChartTooltip({ active, payload, label, valueFmt }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="font-medium mb-0.5">{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} className="tabular-nums text-muted-foreground">
          {valueFmt ? valueFmt(p.value) : p.value}
        </div>
      ))}
    </div>
  );
}
