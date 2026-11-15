import { notFound } from "next/navigation";

// Developer harnesses are not part of the product: hide them in production builds.
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return children;
}
