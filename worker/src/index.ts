import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './db/schema';

type Bindings = {
  DATABASE_URL: string;
  GEMINI_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', cors());

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/chat', async (c) => {
  const { prompt, userId } = await c.req.json();
  const genAI = new GoogleGenerativeAI(c.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  try {
    const result = await model.generateContentStream(prompt);
    
    // Log usage to database asynchronously without blocking response
    c.executionCtx.waitUntil((async () => {
      if (userId) {
        try {
          const sql = neon(c.env.DATABASE_URL);
          const db = drizzle(sql);
          await db.insert(schema.usageLogs).values({
            userId,
            tokens: 'stream', // Simplified token logging
          });
        } catch (dbError) {
          console.error("Failed to log usage:", dbError);
        }
      }
    })());

    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of result.stream) {
              const chunkText = chunk.text();
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text: chunkText })}\n\n`));
            }
            controller.enqueue(new TextEncoder().encode(`data: [DONE]\n\n`));
          } catch (streamError) {
            controller.error(streamError);
          } finally {
            controller.close();
          }
        },
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      }
    );
  } catch (error) {
    console.error("Chat API Error:", error);
    return c.json({ error: 'Failed to generate content' }, 500);
  }
});

app.get('/api/user', (c) => {
  return c.json({ id: 'dummy-user-uuid', role: 'free' });
});

export default app;
