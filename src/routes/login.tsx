import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, LockKeyhole } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Logo } from "@/components/scoutly/logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Entrar — Scoutly AI" },
      { name: "description", content: "Entre ou crie sua conta Scoutly AI." },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { user, loading, configured, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) void navigate({ to: "/app", replace: true });
  }, [loading, user, navigate]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (!email.trim() || password.length < 6 || (mode === "signup" && !name.trim())) {
      setMessage("Preencha os campos. A senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    setSubmitting(true);
    try {
      const result =
        mode === "login" ? await signIn(email, password) : await signUp(email, password, name);
      if (!result.ok) {
        setMessage(result.message ?? "Não foi possível concluir a autenticação.");
        return;
      }
      if (result.needsEmailConfirmation) {
        setMessage(result.message ?? "Confirme seu e-mail para entrar.");
        setMode("login");
        return;
      }
      await navigate({ to: "/app", replace: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8 sm:px-6">
      <div className="mx-auto flex max-w-md flex-col">
        <div className="mb-10 flex items-center justify-between">
          <Link to="/" aria-label="Scoutly AI — início">
            <Logo />
          </Link>
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
            Voltar ao site
          </Link>
        </div>

        <div className="surface-card p-6 sm:p-8">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <LockKeyhole className="size-5" />
          </div>
          <h1 className="mt-5 text-2xl font-bold">
            {mode === "login" ? "Entre na sua conta" : "Crie sua conta"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Seu histórico, análises salvas e workspaces ficam sincronizados com sua conta.
          </p>

          {!loading && !configured && (
            <div className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              Supabase Auth ainda não está configurado neste ambiente.
            </div>
          )}

          <form className="mt-6 space-y-4" onSubmit={submit}>
            {mode === "signup" && (
              <label className="block text-sm font-medium">
                Nome
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring"
                  placeholder="Seu nome"
                />
              </label>
            )}
            <label className="block text-sm font-medium">
              E-mail
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring"
                placeholder="voce@email.com"
              />
            </label>
            <label className="block text-sm font-medium">
              Senha
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring"
                placeholder="Mínimo de 6 caracteres"
              />
            </label>

            {message && <p className="text-sm text-muted-foreground">{message}</p>}

            <Button
              className="w-full"
              disabled={submitting || loading || !configured}
              type="submit"
            >
              {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
              {mode === "login" ? "Entrar" : "Criar conta"}
            </Button>
          </form>

          <div className="mt-5 border-t border-border pt-5 text-center text-sm text-muted-foreground">
            {mode === "login" ? "Ainda não tem conta?" : "Já tem conta?"}{" "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setMessage(null);
              }}
            >
              {mode === "login" ? "Criar conta" : "Entrar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
