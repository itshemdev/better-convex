import { defineSchema as defineConvexSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { convexTable, createOrm, defineRelations, id, integer, text } from '.';

const runtimeSchema = defineConvexSchema({
  poly_posts_runtime: defineTable({
    title: v.string(),
  }),
  poly_videos_runtime: defineTable({
    title: v.string(),
    duration: v.number(),
  }),
  poly_comments_runtime: defineTable({
    body: v.string(),
    targetType: v.string(),
    postId: v.optional(v.id('poly_posts_runtime')),
    videoId: v.optional(v.id('poly_videos_runtime')),
  }),
});

const posts = convexTable('poly_posts_runtime', {
  title: text().notNull(),
});

const videos = convexTable('poly_videos_runtime', {
  title: text().notNull(),
  duration: integer().notNull(),
});

const comments = convexTable('poly_comments_runtime', {
  body: text().notNull(),
  targetType: text().notNull(),
  postId: id('poly_posts_runtime'),
  videoId: id('poly_videos_runtime'),
});

const relations = defineRelations(
  {
    poly_posts_runtime: posts,
    poly_videos_runtime: videos,
    poly_comments_runtime: comments,
  },
  (r) => ({
    poly_comments_runtime: {
      post: r.one.poly_posts_runtime({
        from: r.poly_comments_runtime.postId,
        to: r.poly_posts_runtime.id,
      }),
      video: r.one.poly_videos_runtime({
        from: r.poly_comments_runtime.videoId,
        to: r.poly_videos_runtime.id,
      }),
    },
  })
);

const orm = createOrm({ schema: relations });

const defaultPolymorphicSchema = z.discriminatedUnion('targetType', [
  z.object({
    targetType: z.literal('post'),
    target: z.object({ title: z.string() }),
  }),
  z.object({
    targetType: z.literal('video'),
    target: z.object({ duration: z.number() }),
  }),
]);
const POLYMORPHIC_ERROR_PATTERN = /polymorphic/i;

describe('orm polymorphic query config', () => {
  test('findMany synthesizes target and hides auto-loaded case relations', async () => {
    const t = convexTest(runtimeSchema);
    await t.run(async (ctx) => {
      const postId = await ctx.db.insert('poly_posts_runtime', {
        title: 'Post title',
      });
      await ctx.db.insert('poly_comments_runtime', {
        body: 'Comment body',
        postId,
        targetType: 'post',
      });

      const db = orm.db(ctx.db as any);
      const rows = await db.query.poly_comments_runtime.findMany({
        polymorphic: {
          discriminator: 'targetType',
          schema: defaultPolymorphicSchema,
          cases: {
            post: 'post',
            video: 'video',
          },
        },
        limit: 10,
      });

      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row?.targetType).toBe('post');
      if (!row || row.targetType !== 'post') {
        throw new Error('Expected a post polymorphic row');
      }
      expect(row.target.title).toBe('Post title');
      expect(row).not.toHaveProperty('post');
      expect(row).not.toHaveProperty('video');
    });
  });

  test('explicit with keeps relation while polymorphic target is synthesized', async () => {
    const t = convexTest(runtimeSchema);
    await t.run(async (ctx) => {
      const postId = await ctx.db.insert('poly_posts_runtime', {
        title: 'Post title',
      });
      await ctx.db.insert('poly_comments_runtime', {
        body: 'Comment body',
        postId,
        targetType: 'post',
      });

      const db = orm.db(ctx.db as any);
      const rows = await db.query.poly_comments_runtime.findMany({
        with: {
          post: true,
        },
        polymorphic: {
          discriminator: 'targetType',
          schema: defaultPolymorphicSchema,
          cases: {
            post: 'post',
            video: 'video',
          },
        },
        limit: 10,
      });

      const row = rows[0];
      expect(row?.targetType).toBe('post');
      if (!row || row.targetType !== 'post') {
        throw new Error('Expected a post polymorphic row');
      }
      expect(row.target.title).toBe('Post title');
      expect(row.post?.title).toBe('Post title');
    });
  });

  test('findFirst and findFirstOrThrow support custom alias', async () => {
    const t = convexTest(runtimeSchema);
    await t.run(async (ctx) => {
      const postId = await ctx.db.insert('poly_posts_runtime', {
        title: 'Post title',
      });
      await ctx.db.insert('poly_comments_runtime', {
        body: 'Comment body',
        postId,
        targetType: 'post',
      });

      const customAliasSchema = z.discriminatedUnion('targetType', [
        z.object({
          targetType: z.literal('post'),
          entity: z.object({ title: z.string() }),
        }),
        z.object({
          targetType: z.literal('video'),
          entity: z.object({ duration: z.number() }),
        }),
      ]);

      const db = orm.db(ctx.db as any);
      const first = await db.query.poly_comments_runtime.findFirst({
        polymorphic: {
          discriminator: 'targetType',
          schema: customAliasSchema,
          cases: {
            post: 'post',
            video: 'video',
          },
          as: 'entity',
        },
      });
      const firstOrThrow =
        await db.query.poly_comments_runtime.findFirstOrThrow({
          polymorphic: {
            discriminator: 'targetType',
            schema: customAliasSchema,
            cases: {
              post: 'post',
              video: 'video',
            },
            as: 'entity',
          },
        });

      expect(first?.targetType).toBe('post');
      if (!first || first.targetType !== 'post') {
        throw new Error('Expected findFirst() to return post row');
      }
      expect(first.entity.title).toBe('Post title');
      expect(firstOrThrow.targetType).toBe('post');
      if (firstOrThrow.targetType !== 'post') {
        throw new Error('Expected findFirstOrThrow() to return post row');
      }
      expect(firstOrThrow.entity.title).toBe('Post title');
    });
  });

  test('throws when discriminator case relation is missing', async () => {
    const t = convexTest(runtimeSchema);
    await t.run(async (ctx) => {
      await ctx.db.insert('poly_comments_runtime', {
        body: 'Comment body',
        targetType: 'post',
      });

      const db = orm.db(ctx.db as any);
      await expect(
        db.query.poly_comments_runtime.findMany({
          polymorphic: {
            discriminator: 'targetType',
            schema: defaultPolymorphicSchema,
            cases: {
              post: 'post',
              video: 'video',
            },
          },
          limit: 10,
        })
      ).rejects.toThrow(POLYMORPHIC_ERROR_PATTERN);
    });
  });

  test('throws when discriminator value has no mapped polymorphic case', async () => {
    const t = convexTest(runtimeSchema);
    await t.run(async (ctx) => {
      await ctx.db.insert('poly_comments_runtime', {
        body: 'Comment body',
        targetType: 'image',
      });

      const db = orm.db(ctx.db as any);
      await expect(
        db.query.poly_comments_runtime.findMany({
          polymorphic: {
            discriminator: 'targetType',
            schema: defaultPolymorphicSchema,
            cases: {
              post: 'post',
              video: 'video',
            },
          },
          limit: 10,
        })
      ).rejects.toThrow(POLYMORPHIC_ERROR_PATTERN);
    });
  });

  test('throws when polymorphic schema parsing fails', async () => {
    const t = convexTest(runtimeSchema);
    await t.run(async (ctx) => {
      const postId = await ctx.db.insert('poly_posts_runtime', {
        title: 'Post title',
      });
      await ctx.db.insert('poly_comments_runtime', {
        body: 'Comment body',
        postId,
        targetType: 'post',
      });

      const invalidSchema = z.discriminatedUnion('targetType', [
        z.object({
          targetType: z.literal('post'),
          target: z.object({ title: z.literal('Wrong title') }),
        }),
        z.object({
          targetType: z.literal('video'),
          target: z.object({ duration: z.number() }),
        }),
      ]);

      const db = orm.db(ctx.db as any);
      await expect(
        db.query.poly_comments_runtime.findMany({
          polymorphic: {
            discriminator: 'targetType',
            schema: invalidSchema,
            cases: {
              post: 'post',
              video: 'video',
            },
          },
          limit: 10,
        })
      ).rejects.toThrow(POLYMORPHIC_ERROR_PATTERN);
    });
  });
});
