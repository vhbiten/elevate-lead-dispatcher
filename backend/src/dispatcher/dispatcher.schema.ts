import { z } from 'zod';

// Corpo de PUT /api/dispatcher: os call centers que mudam, com peso e ativo/pausado.
export const dispatcherConfigSchema = z.object({
  call_centers: z
    .array(
      z.object({
        slug: z.string().trim().min(1).max(100),
        weight: z.number().int().min(0).max(1000),
        active: z.boolean(),
      }),
    )
    .min(1)
    .refine((items) => new Set(items.map((item) => item.slug)).size === items.length, 'Each call center can appear only once'),
});

export type DispatcherConfigInput = z.infer<typeof dispatcherConfigSchema>;
