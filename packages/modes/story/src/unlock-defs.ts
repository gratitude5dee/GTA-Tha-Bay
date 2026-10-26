// The unlock rows of the story (M05c1): the fighter tile and its first fighter, and the ten district unlocks. Racing's rows are racing's.
import type { UnlockDef } from '@dv/shared';
import unlocksJson from '../../../../config/unlocks.json';

export function storyUnlockDefs(): UnlockDef[] {
  return (unlocksJson as { unlocks: UnlockDef[] }).unlocks.filter((u) => u.id !== 'unlock.racing' && !u.id.startsWith('unlock.racing.')).map((u) => ({ ...u }));
}
