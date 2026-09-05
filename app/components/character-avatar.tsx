"use client";

import { avatarSources, BACKGROUNDS, type AvatarSelection, type AvatarMotion } from "@/lib/appearance";
import { useOptionalAppearance } from "./appearance-provider";

export function CharacterAvatar({ avatar, size = 40, label = "", motion, className = "" }: { avatar: AvatarSelection; size?: number; label?: string; motion?: AvatarMotion; className?: string }) {
  const preferences = useOptionalAppearance();
  const mode = motion ?? preferences?.appearance.motion ?? "system";
  const sources = avatarSources(avatar);
  return <span className={`character-avatar ${className}`} style={{ width: size, height: size, backgroundColor: BACKGROUNDS[avatar.background] }}>
    <picture>
      {mode === "system" && <source media="(prefers-reduced-motion: reduce)" srcSet={sources.still}/>}
      <img src={mode === "still" ? sources.still : sources.animated} alt={label} width={size} height={size}/>
    </picture>
  </span>;
}

export function ProfileAvatar({ name, size = 40, className = "" }: { name: string; size?: number; className?: string }) {
  const preferences = useOptionalAppearance();
  const avatar = preferences?.appearance.profile;
  if (avatar) return <CharacterAvatar avatar={avatar} size={size} label={name} className={className}/>;
  const initials = name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
  return <span className={`initials ${className}`} style={{ width: size, height: size }} aria-label={name}>{initials}</span>;
}
