/**
 * Workspace singleton with a minimal event bus.
 *
 * This is intentionally small and framework-agnostic: installation hooks, extensions,
 * and other subsystems can coordinate by publishing/subscribing to events.
 */
export type WorkspaceEventName = string;

export type WorkspaceEventHandler<TPayload = unknown> = (payload: TPayload) => unknown | Promise<unknown>;

export type ResourceTypeName = string;

export type WorkspaceResourceType = {
  /**
   * Unique identifier for this resource type (e.g. "project", "event.hook-pre-install").
   * If omitted, defaults to `resourceType`.
   */
  id?: string;
  resourceType: ResourceTypeName;
  enabled?: boolean;
  instanceCount?: 'none' | 'singletone' | 'single' | 'multiple';
  source?: string;
  title?: string;
  description?: string;
  version?: string;
  root?: string;
  [key: string]: unknown;
};

export type WorkspaceResourceInstance = {
  resourceId: string; // e.g. "project:myProject"
  resourceType: ResourceTypeName; // e.g. "project"
  id: string; // short id, e.g. "myProject"
  enabled?: boolean;
  source?: string;
  title?: string;
  description?: string;
  version?: string;
  root?: string;
  [key: string]: unknown;
};

export class EventBus {
  private readonly handlersByEvent = new Map<WorkspaceEventName, Set<WorkspaceEventHandler<any>>>();

  on<TPayload = unknown>(eventName: WorkspaceEventName, handler: WorkspaceEventHandler<TPayload>): () => void {
    const name = String(eventName || '').trim();
    if (!name) throw new Error('EventBus.on: eventName is required');
    if (typeof handler !== 'function') throw new Error(`EventBus.on(${name}): handler must be a function`);

    const set = this.handlersByEvent.get(name) || new Set();
    set.add(handler as WorkspaceEventHandler<any>);
    this.handlersByEvent.set(name, set);

    return () => this.off(name, handler);
  }

  off<TPayload = unknown>(eventName: WorkspaceEventName, handler: WorkspaceEventHandler<TPayload>): void {
    const name = String(eventName || '').trim();
    const set = this.handlersByEvent.get(name);
    if (!set) return;
    set.delete(handler as WorkspaceEventHandler<any>);
    if (set.size === 0) this.handlersByEvent.delete(name);
  }

  /**
   * Emit an event and collect results from all handlers.
   * Errors are collected and returned as Error instances (emit never throws).
   */
  async emit<TPayload = unknown>(eventName: WorkspaceEventName, payload: TPayload): Promise<unknown[]> {
    const name = String(eventName || '').trim();
    const set = this.handlersByEvent.get(name);
    if (!set || set.size === 0) return [];

    const handlers = Array.from(set);
    const results: unknown[] = [];
    for (const h of handlers) {
      try {
        results.push(await h(payload));
      } catch (e) {
        results.push(e instanceof Error ? e : new Error(String(e)));
      }
    }
    return results;
  }

  listeners(eventName: WorkspaceEventName): number {
    const set = this.handlersByEvent.get(String(eventName || '').trim());
    return set ? set.size : 0;
  }

  clear(eventName?: WorkspaceEventName): void {
    if (eventName) {
      this.handlersByEvent.delete(String(eventName).trim());
      return;
    }
    this.handlersByEvent.clear();
  }
}

type RegisterResourceTypeEvent = {
  resourceType: string;
  def: WorkspaceResourceType;
};

type RegisterResourceInstanceEvent = {
  resourceId: string;
  instance: WorkspaceResourceInstance;
};

export class Workspace {
  private readonly _events = new EventBus();

  private eventTypeId(eventName: string): string {
    return `event.${eventName}`;
  }

  private ensureEventRegistered(eventName: string): void {
    const name = String(eventName || '').trim();
    if (!name) throw new Error('workspace.events: eventName is required');
    const typeId = this.eventTypeId(name);
    const def = this.resources.types.get(typeId);
    if (!def || def.resourceType !== 'event' || def.enabled === false) {
      throw new Error(
        `Event '${name}' is not registered. Register it via workspace.resources.registerResourceType({ resourceType: 'event', id: '${typeId}', ... }) before using workspace.events.`
      );
    }
  }

  public readonly events = {
    on: <TPayload = unknown>(eventName: WorkspaceEventName, handler: WorkspaceEventHandler<TPayload>): (() => void) => {
      this.ensureEventRegistered(String(eventName || '').trim());
      return this._events.on(eventName, handler);
    },
    off: <TPayload = unknown>(eventName: WorkspaceEventName, handler: WorkspaceEventHandler<TPayload>): void => {
      this.ensureEventRegistered(String(eventName || '').trim());
      this._events.off(eventName, handler);
    },
    emit: async <TPayload = unknown>(eventName: WorkspaceEventName, payload: TPayload): Promise<unknown[]> => {
      this.ensureEventRegistered(String(eventName || '').trim());
      return await this._events.emit(eventName, payload);
    },
    listeners: (eventName: WorkspaceEventName): number => this._events.listeners(eventName),
    clear: (eventName?: WorkspaceEventName): void => this._events.clear(eventName)
  } as const;

  public readonly resources = {
    // Keyed by resource type id (e.g. "project", "event.hook-pre-install")
    types: new Map<string, WorkspaceResourceType>(),
    instances: new Map<string, WorkspaceResourceInstance>(),

    registerResourceType: (def: WorkspaceResourceType, opts?: { emitHook?: boolean }): WorkspaceResourceType => {
      const typeName = String(def?.resourceType || '').trim();
      if (!typeName) throw new Error('registerResourceType: def.resourceType is required');

      const id = String(def?.id || typeName).trim();
      if (!id) throw new Error('registerResourceType: def.id is required');

      const next: WorkspaceResourceType = { enabled: true, ...def, id, resourceType: typeName };
      this.resources.types.set(id, next);

      // Avoid recursion: ensure hook event types exist before emitting hook events.
      // These are bootstrapped silently (no further hook emissions).
      if (!this.resources.types.has('event.hook-register-resource-type')) {
        this.resources.registerResourceType(
          { resourceType: 'event', id: 'event.hook-register-resource-type', instanceCount: 'none', title: 'Resource type registered' },
          { emitHook: false }
        );
      }
      if (!this.resources.types.has('event.hook-register-resource-instance')) {
        this.resources.registerResourceType(
          { resourceType: 'event', id: 'event.hook-register-resource-instance', instanceCount: 'none', title: 'Resource instance registered' },
          { emitHook: false }
        );
      }

      // Emit hook event (default on).
      if (opts?.emitHook !== false) {
        void this.events.emit(
          'hook-register-resource-type',
          { resourceType: id, def: next } satisfies RegisterResourceTypeEvent
        );
      }

      return next;
    },

    registerResourceInstance: (instance: WorkspaceResourceInstance): WorkspaceResourceInstance => {
      const resourceId = String(instance?.resourceId || '').trim();
      if (!resourceId) throw new Error('registerResourceInstance: instance.resourceId is required');
      const resourceType = String(instance?.resourceType || '').trim();
      if (!resourceType) throw new Error('registerResourceInstance: instance.resourceType is required');
      const id = String(instance?.id || '').trim();
      if (!id) throw new Error('registerResourceInstance: instance.id is required');

      const next: WorkspaceResourceInstance = { enabled: true, ...instance, resourceId, resourceType, id };
      this.resources.instances.set(resourceId, next);
      // Ensure the hook event is registered before emitting.
      if (!this.resources.types.has('event.hook-register-resource-instance')) {
        this.resources.registerResourceType(
          { resourceType: 'event', id: 'event.hook-register-resource-instance', instanceCount: 'none', title: 'Resource instance registered' },
          { emitHook: false }
        );
      }
      void this.events.emit(
        'hook-register-resource-instance',
        { resourceId, instance: next } satisfies RegisterResourceInstanceEvent
      );
      return next;
    },

    clear: () => {
      this.resources.types.clear();
      this.resources.instances.clear();
    }
  } as const;

  constructor() {
    // Bootstrap: register core workspace events before any other code can use workspace.events.
    this.resources.registerResourceType(
      { resourceType: 'event', id: 'event.hook-register-resource-type', instanceCount: 'none', title: 'Resource type registered' },
      { emitHook: false }
    );
    this.resources.registerResourceType(
      { resourceType: 'event', id: 'event.hook-register-resource-instance', instanceCount: 'none', title: 'Resource instance registered' },
      { emitHook: false }
    );
  }

  private activeProjectId: string | null = null;

  public readonly projects = {
    ensureProjectType: (): WorkspaceResourceType => {
      const existing = this.resources.types.get('project');
      if (existing) return existing;
      return this.resources.registerResourceType({
        resourceType: 'project',
        id: 'project',
        instanceCount: 'multiple',
        title: 'Project',
        description: 'Workspace project resource'
      });
    },

    post: (args: { id: string; src: string; title?: string; description?: string; checks?: unknown[] }): WorkspaceResourceInstance => {
      this.projects.ensureProjectType();
      const id = String(args?.id || '').trim();
      const src = String(args?.src || '').trim();
      if (!id) throw new Error('project.post: id is required');
      if (!src) throw new Error('project.post: src is required');
      const resourceId = `project:${id}`;
      return this.resources.registerResourceInstance({
        resourceId,
        resourceType: 'project',
        id,
        src,
        title: args.title,
        description: args.description,
        checks: args.checks
      });
    },

    list: (): WorkspaceResourceInstance[] => {
      return Array.from(this.resources.instances.values()).filter((x) => x.resourceType === 'project' && x.enabled !== false);
    },

    setActive: (projectId: string): void => {
      const id = String(projectId || '').trim();
      if (!id) throw new Error('project.setActive: projectId is required');
      const rid = `project:${id}`;
      const p = this.resources.instances.get(rid);
      if (!p || p.resourceType !== 'project' || p.enabled === false) {
        throw new Error(`project.setActive: project not found: ${id}`);
      }
      this.activeProjectId = id;
    },

    getActive: (): WorkspaceResourceInstance | null => {
      if (this.activeProjectId) {
        const rid = `project:${this.activeProjectId}`;
        const p = this.resources.instances.get(rid);
        if (p && p.resourceType === 'project' && p.enabled !== false) return p;
      }

      const projects = this.projects.list();
      if (projects.length === 1) return projects[0];
      return null;
    },

    clear: (): void => {
      // Remove only project instances and reset active selection.
      for (const [rid, inst] of this.resources.instances.entries()) {
        if (inst.resourceType === 'project') this.resources.instances.delete(rid);
      }
      this.activeProjectId = null;
    }
  } as const;
}

let WORKSPACE_SINGLETON: Workspace | null = null;

export function getWorkspace(): Workspace {
  if (!WORKSPACE_SINGLETON) WORKSPACE_SINGLETON = new Workspace();
  return WORKSPACE_SINGLETON;
}

export const workspace = getWorkspace();

