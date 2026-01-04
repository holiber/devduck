export type WorkspaceInstanceCount = 'none' | 'singletone' | 'single' | 'multiple';

export type WorkspaceResourceSource = 'build-in' | (string & {});

export type WorkspaceResource = {
  /**
   * Unique identifier within its resource namespace.
   *
   * Examples:
   * - extension: "ci"
   * - provider: "ci-github"
   * - command: "fix-test"
   */
  id: string;

  /**
   * Fully qualified resource type.
   * Examples: "extension" | "provider" | "event" | "rule" | "meta" | "command" | custom string.
   */
  resourceType: 'extension' | 'provider' | 'event' | 'rule' | 'meta' | 'command' | (string & {});

  /** Enable/disable this resource type. */
  enabled?: boolean;

  /**
   * Instance lifecycle for this resource type.
   *
   * - none: purely declarative, no instances
   * - singletone: one global instance (usually for extensions)
   * - single: one instance per `root` (usually one provider per extension)
   * - multiple: multiple instances per `root`
   */
  instanceCount?: WorkspaceInstanceCount;

  /** Where this resource was loaded from. */
  source: WorkspaceResourceSource;

  /** Human-readable title. */
  title?: string;

  /** Semver or any version string. */
  version?: string;

  /**
   * Parent/root resource id.
   * For providers this is typically an extension id like "extension.ci".
   */
  root?: string;

  /** Optional free-form metadata. */
  meta?: Record<string, unknown>;
} & Record<string, unknown>;

export type WorkspaceResourceWithAPI<TApi = unknown, TContracts = unknown> = WorkspaceResource & {
  api?: TApi;
  /**
   * Provider contracts for this extension (schemas + metadata, no implementation).
   * This is intentionally permissive at the core level.
   */
  providerContracts?: TContracts;
};

export type WorkspaceResourceInstance<TApi = unknown> = {
  id: string;
  resourceType: WorkspaceResource['resourceType'];
  /**
   * Reference to the resource type id (the key in `workspace.resourceTypes`).
   * Example: "extension.ci" or "extension.ci.providers.ci.ci-github".
   */
  resourceTypeId: string;
  root?: string;
  enabled?: boolean;
  api?: TApi;
  meta?: Record<string, unknown>;
} & Record<string, unknown>;

function assertNonEmptyString(name: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function normalizeEnabled(v: unknown): boolean {
  return v === undefined ? true : !!v;
}

function normalizeInstanceCount(v: unknown): WorkspaceInstanceCount {
  const x = String(v || 'none') as WorkspaceInstanceCount;
  if (x === 'none' || x === 'singletone' || x === 'single' || x === 'multiple') return x;
  throw new Error(`instanceCount must be one of: none|singletone|single|multiple (got '${String(v)}')`);
}

function defaultResourceTypeId(r: WorkspaceResource): string {
  // Keep the convention explicit and stable.
  // - extension.ci
  // - provider.ci-github
  return `${String(r.resourceType)}.${String(r.id)}`;
}

export class Workspace {
  private static _instance: Workspace | null = null;

  static getInstance(): Workspace {
    if (!Workspace._instance) Workspace._instance = new Workspace();
    return Workspace._instance;
  }

  /**
   * Declarative registry of *resource types*.
   *
   * Key is a stable `resourceTypeId` (not necessarily equal to `resource.id`).
   */
  readonly resourceTypes: Record<string, WorkspaceResourceWithAPI> = {};

  /**
   * Registry of instantiated resources (runtime objects), keyed by unique instance id.
   */
  readonly resourceInstances: Record<string, WorkspaceResourceInstance> = {};

  private constructor() {}

  registerResourceType(resource: WorkspaceResourceWithAPI, opts?: { resourceTypeId?: string }): string {
    if (!resource || typeof resource !== 'object') {
      throw new Error('registerResourceType: resource must be an object');
    }
    assertNonEmptyString('resource.id', resource.id);
    assertNonEmptyString('resource.resourceType', resource.resourceType);
    assertNonEmptyString('resource.source', resource.source);

    const resourceTypeId = String(opts?.resourceTypeId || defaultResourceTypeId(resource)).trim();
    assertNonEmptyString('resourceTypeId', resourceTypeId);

    const normalized: WorkspaceResourceWithAPI = {
      ...resource,
      enabled: normalizeEnabled(resource.enabled),
      instanceCount: normalizeInstanceCount(resource.instanceCount)
    };

    this.resourceTypes[resourceTypeId] = normalized;
    return resourceTypeId;
  }

  registerExtention(
    resource: Omit<WorkspaceResourceWithAPI, 'resourceType' | 'instanceCount'> & { id: string; source: WorkspaceResourceSource }
  ): string {
    return this.registerResourceType(
      {
        ...resource,
        resourceType: 'extension',
        instanceCount: 'singletone'
      },
      { resourceTypeId: `extension.${resource.id}` }
    );
  }

  registerProvider(
    resource: Omit<WorkspaceResourceWithAPI, 'resourceType'> & {
      id: string;
      source: WorkspaceResourceSource;
      root: string;
      instanceCount?: Extract<WorkspaceInstanceCount, 'single' | 'multiple'>;
      providerType?: string;
    }
  ): string {
    assertNonEmptyString('resource.root', resource.root);
    const providerType = String(resource.providerType || resource.id).trim();
    assertNonEmptyString('providerType', providerType);

    // Convention for provider resource types:
    // extension.ci.providers.ci.ci-github
    const resourceTypeId = `${resource.root}.providers.${providerType}.${resource.id}`;

    return this.registerResourceType(
      {
        ...resource,
        resourceType: 'provider',
        instanceCount: normalizeInstanceCount(resource.instanceCount || 'multiple')
      },
      { resourceTypeId }
    );
  }

  /**
   * Register a runtime instance of a resource type.
   * This is intentionally low-level; higher-level helpers will be added as the refactor progresses.
   */
  registerResourceInstance(instance: WorkspaceResourceInstance): void {
    if (!instance || typeof instance !== 'object') {
      throw new Error('registerResourceInstance: instance must be an object');
    }
    assertNonEmptyString('instance.id', instance.id);
    assertNonEmptyString('instance.resourceTypeId', instance.resourceTypeId);
    assertNonEmptyString('instance.resourceType', instance.resourceType);
    this.resourceInstances[instance.id] = {
      ...instance,
      enabled: normalizeEnabled(instance.enabled)
    };
  }
}

export const workspace = Workspace.getInstance();

export function registerResourceType(resource: WorkspaceResourceWithAPI, opts?: { resourceTypeId?: string }): string {
  return workspace.registerResourceType(resource, opts);
}

export function registerExtention(
  resource: Omit<WorkspaceResourceWithAPI, 'resourceType' | 'instanceCount'> & { id: string; source: WorkspaceResourceSource }
): string {
  return workspace.registerExtention(resource);
}

export function registerProvider(
  resource: Omit<WorkspaceResourceWithAPI, 'resourceType'> & {
    id: string;
    source: WorkspaceResourceSource;
    root: string;
    instanceCount?: Extract<WorkspaceInstanceCount, 'single' | 'multiple'>;
    providerType?: string;
  }
): string {
  return workspace.registerProvider(resource);
}

