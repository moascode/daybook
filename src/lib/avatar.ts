// A stable per-user avatar tint: the same person gets the same colour on every
// row, without storing a colour anywhere.
const AVATAR_BG = ['bg-alt-bg text-alt-fg', 'bg-info-bg text-info-fg', 'bg-calm-bg text-calm-fg', 'bg-warn-bg text-warn-fg']

export function avatarClass(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0
  return AVATAR_BG[Math.abs(hash) % AVATAR_BG.length]
}
