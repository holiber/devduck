import type { z } from 'zod';

import type { UnifiedRegistry } from '../unified-registry.js';
import type { ToolDef } from '../tool-spec.js';

function listToolsFromSpec(spec: { tools?: Record<string, ToolDef>; vendorTools?: Record<string, Record<string, ToolDef>> }): Array<{
  procedurePath: string;
  def: ToolDef;
}> {
  const out: Array<{ procedurePath: string; def: ToolDef }> = [];

  if (spec.tools) {
    for (const [name, def] of Object.entries(spec.tools)) {
      out.push({ procedurePath: name, def });
    }
  }

  if (spec.vendorTools) {
    for (const [ns, tools] of Object.entries(spec.vendorTools)) {
      for (const [name, def] of Object.entries(tools)) {
        out.push({ procedurePath: `vendor.${ns}.${name}`, def });
      }
    }
  }

  return out;
}

function shortDesc(def: ToolDef): string {
  return String(def.meta?.description || def.meta?.title || '').trim();
}

export function formatAvailableMethods(registry: UnifiedRegistry): string {
  let output = '';

  for (const moduleName of Object.keys(registry).sort()) {
    const entry = registry[moduleName];
    const title = entry.description || moduleName;
    output += `\n  ${title}:\n`;

    if (entry.spec && (entry.spec.tools || entry.spec.vendorTools)) {
      const tools = listToolsFromSpec(entry.spec as any);
      for (const { procedurePath, def } of tools) {
        const d = shortDesc(def);
        output += `    ${moduleName}.${procedurePath}${d ? `  - ${d}` : ''}\n`;
      }
      continue;
    }

    // Fallback for legacy modules: we don't have a spec yet.
    const procedures = (entry.router as any).procedures as Record<string, any> | undefined;
    if (!procedures) continue;
    for (const [procedureName, procedure] of Object.entries(procedures)) {
      const p = procedure as any;
      const d = String(p.meta?.description || p.meta?.title || '').trim();
      output += `    ${moduleName}.${procedureName}${d ? `  - ${d}` : ''}\n`;
    }
  }

  return output;
}

export type ResolvedProcedureFromSpec = {
  procedurePath: string;
  input: z.ZodTypeAny;
  output: z.ZodTypeAny;
  meta: ToolDef['meta'] | undefined;
  examples: Array<{ command: string; description?: string }> | undefined;
};

export function resolveProcedureFromSpec(spec: any, procedurePath: string): ResolvedProcedureFromSpec | null {
  if (!spec || typeof spec !== 'object') return null;

  if (procedurePath.startsWith('vendor.')) {
    const parts = procedurePath.split('.');
    if (parts.length < 3) return null;
    const ns = parts[1];
    const method = parts.slice(2).join('.');
    const def = spec.vendorTools?.[ns]?.[method] as ToolDef | undefined;
    if (!def) return null;
    return {
      procedurePath,
      input: def.input as z.ZodTypeAny,
      output: def.output as z.ZodTypeAny,
      meta: def.meta,
      examples: (def.meta && (def.meta as any).examples) || undefined
    };
  }

  const def = spec.tools?.[procedurePath] as ToolDef | undefined;
  if (!def) return null;

  return {
    procedurePath,
    input: def.input as z.ZodTypeAny,
    output: def.output as z.ZodTypeAny,
    meta: def.meta,
    examples: (def.meta && (def.meta as any).examples) || undefined
  };
}

