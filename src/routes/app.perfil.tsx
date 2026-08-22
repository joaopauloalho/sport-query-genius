import { createFileRoute } from "@tanstack/react-router";
import { Loader2, UserRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useScoutly } from "@/lib/store";

export const Route = createFileRoute("/app/perfil")({
  head: () => ({ meta: [{ title: "Perfil — Scoutly AI" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { profile, loadingUserData, updateProfile } = useScoutly();
  const [name, setName] = useState(profile.name);
  const [saving, setSaving] = useState(false);

  useEffect(() => setName(profile.name), [profile.name]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await updateProfile({ name });
      toast.success("Perfil atualizado.");
    } finally {
      setSaving(false);
    }
  }

  if (loadingUserData) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Carregando perfil…
        </span>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="flex items-center gap-2 text-2xl font-bold">
        <UserRound className="size-5 text-primary" /> Perfil
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Dados básicos vinculados à sua conta Supabase Auth.
      </p>

      <form onSubmit={submit} className="surface-card mt-7 space-y-4 p-5 sm:p-6">
        <label className="block text-sm font-medium">
          Nome de exibição
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
        </label>
        <label className="block text-sm font-medium">
          E-mail
          <input
            value={profile.email}
            disabled
            className="mt-1.5 h-10 w-full rounded-md border border-input bg-muted px-3 text-sm text-muted-foreground"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          O e-mail vem do usuário autenticado. O nome de exibição não é usado para autorização.
        </p>
        <Button type="submit" disabled={saving || !name.trim()}>
          {saving && <Loader2 className="mr-2 size-4 animate-spin" />} Salvar perfil
        </Button>
      </form>
    </div>
  );
}
