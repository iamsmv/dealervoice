import Link from "next/link";

const features = [
  { title: "Answers every call", body: "An AI receptionist that picks up 24/7, in English or Hindi, and never puts a buyer on hold." },
  { title: "Books test drives", body: "Collects name, phone and email, then books straight into your calendar with a confirmation email." },
  { title: "Service & trade-ins", body: "Captures service requests and trade-in details so your team calls back with everything they need." },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <span className="text-lg font-bold text-slate-900">DealerVoice</span>
        <Link href="/login" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white">
          Sign in
        </Link>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-16 pt-12 text-center sm:pt-20">
        <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-slate-900 sm:text-6xl">
          The AI receptionist for car dealerships
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-slate-600">
          Never miss a buyer again. Your AI agent answers calls, books test drives and service slots,
          and sends every lead to your team.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/login" className="rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white hover:bg-indigo-500">
            Start free trial
          </Link>
          <a href="#how" className="rounded-lg px-6 py-3 font-medium text-slate-700 ring-1 ring-slate-300">
            See how it works
          </a>
        </div>
      </section>

      <section id="how" className="mx-auto grid max-w-6xl gap-6 px-4 pb-24 sm:grid-cols-3">
        {features.map((f) => (
          <div key={f.title} className="rounded-2xl bg-slate-50 p-6 ring-1 ring-slate-200">
            <h3 className="font-semibold text-slate-900">{f.title}</h3>
            <p className="mt-2 text-sm text-slate-600">{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
