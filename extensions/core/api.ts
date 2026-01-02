import { z } from 'zod';

import { defineExtension, publicProcedure, workspace } from '@barducks/sdk';

const ProjectSchema = z.object({
  resourceId: z.string().min(1),
  resourceType: z.literal('project'),
  id: z.string().min(1),
  src: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  checks: z.array(z.unknown()).optional()
});

type Project = z.infer<typeof ProjectSchema>;

const ProjectPostInputSchema = z.object({
  projectId: z.string().min(1),
  src: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  checks: z.array(z.unknown()).optional()
});
type ProjectPostInput = z.infer<typeof ProjectPostInputSchema>;

const ProjectSetActiveInputSchema = z.object({
  projectId: z.string().min(1)
});
type ProjectSetActiveInput = z.infer<typeof ProjectSetActiveInputSchema>;

const ProjectGetActiveInputSchema = z.object({});
type ProjectGetActiveInput = z.infer<typeof ProjectGetActiveInputSchema>;

const ProjectListInputSchema = z.object({});
type ProjectListInput = z.infer<typeof ProjectListInputSchema>;

const OkSchema = z.object({ ok: z.boolean() });

export default defineExtension((_ext: Record<string, never>) => {
  return {
    api: {
      'project.post': publicProcedure
        .title('Register a new project')
        .input(ProjectPostInputSchema)
        .return(ProjectSchema)
        .query((input: ProjectPostInput) => workspace.projects.post({ id: input.projectId, src: input.src, title: input.title, description: input.description, checks: input.checks }) as Project),

      'project.setActive': publicProcedure
        .title('Set active project')
        .input(ProjectSetActiveInputSchema)
        .return(OkSchema)
        .query((input: ProjectSetActiveInput) => {
          workspace.projects.setActive(input.projectId);
          return { ok: true };
        }),

      'project.getActive': publicProcedure
        .title('Get active project (or the only project)')
        .input(ProjectGetActiveInputSchema)
        .return(ProjectSchema.nullable())
        .query((_input: ProjectGetActiveInput) => (workspace.projects.getActive() as Project | null)),

      'project.list': publicProcedure
        .title('List projects')
        .input(ProjectListInputSchema)
        .return(z.array(ProjectSchema))
        .query((_input: ProjectListInput) => workspace.projects.list() as Project[])
    },

    contracts: {
      project: {
        'project.post': publicProcedure.title('Register a new project').input(ProjectPostInputSchema).return(ProjectSchema),
        'project.setActive': publicProcedure.title('Set active project').input(ProjectSetActiveInputSchema).return(OkSchema),
        'project.getActive': publicProcedure.title('Get active project (or the only project)').input(ProjectGetActiveInputSchema).return(ProjectSchema.nullable()),
        'project.list': publicProcedure.title('List projects').input(ProjectListInputSchema).return(z.array(ProjectSchema))
      }
    }
  };
});

