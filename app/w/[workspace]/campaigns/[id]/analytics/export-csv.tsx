"use client";
import { Button } from "@/components/ui";
import { toCsv } from "@/lib/csv";

export function ExportCsvButton({ rows, filename }: { rows: (string | number)[][]; filename: string }) {
  function download() {
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Button variant="outline" onClick={download}>
      Export CSV
    </Button>
  );
}
