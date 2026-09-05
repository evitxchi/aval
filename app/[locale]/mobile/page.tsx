import { redirect } from "next/navigation";
export default async function Mobile({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale === "es-mx" ? "es-mx" : "en"}`);
}
