import { content } from "@/lib/content";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
        {content.hero.title}
      </h1>
      <p className="max-w-xl text-lg text-foreground/70">
        {content.hero.subtitle}
      </p>
      <p className="text-sm text-foreground/50">{content.hero.status}</p>
    </main>
  );
}
