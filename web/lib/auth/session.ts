import { auth } from "@/lib/auth";

export async function getUserIdOrNull(): Promise<string | null> {
  return (await auth())?.user?.id ?? null;
}
