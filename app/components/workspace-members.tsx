"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Lock, User, Xmark } from "iconoir-react";
import type { AvatarSelection } from "@/lib/appearance";
import { CharacterAvatar } from "./character-avatar";
import { useOptionalAppearance } from "./appearance-provider";

interface MemberView {
  userId: string;
  email: string;
  displayName: string;
  role: "owner" | "approver" | "member";
  isOwner: boolean;
  profileAvatar?: AvatarSelection | null;
}

interface InvitationView {
  id: string;
  role: "owner" | "approver" | "member";
  expiresAt: string | number;
}

interface WorkspaceView {
  organizationId: string;
  name: string;
  role: "owner" | "approver" | "member";
  isPersonal: boolean;
}

/**
 * Who is in this workspace, and what they may do.
 *
 * The roster is visible to everyone in the workspace — knowing who else can
 * see your data is not privileged — while every control that changes it is
 * gated on the owner role, which the API enforces independently.
 */
export function WorkspaceMembers() {
  const t = useTranslations();
  const appearance = useOptionalAppearance();
  const [role, setRole] = useState<MemberView["role"]>("member");
  const [members, setMembers] = useState<MemberView[]>([]);
  const [invitations, setInvitations] = useState<InvitationView[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceView[]>([]);
  const [active, setActive] = useState("");
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [inviteRole, setInviteRole] = useState<"approver" | "member">("member");
  const [issuedCode, setIssuedCode] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  /**
   * Re-reads the roster, workspaces and invitations after any change.
   *
   * `stillMounted` guards every write: these are three sequential fetches, and
   * the card can be unmounted (Settings closed, workspace switched) while they
   * are in flight.
   */
  const load = useCallback(async (stillMounted: () => boolean = () => true) => {
    const roster = await fetch("/api/organizations/members", { cache: "no-store" });
    if (!roster.ok) return;
    const data = await roster.json().catch(() => ({})) as { role?: MemberView["role"]; members?: MemberView[] };
    if (!stillMounted()) return;
    setAvailable(true);
    setRole(data.role ?? "member");
    setMembers(data.members ?? []);

    const list = await fetch("/api/organizations/workspaces", { cache: "no-store" });
    if (list.ok && stillMounted()) {
      const body = await list.json().catch(() => ({})) as { active?: string; workspaces?: WorkspaceView[] };
      setActive(body.active ?? "");
      setWorkspaces(body.workspaces ?? []);
    }
    // Only an owner may read outstanding invitations, so a non-owner's 403
    // here is the expected answer rather than a failure worth reporting.
    const pending = await fetch("/api/organizations/invitations", { cache: "no-store" });
    if (pending.ok && stillMounted()) {
      const body = await pending.json().catch(() => ({})) as { invitations?: InvitationView[] };
      setInvitations(body.invitations ?? []);
    }
  }, []);

  useEffect(() => {
    let live = true;
    // Defined inside the effect so the state writes are unambiguously
    // asynchronous: they happen after the first fetch resolves, never during
    // the render pass that scheduled this.
    const run = async () => {
      try { await load(() => live); }
      catch { if (live) setError(t("SettingsModule.unavailable")); }
      finally { if (live) setLoading(false); }
    };
    void run();
    return () => { live = false; };
  }, [load, t, appearance?.saved.profile]);

  const act = async (run: () => Promise<Response>, success: string) => {
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const response = await run();
      const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
      if (!response.ok) throw new Error(body.error ?? t("WorkspaceMembers.failed"));
      if (body.code) setIssuedCode(body.code);
      setMessage(success);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("WorkspaceMembers.failed"));
    } finally {
      setWorking(false);
    }
  };

  if (!available) return <p className="settings-muted" role="status">{t(loading ? "SettingsModule.loading" : "SettingsModule.unavailable")}</p>;
  const isOwner = role === "owner";

  return (
    <article className="settings-card workspace-members" data-reveal>
      <div className="workspace-header">
        <div>
          <p className="eyebrow">{t("WorkspaceMembers.eyebrow")}</p>
          <h2>{t("WorkspaceMembers.title")}</h2>
        </div>
        {!isOwner && (
          <span className="workspace-role-badge">
            <Lock width={13} height={13}/>{t(`WorkspaceMembers.role_${role}`)}
          </span>
        )}
      </div>

      <p className="workspace-explainer">{t("WorkspaceMembers.explainer")}</p>

      {workspaces.length > 1 && (
        <div className="workspace-switcher">
          <span>{t("WorkspaceMembers.switchLabel")}</span>
          <div className="workspace-switcher-options">
            {workspaces.map((workspace) => (
              <button
                key={workspace.organizationId}
                type="button"
                className={`workspace-chip${workspace.organizationId === active ? " current" : ""}`}
                disabled={working || workspace.organizationId === active}
                onClick={() => act(
                  () => fetch("/api/organizations/workspaces", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ organizationId: workspace.organizationId }),
                  }),
                  t("WorkspaceMembers.switched", { name: workspace.name }),
                )}
              >
                {workspace.name}
                <small>{t(`WorkspaceMembers.role_${workspace.role}`)}</small>
              </button>
            ))}
          </div>
        </div>
      )}

      <ul className="workspace-roster">
        {members.map((member) => (
          <li key={member.userId}>
            {member.profileAvatar ? <CharacterAvatar avatar={member.profileAvatar} size={34} label={member.displayName}/> : <span className="workspace-avatar" aria-hidden="true"><User width={15} height={15}/></span>}
            <div className="workspace-identity">
              <strong>{member.displayName}</strong>
              <small>{member.email}</small>
            </div>
            {isOwner && !member.isOwner ? (
              <select
                value={member.role}
                disabled={working}
                aria-label={t("WorkspaceMembers.roleFor", { name: member.displayName })}
                onChange={(event) => act(
                  () => fetch("/api/organizations/members", {
                    method: "PATCH",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ userId: member.userId, role: event.target.value }),
                  }),
                  t("WorkspaceMembers.roleUpdated", { name: member.displayName }),
                )}
              >
                <option value="member">{t("WorkspaceMembers.role_member")}</option>
                <option value="approver">{t("WorkspaceMembers.role_approver")}</option>
              </select>
            ) : (
              <span className="workspace-role-tag">{t(`WorkspaceMembers.role_${member.role}`)}</span>
            )}
            {isOwner && !member.isOwner && (
              <button
                type="button"
                className="workspace-remove"
                disabled={working}
                aria-label={t("WorkspaceMembers.removeMember", { name: member.displayName })}
                onClick={() => act(
                  () => fetch(`/api/organizations/members?userId=${encodeURIComponent(member.userId)}`, { method: "DELETE" }),
                  t("WorkspaceMembers.removed", { name: member.displayName }),
                )}
              >
                <Xmark width={14} height={14}/>
              </button>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <div className="workspace-invite">
          <div className="workspace-invite-controls">
            <label>
              <span>{t("WorkspaceMembers.inviteAs")}</span>
              <select value={inviteRole} disabled={working} onChange={(event) => setInviteRole(event.target.value as "approver" | "member")}>
                <option value="member">{t("WorkspaceMembers.role_member")}</option>
                <option value="approver">{t("WorkspaceMembers.role_approver")}</option>
              </select>
            </label>
            <button
              type="button"
              className="primary-button"
              disabled={working}
              onClick={() => act(
                () => fetch("/api/organizations/invitations", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ role: inviteRole }),
                }),
                t("WorkspaceMembers.inviteCreated"),
              )}
            >
              {t("WorkspaceMembers.createInvite")}
            </button>
          </div>

          {issuedCode && (
            <div className="workspace-code" role="status">
              <div>
                <p>{t("WorkspaceMembers.codeOnce")}</p>
                <code>{issuedCode}</code>
              </div>
              <button
                type="button"
                className="soft-button"
                onClick={() => { void navigator.clipboard?.writeText(issuedCode); setMessage(t("WorkspaceMembers.codeCopied")); }}
              >
                <Copy width={14} height={14}/>{t("WorkspaceMembers.copy")}
              </button>
            </div>
          )}

          {invitations.length > 0 && (
            <ul className="workspace-invitations">
              {invitations.map((invitation) => (
                <li key={invitation.id}>
                  <span>{t("WorkspaceMembers.pendingInvite", { role: t(`WorkspaceMembers.role_${invitation.role}`) })}</span>
                  <button
                    type="button"
                    className="soft-button"
                    disabled={working}
                    onClick={() => act(
                      () => fetch(`/api/organizations/invitations?id=${encodeURIComponent(invitation.id)}`, { method: "DELETE" }),
                      t("WorkspaceMembers.inviteRevoked"),
                    )}
                  >
                    {t("WorkspaceMembers.revoke")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="workspace-redeem">
        <label>
          <span>{t("WorkspaceMembers.joinLabel")}</span>
          <small>{t("WorkspaceMembers.joinHint")}</small>
          <input
            value={redeemCode}
            onChange={(event) => setRedeemCode(event.target.value)}
            placeholder="AVAL-XXXXX-XXXXX-XXXXX-XXXXX"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button
          type="button"
          className="soft-button"
          disabled={working || !redeemCode.trim()}
          onClick={() => act(
            () => fetch("/api/organizations/workspaces", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ code: redeemCode.trim() }),
            }),
            t("WorkspaceMembers.joined"),
          ).then(() => setRedeemCode(""))}
        >
          {t("WorkspaceMembers.join")}
        </button>
      </div>

      {(error || message) && (
        <p className={error ? "workspace-feedback error" : "workspace-feedback success"} role="status">{error || message}</p>
      )}
    </article>
  );
}
