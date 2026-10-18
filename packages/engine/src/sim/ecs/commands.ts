import type { CommandBuffer, ComponentDef, ComponentSchema, EntityHandle, StableKey } from '@dv/shared';

export const enum CommandOp {
  Spawn = 0,
  Despawn = 1,
  Add = 2,
  Remove = 3,
}

/** What the command buffer needs from the world. */
export interface CommandHost {
  /** Validate, reserve an id and a key. Throws EntityLimitError, DuplicateKeyError, UnknownPrefabError. */
  issueSpawn(
    prefabId: string,
    init: Readonly<Partial<Record<string, number>>> | undefined,
    key: StableKey | undefined,
  ): { handle: EntityHandle; keyId: number };
  applySpawn(handle: EntityHandle, prefabId: string, init: Readonly<Partial<Record<string, number>>> | undefined, keyId: number): void;
  applyDespawn(handle: EntityHandle): void;
  applyAdd(handle: EntityHandle, def: ComponentDef, init: Readonly<Partial<Record<string, number>>> | undefined): void;
  applyRemove(handle: EntityHandle, def: ComponentDef): void;
}

type Init = Readonly<Partial<Record<string, number>>> | undefined;

/**
 * Structural changes queued during a stage and applied, in issue order, when the stage ends (C01 rule 2).
 * `spawn` reserves the id at issue time so it can return the handle at once; the entity exists (and the handle
 * resolves) only after `apply`. A command whose handle is stale when it is applied is dropped.
 */
export class CommandBufferImpl implements CommandBuffer {
  private ops: number[] = [];
  private handles: number[] = [];
  private names: (string | ComponentDef | null)[] = [];
  private inits: Init[] = [];
  private keyIds: number[] = [];
  private applying = false;

  constructor(private readonly host: CommandHost) {}

  /** Commands waiting for the end of the stage. */
  get pending(): number {
    return this.ops.length;
  }

  spawn(prefabId: string, init?: Partial<Record<string, number>>, key?: StableKey): EntityHandle {
    const r = this.host.issueSpawn(prefabId, init, key);
    this.push(CommandOp.Spawn, r.handle, prefabId, init, r.keyId);
    return r.handle;
  }

  despawn(h: EntityHandle): void {
    this.push(CommandOp.Despawn, h, null, undefined, 0);
  }

  add<S extends ComponentSchema>(h: EntityHandle, c: ComponentDef<S>, init?: Partial<Record<keyof S, number>>): void {
    this.push(CommandOp.Add, h, c as ComponentDef, init as Init, 0);
  }

  remove(h: EntityHandle, c: ComponentDef): void {
    this.push(CommandOp.Remove, h, c, undefined, 0);
  }

  private push(op: CommandOp, h: number, name: string | ComponentDef | null, init: Init, keyId: number): void {
    if (this.applying) throw new Error('CommandBuffer: commands cannot be issued while the buffer is being applied');
    this.ops.push(op);
    this.handles.push(h);
    this.names.push(name);
    this.inits.push(init);
    this.keyIds.push(keyId);
  }

  /** Apply every queued command in issue order and empty the buffer. */
  apply(): void {
    if (this.ops.length === 0) return;
    const { ops, handles, names, inits, keyIds } = this;
    this.applying = true;
    try {
      for (let i = 0; i < ops.length; i++) {
        const h = handles[i] as EntityHandle;
        switch (ops[i] as CommandOp) {
          case CommandOp.Spawn:
            this.host.applySpawn(h, names[i] as string, inits[i], keyIds[i] as number);
            break;
          case CommandOp.Despawn:
            this.host.applyDespawn(h);
            break;
          case CommandOp.Add:
            this.host.applyAdd(h, names[i] as ComponentDef, inits[i]);
            break;
          case CommandOp.Remove:
            this.host.applyRemove(h, names[i] as ComponentDef);
            break;
        }
      }
    } finally {
      this.applying = false;
      ops.length = 0;
      handles.length = 0;
      names.length = 0;
      inits.length = 0;
      keyIds.length = 0;
    }
  }
}
