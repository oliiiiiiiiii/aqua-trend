import type { Metadata } from "next";
import BatchApp from "@/components/detective/batch/BatchApp";

export const metadata: Metadata = {
  title: "Batch questions",
  description:
    "Upload a CSV with one Earth event per row. Each question is answered like a single Trend Detective question, and the answers can be downloaded as a CSV or opened in the workbench.",
};

export default function BatchPage() {
  return <BatchApp />;
}
