import { redirect } from "next/navigation";

export default function InternalIndex() {
  redirect("/internal/shipments");
}
